import * as React from 'react';
import { addPluginListener, invoke, type PluginListener } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { usePathname, useRouter } from 'expo-router';

import { storage, useLocalSetting } from '@/sync/storage';
import { Modal } from '@/modal';
import { t } from '@/text';
import { getSessionName } from '@/utils/sessionUtils';
import { isTauriDesktop } from '@/utils/tauri';
import { subscribeToDesktopMessages, subscribeToDesktopPermissionRequests } from './desktopEvents';
import { subscribeToDesktopAuthentication } from './desktopAuthEvents';
import {
    agentMessagePreview,
    countDesktopAttentionSessions,
    isReadyEvent,
    notificationId,
    otherUserMessagePreview,
    sessionIdFromPath,
} from './desktopNotificationUtils';
import { sessionLastViewedAt } from '@/sync/sync';
import { truncateMessagePreviewText } from '@/utils/messagePreviewText';
import {
    clearDesktopNotificationRoutes,
    rememberDesktopNotificationRoute,
    resolveDesktopNotificationRoute,
} from './desktopNotificationRoutes';
import {
    prepareDesktopUpdate,
} from './desktopUpdater';

const DESKTOP_SHORTCUT = 'CommandOrControl+Shift+H';
const DESKTOP_UPDATE_INITIAL_DELAY_MS = 12_000;
const DESKTOP_UPDATE_CHECK_INTERVAL_MS = 30 * 60_000;
const DESKTOP_UPDATE_POLL_INTERVAL_MS = 60_000;
const IS_MACOS_DESKTOP = typeof navigator !== 'undefined' && /Macintosh|Mac OS X/.test(navigator.userAgent);
const IS_WINDOWS_DESKTOP = typeof navigator !== 'undefined' && /Windows/.test(navigator.userAgent);

