use std::{
    collections::HashMap,
    fs,
    io::{Read, Write},
    net::{SocketAddr, TcpListener, TcpStream},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    webview::{NewWindowFeatures, NewWindowResponse, WebviewWindowBuilder},
    window::{Color, Monitor},
    AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, Runtime, State, Theme, WebviewUrl,
    Window,
};
use tauri_plugin_opener::OpenerExt;
use uuid::Uuid;

mod native_startup_logo;
#[cfg(target_os = "macos")]
mod webkit_storage_maintenance;

const TRAY_ID: &str = "main-tray";
const TRAY_SHOW_ID: &str = "tray-show";
const TRAY_HIDE_ID: &str = "tray-hide";
const TRAY_UNREAD_ID: &str = "tray-unread";
const TRAY_QUIT_ID: &str = "tray-quit";
const MENU_NEW_SESSION_ID: &str = "menu-new-session";
const MENU_SEARCH_ID: &str = "menu-search";
const MENU_FIND_ID: &str = "menu-find";
const MENU_SESSIONS_ID: &str = "menu-sessions";
const MENU_INBOX_ID: &str = "menu-inbox";
const MENU_DOOTASK_ID: &str = "menu-dootask";
const MENU_SETTINGS_ID: &str = "menu-settings";
const MENU_BACK_ID: &str = "menu-back";
const MENU_FORWARD_ID: &str = "menu-forward";
const MENU_SOFTWARE_UPDATE_ID: &str = "menu-software-update";
const DESKTOP_MENU_ACTION_EVENT: &str = "desktop-menu-action";
const UNAUTHENTICATED_WINDOW_WIDTH: f64 = 800.0;
const UNAUTHENTICATED_WINDOW_HEIGHT: f64 = 600.0;
const AUTHENTICATED_WINDOW_WIDTH: f64 = 1440.0;
const AUTHENTICATED_WINDOW_HEIGHT: f64 = 900.0;
const AUTHENTICATED_MINIMUM_WIDTH: f64 = 1100.0;
const AUTHENTICATED_MINIMUM_HEIGHT: f64 = 700.0;
const WINDOW_EDGE_MARGIN: i32 = 8;
const BOOTSTRAP_CACHE_FILE: &str = "desktop-bootstrap.json";
const BOOTSTRAP_CACHE_VERSION: u32 = 1;
const LIGHT_BACKGROUND_RGB: (u8, u8, u8) = (245, 245, 245);
const DARK_BACKGROUND_RGB: (u8, u8, u8) = (30, 30, 30);
const HTML_PREVIEW_MAX_AGE: Duration = Duration::from_secs(24 * 60 * 60);
#[cfg(target_os = "macos")]
const AUTHENTICATED_TRAFFIC_LIGHT_Y: f64 = 26.0;
#[cfg(target_os = "macos")]
const UNAUTHENTICATED_TRAFFIC_LIGHT_Y: f64 = 30.0;
#[cfg(target_os = "macos")]
const AUTHENTICATED_TRAFFIC_LIGHT_X: f64 = 16.0;
#[cfg(target_os = "macos")]
const UNAUTHENTICATED_TRAFFIC_LIGHT_X: f64 = 20.0;
const DESKTOP_NOTIFICATION_CLICKED_EVENT: &str = "desktop-notification-clicked";
const DESKTOP_NOTIFICATION_PROTOCOL_PREFIX: &str = "happy-next://notification/";

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopNotificationClicked {
    session_id: Option<String>,
    notification_id: Option<i32>,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopMenuAction {
    action: &'static str,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopDiagnostics {
    app_name: String,
    app_version: String,
    identifier: String,
    operating_system: &'static str,
    architecture: &'static str,
    build_profile: &'static str,
    updater_test_mode: bool,
    log_directory: String,
}

#[derive(Clone, Copy, Debug, Default, serde::Deserialize, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum DesktopThemePreference {
    Light,
    Dark,
    #[default]
    Adaptive,
}

#[derive(Clone, Debug, serde::Deserialize, serde::Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct AuthenticatedWindowState {
    x: i32,
    y: i32,
    width: f64,
    height: f64,
    #[serde(default)]
    maximized: bool,
}

#[derive(Clone, Debug, serde::Deserialize, serde::Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct DesktopBootstrapState {
    #[serde(default = "bootstrap_cache_version")]
    version: u32,
    #[serde(default)]
    last_authenticated: bool,
    #[serde(default)]
    theme_preference: DesktopThemePreference,
    #[serde(default)]
    window: Option<AuthenticatedWindowState>,
}

const fn bootstrap_cache_version() -> u32 {
    BOOTSTRAP_CACHE_VERSION
}

impl Default for DesktopBootstrapState {
    fn default() -> Self {
        Self {
            version: BOOTSTRAP_CACHE_VERSION,
            last_authenticated: false,
            theme_preference: DesktopThemePreference::Adaptive,
            window: None,
        }
    }
}

struct DesktopState {
    close_to_tray: AtomicBool,
    explicit_quit: AtomicBool,
    authenticated: AtomicBool,
    bootstrap: Mutex<DesktopBootstrapState>,
    bootstrap_path: Mutex<Option<PathBuf>>,
    save_generation: Arc<AtomicU64>,
    ignore_window_events_until: Mutex<Option<Instant>>,
    unread_item: Mutex<Option<MenuItem<tauri::Wry>>>,
    html_preview_server: Mutex<Option<HtmlPreviewServer>>,
    notification_activation: Mutex<DesktopNotificationActivationState>,
}

#[derive(Default)]
struct DesktopNotificationActivationState {
    listener_ready: bool,
    pending_ids: Vec<i32>,
}

impl Default for DesktopState {
    fn default() -> Self {
        Self {
            close_to_tray: AtomicBool::new(true),
            explicit_quit: AtomicBool::new(false),
            authenticated: AtomicBool::new(false),
            bootstrap: Mutex::new(DesktopBootstrapState::default()),
            bootstrap_path: Mutex::new(None),
            save_generation: Arc::new(AtomicU64::new(0)),
            ignore_window_events_until: Mutex::new(None),
            unread_item: Mutex::new(None),
            html_preview_server: Mutex::new(None),
            notification_activation: Mutex::new(DesktopNotificationActivationState {
                listener_ready: false,
                pending_ids: notification_ids_from_args(std::env::args()),
            }),
        }
    }
}

#[derive(Clone)]
struct HtmlPreviewServer {
    address: SocketAddr,
    previews: Arc<Mutex<HashMap<String, HtmlPreviewEntry>>>,
}

struct HtmlPreviewEntry {
    html: Arc<str>,
    dark: bool,
    created_at: Instant,
}

fn show_main_window(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    {
        let _ = app.show();
        let authenticated = app
            .state::<DesktopState>()
            .authenticated
            .load(Ordering::SeqCst);
        show_prepared_macos_window(app, authenticated);
        schedule_macos_traffic_light_reconciliation(app);
    }

    #[cfg(target_os = "windows")]
    {
        show_prepared_windows_window(app);
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn hide_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
}

fn toggle_main_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };

    if window.is_visible().unwrap_or(false) && window.is_focused().unwrap_or(false) {
        let _ = window.hide();
    } else {
        show_main_window(app);
    }
}

fn quit_app<R: Runtime>(app: &AppHandle<R>) {
    app.state::<DesktopState>()
        .explicit_quit
        .store(true, Ordering::SeqCst);
    app.exit(0);
}

fn notification_ids_from_args<I, S>(args: I) -> Vec<i32>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    args.into_iter()
        .filter_map(|argument| {
            positive_notification_id(
                argument
                    .as_ref()
                    .strip_prefix(DESKTOP_NOTIFICATION_PROTOCOL_PREFIX)?,
            )
        })
        .collect()
}

fn positive_notification_id(value: &str) -> Option<i32> {
    value.parse::<i32>().ok().filter(|id| *id > 0)
}

#[cfg(target_os = "windows")]
fn set_windows_registry_string(
    path: &str,
    name: Option<&str>,
    value: &str,
    expandable: bool,
) -> Result<(), String> {
    use windows_sys::Win32::{
        Foundation::ERROR_SUCCESS,
        System::Registry::{
            RegCloseKey, RegCreateKeyW, RegSetValueExW, HKEY, HKEY_CURRENT_USER, REG_EXPAND_SZ,
            REG_SZ,
        },
    };

    fn wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(std::iter::once(0)).collect()
    }

    let path = wide(path);
    let name = name.map(wide);
    let value = wide(value);
    let mut key: HKEY = std::ptr::null_mut();
    let create_result = unsafe { RegCreateKeyW(HKEY_CURRENT_USER, path.as_ptr(), &mut key) };
    if create_result != ERROR_SUCCESS {
        return Err(format!("failed to create registry key: {create_result}"));
    }

    let name_ptr = name.as_ref().map_or(std::ptr::null(), |name| name.as_ptr());
    let set_result = unsafe {
        RegSetValueExW(
            key,
            name_ptr,
            0,
            if expandable { REG_EXPAND_SZ } else { REG_SZ },
            value.as_ptr().cast(),
            (value.len() * std::mem::size_of::<u16>()) as u32,
        )
    };
    unsafe {
        RegCloseKey(key);
    }
    if set_result == ERROR_SUCCESS {
        Ok(())
    } else {
        Err(format!("failed to set registry value: {set_result}"))
    }
}

