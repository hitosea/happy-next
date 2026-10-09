import { useSocketStatus, useFriendRequests } from '@/sync/storage';
import * as React from 'react';
import { Text, View, Pressable, useWindowDimensions, Dimensions, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePathname, useRouter } from 'expo-router';
import { useHeaderHeight } from '@/utils/responsive';
import { isRunningOnMac } from '@/utils/platform';
import { Typography } from '@/constants/Typography';
import { StatusDot } from './StatusDot';
import { MachineRail, MACHINE_RAIL_WIDTH } from './MachineRail';
import { SidebarSearchRow } from './SidebarSearchRow';
import { VoiceAssistantStatusBar } from './VoiceAssistantStatusBar';
import { useRealtimeStatus, useSettingMutable } from '@/sync/storage';
import { MainView } from './MainView';
import { Image } from 'expo-image';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { t } from '@/text';
import { useInboxHasContent } from '@/hooks/useInboxHasContent';
import { useDootaskProfile, useProfile } from '@/sync/storage';
import { getDesktopPlatform } from '@/desktop/desktopWindowUtils';
import { useSessionListScope } from '@/hooks/useSessionListScope';
import { openMachineTerminal } from '@/terminal/openMachineTerminal';

const stylesheet = StyleSheet.create((theme, runtime) => ({
    container: {
        flex: 1,
        flexDirection: 'row',
        borderStyle: 'solid',
        backgroundColor: theme.colors.groupped.background,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider,
    },
    // Inside the desktop's rounded panel only the edge toward the content stays.
    containerDesktop: {
        borderWidth: 0,
        borderRightWidth: StyleSheet.hairlineWidth,
    },
    listColumn: {
        flex: 1,
        minWidth: 0,
    },
    railLogoCell: {
        width: MACHINE_RAIL_WIDTH,
        alignItems: 'center',
        justifyContent: 'center',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        backgroundColor: theme.colors.groupped.background,
        position: 'relative',
    },
    titleContainerLeft: {
        flex: 1,
        minWidth: 0,
        flexDirection: 'column',
        alignItems: 'flex-start',
        justifyContent: 'center',
    },
    titleText: {
        maxWidth: '100%',
        fontSize: 17,
        fontWeight: '500',
        color: theme.colors.header.tint,
        whiteSpace: Platform.select({ web: 'nowrap', default: undefined }),
        ...Typography.default('semiBold'),
    },
    statusContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: -2,
    },
    statusDot: {
        marginRight: 4,
    },
    statusText: {
        flexShrink: 1,
        fontSize: 11,
        fontWeight: '500',
        lineHeight: 16,
        ...Typography.default(),
    },
    rightContainer: {
        marginLeft: 'auto',
        alignItems: 'flex-end',
        flexDirection: 'row',
        gap: 8,
    },
    notificationButton: {
        position: 'relative',
    },
    badge: {
        position: 'absolute',
        top: -4,
        right: -4,
        backgroundColor: theme.colors.status.error,
        borderRadius: 8,
        minWidth: 16,
        height: 16,
        paddingHorizontal: 4,
        justifyContent: 'center',
        alignItems: 'center',
    },
    badgeText: {
        color: '#FFFFFF',
        fontSize: 10,
        ...Typography.default('semiBold'),
    },
    // Status colors
    statusConnected: {
        color: theme.colors.status.connected,
    },
    statusConnecting: {
        color: theme.colors.status.connecting,
    },
    statusDisconnected: {
        color: theme.colors.status.disconnected,
    },
    statusError: {
        color: theme.colors.status.error,
    },
    statusDefault: {
        color: theme.colors.status.default,
    },
    indicatorDot: {
        position: 'absolute',
        top: 0,
        right: -2,
        width: 6,
        height: 6,
        borderRadius: 3,
        backgroundColor: theme.colors.text,
    },
}));

type SidebarViewProps = {
    sidebarWidth?: number;
};

