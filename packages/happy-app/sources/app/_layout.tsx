import 'react-native-quick-base64';
import '@/encryption/ed25519.setup';
import '../theme.css';
import * as React from 'react';
import * as SplashScreen from 'expo-splash-screen';
import * as Fonts from 'expo-font';
import * as Notifications from 'expo-notifications';
import { FontAwesome, FontAwesome6, Ionicons, Octicons, MaterialCommunityIcons, AntDesign, SimpleLineIcons } from '@expo/vector-icons';
import { AuthCredentials, TokenStorage } from '@/auth/tokenStorage';
import { AuthProvider } from '@/auth/AuthContext';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { initialWindowMetrics, SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import { SidebarNavigator } from '@/components/SidebarNavigator';
import sodium from '@/encryption/libsodium.lib';
import { AppState, View, Platform } from 'react-native';
import { ModalProvider } from '@/modal';
import { PostHogProvider } from 'posthog-react-native';
import { tracking } from '@/track/tracking';
import { sync, syncRestore } from '@/sync/sync';
import { resetBadgeCount } from '@/sync/apiPush';
import { resolveServerConfig } from '@/sync/serverConfig';
import { useTrackScreens } from '@/track/useTrackScreens';
import { RealtimeProvider } from '@/realtime/RealtimeProvider';
import { FaviconPermissionIndicator } from '@/components/web/FaviconPermissionIndicator';
import { CommandPaletteProvider } from '@/components/CommandPalette/CommandPaletteProvider';
import { StatusBarProvider } from '@/components/StatusBarProvider';
import { ToastHost } from '@/components/Toast';
import { TtsFloatingPlayer } from '@/components/TtsFloatingPlayer';
// import * as SystemUI from 'expo-system-ui';
import { monkeyPatchConsoleForRemoteLoggingForFasterAiAutoDebuggingOnlyInLocalBuilds } from '@/utils/remoteLogger';
import { useUnistyles } from 'react-native-unistyles';
import { AsyncLock } from '@/utils/lock';
import { storage } from '@/sync/storage';
import { usePathname } from 'expo-router';
import { useDootaskGlobalWebSocket } from '@/hooks/useDootaskGlobalWebSocket';
import { isTauriDesktop } from '@/utils/tauri';
import { DesktopBridge } from '@/desktop/DesktopBridge';
import { DesktopWindowFrame } from '@/desktop/DesktopWindowFrame';
import { DesktopAuthWindowSync } from '@/desktop/DesktopAuthWindowSync';
import { ThemePreferenceSync } from '@/components/ThemePreferenceSync';
import { ActionMenuOverlayProvider } from '@/components/ActionMenuOverlayProvider';
import { getNotificationSessionId } from '@/utils/notificationData';

let currentAppState: string = AppState.currentState;
let currentSessionId: string | null = null;

function shouldHideForegroundNotification(notification: Notifications.Notification): boolean {
    if (currentAppState !== 'active') {
        return false;
    }

    const { localSettings } = storage.getState();

    if (localSettings.hideNotificationsWhenActive) {
        return true;
    }

    if (!localSettings.hideSessionNotificationsWhenActive) {
        return false;
    }

    const notificationSessionId = getNotificationSessionId(notification.request?.content?.data);
    return !!notificationSessionId && notificationSessionId === currentSessionId;
}

// Mute all notification sounds while a voice conversation is active
// to avoid audio interference. Notifications still display normally.
function shouldMuteNotificationSound(): boolean {
    return currentAppState === 'active' && storage.getState().realtimeStatus === 'connected';
}

function getSessionIdFromPath(pathname: string | null | undefined): string | null {
    if (!pathname) {
        return null;
    }
    const match = pathname.match(/\/session\/([^/]+)/);
    if (!match) {
        return null;
    }

    const candidate = decodeURIComponent(match[1]);
    // Static routes under /session are not actual conversation pages.
    if (candidate === 'recent' || candidate === 'claude') {
        return null;
    }

    return candidate;
}

// Configure notification handler for foreground notifications
Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
        const shouldHide = shouldHideForegroundNotification(notification);
        const shouldMute = shouldMuteNotificationSound();
        return {
            shouldShowAlert: !shouldHide,
            shouldPlaySound: !shouldHide && !shouldMute,
            shouldSetBadge: !shouldHide,
            shouldShowBanner: !shouldHide,
            shouldShowList: !shouldHide,
        };
    },
});