#[cfg(target_os = "windows")]
fn register_windows_notification_protocol(app: &AppHandle) -> Result<(), String> {
    let executable = std::env::current_exe().map_err(|error| error.to_string())?;
    let notification_icon =
        windows_notification_icon_path(app).unwrap_or_else(|| executable.clone());
    let command = format!("\"{}\" \"%1\"", executable.display());
    let protocol_key = r"Software\Classes\happy-next";
    set_windows_registry_string(protocol_key, None, "URL:Happy Next notification", false)?;
    set_windows_registry_string(protocol_key, Some("URL Protocol"), "", false)?;
    set_windows_registry_string(
        r"Software\Classes\happy-next\DefaultIcon",
        None,
        &format!("\"{}\",0", executable.display()),
        false,
    )?;
    set_windows_registry_string(
        r"Software\Classes\happy-next\shell\open\command",
        None,
        &command,
        false,
    )?;

    let app_id_key = format!(
        r"Software\Classes\AppUserModelId\{}",
        app.config().identifier
    );
    set_windows_registry_string(
        &app_id_key,
        Some("DisplayName"),
        app.config().product_name.as_deref().unwrap_or("Happy Next"),
        true,
    )?;
    set_windows_registry_string(
        &app_id_key,
        Some("IconUri"),
        &notification_icon.display().to_string(),
        true,
    )
}

#[cfg(target_os = "windows")]
fn escape_windows_toast_xml(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

#[cfg(target_os = "windows")]
fn windows_notification_icon_path(app: &AppHandle) -> Option<PathBuf> {
    let path = app
        .path()
        .resolve(
            "icons/notification.png",
            tauri::path::BaseDirectory::Resource,
        )
        .ok()
        .filter(|path| path.is_file())?;
    let path = path.to_string_lossy();
    let path = if let Some(path) = path.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{path}")
    } else {
        path.strip_prefix(r"\\?\").unwrap_or(&path).to_string()
    };
    Some(PathBuf::from(path))
}

#[cfg(target_os = "windows")]
fn windows_notification_icon_uri(app: &AppHandle) -> Option<String> {
    tauri::Url::from_file_path(windows_notification_icon_path(app)?)
        .ok()
        .map(|url| url.to_string())
}

#[cfg(target_os = "windows")]
fn show_windows_notification(
    app: &AppHandle,
    notification_id: i32,
    title: &str,
    body: &str,
) -> Result<(), String> {
    use windows::{
        core::HSTRING,
        Data::Xml::Dom::XmlDocument,
        UI::Notifications::{ToastNotification, ToastNotificationManager},
    };

    let document = XmlDocument::new().map_err(|error| error.to_string())?;
    let activation_url = format!("{DESKTOP_NOTIFICATION_PROTOCOL_PREFIX}{notification_id}");
    let icon = windows_notification_icon_uri(app).map_or_else(String::new, |uri| {
        format!(
            r#"<image placement="appLogoOverride" src="{}" alt="Happy Next"/>"#,
            escape_windows_toast_xml(&uri)
        )
    });
    let xml = format!(
        r#"<toast activationType="protocol" launch="{activation_url}"><visual><binding template="ToastGeneric">{icon}<text>{}</text><text>{}</text></binding></visual></toast>"#,
        escape_windows_toast_xml(title),
        escape_windows_toast_xml(body),
    );
    document
        .LoadXml(&HSTRING::from(xml))
        .map_err(|error| error.to_string())?;
    let toast =
        ToastNotification::CreateToastNotification(&document).map_err(|error| error.to_string())?;
    toast
        .SetTag(&HSTRING::from(notification_id.to_string()))
        .map_err(|error| error.to_string())?;
    let notifier = ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(
        app.config().identifier.as_str(),
    ))
    .map_err(|error| error.to_string())?;
    notifier.Show(&toast).map_err(|error| error.to_string())
}

fn activate_desktop_notification(app: &AppHandle, notification_id: i32) {
    show_main_window(app);
    let should_emit =
        if let Ok(mut activation) = app.state::<DesktopState>().notification_activation.lock() {
            if activation.listener_ready {
                true
            } else {
                if !activation.pending_ids.contains(&notification_id) {
                    activation.pending_ids.push(notification_id);
                }
                false
            }
        } else {
            false
        };

    if should_emit {
        let _ = app.emit(
            DESKTOP_NOTIFICATION_CLICKED_EVENT,
            DesktopNotificationClicked {
                session_id: None,
                notification_id: Some(notification_id),
            },
        );
    }
}

#[cfg(target_os = "macos")]
mod macos_notification_delegate {
    use super::{activate_desktop_notification, positive_notification_id};
    use block2::DynBlock;
    use objc2::rc::Retained;
    use objc2::runtime::ProtocolObject;
    use objc2::{define_class, msg_send, AnyThread, DefinedClass};
    use objc2_foundation::{NSObject, NSObjectProtocol};
    use objc2_user_notifications::{
        UNNotification, UNNotificationPresentationOptions, UNNotificationResponse,
        UNUserNotificationCenter, UNUserNotificationCenterDelegate,
    };
    use std::sync::OnceLock;
    use tauri::AppHandle;

    define_class!(
        // SAFETY: NSObject has no subclassing requirements, and the ivar is valid
        // for the lifetime of the delegate retained below.
        #[unsafe(super(NSObject))]
        #[name = "HappyNotificationCenterDelegate"]
        #[ivars = AppHandle]
        struct NotificationCenterDelegate;

        unsafe impl NSObjectProtocol for NotificationCenterDelegate {}

        unsafe impl UNUserNotificationCenterDelegate for NotificationCenterDelegate {
            #[unsafe(method(userNotificationCenter:willPresentNotification:withCompletionHandler:))]
            unsafe fn will_present(
                &self,
                _center: &UNUserNotificationCenter,
                _notification: &UNNotification,
                completion_handler: &DynBlock<dyn Fn(UNNotificationPresentationOptions)>,
            ) {
                completion_handler.call((UNNotificationPresentationOptions::Badge
                    | UNNotificationPresentationOptions::Sound
                    | UNNotificationPresentationOptions::Banner
                    | UNNotificationPresentationOptions::List,));
            }

            #[unsafe(method(userNotificationCenter:didReceiveNotificationResponse:withCompletionHandler:))]
            unsafe fn did_receive(
                &self,
                _center: &UNUserNotificationCenter,
                response: &UNNotificationResponse,
                completion_handler: &DynBlock<dyn Fn()>,
            ) {
                let identifier = unsafe { response.notification().request().identifier() };
                if let Some(notification_id) = positive_notification_id(&identifier.to_string()) {
                    activate_desktop_notification(self.ivars(), notification_id);
                } else {
                    log::warn!("Ignoring macOS notification with invalid identifier: {identifier}");
                }
                completion_handler.call(());
            }
        }
    );

    impl NotificationCenterDelegate {
        fn new(app: AppHandle) -> Retained<Self> {
            let this = Self::alloc().set_ivars(app);
            unsafe { msg_send![super(this), init] }
        }
    }

    static DELEGATE: OnceLock<Retained<NotificationCenterDelegate>> = OnceLock::new();

    pub fn install(app: &AppHandle) -> Result<(), String> {
        let delegate = DELEGATE.get_or_init(|| NotificationCenterDelegate::new(app.clone()));
        let center = unsafe { UNUserNotificationCenter::currentNotificationCenter() };
        unsafe {
            center.setDelegate(Some(ProtocolObject::from_ref(&**delegate)));
        }
        Ok(())
    }
}

#[tauri::command]
fn set_desktop_notification_click_listener_ready(
    state: State<'_, DesktopState>,
    ready: bool,
) -> Vec<i32> {
    let Ok(mut activation) = state.notification_activation.lock() else {
        return Vec::new();
    };
    activation.listener_ready = ready;
    if ready {
        std::mem::take(&mut activation.pending_ids)
    } else {
        Vec::new()
    }
}