export function DesktopBridge() {
    const router = useRouter();
    const pathname = usePathname();
    const closeToTray = useLocalSetting('desktopCloseToTray');
    const notificationsEnabled = useLocalSetting('desktopNotificationsEnabled');
    const autostartEnabled = useLocalSetting('desktopAutostartEnabled');
    const globalShortcutEnabled = useLocalSetting('desktopGlobalShortcutEnabled');
    const hideNotificationsWhenActive = useLocalSetting('hideNotificationsWhenActive');
    const hideSessionNotificationsWhenActive = useLocalSetting('hideSessionNotificationsWhenActive');
    const currentSessionId = React.useMemo(() => sessionIdFromPath(pathname), [pathname]);

    const currentSessionIdRef = React.useRef(currentSessionId);
    const windowFocusedRef = React.useRef(true);
    const desktopAttentionCountRef = React.useRef(-1);
    const seenMessageIdsRef = React.useRef(new Set<string>());
    const seenPermissionRequestIdsRef = React.useRef(new Set<string>());
    const latestAgentPreviewBySessionRef = React.useRef(new Map<string, string>());
    const notificationTimersRef = React.useRef(new Map<string, ReturnType<typeof setTimeout>>());
    const notificationPayloadRef = React.useRef(new Map<string, { title: string; body: string }>());
    const notificationSessionsRef = React.useRef(new Map<number, string>());
    const lastDesktopUpdateCheckAtRef = React.useRef(0);
    React.useEffect(() => {
        if (!isTauriDesktop()) {
            return;
        }
        let cancelled = false;
        let unlistenMenu: (() => void) | undefined;
        let unlistenUpdateFocus: (() => void) | undefined;

        const prepareUpdate = async (interactive = false) => {
            lastDesktopUpdateCheckAtRef.current = Date.now();
            const result = await prepareDesktopUpdate();
            if (interactive && result.phase === 'upToDate') {
                Modal.alert(t('desktopUpdate.title'), t('desktopUpdate.upToDate'));
                return;
            }
            if (interactive && result.phase === 'unsupported') {
                Modal.alert(t('desktopUpdate.title'), t('desktopUpdate.productionOnly'));
                return;
            }
            if (interactive && result.phase === 'error') {
                Modal.alert(t('desktopUpdate.failed'), t('desktopUpdate.tryAgain'));
            }
        };

        const checkForUpdateIfDue = () => {
            const lastCheckedAt = lastDesktopUpdateCheckAtRef.current;
            if (lastCheckedAt === 0 || Date.now() - lastCheckedAt < DESKTOP_UPDATE_CHECK_INTERVAL_MS) {
                return;
            }
            void prepareUpdate();
        };

        const timer = setTimeout(() => {
            if (lastDesktopUpdateCheckAtRef.current === 0) {
                void prepareUpdate();
            }
        }, DESKTOP_UPDATE_INITIAL_DELAY_MS);
        const updateInterval = setInterval(checkForUpdateIfDue, DESKTOP_UPDATE_POLL_INTERVAL_MS);

        void getCurrentWindow().onFocusChanged(({ payload: focused }) => {
            if (focused) {
                checkForUpdateIfDue();
            }
        }).then((unlisten) => {
            if (cancelled) {
                unlisten();
            } else {
                unlistenUpdateFocus = unlisten;
            }
        }).catch((error) => console.warn('Failed to register update focus listener:', error));

        void listen<{ action: string }>('desktop-menu-action', ({ payload }) => {
            if (payload.action === 'softwareUpdate') {
                void prepareUpdate(true);
            }
        }).then((unlisten) => {
            if (cancelled) {
                unlisten();
            } else {
                unlistenMenu = unlisten;
            }
        }).catch((error) => console.warn('Failed to register software update menu listener:', error));

        return () => {
            cancelled = true;
            clearTimeout(timer);
            clearInterval(updateInterval);
            unlistenMenu?.();
            unlistenUpdateFocus?.();
        };
    }, [router]);

    React.useEffect(() => {
        if (!isTauriDesktop()) {
            return;
        }
        return subscribeToDesktopAuthentication((authenticated) => {
            if (authenticated) {
                return;
            }
            desktopAttentionCountRef.current = 0;
            clearDesktopNotificationRoutes();
            seenMessageIdsRef.current.clear();
            seenPermissionRequestIdsRef.current.clear();
            latestAgentPreviewBySessionRef.current.clear();
            notificationPayloadRef.current.clear();
            notificationSessionsRef.current.clear();
            for (const timer of notificationTimersRef.current.values()) {
                clearTimeout(timer);
            }
            notificationTimersRef.current.clear();
            void invoke('set_desktop_unread_count', { count: 0 });
        });
    }, []);

    React.useEffect(() => {
        currentSessionIdRef.current = currentSessionId;
    }, [currentSessionId]);

    React.useEffect(() => {
        if (!isTauriDesktop()) {
            return;
        }

        const syncDesktopAttentionCount = () => {
            const state = storage.getState();
            const count = countDesktopAttentionSessions(
                state.sessions,
                state.sharedSessions,
                sessionLastViewedAt,
            );
            if (desktopAttentionCountRef.current === count) {
                return;
            }
            desktopAttentionCountRef.current = count;
            void invoke('set_desktop_unread_count', { count });
        };

        syncDesktopAttentionCount();
        return storage.subscribe(syncDesktopAttentionCount);
    }, []);

    React.useEffect(() => {
        if (!isTauriDesktop()) {
            return;
        }
        void invoke('set_close_to_tray', { enabled: closeToTray });
    }, [closeToTray]);

    React.useEffect(() => {
        if (!isTauriDesktop()) {
            return;
        }
        let cancelled = false;
        void import('@tauri-apps/plugin-autostart').then(async ({ disable, enable }) => {
            if (cancelled) {
                return;
            }
            try {
                if (autostartEnabled) {
                    await enable();
                } else {
                    await disable();
                }
            } catch (error) {
                console.warn('Failed to update desktop autostart:', error);
            }
        });
        return () => {
            cancelled = true;
        };
    }, [autostartEnabled]);

    React.useEffect(() => {
        if (!isTauriDesktop()) {
            return;
        }
        let active = true;
        void import('@tauri-apps/plugin-global-shortcut').then(async ({ isRegistered, register, unregister }) => {
            try {
                const registered = await isRegistered(DESKTOP_SHORTCUT);
                if (!active) {
                    return;
                }
                if (globalShortcutEnabled && !registered) {
                    await register(DESKTOP_SHORTCUT, (event) => {
                        if (event.state === 'Pressed') {
                            void invoke('toggle_desktop_window');
                        }
                    });
                } else if (!globalShortcutEnabled && registered) {
                    await unregister(DESKTOP_SHORTCUT);
                }
            } catch (error) {
                console.warn('Failed to update desktop global shortcut:', error);
            }
        });
        return () => {
            active = false;
        };
    }, [globalShortcutEnabled]);

    React.useEffect(() => {
        if (!isTauriDesktop() || !notificationsEnabled) {
            return;
        }
        if (IS_MACOS_DESKTOP) {
            void invoke('plugin:notifications|request_permission')
                .catch((error) => console.warn('Failed to request native macOS notification permission:', error));
            return;
        }

        void import('@tauri-apps/plugin-notification').then(async ({ isPermissionGranted, requestPermission }) => {
            try {
                if (!(await isPermissionGranted())) {
                    await requestPermission();
                }
            } catch (error) {
                console.warn('Failed to request desktop notification permission:', error);
            }
        });
    }, [notificationsEnabled]);

    React.useEffect(() => {
        if (!isTauriDesktop()) {
            return;
        }
        let unlistenFocus: (() => void) | undefined;
        let unlistenNotificationClick: (() => void) | undefined;
        let nativeNotificationClickListener: PluginListener | undefined;
        let nativeNotificationActionListener: PluginListener | undefined;
        let lastNativeNotificationOpen: { id: number; openedAt: number } | undefined;
        let cancelled = false;

        const openNotificationSession = (sessionId: string) => {
            const pendingTimer = notificationTimersRef.current.get(sessionId);
            if (pendingTimer) {
                clearTimeout(pendingTimer);
                notificationTimersRef.current.delete(sessionId);
            }
            notificationPayloadRef.current.delete(sessionId);
            notificationSessionsRef.current.delete(notificationId(sessionId));

            currentSessionIdRef.current = sessionId;
            void invoke('show_desktop_window')
                .catch((error) => console.warn('Failed to show desktop window from notification:', error));
            router.replace(`/session/${encodeURIComponent(sessionId)}`);
        };

        const sessionIdForNotification = (id: number): string | null => {
            const state = storage.getState();
            return resolveDesktopNotificationRoute(id)
                ?? notificationSessionsRef.current.get(id)
                ?? [...Object.keys(state.sessions), ...Object.keys(state.sharedSessions)]
                    .find((candidate) => notificationId(candidate) === id)
                ?? null;
        };

        const openMacNotification = (rawId: number | string, payloadSessionId?: unknown) => {
            const id = typeof rawId === 'number' ? rawId : Number.parseInt(rawId, 10);
            if (!Number.isFinite(id)) {
                return;
            }
            const now = Date.now();
            if (lastNativeNotificationOpen?.id === id && now - lastNativeNotificationOpen.openedAt < 1000) {
                return;
            }
            const sessionId = typeof payloadSessionId === 'string'
                ? payloadSessionId
                : sessionIdForNotification(id);
            if (sessionId) {
                lastNativeNotificationOpen = { id, openedAt: now };
                openNotificationSession(sessionId);
            }
        };

        void getCurrentWindow().isFocused().then((focused) => {
            windowFocusedRef.current = focused;
        });
        void getCurrentWindow().onFocusChanged(({ payload: focused }) => {
            windowFocusedRef.current = focused;
        }).then((unlisten) => {
            if (cancelled) {
                unlisten();
            } else {
                unlistenFocus = unlisten;
            }
        });

        void listen<{ sessionId?: string; notificationId?: number }>('desktop-notification-clicked', ({ payload }) => {
            const sessionId = typeof payload.sessionId === 'string'
                ? payload.sessionId
                : typeof payload.notificationId === 'number'
                    ? sessionIdForNotification(payload.notificationId)
                    : null;
            if (sessionId) {
                openNotificationSession(sessionId);
            }
        }).then((unlisten) => {
            if (cancelled) {
                unlisten();
            } else {
                unlistenNotificationClick = unlisten;
                if (IS_WINDOWS_DESKTOP || IS_MACOS_DESKTOP) {
                    void invoke<number[]>('set_desktop_notification_click_listener_ready', { ready: true })
                        .then((pendingIds) => {
                            if (cancelled) {
                                return;
                            }
                            for (const id of pendingIds) {
                                const sessionId = sessionIdForNotification(id);
                                if (sessionId) {
                                    openNotificationSession(sessionId);
                                }
                            }
                        })
                        .catch((error) => console.warn('Failed to activate desktop notification click listener:', error));
                }
            }
        }).catch((error) => console.warn('Failed to register notification click listener:', error));

        if (IS_MACOS_DESKTOP) {
            void addPluginListener<{
                actionId: string;
                notification?: { id: number | string };
            }>('notifications', 'actionPerformed', (action) => {
                if (action.actionId === 'tap' && action.notification) {
                    openMacNotification(action.notification.id);
                }
            }).then(async (listener) => {
                if (cancelled) {
                    await listener.unregister();
                    return;
                }
                nativeNotificationActionListener = listener;
            }).catch((error) => console.warn('Failed to register native macOS notification action listener:', error));

            void addPluginListener<{ id: number | string; data?: Record<string, unknown> }>('notifications', 'notificationClicked', (notification) => {
                openMacNotification(notification.id, notification.data?.sessionId);
            }).then(async (listener) => {
                if (cancelled) {
                    await listener.unregister();
                    return;
                }
                nativeNotificationClickListener = listener;
                await invoke('plugin:notifications|set_click_listener_active', { active: true });
            }).catch((error) => console.warn('Failed to register native macOS notification click listener:', error));
        }

        const unsubscribeMessages = subscribeToDesktopMessages(({ sessionId, messages }) => {
            const state = storage.getState();
            const currentUserId = state.profile.id || null;
            let notificationBody: string | null = null;
            let completionMessageId: string | null = null;

            for (const message of messages) {
                if (seenMessageIdsRef.current.has(message.id)) {
                    continue;
                }
                seenMessageIdsRef.current.add(message.id);
                if (seenMessageIdsRef.current.size > 5000) {
                    seenMessageIdsRef.current.clear();
                    seenMessageIdsRef.current.add(message.id);
                }

                const agentPreview = agentMessagePreview(message);
                if (agentPreview) {
                    latestAgentPreviewBySessionRef.current.set(sessionId, agentPreview);
                    continue;
                }

                const otherUserPreview = otherUserMessagePreview(message, currentUserId);
                if (otherUserPreview) {
                    notificationBody = otherUserPreview;
                    continue;
                }

                if (isReadyEvent(message)) {
                    completionMessageId = message.id;
                }
            }

            if (completionMessageId) {
                const hasActiveDelegatedWork = Object.keys(state.orchestratorActivity[sessionId] ?? {}).length > 0;
                if (!hasActiveDelegatedWork) {
                    notificationBody = latestAgentPreviewBySessionRef.current.get(sessionId)
                        ?? 'Your agent is waiting for your command';
                    latestAgentPreviewBySessionRef.current.delete(sessionId);
                }
            }

            const isCurrentAndFocused = windowFocusedRef.current && currentSessionIdRef.current === sessionId;
            const shouldNotify = notificationsEnabled
                && !isCurrentAndFocused
                && !(windowFocusedRef.current && hideNotificationsWhenActive)
                && !(windowFocusedRef.current && hideSessionNotificationsWhenActive && currentSessionIdRef.current === sessionId);
            if (!notificationBody || !shouldNotify) {
                return;
            }

            const session = state.sessions[sessionId] ?? state.sharedSessions[sessionId];
            const title = session ? getSessionName(session) : 'Happy Next';
            notificationPayloadRef.current.set(sessionId, { title, body: notificationBody });

            const existingTimer = notificationTimersRef.current.get(sessionId);
            if (existingTimer) {
                clearTimeout(existingTimer);
            }
            const timer = setTimeout(() => {
                notificationTimersRef.current.delete(sessionId);
                const payload = notificationPayloadRef.current.get(sessionId);
                notificationPayloadRef.current.delete(sessionId);
                if (!payload) {
                    return;
                }
                const sendDesktopNotification = async () => {
                    const id = notificationId(sessionId);
                    notificationSessionsRef.current.set(id, sessionId);
                    rememberDesktopNotificationRoute(id, sessionId);
                    await invoke('show_desktop_notification', {
                        notificationId: id,
                        title: payload.title,
                        body: truncateMessagePreviewText(payload.body, 240),
                        sessionId,
                    });
                };

                // The native command owns permission handling. Keeping the permission
                // check here caused notifications to be silently skipped when WebKit's
                // platform detection or the separate official plugin disagreed with the
                // native notification backend.
                void sendDesktopNotification()
                    .catch((error) => console.warn('Failed to send desktop notification:', error));
            }, 500);
            notificationTimersRef.current.set(sessionId, timer);
        });

        const unsubscribePermissionRequests = subscribeToDesktopPermissionRequests(({ sessionId, requestId, toolName }) => {
            if (seenPermissionRequestIdsRef.current.has(requestId)) {
                return;
            }
            seenPermissionRequestIdsRef.current.add(requestId);
            if (seenPermissionRequestIdsRef.current.size > 5000) {
                seenPermissionRequestIdsRef.current.clear();
                seenPermissionRequestIdsRef.current.add(requestId);
            }

            const isCurrentAndFocused = windowFocusedRef.current && currentSessionIdRef.current === sessionId;
            const shouldNotify = notificationsEnabled
                && !isCurrentAndFocused
                && !(windowFocusedRef.current && hideNotificationsWhenActive)
                && !(windowFocusedRef.current && hideSessionNotificationsWhenActive && currentSessionIdRef.current === sessionId);
            if (!shouldNotify) {
                return;
            }

            const state = storage.getState();
            const session = state.sessions[sessionId] ?? state.sharedSessions[sessionId];
            const title = session ? getSessionName(session) : 'Permission Request';
            const agentName = session?.metadata?.flavor === 'codex'
                ? 'Codex'
                : session?.metadata?.flavor === 'gemini'
                    ? 'Gemini'
                    : 'Claude';
            const id = notificationId(sessionId);
            notificationSessionsRef.current.set(id, sessionId);
            rememberDesktopNotificationRoute(id, sessionId);
            void invoke('show_desktop_notification', {
                notificationId: id,
                title,
                body: `${agentName} wants to ${toolName}`,
                sessionId,
            }).catch((error) => console.warn('Failed to send desktop permission notification:', error));
        });

        return () => {
            cancelled = true;
            unsubscribeMessages();
            unsubscribePermissionRequests();
            unlistenFocus?.();
            unlistenNotificationClick?.();
            if (IS_WINDOWS_DESKTOP || IS_MACOS_DESKTOP) {
                void invoke('set_desktop_notification_click_listener_ready', { ready: false });
            }
            if (nativeNotificationClickListener) {
                void nativeNotificationClickListener.unregister();
                void invoke('plugin:notifications|set_click_listener_active', { active: false });
            }
            if (nativeNotificationActionListener) {
                void nativeNotificationActionListener.unregister();
            }
            for (const timer of notificationTimersRef.current.values()) {
                clearTimeout(timer);
            }
            notificationTimersRef.current.clear();
        };
    }, [hideNotificationsWhenActive, hideSessionNotificationsWhenActive, notificationsEnabled, router]);

    return null;
}