// Setup Android notification channel (required for Android 8.0+)
if (Platform.OS === 'android') {
    const channelOptions: Notifications.NotificationChannelInput = {
        name: 'Alerts',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#FF231F7C',
        sound: 'default',
    };

    // `default` is used by HMS/Xiaomi payloads. DooPush's Android fallback
    // service uses `doopush_default_channel`, so create that exact OS channel
    // before the SDK receives its first notification.
    void Promise.all([
        Notifications.setNotificationChannelAsync('default', channelOptions),
        Notifications.setNotificationChannelAsync('doopush_default_channel', {
            ...channelOptions,
            name: 'DooPush Alerts',
        }),
    ]).catch((error) => {
        console.warn('Failed to configure Android notification channels', error);
    });
}

export {
    // Catch any errors thrown by the Layout component.
    ErrorBoundary,
} from 'expo-router';

// Configure splash screen
SplashScreen.setOptions({
    fade: true,
    duration: 300,
})
SplashScreen.preventAutoHideAsync();

// Set window background color - now handled by Unistyles
// SystemUI.setBackgroundColorAsync('white');

// NEVER ENABLE REMOTE LOGGING IN PRODUCTION
// This is for local debugging with AI only
// So AI will have all the logs easily accessible in one file for analysis
if (!!process.env.PUBLIC_EXPO_DANGEROUSLY_LOG_TO_SERVER_FOR_AI_AUTO_DEBUGGING) {
    monkeyPatchConsoleForRemoteLoggingForFasterAiAutoDebuggingOnlyInLocalBuilds()
}

// Component to apply horizontal safe area padding
function HorizontalSafeAreaWrapper({ children }: { children: React.ReactNode }) {
    const insets = useSafeAreaInsets();
    return (
        <View style={{
            flex: 1,
            paddingLeft: insets.left,
            paddingRight: insets.right
        }}>
            {children}
        </View>
    );
}

let lock = new AsyncLock();
let loaded = false;

const allFonts = {
    SpaceMono: require('@/assets/fonts/SpaceMono-Regular.ttf'),
    'IBMPlexSans-Regular': require('@/assets/fonts/IBMPlexSans-Regular.ttf'),
    'IBMPlexSans-Italic': require('@/assets/fonts/IBMPlexSans-Italic.ttf'),
    'IBMPlexSans-SemiBold': require('@/assets/fonts/IBMPlexSans-SemiBold.ttf'),
    'IBMPlexMono-Regular': require('@/assets/fonts/IBMPlexMono-Regular.ttf'),
    'IBMPlexMono-Italic': require('@/assets/fonts/IBMPlexMono-Italic.ttf'),
    'IBMPlexMono-SemiBold': require('@/assets/fonts/IBMPlexMono-SemiBold.ttf'),
    'BricolageGrotesque-Bold': require('@/assets/fonts/BricolageGrotesque-Bold.ttf'),
    ...FontAwesome.font,
    ...FontAwesome6.font,
    ...Ionicons.font,
    ...Octicons.font,
    ...MaterialCommunityIcons.font,
    ...AntDesign.font,
    ...SimpleLineIcons.font,
};

async function loadFontsWithRetry() {
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            await Fonts.loadAsync(allFonts);
            return;
        } catch (e) {
            if (attempt < 3) {
                console.warn(`Font loading attempt ${attempt} failed, retrying...`, e);
            } else {
                throw e;
            }
        }
    }
}

async function loadFonts() {
    await lock.inLock(async () => {
        if (loaded) {
            return;
        }
        loaded = true;
        // Check if running in Tauri
        const isTauri = isTauriDesktop();

        if (!isTauri) {
            // Handle slow networks where FontFaceObserver's 6s timeout may fire
            await loadFontsWithRetry();
        } else {
            // For Tauri, skip Font Face Observer as fonts are loaded via CSS
            console.log('Do not wait for fonts to load');
            (async () => {
                try {
                    await Fonts.loadAsync(allFonts);
                } catch (e) {
                    // Ignore
                }
            })();
        }
    });
}