#[tauri::command]
fn set_close_to_tray(state: State<'_, DesktopState>, enabled: bool) {
    state.close_to_tray.store(enabled, Ordering::SeqCst);
}

#[tauri::command]
fn show_desktop_window(app: AppHandle) {
    show_main_window(&app);
}

#[tauri::command]
fn dismiss_native_startup_logo(app: AppHandle) {
    native_startup_logo::dismiss(&app);
}

#[tauri::command]
async fn show_desktop_notification(
    app: AppHandle,
    notification_id: i32,
    title: String,
    body: String,
    session_id: String,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use tauri::plugin::PermissionState;
        use tauri_plugin_notifications::NotificationsExt;

        let permission = app
            .notifications()
            .request_permission()
            .await
            .map_err(|error| format!("failed to request notification permission: {error}"))?;
        if permission != PermissionState::Granted {
            return Err(format!(
                "macOS notification permission is not granted: {permission:?}"
            ));
        }

        app.notifications()
            .builder()
            .id(notification_id)
            .title(title)
            .body(body)
            .extra("sessionId", session_id)
            .auto_cancel()
            .show()
            .await
            .map_err(|error| error.to_string())?;
        return Ok(());
    }

    #[cfg(target_os = "windows")]
    {
        let _ = session_id;
        show_windows_notification(&app, notification_id, &title, &body)?;
        return Ok(());
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let mut notification = notify_rust::Notification::new();
        notification.summary(&title).body(&body);

        let handle = notification.show().map_err(|error| error.to_string())?;
        std::thread::spawn(move || {
            let _ = handle.wait_for_response(|response: &notify_rust::NotificationResponse| {
                if !matches!(
                    response,
                    notify_rust::NotificationResponse::Default
                        | notify_rust::NotificationResponse::Action(_)
                        | notify_rust::NotificationResponse::Reply(_)
                ) {
                    return;
                }

                show_main_window(&app);
                let _ = app.emit(
                    DESKTOP_NOTIFICATION_CLICKED_EVENT,
                    DesktopNotificationClicked {
                        session_id: Some(session_id),
                        notification_id: None,
                    },
                );
            });
        });
        Ok(())
    }
}

#[tauri::command]
fn toggle_desktop_window(app: AppHandle) {
    toggle_main_window(&app);
}

#[tauri::command]
fn set_desktop_unread_count(app: AppHandle, state: State<'_, DesktopState>, count: u32) {
    apply_desktop_unread_count(&app, &state, count);
}

#[cfg(target_os = "windows")]
fn windows_unread_overlay_icon() -> tauri::image::Image<'static> {
    const SIZE: u32 = 32;
    const CENTER: f32 = (SIZE as f32 - 1.0) / 2.0;
    const OUTER_RADIUS: f32 = 13.5;
    const INNER_RADIUS: f32 = 9.5;
    const UNREAD_BLUE: [u8; 3] = [0, 122, 255];

    let mut rgba = Vec::with_capacity((SIZE * SIZE * 4) as usize);
    for y in 0..SIZE {
        for x in 0..SIZE {
            let dx = x as f32 - CENTER;
            let dy = y as f32 - CENTER;
            let distance = (dx * dx + dy * dy).sqrt();
            let outer_coverage = (OUTER_RADIUS + 0.5 - distance).clamp(0.0, 1.0);
            let inner_coverage = (INNER_RADIUS + 0.5 - distance).clamp(0.0, 1.0);
            let blend = inner_coverage;

            rgba.extend_from_slice(&[
                ((255.0 * (1.0 - blend)) + (UNREAD_BLUE[0] as f32 * blend)).round() as u8,
                ((255.0 * (1.0 - blend)) + (UNREAD_BLUE[1] as f32 * blend)).round() as u8,
                ((255.0 * (1.0 - blend)) + (UNREAD_BLUE[2] as f32 * blend)).round() as u8,
                (255.0 * outer_coverage).round() as u8,
            ]);
        }
    }

    tauri::image::Image::new_owned(rgba, SIZE, SIZE)
}

fn apply_desktop_unread_count<R: Runtime>(app: &AppHandle<R>, state: &DesktopState, count: u32) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_badge_count((count > 0).then_some(count as i64));

        #[cfg(target_os = "windows")]
        {
            let overlay = if count > 0 {
                Some(windows_unread_overlay_icon())
            } else {
                None
            };
            let _ = window.set_overlay_icon(overlay);
        }
    }

    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let tooltip = if count == 0 {
            "Happy Next".to_string()
        } else {
            format!("Happy Next · {count} sessions need attention")
        };
        let _ = tray.set_tooltip(Some(tooltip));

        #[cfg(target_os = "macos")]
        let _ = tray.set_title(None::<String>);
    }

    if let Ok(item) = state.unread_item.lock() {
        if let Some(item) = item.as_ref() {
            let text = if count == 0 {
                "No sessions need attention".to_string()
            } else if count == 1 {
                "1 session needs attention".to_string()
            } else {
                format!("{count} sessions need attention")
            };
            let _ = item.set_text(text);
        }
    }
}

fn build_application_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let new_session = MenuItem::with_id(
        app,
        MENU_NEW_SESSION_ID,
        "New Session",
        true,
        Some("CmdOrCtrl+N"),
    )?;
    let search = MenuItem::with_id(app, MENU_SEARCH_ID, "Search…", true, Some("CmdOrCtrl+K"))?;
    let find = MenuItem::with_id(app, MENU_FIND_ID, "Find…", true, Some("CmdOrCtrl+F"))?;
    let sessions = MenuItem::with_id(app, MENU_SESSIONS_ID, "Sessions", true, Some("CmdOrCtrl+1"))?;
    let inbox = MenuItem::with_id(app, MENU_INBOX_ID, "Inbox", true, Some("CmdOrCtrl+2"))?;
    let dootask = MenuItem::with_id(app, MENU_DOOTASK_ID, "DooTask", true, Some("CmdOrCtrl+3"))?;
    #[cfg(not(target_os = "macos"))]
    let settings = MenuItem::with_id(
        app,
        MENU_SETTINGS_ID,
        "Settings…",
        true,
        Some("CmdOrCtrl+,"),
    )?;
    #[cfg(target_os = "macos")]
    let back_accelerator = "CmdOrCtrl+[";
    #[cfg(not(target_os = "macos"))]
    let back_accelerator = "Alt+Left";
    let back = MenuItem::with_id(app, MENU_BACK_ID, "Back", true, Some(back_accelerator))?;
    #[cfg(target_os = "macos")]
    let forward_accelerator = "CmdOrCtrl+]";
    #[cfg(not(target_os = "macos"))]
    let forward_accelerator = "Alt+Right";
    let forward = MenuItem::with_id(
        app,
        MENU_FORWARD_ID,
        "Forward",
        true,
        Some(forward_accelerator),
    )?;
    let software_update = MenuItem::with_id(
        app,
        MENU_SOFTWARE_UPDATE_ID,
        "Check for Updates…",
        true,
        None::<&str>,
    )?;

    let file_menu = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &new_session,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, None)?,
            #[cfg(not(target_os = "macos"))]
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?;
    let edit_menu = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;
    let navigate_menu = Submenu::with_items(
        app,
        "Navigate",
        true,
        &[
            &search,
            &find,
            &PredefinedMenuItem::separator(app)?,
            &sessions,
            &inbox,
            &dootask,
            #[cfg(not(target_os = "macos"))]
            &settings,
            &PredefinedMenuItem::separator(app)?,
            &back,
            &forward,
        ],
    )?;
    let window_menu = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, None)?,
            #[cfg(target_os = "macos")]
            &PredefinedMenuItem::fullscreen(app, None)?,
        ],
    )?;

    #[cfg(target_os = "macos")]
    {
        let app_settings = MenuItem::with_id(
            app,
            MENU_SETTINGS_ID,
            "Settings…",
            true,
            Some("CmdOrCtrl+,"),
        )?;
        let app_menu = Submenu::with_items(
            app,
            "Happy Next",
            true,
            &[
                &PredefinedMenuItem::about(app, None, None)?,
                &software_update,
                &PredefinedMenuItem::separator(app)?,
                &app_settings,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::services(app, None)?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::hide(app, None)?,
                &PredefinedMenuItem::hide_others(app, None)?,
                &PredefinedMenuItem::show_all(app, None)?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::quit(app, None)?,
            ],
        )?;
        Menu::with_items(
            app,
            &[
                &app_menu,
                &file_menu,
                &edit_menu,
                &navigate_menu,
                &window_menu,
            ],
        )
    }

    #[cfg(not(target_os = "macos"))]
    {
        let help_menu = Submenu::with_items(
            app,
            "Help",
            true,
            &[
                &software_update,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::about(app, None, None)?,
            ],
        )?;
        Menu::with_items(
            app,
            &[
                &file_menu,
                &edit_menu,
                &navigate_menu,
                &window_menu,
                &help_menu,
            ],
        )
    }
}

