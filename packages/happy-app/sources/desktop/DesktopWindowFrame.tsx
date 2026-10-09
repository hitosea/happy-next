import { Ionicons } from '@expo/vector-icons';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Image } from 'expo-image';
import { usePathname, useRouter } from 'expo-router';
import * as React from 'react';
import { Pressable, Text, useWindowDimensions, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import { useAuth } from '@/auth/AuthContext';
import { useInboxHasContent } from '@/hooks/useInboxHasContent';
import { useDootaskProfile, useFriendRequests, useProfile, useSocketStatus } from '@/sync/storage';
import { getServerInfo } from '@/sync/serverConfig';
import { t } from '@/text';
import { StatusDot } from '@/components/StatusDot';
import { DesktopUpdateButton } from './DesktopUpdateButton';
import { DesktopWindowControls, WINDOWS_TITLE_BAR_HEIGHT } from './DesktopWindowControls';
import { getDesktopPlatform, handleDesktopTitleBarMouseDown, isTerminalWindow } from './desktopWindowUtils';
import { useDesktopWindowFullscreen } from './useDesktopWindowFullscreen';

const MACOS_RIGHT_DRAG_STRIP_LEFT = 360;
// Kept in step with AUTHENTICATED_TRAFFIC_LIGHT_X/Y in src-tauri/src/lib.rs. A compact
// macOS toolbar, as tall as the terminal window's tab row.
const MACOS_TITLE_BAR_HEIGHT = 38;
const MACOS_TRAFFIC_LIGHT_GUTTER = 86;
const PANEL_INSET = 5;
const PANEL_RADIUS = 10;
const WINDOWS_NAVIGATION_BUTTON_SIZE = 30;

type WindowsUnauthenticatedRoute = 'welcome' | 'restore' | 'restoreManual' | 'server';

function getWindowsUnauthenticatedRoute(pathname: string): WindowsUnauthenticatedRoute | null {
    const normalizedPathname = pathname.length > 1 ? pathname.replace(/\/$/, '') : pathname;

    switch (normalizedPathname) {
        case '/':
            return 'welcome';
        case '/restore':
            return 'restore';
        case '/restore/manual':
            return 'restoreManual';
        case '/server':
            return 'server';
        default:
            return null;
    }
}


type WindowsNavigationButtonProps = {
    accessibilityLabel: string;
    children: React.ReactNode;
    onPress: () => void;
};

function WindowsNavigationButton({ accessibilityLabel, children, onPress }: WindowsNavigationButtonProps) {
    const { theme } = useUnistyles();

    return (
        <Pressable
            {...({ 'data-desktop-no-drag': true } as any)}
            accessibilityLabel={accessibilityLabel}
            accessibilityRole="button"
            onPress={onPress}
            ref={(element: any) => {
                if (element && typeof element === 'object') {
                    element.title = accessibilityLabel;
                }
            }}
            style={({ hovered, pressed }: any) => ({
                alignItems: 'center',
                backgroundColor: hovered || pressed ? theme.colors.surfacePressed : 'transparent',
                borderRadius: 5,
                height: WINDOWS_NAVIGATION_BUTTON_SIZE,
                justifyContent: 'center',
                position: 'relative',
                width: WINDOWS_NAVIGATION_BUTTON_SIZE,
            })}
        >
            {children}
        </Pressable>
    );
}

// The connection status beside the app title in the signed-in title bar.
function TitleBarConnectionStatus() {
    const { theme } = useUnistyles();
    const socketStatus = useSocketStatus();
    const { width: windowWidth } = useWindowDimensions();
    const showConnectionText = windowWidth >= 720;

    const connectionStatus = (() => {
        switch (socketStatus.status) {
            case 'connected':
                return { color: theme.colors.status.connected, isPulsing: false, text: t('status.connected') };
            case 'connecting':
                return { color: theme.colors.status.connecting, isPulsing: true, text: t('status.connecting') };
            case 'disconnected':
                return { color: theme.colors.status.disconnected, isPulsing: false, text: t('status.disconnected') };
            case 'error':
                return { color: theme.colors.status.error, isPulsing: false, text: t('status.error') };
            default:
                return { color: theme.colors.status.default, isPulsing: false, text: '' };
        }
    })();

    if (!connectionStatus.text) return null;
    return (
        <View style={{ alignItems: 'center', flexDirection: 'row', gap: 5, paddingLeft: 4 }}>
            <StatusDot
                color={connectionStatus.color}
                isPulsing={connectionStatus.isPulsing}
                size={6}
            />
            {showConnectionText && (
                <Text selectable={false} style={{ color: connectionStatus.color, fontSize: 11, fontWeight: '500' }}>
                    {connectionStatus.text}
                </Text>
            )}
        </View>
    );
}

// Navigation on the right of the signed-in title bar, on macOS and Windows alike. Search lives in
// the sidebar's search field instead.
function TitleBarNavigation() {
    const { theme } = useUnistyles();
    const router = useRouter();
    const friendRequests = useFriendRequests();
    const inboxHasContent = useInboxHasContent();
    const dootaskProfile = useDootaskProfile();
    const profile = useProfile();

    return (
        <View
            {...({ 'data-desktop-no-drag': true } as any)}
            style={{ alignItems: 'center', flexDirection: 'row', gap: 6 }}
        >
            <WindowsNavigationButton
                accessibilityLabel={t('tabs.inbox')}
                onPress={() => router.navigate('/(app)/inbox')}
            >
                <Image
                    source={require('@/assets/images/navigation/inbox.png')}
                    contentFit="contain"
                    style={{ height: 18, width: 18 }}
                    tintColor={theme.colors.header.tint}
                />
                {friendRequests.length > 0 ? (
                    <View style={{
                        alignItems: 'center',
                        backgroundColor: theme.colors.status.error,
                        borderRadius: 7,
                        height: 14,
                        justifyContent: 'center',
                        minWidth: 14,
                        paddingHorizontal: 3,
                        position: 'absolute',
                        right: -2,
                        top: -2,
                    }}>
                        <Text style={{ color: '#FFFFFF', fontSize: 9, fontWeight: '600' }}>
                            {friendRequests.length > 99 ? '99+' : friendRequests.length}
                        </Text>
                    </View>
                ) : inboxHasContent ? (
                    <View style={{
                        backgroundColor: '#007AFF',
                        borderRadius: 3,
                        height: 6,
                        position: 'absolute',
                        right: 2,
                        top: 2,
                        width: 6,
                    }} />
                ) : null}
            </WindowsNavigationButton>
            {!!dootaskProfile && (
                <WindowsNavigationButton
                    accessibilityLabel={t('tabs.dootask')}
                    onPress={() => router.navigate('/(app)/dootask')}
                >
                    <Image
                        source={require('@/assets/images/navigation/todo.png')}
                        contentFit="contain"
                        style={{ height: 18, width: 18 }}
                        tintColor={theme.colors.header.tint}
                    />
                </WindowsNavigationButton>
            )}
            {!!profile.github && (
                <WindowsNavigationButton
                    accessibilityLabel={t('tabs.github')}
                    onPress={() => router.navigate('/(app)/github')}
                >
                    <Image
                        source={require('@/assets/images/navigation/github.png')}
                        contentFit="contain"
                        style={{ height: 18, width: 18 }}
                        tintColor={theme.colors.header.tint}
                    />
                </WindowsNavigationButton>
            )}
            <DesktopUpdateButton placement="titleBar" />
        </View>
    );
}

function WindowsUnauthenticatedNavigation() {
    const { theme } = useUnistyles();
    const router = useRouter();
    const socketStatus = useSocketStatus();
    const serverInfo = getServerInfo();
    const connectionStatus = (() => {
        switch (socketStatus.status) {
            case 'connected':
                return { color: theme.colors.status.connected, text: t('status.connected') };
            case 'connecting':
                return { color: theme.colors.status.connecting, text: t('status.connecting') };
            case 'disconnected':
                return { color: theme.colors.status.disconnected, text: t('status.disconnected') };
            case 'error':
                return { color: theme.colors.status.error, text: t('status.error') };
            default:
                return { color: theme.colors.status.default, text: '' };
        }
    })();
    const serverLabel = serverInfo.hostname + (serverInfo.port ? `:${serverInfo.port}` : '');

    return (
        <View
            {...({ 'data-desktop-no-drag': true } as any)}
            style={{ alignItems: 'center', flexDirection: 'row', gap: 6, height: WINDOWS_TITLE_BAR_HEIGHT, marginRight: 7 }}
        >
            {serverInfo.isCustom ? (
                <Text
                    numberOfLines={1}
                    ref={(element: any) => {
                        if (element && typeof element === 'object') {
                            element.title = serverInfo.resolvedUrl;
                        }
                    }}
                    style={{ color: theme.colors.textSecondary, fontSize: 11, fontWeight: '500', maxWidth: 180 }}
                >
                    {serverLabel}
                </Text>
            ) : !!connectionStatus.text ? (
                <View style={{ alignItems: 'center', flexDirection: 'row', gap: 5, paddingHorizontal: 4 }}>
                    <StatusDot color={connectionStatus.color} isPulsing={socketStatus.status === 'connecting'} size={6} />
                    <Text style={{ color: connectionStatus.color, fontSize: 11, fontWeight: '500' }}>
                        {connectionStatus.text}
                    </Text>
                </View>
            ) : null}
            <WindowsNavigationButton
                accessibilityLabel={t('server.serverConfiguration')}
                onPress={() => router.push('/server')}
            >
                <Ionicons name="server-outline" size={18} color={theme.colors.header.tint} />
            </WindowsNavigationButton>
        </View>
    );
}

export function DesktopWindowFrame({ children }: { children: React.ReactNode }) {
    const { theme } = useUnistyles();
    const desktopPlatform = getDesktopPlatform();
    const { isAuthenticated } = useAuth();
    const pathname = usePathname();
    const router = useRouter();
    const isFullscreen = useDesktopWindowFullscreen(desktopPlatform !== null);
    const isWindowsFullscreen = desktopPlatform === 'windows' && isFullscreen;
    const { width: windowWidth } = useWindowDimensions();
    const handleGoHome = React.useCallback(() => {
        try {
            router.dismissAll();
        } catch (_) {
            // Already at the root of the current stack.
        }
    }, [router]);

    // The terminal window is framed by the OS instead. This frame would give it
    // a second title bar on Windows and lay a drag strip over the top of the tab
    // strip on macOS, which is the opposite of the plain window it should be.
    if (!desktopPlatform || isTerminalWindow()) {
        return <>{children}</>;
    }

    const window = getCurrentWindow();
    const isMacOS = desktopPlatform === 'macos';
    const handleTitleBarMouseDown = (event: any) => {
        handleDesktopTitleBarMouseDown(event, { allowMaximize: isAuthenticated });
    };

    // Signed in, the window is a QQ-style frame: one title bar across the whole window with the app
    // title, connection status and navigation, and the app below it in a rounded panel that stands
    // apart from the chrome by a shade of background only.
    const appTitle = (
        <View
            {...({ 'data-desktop-no-drag': true } as any)}
            style={{ alignItems: 'center', flexDirection: 'row', gap: 8 }}
        >
            <Pressable
                accessibilityLabel={t('tabs.sessions')}
                accessibilityRole="button"
                hitSlop={6}
                onPress={handleGoHome}
                ref={(element: any) => {
                    if (element && typeof element === 'object') {
                        element.title = t('tabs.sessions');
                    }
                }}
                style={({ hovered, pressed }: any) => ({
                    alignItems: 'center',
                    cursor: 'pointer',
                    flexDirection: 'row',
                    gap: 8,
                    opacity: hovered || pressed ? 0.7 : 1,
                })}
            >
                <Image
                    source={theme.dark
                        ? require('@/assets/images/logo-white.svg')
                        : require('@/assets/images/logo-black.svg')}
                    contentFit="contain"
                    style={{ height: 20, width: 20 }}
                />
                {windowWidth >= 600 && (
                    <Text
                        selectable={false}
                        style={{ color: theme.colors.header.tint, fontSize: 13, fontWeight: '600' }}
                    >
                        Happy Next
                    </Text>
                )}
            </Pressable>
            <TitleBarConnectionStatus />
        </View>
    );
    const panel = (
        <View
            style={{
                backgroundColor: theme.colors.groupped.background,
                borderRadius: PANEL_RADIUS,
                flex: 1,
                marginBottom: PANEL_INSET,
                marginHorizontal: PANEL_INSET,
                overflow: 'hidden',
            }}
        >
            {children}
        </View>
    );

    if (isMacOS && isAuthenticated) {
        return (
            <View style={{ flex: 1, backgroundColor: theme.colors.windowChrome }}>
                <View
                    {...({
                        'data-tauri-drag-region': true,
                        onMouseDown: handleTitleBarMouseDown,
                    } as any)}
                    style={{
                        alignItems: 'center',
                        flexDirection: 'row',
                        height: MACOS_TITLE_BAR_HEIGHT,
                        paddingLeft: isFullscreen ? 12 : MACOS_TRAFFIC_LIGHT_GUTTER,
                        paddingRight: 12,
                        userSelect: 'none',
                    } as any}
                >
                    {appTitle}
                    <View
                        {...({ 'data-tauri-drag-region': true } as any)}
                        style={{ flex: 1, height: MACOS_TITLE_BAR_HEIGHT }}
                    />
                    <TitleBarNavigation />
                </View>
                {panel}
            </View>
        );
    }

    if (isMacOS) {
        return (
            <View style={{ flex: 1, backgroundColor: theme.colors.groupped.background }}>
                {children}
                {!isAuthenticated && (
                    <View
                        pointerEvents="box-none"
                        style={{ bottom: 16, position: 'absolute', right: 16, zIndex: 1100 }}
                    >
                        <DesktopUpdateButton placement="floating" />
                    </View>
                )}
                <View
                    {...({
                        'data-tauri-drag-region': true,
                        onMouseDown: handleTitleBarMouseDown,
                    } as any)}
                    style={{
                        height: 8,
                        left: MACOS_RIGHT_DRAG_STRIP_LEFT,
                        position: 'absolute',
                        right: 0,
                        top: 0,
                        zIndex: 1000,
                    }}
                />
            </View>
        );
    }

    if (isWindowsFullscreen) {
        return <View style={{ flex: 1, backgroundColor: theme.colors.groupped.background }}>{children}</View>;
    }

    const titleBarHeight = WINDOWS_TITLE_BAR_HEIGHT;
    const unauthenticatedRoute = !isAuthenticated ? getWindowsUnauthenticatedRoute(pathname) : null;
    const unauthenticatedTitle = unauthenticatedRoute === 'restore'
        ? t('navigation.linkNewDevice')
        : unauthenticatedRoute === 'restoreManual'
            ? t('navigation.restoreWithSecretKey')
            : unauthenticatedRoute === 'server'
                ? t('server.serverConfiguration')
                : null;
    const handleUnauthenticatedBack = () => {
        if (router.canGoBack()) {
            router.back();
        } else {
            router.replace('/');
        }
    };

    return (
        <View style={{ flex: 1, backgroundColor: isAuthenticated ? theme.colors.windowChrome : theme.colors.groupped.background }}>
            <View
                {...({
                    'data-tauri-drag-region': true,
                    onMouseDown: handleTitleBarMouseDown,
                } as any)}
                style={{
                    alignItems: 'center',
                    backgroundColor: isAuthenticated ? theme.colors.windowChrome : theme.colors.header.background,
                    borderBottomColor: theme.colors.divider,
                    borderBottomWidth: isAuthenticated ? 0 : 1,
                    flexDirection: 'row',
                    height: titleBarHeight,
                    userSelect: 'none',
                    zIndex: 1000,
                } as any}
            >
                <View
                    {...({ 'data-tauri-drag-region': true } as any)}
                    style={{ alignItems: 'center', flexDirection: 'row', gap: 8, paddingLeft: 12 }}
                >
                    {!!unauthenticatedTitle ? (
                        <>
                            <WindowsNavigationButton
                                accessibilityLabel={t('common.back')}
                                onPress={handleUnauthenticatedBack}
                            >
                                <Ionicons name="chevron-back" size={20} color={theme.colors.header.tint} />
                            </WindowsNavigationButton>
                            <Text
                                numberOfLines={1}
                                selectable={false}
                                style={{ color: theme.colors.header.tint, fontSize: 13, fontWeight: '600' }}
                            >
                                {unauthenticatedTitle}
                            </Text>
                        </>
                    ) : appTitle}
                </View>
                <View
                    {...({ 'data-tauri-drag-region': true } as any)}
                    style={{ flex: 1, height: titleBarHeight }}
                />
                {isAuthenticated && <TitleBarNavigation />}
                {!isAuthenticated && unauthenticatedRoute === 'welcome' && <WindowsUnauthenticatedNavigation />}
                {isAuthenticated && (
                    <View style={{ backgroundColor: theme.colors.divider, height: 20, marginHorizontal: 10, width: 1 }} />
                )}
                <View style={{ flexDirection: 'row', height: titleBarHeight }}>
                    <DesktopWindowControls />
                </View>
            </View>
            {isAuthenticated ? panel : (
                <View style={{ flex: 1 }}>
                    {children}
                    <View
                        pointerEvents="box-none"
                        style={{ bottom: 16, position: 'absolute', right: 16, zIndex: 1100 }}
                    >
                        <DesktopUpdateButton placement="floating" />
                    </View>
                </View>
            )}
        </View>
    );
}