export default function RootLayout() {
    const pathname = usePathname();
    React.useEffect(() => {
        const subscription = AppState.addEventListener('change', (nextState) => {
            currentAppState = nextState;
            // Clear badge when app comes to foreground or goes to background
            if (nextState === 'active' || nextState === 'background') {
                Notifications.setBadgeCountAsync(0);
                const credentials = sync.getCredentials();
                if (credentials) {
                    resetBadgeCount(credentials);
                }
            }
        });
        return () => {
            subscription.remove();
        };
    }, []);
    React.useEffect(() => {
        const newSessionId = getSessionIdFromPath(pathname);
        if (currentSessionId && !newSessionId) {
            sync.onSessionHidden();
        }
        currentSessionId = newSessionId;
    }, [pathname]);
    const { theme } = useUnistyles();
    const navigationTheme = React.useMemo(() => {
        if (theme.dark) {
            return {
                ...DarkTheme,
                colors: {
                    ...DarkTheme.colors,
                    background: theme.colors.groupped.background,
                }
            }
        }
        return {
            ...DefaultTheme,
            colors: {
                ...DefaultTheme.colors,
                background: theme.colors.groupped.background,
            }
        };
    }, [theme.dark]);

    //
    // Init sequence
    //
    const [initState, setInitState] = React.useState<{ credentials: AuthCredentials | null } | null>(null);
    React.useEffect(() => {
        (async () => {
            try {
                await loadFonts();
                await sodium.ready;
                await resolveServerConfig();
                const credentials = await TokenStorage.getCredentials();
                console.log('credentials', credentials);
                if (credentials) {
                    await syncRestore(credentials);
                }

                setInitState({ credentials });
            } catch (error) {
                console.error('Error initializing:', error);
            }
        })();
    }, []);

    React.useEffect(() => {
        if (initState) {
            setTimeout(() => {
                SplashScreen.hideAsync();
            }, 100);

            if (Platform.OS === 'web' && isTauriDesktop()) {
                requestAnimationFrame(() => {
                    void import('@tauri-apps/api/core')
                        .then(({ invoke }) => invoke('dismiss_native_startup_logo'))
                        .catch((error) => console.warn('Failed to dismiss native startup logo:', error));
                });
            }
        }
    }, [initState]);


    // Track the screens
    useTrackScreens()

    // Global DooTask WebSocket connection
    useDootaskGlobalWebSocket();

    //
    // Not inited
    //

    if (!initState) {
        return null;
    }

    //
    // Boot
    //

    let providers = (
        <SafeAreaProvider initialMetrics={initialWindowMetrics}>
            <KeyboardProvider>
                <GestureHandlerRootView style={{ flex: 1 }}>
                    <BottomSheetModalProvider>
                        <AuthProvider initialCredentials={initState.credentials}>
                            <ThemePreferenceSync />
                            <DesktopAuthWindowSync />
                            <ThemeProvider value={navigationTheme}>
                                <StatusBarProvider>
                                    <ModalProvider>
                                        <CommandPaletteProvider>
                                            <RealtimeProvider>
                                                <DesktopWindowFrame>
                                                    <ActionMenuOverlayProvider>
                                                        <HorizontalSafeAreaWrapper>
                                                            <SidebarNavigator />
                                                        </HorizontalSafeAreaWrapper>
                                                    </ActionMenuOverlayProvider>
                                                </DesktopWindowFrame>
                                            </RealtimeProvider>
                                        </CommandPaletteProvider>
                                    </ModalProvider>
                                    <TtsFloatingPlayer />
                                    <ToastHost />
                                </StatusBarProvider>
                            </ThemeProvider>
                        </AuthProvider>
                    </BottomSheetModalProvider>
                </GestureHandlerRootView>
            </KeyboardProvider>
        </SafeAreaProvider>
    );
    if (tracking) {
        providers = (
            <PostHogProvider client={tracking}>
                {providers}
            </PostHogProvider>
        );
    }

    return (
        <>
            <FaviconPermissionIndicator />
            <DesktopBridge />
            {providers}
        </>
    );
}