fn handle_application_menu_event(app: &AppHandle, id: &str) {
    let action = match id {
        MENU_NEW_SESSION_ID => "newSession",
        MENU_SEARCH_ID | MENU_FIND_ID => "search",
        MENU_SESSIONS_ID => "sessions",
        MENU_INBOX_ID => "inbox",
        MENU_DOOTASK_ID => "dootask",
        MENU_SETTINGS_ID => "settings",
        MENU_BACK_ID => "back",
        MENU_FORWARD_ID => "forward",
        MENU_SOFTWARE_UPDATE_ID => "softwareUpdate",
        _ => return,
    };
    show_main_window(app);
    let _ = app.emit(DESKTOP_MENU_ACTION_EVENT, DesktopMenuAction { action });
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, TRAY_SHOW_ID, "Show Happy Next", true, None::<&str>)?;
    let hide = MenuItem::with_id(app, TRAY_HIDE_ID, "Hide Window", true, None::<&str>)?;
    let unread = MenuItem::with_id(
        app,
        TRAY_UNREAD_ID,
        "No sessions need attention",
        false,
        None::<&str>,
    )?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, TRAY_QUIT_ID, "Quit Happy Next", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &hide, &unread, &separator, &quit])?;

    if let Ok(mut item) = app.state::<DesktopState>().unread_item.lock() {
        *item = Some(unread);
    }

    let mut tray = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .tooltip("Happy Next")
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            TRAY_SHOW_ID => show_main_window(app),
            TRAY_HIDE_ID => hide_main_window(app),
            TRAY_QUIT_ID => quit_app(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } | TrayIconEvent::DoubleClick {
                    button: MouseButton::Left,
                    ..
                }
            ) {
                toggle_main_window(tray.app_handle());
            }
        });

    #[cfg(target_os = "macos")]
    {
        let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray-icon.png"))?;
        tray = tray.icon(icon).icon_as_template(true);
    }

    #[cfg(not(target_os = "macos"))]
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }

    tray.build(app)?;
    Ok(())
}

fn should_start_hidden() -> bool {
    std::env::args().any(|arg| arg == "--hidden")
}

fn read_bootstrap_state(path: &Path) -> DesktopBootstrapState {
    let Ok(contents) = fs::read(path) else {
        return DesktopBootstrapState::default();
    };
    let Ok(mut state) = serde_json::from_slice::<DesktopBootstrapState>(&contents) else {
        return DesktopBootstrapState::default();
    };
    if state.version != BOOTSTRAP_CACHE_VERSION {
        return DesktopBootstrapState::default();
    }
    if let Some(window) = state.window.as_ref() {
        if !window.width.is_finite()
            || !window.height.is_finite()
            || window.width <= 0.0
            || window.height <= 0.0
        {
            state.window = None;
        }
    }
    state
}

fn write_bootstrap_state(path: &Path, state: &DesktopBootstrapState) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let contents = serde_json::to_vec_pretty(state).map_err(std::io::Error::other)?;
    let temporary_path = path.with_extension("json.tmp");
    fs::write(&temporary_path, contents)?;
    #[cfg(target_os = "windows")]
    if path.exists() {
        fs::remove_file(path)?;
    }
    fs::rename(temporary_path, path)
}

fn persist_bootstrap_state(state: &DesktopState) {
    let path = state
        .bootstrap_path
        .lock()
        .ok()
        .and_then(|path| path.clone());
    let snapshot = state.bootstrap.lock().ok().map(|state| state.clone());
    if let (Some(path), Some(snapshot)) = (path, snapshot) {
        let _ = write_bootstrap_state(&path, &snapshot);
    }
}

fn schedule_bootstrap_save(state: &DesktopState) {
    let path = state
        .bootstrap_path
        .lock()
        .ok()
        .and_then(|path| path.clone());
    let snapshot = state.bootstrap.lock().ok().map(|state| state.clone());
    let generation = state.save_generation.fetch_add(1, Ordering::SeqCst) + 1;
    let save_generation = Arc::clone(&state.save_generation);
    if let (Some(path), Some(snapshot)) = (path, snapshot) {
        thread::spawn(move || {
            thread::sleep(Duration::from_millis(350));
            if save_generation.load(Ordering::SeqCst) == generation {
                let _ = write_bootstrap_state(&path, &snapshot);
            }
        });
    }
}

fn rectangles_intersection_area(left: (i64, i64, i64, i64), right: (i64, i64, i64, i64)) -> i64 {
    let width = (left.2.min(right.2) - left.0.max(right.0)).max(0);
    let height = (left.3.min(right.3) - left.1.max(right.1)).max(0);
    width * height
}

fn monitor_rect(monitor: &Monitor) -> (i64, i64, i64, i64) {
    let area = monitor.work_area();
    let x = i64::from(area.position.x);
    let y = i64::from(area.position.y);
    (
        x,
        y,
        x + i64::from(area.size.width),
        y + i64::from(area.size.height),
    )
}

fn choose_restore_monitor<'a>(
    monitors: &'a [Monitor],
    saved: &AuthenticatedWindowState,
) -> Option<&'a Monitor> {
    monitors
        .iter()
        .map(|monitor| {
            let scale = monitor.scale_factor();
            let saved_width = (saved.width * scale).round().max(1.0) as i64;
            let saved_height = (saved.height * scale).round().max(1.0) as i64;
            let area = rectangles_intersection_area(
                (
                    i64::from(saved.x),
                    i64::from(saved.y),
                    i64::from(saved.x) + saved_width,
                    i64::from(saved.y) + saved_height,
                ),
                monitor_rect(monitor),
            );
            (monitor, area)
        })
        .max_by_key(|(_, area)| *area)
        .and_then(|(monitor, area)| (area > 0).then_some(monitor))
}

fn clamp_window_to_monitor(
    saved: Option<&AuthenticatedWindowState>,
    monitor: &Monitor,
    default_width: f64,
    default_height: f64,
    minimum_width: f64,
    minimum_height: f64,
) -> AuthenticatedWindowState {
    let scale = monitor.scale_factor();
    let area = monitor.work_area();
    let available_width =
        (f64::from(area.size.width) / scale - f64::from(WINDOW_EDGE_MARGIN * 2) / scale).max(1.0);
    let available_height =
        (f64::from(area.size.height) / scale - f64::from(WINDOW_EDGE_MARGIN * 2) / scale).max(1.0);
    let width = saved
        .map(|window| window.width)
        .unwrap_or(default_width)
        .clamp(minimum_width.min(available_width), available_width);
    let height = saved
        .map(|window| window.height)
        .unwrap_or(default_height)
        .clamp(minimum_height.min(available_height), available_height);
    let physical_width = (width * scale).round() as i64;
    let physical_height = (height * scale).round() as i64;
    let area_left = i64::from(area.position.x) + i64::from(WINDOW_EDGE_MARGIN);
    let area_top = i64::from(area.position.y) + i64::from(WINDOW_EDGE_MARGIN);
    let area_right =
        i64::from(area.position.x) + i64::from(area.size.width) - i64::from(WINDOW_EDGE_MARGIN);
    let area_bottom =
        i64::from(area.position.y) + i64::from(area.size.height) - i64::from(WINDOW_EDGE_MARGIN);

    let (x, y) = if let Some(saved) = saved {
        (
            i64::from(saved.x).clamp(area_left, (area_right - physical_width).max(area_left)),
            i64::from(saved.y).clamp(area_top, (area_bottom - physical_height).max(area_top)),
        )
    } else {
        (
            area_left + (area_right - area_left - physical_width).max(0) / 2,
            area_top + (area_bottom - area_top - physical_height).max(0) / 2,
        )
    };

    AuthenticatedWindowState {
        x: x as i32,
        y: y as i32,
        width,
        height,
        maximized: saved.is_some_and(|window| window.maximized),
    }
}

fn resolve_dark_background(
    window: &tauri::WebviewWindow,
    preference: DesktopThemePreference,
) -> bool {
    match preference {
        DesktopThemePreference::Light => false,
        DesktopThemePreference::Dark => true,
        DesktopThemePreference::Adaptive => window.theme().is_ok_and(|theme| theme == Theme::Dark),
    }
}