// The machine rail down the sidebar's left edge, always shown in the sidebar layout.
const SidebarMachineRail = React.memo(({ header }: { header?: React.ReactNode }) => {
    const scope = useSessionListScope();
    const router = useRouter();
    const pathname = usePathname();
    const [hideIdleMachines, setHideIdleMachines] = useSettingMutable('hideIdleMachines');
    return (
        <MachineRail
            groups={scope.groups}
            selection={scope.selection}
            onSelect={scope.setSelection}
            hasShared={scope.hasShared}
            hasSharedByMe={scope.hasSharedByMe}
            sharedDot={scope.sharedDot}
            sharedByMeDot={scope.sharedByMeDot}
            sessionCount={scope.activeSessions.length}
            settingsActive={pathname.startsWith('/settings')}
            onSettings={() => router.navigate('/settings')}
            machineDetailsActive={pathname === `/machine/${scope.selection}`}
            onMachineDetails={(machineId) => router.navigate(`/machine/${machineId}`)}
            onNewSession={(machineId) => router.push({ pathname: '/new', params: { machineId } })}
            onOpenTerminal={(machineId) => openMachineTerminal({ machineId, push: router.push })}
            hideIdleMachines={hideIdleMachines}
            onHideIdleMachinesChange={setHideIdleMachines}
            header={header}
        />
    );
});