fn set_desktop_background(window: &tauri::WebviewWindow, preference: DesktopThemePreference) {
    let dark = resolve_dark_background(window, preference);
    let (red, green, blue) = if dark {
        DARK_BACKGROUND_RGB
    } else {
        LIGHT_BACKGROUND_RGB
    };
    let color = Color(red, green, blue, 255);
    let _ = window.set_background_color(Some(color));

    #[cfg(target_os = "macos")]
    {
        use objc2_app_kit::{
            NSAppearanceNameAqua, NSAppearanceNameDarkAqua, NSApplication, NSColor, NSWindow,
        };
        use objc2_foundation::NSArray;
        use objc2_web_kit::WKWebView;

        let _ = window.with_webview(move |webview| {
            // SAFETY: Tauri provides the live WKWebView pointer and invokes this
            // callback on the WebView UI thread.
            unsafe {
                let dark = match preference {
                    DesktopThemePreference::Light => false,
                    DesktopThemePreference::Dark => true,
                    DesktopThemePreference::Adaptive => {
                        let main_thread = objc2::MainThreadMarker::new()
                            .expect("macOS appearance lookup must run on the main thread");
                        let application = NSApplication::sharedApplication(main_thread);
                        let appearances =
                            NSArray::from_slice(&[NSAppearanceNameAqua, NSAppearanceNameDarkAqua]);
                        application
                            .effectiveAppearance()
                            .bestMatchFromAppearancesWithNames(&appearances)
                            .is_some_and(|appearance| {
                                appearance.isEqualToString(NSAppearanceNameDarkAqua)
                            })
                    }
                };
                let (red, green, blue) = if dark {
                    DARK_BACKGROUND_RGB
                } else {
                    LIGHT_BACKGROUND_RGB
                };
                let color = NSColor::colorWithSRGBRed_green_blue_alpha(
                    f64::from(red) / 255.0,
                    f64::from(green) / 255.0,
                    f64::from(blue) / 255.0,
                    1.0,
                );
                let ns_window = &*webview.ns_window().cast::<NSWindow>();
                let webview = &*webview.inner().cast::<WKWebView>();
                webview.setUnderPageBackgroundColor(Some(&color));
                ns_window.setBackgroundColor(Some(&color));
            }
        });
    }
}

#[cfg(target_os = "macos")]
unsafe fn apply_macos_traffic_light_position(
    ns_window: &objc2_app_kit::NSWindow,
    authenticated: bool,
) {
    use objc2_app_kit::{NSView, NSWindowButton};

    let (x, y) = if authenticated {
        (AUTHENTICATED_TRAFFIC_LIGHT_X, AUTHENTICATED_TRAFFIC_LIGHT_Y)
    } else {
        (
            UNAUTHENTICATED_TRAFFIC_LIGHT_X,
            UNAUTHENTICATED_TRAFFIC_LIGHT_Y,
        )
    };

    let Some(close) = ns_window.standardWindowButton(NSWindowButton::CloseButton) else {
        return;
    };
    let Some(miniaturize) = ns_window.standardWindowButton(NSWindowButton::MiniaturizeButton)
    else {
        return;
    };
    let zoom = ns_window.standardWindowButton(NSWindowButton::ZoomButton);

    let Some(title_bar_view) = close.superview().and_then(|view| view.superview()) else {
        return;
    };
    title_bar_view.layoutSubtreeIfNeeded();
    let close_rect = NSView::frame(&close);
    let title_bar_height = close_rect.size.height + y;
    let mut title_bar_rect = NSView::frame(&title_bar_view);
    if (close_rect.origin.x - x).abs() < 0.25
        && (title_bar_rect.size.height - title_bar_height).abs() < 0.25
    {
        return;
    }
    title_bar_rect.size.height = title_bar_height;
    title_bar_rect.origin.y = ns_window.frame().size.height - title_bar_height;
    title_bar_view.setFrame(title_bar_rect);

    let spacing = NSView::frame(&miniaturize).origin.x - close_rect.origin.x;
    for (index, button) in [Some(close), Some(miniaturize), zoom]
        .into_iter()
        .flatten()
        .enumerate()
    {
        let mut origin = NSView::frame(&button).origin;
        origin.x = x + index as f64 * spacing;
        button.setFrameOrigin(origin);
    }
    ns_window.displayIfNeeded();
}

#[cfg(target_os = "macos")]
fn reconcile_macos_traffic_light_position(app: &AppHandle) {
    use objc2_app_kit::NSWindow;

    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let app = app.clone();
    let _ = window.with_webview(move |webview| {
        let authenticated = app
            .state::<DesktopState>()
            .authenticated
            .load(Ordering::SeqCst);
        // SAFETY: Tauri provides the live NSWindow on the WebView UI thread.
        unsafe {
            let ns_window = &*webview.ns_window().cast::<NSWindow>();
            apply_macos_traffic_light_position(ns_window, authenticated);
        }
    });
}

#[cfg(target_os = "macos")]
fn schedule_macos_traffic_light_reconciliation(app: &AppHandle) {
    for delay in [Duration::from_millis(50), Duration::from_millis(200)] {
        let scheduler = app.clone();
        let callback_app = app.clone();
        thread::spawn(move || {
            thread::sleep(delay);
            let _ = scheduler.run_on_main_thread(move || {
                reconcile_macos_traffic_light_position(&callback_app);
            });
        });
    }
}

#[cfg(target_os = "macos")]
fn show_prepared_macos_window(app: &AppHandle, authenticated: bool) {
    if !native_startup_logo::is_pending() {
        present_macos_window(app, authenticated, false);
        return;
    }

    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let scheduler = app.clone();
    let callback_app = app.clone();
    thread::spawn(move || {
        // Window setters issued during setup are dispatched through the platform event loop.
        // Keep the window hidden until its physical frame is unchanged across two samples.
        let mut previous = None;
        let mut stable_samples = 0;
        for _ in 0..12 {
            let current = window
                .outer_position()
                .ok()
                .zip(window.outer_size().ok())
                .map(|(position, size)| (position.x, position.y, size.width, size.height));
            if current.is_some() && current == previous {
                stable_samples += 1;
                if stable_samples >= 2 {
                    break;
                }
            } else {
                stable_samples = 0;
                previous = current;
            }
            thread::sleep(Duration::from_millis(16));
        }

        let _ = scheduler.run_on_main_thread(move || {
            present_macos_window(&callback_app, authenticated, true);
        });
    });
}

#[cfg(target_os = "macos")]
fn present_macos_window(app: &AppHandle, authenticated: bool, install_startup_logo: bool) {
    use objc2_app_kit::{NSApplication, NSWindow};

    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let theme_preference = app
        .state::<DesktopState>()
        .bootstrap
        .lock()
        .ok()
        .map(|bootstrap| bootstrap.theme_preference)
        .unwrap_or_default();
    let dark = resolve_dark_background(&window, theme_preference);
    let _ = window.with_webview(move |webview| {
        // SAFETY: The callback runs on the main thread with the live NSWindow.
        unsafe {
            let ns_window = &*webview.ns_window().cast::<NSWindow>();
            apply_macos_traffic_light_position(ns_window, authenticated);
            if install_startup_logo {
                native_startup_logo::install_macos(ns_window, dark);
            }
            ns_window.deminiaturize(None);
            ns_window.makeKeyAndOrderFront(None);
            let main_thread = objc2::MainThreadMarker::new()
                .expect("macOS application activation must run on the main thread");
            #[allow(deprecated)]
            NSApplication::sharedApplication(main_thread).activateIgnoringOtherApps(true);
        }
    });
}

#[cfg(target_os = "windows")]
fn show_prepared_windows_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    if !native_startup_logo::is_pending() {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        return;
    }

    let theme_preference = app
        .state::<DesktopState>()
        .bootstrap
        .lock()
        .ok()
        .map(|bootstrap| bootstrap.theme_preference)
        .unwrap_or_default();
    let dark = resolve_dark_background(&window, theme_preference);
    let scheduler = app.clone();
    thread::spawn(move || {
        let mut previous = None;
        let mut stable_samples = 0;
        for _ in 0..12 {
            let current = window
                .outer_position()
                .ok()
                .zip(window.outer_size().ok())
                .map(|(position, size)| (position.x, position.y, size.width, size.height));
            if current.is_some() && current == previous {
                stable_samples += 1;
                if stable_samples >= 2 {
                    break;
                }
            } else {
                stable_samples = 0;
                previous = current;
            }
            thread::sleep(Duration::from_millis(16));
        }

        let callback_app = scheduler.clone();
        let _ = scheduler.run_on_main_thread(move || {
            let Some(window) = callback_app.get_webview_window("main") else {
                return;
            };
            native_startup_logo::install_windows(&window, dark);
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
        });
    });
}