export const SidebarView = React.memo((props: SidebarViewProps) => {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const safeArea = useSafeAreaInsets();
    const router = useRouter();
    const headerHeight = useHeaderHeight();
    const socketStatus = useSocketStatus();
    const realtimeStatus = useRealtimeStatus();
    const friendRequests = useFriendRequests();
    const inboxHasContent = useInboxHasContent();
    const dootaskProfile = useDootaskProfile();
    const profile = useProfile();
    // The desktop shells draw the app title, status and navigation in their own title bar
    // (see DesktopWindowFrame), and frame the sidebar in a rounded panel below it.
    const isDesktop = getDesktopPlatform() !== null;
    // Compute connection status once per render (theme-reactive, no stale memoization)
    const connectionStatus = (() => {
        const { status } = socketStatus;
        switch (status) {
            case 'connected':
                return {
                    color: styles.statusConnected.color,
                    isPulsing: false,
                    text: t('status.connected'),
                    textColor: styles.statusConnected.color
                };
            case 'connecting':
                return {
                    color: styles.statusConnecting.color,
                    isPulsing: true,
                    text: t('status.connecting'),
                    textColor: styles.statusConnecting.color
                };
            case 'disconnected':
                return {
                    color: styles.statusDisconnected.color,
                    isPulsing: false,
                    text: t('status.disconnected'),
                    textColor: styles.statusDisconnected.color
                };
            case 'error':
                return {
                    color: styles.statusError.color,
                    isPulsing: false,
                    text: t('status.error'),
                    textColor: styles.statusError.color
                };
            default:
                return {
                    color: styles.statusDefault.color,
                    isPulsing: false,
                    text: '',
                    textColor: styles.statusDefault.color
                };
        }
    })();

    const { width: windowWidth, height: windowHeight } = useWindowDimensions();

    // iPad Stage Manager / Mac Catalyst draws window controls (traffic lights)
    // at the top-left, OUTSIDE of safeAreaInsets — system chrome that overlays
    // the app's content. Detect the most common cases via heuristic and reserve
    // ~60px so the logo/title clear them. (A real fix would need a native module
    // calling iOS 26's window control APIs.)
    const screenWidth = Dimensions.get('screen').width;
    const screenHeight = Dimensions.get('screen').height;
    const isWindowedIos = Platform.OS === 'ios' && (windowWidth < screenWidth - 1 || windowHeight < screenHeight - 1);
    const hasWindowControls = isWindowedIos || isRunningOnMac();

    const handleGoHome = React.useCallback(() => {
        try {
            router.dismissAll();
        } catch (_) {
            // Already at root of the current stack.
        }
    }, [router]);

    const navigationButtons = (
        <>
            <Pressable
                accessibilityLabel={t('tabs.inbox')}
                onPress={() => router.navigate('/(app)/inbox')}
                hitSlop={10}
                style={styles.notificationButton}
            >
                <Image
                    source={require('@/assets/images/navigation/inbox.png')}
                    contentFit="contain"
                    style={{ width: 20, height: 20, margin: 4 }}
                    tintColor={theme.colors.header.tint}
                />
                {friendRequests.length > 0 && (
                    <View style={styles.badge}>
                        <Text style={styles.badgeText}>
                            {friendRequests.length > 99 ? '99+' : friendRequests.length}
                        </Text>
                    </View>
                )}
                {inboxHasContent && friendRequests.length === 0 && (
                    <View style={styles.indicatorDot} />
                )}
            </Pressable>
            {!!dootaskProfile && (
                <Pressable
                    accessibilityLabel={t('tabs.dootask')}
                    onPress={() => router.navigate('/(app)/dootask')}
                    hitSlop={10}
                >
                    <Image
                        source={require('@/assets/images/navigation/todo.png')}
                        contentFit="contain"
                        style={{ width: 20, height: 20, margin: 4 }}
                        tintColor={theme.colors.header.tint}
                    />
                </Pressable>
            )}
            {!!profile.github && (
                <Pressable
                    accessibilityLabel={t('tabs.github')}
                    accessibilityRole="button"
                    onPress={() => router.navigate('/(app)/github')}
                    hitSlop={10}
                    ref={(element: any) => {
                        if (element && typeof element === 'object') {
                            element.title = t('tabs.github');
                        }
                    }}
                >
                    <Image
                        source={require('@/assets/images/navigation/github.png')}
                        contentFit="contain"
                        style={{ width: 20, height: 20, margin: 4 }}
                        tintColor={theme.colors.header.tint}
                    />
                </Pressable>
            )}
        </>
    );

    // The app logo heads the rail, level with the list column's title. Where the system draws window
    // controls over the top-left corner, the cell stays empty so the controls cover nothing.
    const railHeader = isDesktop ? undefined : (
        <View style={[styles.railLogoCell, { height: headerHeight }]}>
            {!hasWindowControls && (
                <Pressable accessibilityLabel={t('tabs.sessions')} onPress={handleGoHome} hitSlop={6}>
                    <Image
                        source={theme.dark ? require('@/assets/images/logo-white.svg') : require('@/assets/images/logo-black.svg')}
                        contentFit="contain"
                        style={{ width: 26, height: 26 }}
                    />
                </Pressable>
            )}
        </View>
    );

    return (
        <View style={[styles.container, isDesktop && styles.containerDesktop, { paddingTop: safeArea.top }]}>
            <SidebarMachineRail header={railHeader} />
            <View style={styles.listColumn}>
                {!isDesktop && (
                    <View style={[styles.header, { height: headerHeight }]}>
                        <View style={styles.titleContainerLeft}>
                            <Text
                                style={styles.titleText}
                                numberOfLines={1}
                                ref={(el: any) => {
                                    if (Platform.OS === 'web' && el) {
                                        el.title = t('sidebar.sessionsTitle');
                                    }
                                }}
                            >
                                {t('sidebar.sessionsTitle')}
                            </Text>
                            {connectionStatus.text && (
                                <View style={styles.statusContainer}>
                                    <StatusDot
                                        color={connectionStatus.color}
                                        isPulsing={connectionStatus.isPulsing}
                                        size={6}
                                        style={styles.statusDot}
                                    />
                                    <Text numberOfLines={1} style={[styles.statusText, { color: connectionStatus.textColor }]}>
                                        {connectionStatus.text}
                                    </Text>
                                </View>
                            )}
                        </View>
                        <View style={styles.rightContainer}>
                            {navigationButtons}
                        </View>
                    </View>
                )}
                <SidebarSearchRow />
                {realtimeStatus !== 'disconnected' && (
                    <VoiceAssistantStatusBar variant="sidebar" />
                )}
                <MainView variant="sidebar" />
            </View>
        </View>
    );
});