fn configure_desktop_window(app: &AppHandle, authenticated: bool) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let state = app.state::<DesktopState>();
    if let Ok(mut ignore_until) = state.ignore_window_events_until.lock() {
        *ignore_until = Some(Instant::now() + Duration::from_millis(750));
    }
    let _ = window.unmaximize();
    let _ = window.set_resizable(true);

    if authenticated {
        let saved = state
            .bootstrap
            .lock()
            .ok()
            .and_then(|bootstrap| bootstrap.window.clone());
        let monitors = window.available_monitors().unwrap_or_default();
        let primary_monitor = window.primary_monitor().ok().flatten();
        let monitor = saved
            .as_ref()
            .and_then(|saved| choose_restore_monitor(&monitors, saved))
            .or_else(|| {
                primary_monitor.as_ref().and_then(|primary| {
                    monitors
                        .iter()
                        .find(|monitor| monitor.position() == primary.position())
                })
            })
            .or_else(|| monitors.first());
        let target = monitor.map(|monitor| {
            clamp_window_to_monitor(
                saved.as_ref(),
                monitor,
                AUTHENTICATED_WINDOW_WIDTH,
                AUTHENTICATED_WINDOW_HEIGHT,
                AUTHENTICATED_MINIMUM_WIDTH,
                AUTHENTICATED_MINIMUM_HEIGHT,
            )
        });
        let target_width = target
            .as_ref()
            .map(|window| window.width)
            .unwrap_or(AUTHENTICATED_WINDOW_WIDTH);
        let target_height = target
            .as_ref()
            .map(|window| window.height)
            .unwrap_or(AUTHENTICATED_WINDOW_HEIGHT);
        let _ = window.set_min_size(Some(LogicalSize::new(
            AUTHENTICATED_MINIMUM_WIDTH.min(target_width),
            AUTHENTICATED_MINIMUM_HEIGHT.min(target_height),
        )));
        let _ = window.set_size(LogicalSize::new(target_width, target_height));
        if let Some(target) = target.as_ref() {
            let _ = window.set_position(PhysicalPosition::new(target.x, target.y));
            if target.maximized {
                let _ = window.maximize();
            }
        } else {
            let _ = window.center();
        }
    } else {
        let _ = window.set_min_size(None::<LogicalSize<f64>>);
        let monitor = window
            .current_monitor()
            .ok()
            .flatten()
            .or_else(|| window.primary_monitor().ok().flatten());
        if let Some(monitor) = monitor {
            let target = clamp_window_to_monitor(
                None,
                &monitor,
                UNAUTHENTICATED_WINDOW_WIDTH,
                UNAUTHENTICATED_WINDOW_HEIGHT,
                480.0,
                480.0,
            );
            let _ = window.set_size(LogicalSize::new(target.width, target.height));
            let _ = window.set_position(PhysicalPosition::new(target.x, target.y));
        } else {
            let _ = window.set_size(LogicalSize::new(
                UNAUTHENTICATED_WINDOW_WIDTH,
                UNAUTHENTICATED_WINDOW_HEIGHT,
            ));
            let _ = window.center();
        }
    }
    let _ = window.set_resizable(authenticated);

    #[cfg(target_os = "macos")]
    {
        reconcile_macos_traffic_light_position(app);
        schedule_macos_traffic_light_reconciliation(app);
    }
}

fn capture_authenticated_window_state(window: &Window, state: &DesktopState) {
    if !state.authenticated.load(Ordering::SeqCst) {
        return;
    }
    if state
        .ignore_window_events_until
        .lock()
        .ok()
        .and_then(|until| *until)
        .is_some_and(|until| Instant::now() < until)
    {
        return;
    }
    let maximized = window.is_maximized().unwrap_or(false);
    if let Ok(mut bootstrap) = state.bootstrap.lock() {
        let saved = bootstrap.window.get_or_insert(AuthenticatedWindowState {
            x: 0,
            y: 0,
            width: AUTHENTICATED_WINDOW_WIDTH,
            height: AUTHENTICATED_WINDOW_HEIGHT,
            maximized,
        });
        saved.maximized = maximized;
        if !maximized {
            if let Ok(position) = window.outer_position() {
                saved.x = position.x;
                saved.y = position.y;
            }
            if let (Ok(size), Ok(scale)) = (window.inner_size(), window.scale_factor()) {
                let logical = size.to_logical::<f64>(scale);
                if logical.width.is_finite() && logical.height.is_finite() {
                    saved.width = logical.width;
                    saved.height = logical.height;
                }
            }
        }
    }
    schedule_bootstrap_save(state);
}

#[tauri::command]
fn sync_desktop_bootstrap_state(
    app: AppHandle,
    authenticated: bool,
    theme_preference: DesktopThemePreference,
) {
    let state = app.state::<DesktopState>();
    let authentication_changed =
        state.authenticated.swap(authenticated, Ordering::SeqCst) != authenticated;
    if let Ok(mut bootstrap) = state.bootstrap.lock() {
        bootstrap.last_authenticated = authenticated;
        bootstrap.theme_preference = theme_preference;
    }

    if let Some(window) = app.get_webview_window("main") {
        set_desktop_background(&window, theme_preference);
    }
    if authentication_changed {
        configure_desktop_window(&app, authenticated);
    }
    if !authenticated {
        apply_desktop_unread_count(&app, &state, 0);
    }
    schedule_bootstrap_save(&state);
}

#[tauri::command]
fn start_desktop_window_dragging(window: tauri::WebviewWindow) -> Result<(), String> {
    window.start_dragging().map_err(|error| error.to_string())
}

#[tauri::command]
fn get_desktop_diagnostics(app: AppHandle) -> Result<DesktopDiagnostics, String> {
    let log_directory = app
        .path()
        .app_log_dir()
        .map_err(|error| error.to_string())?;
    Ok(DesktopDiagnostics {
        app_name: app.package_info().name.clone(),
        app_version: app.package_info().version.to_string(),
        identifier: app.config().identifier.clone(),
        operating_system: std::env::consts::OS,
        architecture: std::env::consts::ARCH,
        build_profile: if cfg!(debug_assertions) {
            "debug"
        } else {
            "release"
        },
        updater_test_mode: option_env!("HAPPY_UPDATER_TEST_MODE") == Some("1"),
        log_directory: log_directory.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
fn open_desktop_log_directory(app: AppHandle) -> Result<(), String> {
    let directory = app
        .path()
        .app_log_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    app.opener()
        .open_path(directory.to_string_lossy().into_owned(), None::<String>)
        .map_err(|error| error.to_string())
}

fn write_http_response(
    stream: &mut TcpStream,
    status: &str,
    content_type: &str,
    body: &[u8],
    include_body: bool,
) -> std::io::Result<()> {
    write!(
        stream,
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n",
        body.len()
    )?;
    if include_body {
        stream.write_all(body)?;
    }
    stream.flush()
}

fn handle_html_preview_request(
    mut stream: TcpStream,
    previews: &Arc<Mutex<HashMap<String, HtmlPreviewEntry>>>,
) -> std::io::Result<()> {
    stream.set_read_timeout(Some(Duration::from_secs(2)))?;
    stream.set_write_timeout(Some(Duration::from_secs(5)))?;
    let mut request = [0_u8; 8192];
    let bytes_read = stream.read(&mut request)?;
    let request = String::from_utf8_lossy(&request[..bytes_read]);
    let Some(request_line) = request.lines().next() else {
        return write_http_response(
            &mut stream,
            "400 Bad Request",
            "text/plain; charset=utf-8",
            b"Bad request",
            true,
        );
    };
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or_default();
    let path = parts.next().unwrap_or_default();
    let include_body = method != "HEAD";
    if method != "GET" && method != "HEAD" {
        return write_http_response(
            &mut stream,
            "405 Method Not Allowed",
            "text/plain; charset=utf-8",
            b"Method not allowed",
            include_body,
        );
    }

    let preview_path = path
        .split('?')
        .next()
        .and_then(|path| path.strip_prefix("/preview/"));
    let route = preview_path.and_then(|path| {
        let mut segments = path.split('/');
        let token = segments.next().filter(|token| !token.is_empty())?;
        let resource = segments.next();
        if segments.next().is_some() || resource.is_some_and(|resource| resource != "content") {
            return None;
        }
        Some((token, resource == Some("content")))
    });
    let preview = route.and_then(|(token, content)| {
        let mut entries = previews.lock().ok()?;
        entries.retain(|_, entry| entry.created_at.elapsed() < HTML_PREVIEW_MAX_AGE);
        entries.get(token).map(|entry| {
            (
                token.to_string(),
                content,
                Arc::clone(&entry.html),
                entry.dark,
            )
        })
    });
    if let Some((token, content, html, dark)) = preview {
        if content {
            write_http_response(
                &mut stream,
                "200 OK",
                "text/html; charset=utf-8",
                html.as_bytes(),
                include_body,
            )
        } else {
            let scheme = if dark { "dark" } else { "light" };
            let background = if dark { "#1e1e1e" } else { "#f5f5f5" };
            let shell = format!(
                "<!doctype html><html style=\"color-scheme:{scheme}\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><meta name=\"color-scheme\" content=\"{scheme}\"><style>html,body{{width:100%;height:100%;margin:0;overflow:hidden;background:{background};color-scheme:{scheme}}}iframe{{display:block;width:100%;height:100%;border:0;background:transparent}}</style></head><body><iframe title=\"HTML Preview\" src=\"/preview/{token}/content\"></iframe></body></html>"
            );
            write_http_response(
                &mut stream,
                "200 OK",
                "text/html; charset=utf-8",
                shell.as_bytes(),
                include_body,
            )
        }
    } else {
        write_http_response(
            &mut stream,
            "404 Not Found",
            "text/plain; charset=utf-8",
            b"Preview not found or expired",
            include_body,
        )
    }
}

fn start_html_preview_server() -> Result<HtmlPreviewServer, String> {
    let listener =
        TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0)).map_err(|error| error.to_string())?;
    let address = listener.local_addr().map_err(|error| error.to_string())?;
    let previews = Arc::new(Mutex::new(HashMap::new()));
    let thread_previews = Arc::clone(&previews);
    thread::Builder::new()
        .name("happy-html-preview".to_string())
        .spawn(move || {
            for connection in listener.incoming() {
                match connection {
                    Ok(stream) => {
                        if let Err(error) = handle_html_preview_request(stream, &thread_previews) {
                            log::debug!("HTML preview request failed: {error}");
                        }
                    }
                    Err(error) => {
                        log::warn!("HTML preview server stopped: {error}");
                        break;
                    }
                }
            }
        })
        .map_err(|error| error.to_string())?;
    Ok(HtmlPreviewServer { address, previews })
}

fn html_preview_server(state: &DesktopState) -> Result<HtmlPreviewServer, String> {
    let mut server = state
        .html_preview_server
        .lock()
        .map_err(|_| "HTML preview server lock poisoned".to_string())?;
    if server.is_none() {
        *server = Some(start_html_preview_server()?);
    }
    server
        .as_ref()
        .cloned()
        .ok_or_else(|| "Failed to start HTML preview server".to_string())
}

fn store_html_preview(
    state: &DesktopState,
    html: String,
    dark: bool,
) -> Result<(HtmlPreviewServer, String, tauri::Url), String> {
    let server = html_preview_server(state)?;
    let token = Uuid::new_v4().simple().to_string();
    {
        let mut previews = server
            .previews
            .lock()
            .map_err(|_| "HTML preview store lock poisoned".to_string())?;
        previews.retain(|_, entry| entry.created_at.elapsed() < HTML_PREVIEW_MAX_AGE);
        previews.insert(
            token.clone(),
            HtmlPreviewEntry {
                html: Arc::<str>::from(html),
                dark,
                created_at: Instant::now(),
            },
        );
    }

    let url = format!("http://{}/preview/{token}", server.address)
        .parse::<tauri::Url>()
        .map_err(|error| error.to_string())?;
    Ok((server, token, url))
}

fn remove_html_preview(server: &HtmlPreviewServer, token: &str) {
    if let Ok(mut previews) = server.previews.lock() {
        previews.remove(token);
    }
}

fn preview_shell_url_for_content(url: &tauri::Url) -> Option<tauri::Url> {
    if url.scheme() != "http" || url.host_str() != Some("127.0.0.1") {
        return None;
    }
    let shell_path = url.path().strip_suffix("/content")?;
    if !shell_path.starts_with("/preview/") || shell_path == "/preview/" {
        return None;
    }

    let mut shell_url = url.clone();
    shell_url.set_path(shell_path);
    shell_url.set_query(None);
    shell_url.set_fragment(None);
    Some(shell_url)
}

fn remove_windows_child_window_menu(window: &tauri::WebviewWindow<tauri::Wry>) {
    #[cfg(target_os = "windows")]
    if let Err(error) = window.remove_menu() {
        log::warn!("Failed to remove child window menu: {error}");
    }

    #[cfg(not(target_os = "windows"))]
    let _ = window;
}

fn create_html_preview_child_window(
    app: &AppHandle,
    requested_url: tauri::Url,
    features: NewWindowFeatures,
    dark: bool,
    preview_title: Arc<str>,
) -> NewWindowResponse<tauri::Wry> {
    let label = format!("html-preview-child-{}", Uuid::new_v4().simple());
    let (red, green, blue) = if dark {
        DARK_BACKGROUND_RGB
    } else {
        LIGHT_BACKGROUND_RGB
    };
    let window_theme = if dark { Theme::Dark } else { Theme::Light };
    let nested_app = app.clone();
    let nested_title = Arc::clone(&preview_title);

    if let Some(shell_url) = preview_shell_url_for_content(&requested_url) {
        let result = WebviewWindowBuilder::new(app, label, WebviewUrl::External(shell_url))
            .title(preview_title.to_string())
            .inner_size(1100.0, 760.0)
            .min_inner_size(640.0, 400.0)
            .window_features(features)
            .theme(Some(window_theme))
            .background_color(Color(red, green, blue, 255))
            .on_new_window(move |url, features| {
                create_html_preview_child_window(
                    &nested_app,
                    url,
                    features,
                    dark,
                    Arc::clone(&nested_title),
                )
            })
            .build();

        match result {
            Ok(window) => remove_windows_child_window_menu(&window),
            Err(error) => log::warn!("Failed to create isolated HTML frame window: {error}"),
        }
        return NewWindowResponse::Deny;
    }

    let blank_url = "about:blank"
        .parse::<tauri::Url>()
        .expect("about:blank must be a valid URL");

    let result = WebviewWindowBuilder::new(app, label, WebviewUrl::External(blank_url))
        .title(requested_url.as_str())
        .inner_size(1100.0, 760.0)
        .min_inner_size(640.0, 400.0)
        .window_features(features)
        .theme(Some(window_theme))
        .background_color(Color(red, green, blue, 255))
        .on_document_title_changed(|window, title| {
            let _ = window.set_title(&title);
        })
        .on_new_window(move |url, features| {
            create_html_preview_child_window(
                &nested_app,
                url,
                features,
                dark,
                Arc::clone(&nested_title),
            )
        })
        .build();

    match result {
        Ok(window) => {
            remove_windows_child_window_menu(&window);
            NewWindowResponse::Create { window }
        }
        Err(error) => {
            log::warn!("Failed to create HTML preview child window: {error}");
            NewWindowResponse::Deny
        }
    }
}

#[tauri::command]
async fn open_desktop_html_preview(
    app: AppHandle,
    state: State<'_, DesktopState>,
    html: String,
    title: Option<String>,
) -> Result<(), String> {
    let preference = state
        .bootstrap
        .lock()
        .map(|bootstrap| bootstrap.theme_preference)
        .unwrap_or_default();
    let dark = app
        .get_webview_window("main")
        .is_some_and(|window| resolve_dark_background(&window, preference));
    let (server, token, url) = store_html_preview(&state, html, dark)?;
    let label = format!("html-preview-{token}");
    let window_title = title
        .filter(|title| !title.trim().is_empty())
        .unwrap_or_else(|| "HTML Preview".to_string());
    let (red, green, blue) = if dark {
        DARK_BACKGROUND_RGB
    } else {
        LIGHT_BACKGROUND_RGB
    };
    let window_theme = if dark { Theme::Dark } else { Theme::Light };
    let popup_app = app.clone();
    let popup_title = Arc::<str>::from(window_title.clone());

    let result = WebviewWindowBuilder::new(&app, label, WebviewUrl::External(url.clone()))
        .title(window_title)
        .inner_size(1100.0, 760.0)
        .min_inner_size(640.0, 400.0)
        .center()
        .theme(Some(window_theme))
        .background_color(Color(red, green, blue, 255))
        .on_new_window(move |url, features| {
            create_html_preview_child_window(
                &popup_app,
                url,
                features,
                dark,
                Arc::clone(&popup_title),
            )
        })
        .build();

    match result {
        Ok(window) => {
            remove_windows_child_window_menu(&window);
            Ok(())
        }
        Err(window_error) => {
            remove_html_preview(&server, &token);
            Err(window_error.to_string())
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let context = tauri::generate_context!();
    #[cfg(target_os = "macos")]
    webkit_storage_maintenance::run(&context.config().identifier);

    let log_level = if cfg!(debug_assertions) {
        log::LevelFilter::Debug
    } else {
        log::LevelFilter::Info
    };
    let builder = tauri::Builder::default()
        .manage(DesktopState::default())
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(log_level)
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepSome(3))
                .max_file_size(1_000_000)
                .build(),
        );

    #[cfg(target_os = "macos")]
    let builder = builder.plugin(tauri_plugin_notifications::init());

    builder
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            #[cfg(target_os = "windows")]
            if let Some(notification_id) = notification_ids_from_args(_args).into_iter().next() {
                activate_desktop_notification(app, notification_id);
                return;
            }
            show_main_window(app);
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .args(["--hidden"])
                .build(),
        )
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .menu(build_application_menu)
        .on_menu_event(|app, event| {
            handle_application_menu_event(app, event.id().as_ref());
        })
        .invoke_handler(tauri::generate_handler![
            set_close_to_tray,
            dismiss_native_startup_logo,
            sync_desktop_bootstrap_state,
            start_desktop_window_dragging,
            show_desktop_window,
            show_desktop_notification,
            set_desktop_notification_click_listener_ready,
            toggle_desktop_window,
            set_desktop_unread_count,
            get_desktop_diagnostics,
            open_desktop_log_directory,
            open_desktop_html_preview
        ])
        .setup(|app| {
            #[cfg(debug_assertions)]
            if std::env::var_os("HAPPY_OPEN_DEVTOOLS").is_some() {
                if let Some(window) = app.get_webview_window("main") {
                    window.open_devtools();
                }
            }

            build_tray(app.handle())?;
            #[cfg(target_os = "macos")]
            macos_notification_delegate::install(app.handle())?;
            #[cfg(target_os = "windows")]
            {
                if let Err(error) = register_windows_notification_protocol(app.handle()) {
                    log::warn!("Failed to register Windows notification protocol: {error}");
                }
                if let Some(window) = app.get_webview_window("main") {
                    window.set_decorations(false)?;
                }
            }

            let bootstrap_path = app
                .path()
                .app_config_dir()
                .map(|directory| directory.join(BOOTSTRAP_CACHE_FILE))?;
            let bootstrap = read_bootstrap_state(&bootstrap_path);
            let authenticated = bootstrap.last_authenticated;
            let theme_preference = bootstrap.theme_preference;
            let state = app.state::<DesktopState>();
            state.authenticated.store(authenticated, Ordering::SeqCst);
            if let Ok(mut path) = state.bootstrap_path.lock() {
                *path = Some(bootstrap_path);
            }
            if let Ok(mut cached) = state.bootstrap.lock() {
                *cached = bootstrap;
            }
            if let Some(window) = app.get_webview_window("main") {
                set_desktop_background(&window, theme_preference);
            }
            configure_desktop_window(app.handle(), authenticated);
            log::info!(
                "desktop setup complete (profile={}, os={}, arch={})",
                if cfg!(debug_assertions) {
                    "debug"
                } else {
                    "release"
                },
                std::env::consts::OS,
                std::env::consts::ARCH
            );
            Ok(())
        })
        .on_window_event(|window: &Window, event| {
            if matches!(
                event,
                tauri::WindowEvent::Moved(_)
                    | tauri::WindowEvent::Resized(_)
                    | tauri::WindowEvent::ScaleFactorChanged { .. }
            ) {
                capture_authenticated_window_state(window, &window.state::<DesktopState>());
            }
            #[cfg(target_os = "windows")]
            if matches!(
                event,
                tauri::WindowEvent::Resized(_) | tauri::WindowEvent::ScaleFactorChanged { .. }
            ) {
                native_startup_logo::resize_windows(window);
            }
            #[cfg(target_os = "macos")]
            if matches!(
                event,
                tauri::WindowEvent::Resized(_) | tauri::WindowEvent::ScaleFactorChanged { .. }
            ) {
                reconcile_macos_traffic_light_position(window.app_handle());
            }
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let state = window.state::<DesktopState>();
                if state.explicit_quit.load(Ordering::SeqCst) {
                    return;
                }

                if state.close_to_tray.load(Ordering::SeqCst) {
                    api.prevent_close();
                    let _ = window.hide();
                } else {
                    state.explicit_quit.store(true, Ordering::SeqCst);
                    window.app_handle().exit(0);
                }
            }
        })
        .build(context)
        .expect("error while building tauri application")
        .run(|app, event| match event {
            tauri::RunEvent::Ready => {
                if should_start_hidden() {
                    hide_main_window(app);
                } else {
                    show_main_window(app);
                }
            }
            tauri::RunEvent::Exit => persist_bootstrap_state(&app.state::<DesktopState>()),
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen {
                has_visible_windows: false,
                ..
            } => show_main_window(app),
            _ => {}
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bootstrap_cache_uses_safe_defaults_for_missing_fields() {
        let state: DesktopBootstrapState = serde_json::from_str(r#"{"version":1}"#).unwrap();
        assert!(!state.last_authenticated);
        assert_eq!(state.theme_preference, DesktopThemePreference::Adaptive);
        assert_eq!(state.window, None);
    }

    #[test]
    fn bootstrap_cache_round_trips_authenticated_window_state() {
        let state = DesktopBootstrapState {
            version: BOOTSTRAP_CACHE_VERSION,
            last_authenticated: true,
            theme_preference: DesktopThemePreference::Dark,
            window: Some(AuthenticatedWindowState {
                x: -1280,
                y: 24,
                width: 1440.0,
                height: 900.0,
                maximized: true,
            }),
        };
        let encoded = serde_json::to_string(&state).unwrap();
        let decoded: DesktopBootstrapState = serde_json::from_str(&encoded).unwrap();
        assert_eq!(decoded, state);
    }

    #[test]
    fn extracts_notification_ids_from_protocol_activation_arguments() {
        assert_eq!(
            notification_ids_from_args([
                "happy-next.exe",
                "happy-next://notification/42",
                "--hidden",
            ]),
            vec![42]
        );
        assert!(notification_ids_from_args([
            "happy-next://notification/not-a-number",
            "happy-next://notification/-1",
            "https://example.com/notification/42",
        ])
        .is_empty());
    }

    #[test]
    fn offscreen_rectangles_have_no_intersection() {
        assert_eq!(
            rectangles_intersection_area((3000, 3000, 3800, 3600), (0, 0, 1920, 1080)),
            0
        );
        assert_eq!(
            rectangles_intersection_area((1600, 800, 2200, 1200), (0, 0, 1920, 1080)),
            89_600
        );
    }

    #[test]
    fn html_preview_server_serves_tokenized_html_without_caching() {
        let server = start_html_preview_server().unwrap();
        server.previews.lock().unwrap().insert(
            "test-token".to_string(),
            HtmlPreviewEntry {
                html: Arc::<str>::from("<html><body>preview</body></html>"),
                dark: true,
                created_at: Instant::now(),
            },
        );

        let mut stream = TcpStream::connect(server.address).unwrap();
        stream
            .write_all(b"GET /preview/test-token HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n")
            .unwrap();
        stream.shutdown(std::net::Shutdown::Write).unwrap();
        let mut response = String::new();
        stream.read_to_string(&mut response).unwrap();

        assert!(response.starts_with("HTTP/1.1 200 OK\r\n"));
        assert!(response.contains("Cache-Control: no-store\r\n"));
        assert!(response.contains("<meta name=\"color-scheme\" content=\"dark\">"));
        assert!(response.contains("src=\"/preview/test-token/content\""));

        let mut stream = TcpStream::connect(server.address).unwrap();
        stream
            .write_all(b"GET /preview/test-token/content HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n")
            .unwrap();
        stream.shutdown(std::net::Shutdown::Write).unwrap();
        let mut response = String::new();
        stream.read_to_string(&mut response).unwrap();

        assert!(response.starts_with("HTTP/1.1 200 OK\r\n"));
        assert!(response.ends_with("<html><body>preview</body></html>"));
    }

    #[test]
    fn preview_frame_content_reopens_through_the_theme_shell() {
        let content = "http://127.0.0.1:43123/preview/token/content?ignored=1#section"
            .parse::<tauri::Url>()
            .unwrap();
        let shell = preview_shell_url_for_content(&content).unwrap();

        assert_eq!(shell.as_str(), "http://127.0.0.1:43123/preview/token");
        assert!(preview_shell_url_for_content(
            &"https://example.com/content".parse::<tauri::Url>().unwrap()
        )
        .is_none());
    }
}
