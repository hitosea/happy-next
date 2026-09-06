import * as React from 'react';
import { View, ActivityIndicator, Text, Pressable, Platform, Image } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import TabView from './NativeBottomTabs';
import { useFriendRequests, useSocketStatus, useRealtimeStatus, useDootaskProfile } from '@/sync/storage';
import { useVisibleSessionListViewData } from '@/hooks/useVisibleSessionListViewData';
import { useInboxHasContent } from '@/hooks/useInboxHasContent';
import { useIsTablet } from '@/utils/responsive';
import { useRouter, Stack } from 'expo-router';
import { EmptySessionsTablet } from './EmptySessionsTablet';
import { SessionsList, SessionsSidebarTitle } from './SessionsList';
import { FABWide } from './FABWide';
import { TabBar, TabType } from './TabBar';
import { InboxView } from './InboxView';
import { SettingsViewWrapper } from './SettingsViewWrapper';
import { DooTaskListView } from './DooTaskListView';
import { GitHubListView } from './GitHubListView';
import { SessionsListWrapper } from './SessionsListWrapper';
import { HeaderLogo } from './HeaderLogo';
import { VoiceAssistantStatusBar } from './VoiceAssistantStatusBar';
import { StatusDot } from './StatusDot';
import { Ionicons } from '@expo/vector-icons';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { isUsingCustomServer } from '@/sync/serverConfig';
import { trackFriendsSearch } from '@/track';
import { DooTaskCreateSheet } from './dootask/DooTaskCreateSheet';
import { useProfile } from '@/sync/storage';
import { useAuth } from '@/auth/AuthContext';
import { prefetchGithubData } from '@/hooks/useGithubData';
import { shouldProvideMainHeaderRight } from './mainHeaderOptions';
import { getDesktopPlatform, handleDesktopTitleBarMouseDown } from '@/desktop/desktopWindowUtils';

interface MainViewProps {
    variant: 'phone' | 'sidebar';
}

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
    },
    phoneContainer: {
        flex: 1,
    },
    tabPage: {
        position: 'absolute' as const,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
    },
    tabPageHidden: {
        opacity: 0,
        pointerEvents: 'none' as const,
    },
    sidebarContentContainer: {
        flex: 1,
        flexBasis: 0,
        flexGrow: 1,
    },
    loadingContainerWrapper: {
        flex: 1,
        flexBasis: 0,
        flexGrow: 1,
        backgroundColor: theme.colors.groupped.background,
    },
    loadingContainer: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingBottom: 32,
    },
    tabletLoadingContainer: {
        flex: 1,
        flexBasis: 0,
        flexGrow: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    emptyStateContainer: {
        flex: 1,
        flexBasis: 0,
        flexGrow: 1,
        flexDirection: 'column',
        backgroundColor: theme.colors.groupped.background,
    },
    emptyStateContentContainer: {
        flex: 1,
        flexBasis: 0,
        flexGrow: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    emptyDetailLogo: {
        width: 92,
        height: 92,
        opacity: 0.11,
    },
    emptyDetailDragRegion: {
        height: 48,
        left: 0,
        position: 'absolute',
        right: 0,
        top: 0,
        zIndex: 1,
    },
    titleContainer: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    repoTitleRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    titleText: {
        fontSize: 17,
        lineHeight: 24,
        color: theme.colors.header.tint,
        fontWeight: '600',
        ...Typography.default('semiBold'),
    },
    statusContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: -2,
    },
    statusText: {
        fontSize: 12,
        fontWeight: '500',
        lineHeight: 16,
        ...Typography.default(),
    },
    headerButton: {
        width: 32,
        height: 32,
        alignItems: 'center',
        justifyContent: 'center',
    },
}));

// Tab header configuration
const TAB_TITLES = {
    sessions: 'tabs.sessions',
    inbox: 'tabs.inbox',
    dootask: 'tabs.dootask',
    github: 'tabs.github',
    settings: 'tabs.settings',
} as const;

// Active tabs
type ActiveTabType = 'sessions' | 'inbox' | 'dootask' | 'github' | 'settings';

// Header title component with connection status
const HeaderTitle = React.memo(({ activeTab, githubRepo, githubLoading, onGithubRepoPress }: { activeTab: ActiveTabType; githubRepo?: string | null; githubLoading?: boolean; onGithubRepoPress?: () => void }) => {
    const { theme } = useUnistyles();
    const socketStatus = useSocketStatus();

    const connectionStatus = React.useMemo(() => {
        const { status } = socketStatus;
        switch (status) {
            case 'connected':
                return {
                    color: theme.colors.status.connected,
                    isPulsing: false,
                    text: t('status.connected'),
                };
            case 'connecting':
                return {
                    color: theme.colors.status.connecting,
                    isPulsing: true,
                    text: t('status.connecting'),
                };
            case 'disconnected':
                return {
                    color: theme.colors.status.disconnected,
                    isPulsing: false,
                    text: t('status.disconnected'),
                };
            case 'error':
                return {
                    color: theme.colors.status.error,
                    isPulsing: false,
                    text: t('status.error'),
                };
            default:
                return {
                    color: theme.colors.status.default,
                    isPulsing: false,
                    text: '',
                };
        }
    }, [socketStatus, theme]);

    if (activeTab === 'github') {
        const repoName = githubRepo ? githubRepo.split('/').pop() || githubRepo : '';
        return (
            <Pressable style={styles.titleContainer} onPress={onGithubRepoPress} disabled={githubLoading || !repoName}>
                {repoName ? (
                    <View style={styles.repoTitleRow}>
                        <Text style={[styles.titleText, { maxWidth: 200 }]} numberOfLines={1} ellipsizeMode="tail">
                            {repoName}
                        </Text>
                        <Ionicons name="chevron-down" size={13} color={theme.colors.textSecondary} style={{ marginLeft: 4 }} />
                    </View>
                ) : (
                    <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                )}
            </Pressable>
        );
    }

    return (
        <View style={styles.titleContainer}>
            <Text style={styles.titleText}>
                {t(TAB_TITLES[activeTab])}
            </Text>
            {connectionStatus.text && (
                <View style={styles.statusContainer}>
                    <StatusDot
                        color={connectionStatus.color}
                        isPulsing={connectionStatus.isPulsing}
                        size={6}
                        style={{ marginRight: 4 }}
                    />
                    <Text style={[styles.statusText, { color: connectionStatus.color }]}>
                        {connectionStatus.text}
                    </Text>
                </View>
            )}
        </View>
    );
});

// Header right button - varies by tab
const HeaderRight = React.memo(({ activeTab, onDootaskCreate }: { activeTab: ActiveTabType; onDootaskCreate?: () => void }) => {
    const router = useRouter();
    const { theme } = useUnistyles();
    const isCustomServer = isUsingCustomServer();

    if (activeTab === 'sessions') {
        return (
            <Pressable
                onPress={() => router.push('/new')}
                hitSlop={15}
                style={styles.headerButton}
            >
                <Ionicons name="add-outline" size={28} color={theme.colors.header.tint} />
            </Pressable>
        );
    }

    if (activeTab === 'inbox') {
        return (
            <Pressable
                onPress={() => {
                    trackFriendsSearch();
                    router.push('/friends/search');
                }}
                hitSlop={15}
                style={styles.headerButton}
            >
                <Ionicons name="person-add-outline" size={24} color={theme.colors.header.tint} />
            </Pressable>
        );
    }

    if (activeTab === 'dootask') {
        return (
            <Pressable onPress={onDootaskCreate} hitSlop={15} style={styles.headerButton}>
                <Ionicons name="add-outline" size={28} color={theme.colors.header.tint} />
            </Pressable>
        );
    }

    if (activeTab === 'github') {
        return null;
    }

    if (activeTab === 'settings') {
        if (!isCustomServer) {
            return null;
        }
        return (
            <Pressable
                onPress={() => router.push('/server')}
                hitSlop={15}
                style={styles.headerButton}
            >
                <Ionicons name="server-outline" size={24} color={theme.colors.header.tint} />
            </Pressable>
        );
    }

    return null;
});

export const MainView = React.memo(({ variant }: MainViewProps) => {
    const { theme } = useUnistyles();
    const sessionListViewData = useVisibleSessionListViewData();
    const isTablet = useIsTablet();
    const router = useRouter();
    const friendRequests = useFriendRequests();
    const realtimeStatus = useRealtimeStatus();
    const dootaskProfile = useDootaskProfile();
    const inboxHasContent = useInboxHasContent();
    const showDootaskTab = !!dootaskProfile;
    const isCustomServer = isUsingCustomServer();
    const profile = useProfile();
    const showGithubTab = !!profile?.github;
    const { credentials } = useAuth();

    const [githubRepo, setGithubRepo] = React.useState<string | null>(null);
    const [githubLoading, setGithubLoading] = React.useState(false);
    const githubRepoPickerTriggerRef = React.useRef<(() => void) | null>(null);
    const handleOpenRepoPicker = React.useCallback(() => {
        githubRepoPickerTriggerRef.current?.();
    }, []);

    React.useEffect(() => {
        if (showGithubTab && credentials) {
            prefetchGithubData(credentials);
        }
    }, [showGithubTab, credentials]);

    const desktopPlatform = getDesktopPlatform();
    const isDesktopMacOS = desktopPlatform === 'macos';
    const isDesktopWindows = desktopPlatform === 'windows';

    // Tab state management
    const [activeTab, setActiveTab] = React.useState<TabType>('sessions');

    // If user is on a tab that becomes unavailable, snap back to sessions
    React.useEffect(() => {
        if (!showDootaskTab && activeTab === 'dootask') {
            setActiveTab('sessions');
        }
        if (!showGithubTab && activeTab === 'github') {
            setActiveTab('sessions');
        }
    }, [showDootaskTab, showGithubTab, activeTab]);

    const handleNewSession = React.useCallback(() => {
        router.push('/new');
    }, [router]);

    const handleTabPress = React.useCallback((tab: TabType) => {
        setActiveTab(tab);
    }, []);

    const [createMenuVisible, setCreateMenuVisible] = React.useState(false);

    const handleCreatePress = React.useCallback(() => {
        setCreateMenuVisible(true);
    }, []);

    const handleCreateMenuClose = React.useCallback(() => {
        setCreateMenuVisible(false);
    }, []);

    const handleSelectTask = React.useCallback(() => {
        router.push('/dootask/add-task');
    }, [router]);

    const handleSelectProject = React.useCallback(() => {
        router.push('/dootask/add-project');
    }, [router]);

    // Web fallback content swap
    const renderTabContent = React.useCallback(() => {
        switch (activeTab) {
            case 'inbox':
                return <InboxView />;
            case 'dootask':
                return <DooTaskListView />;
            case 'github':
                return <GitHubListView onRepoChange={setGithubRepo} onLoadingChange={setGithubLoading} repoPickerTriggerRef={githubRepoPickerTriggerRef} />;
            case 'settings':
                return <SettingsViewWrapper />;
            case 'sessions':
            default:
                return <SessionsListWrapper />;
        }
    }, [activeTab]);

    // Native tab routes for react-native-bottom-tabs
    const inboxBadge = friendRequests.length > 0
        ? (friendRequests.length > 99 ? '99+' : String(friendRequests.length))
        : (inboxHasContent ? ' ' : undefined);

    type NativeTabRoute = {
        key: TabType;
        title: string;
        focusedIcon: any;
        badge?: string;
    };
    const nativeTabRoutes: NativeTabRoute[] = [
        {
            key: 'inbox',
            title: t('tabs.inbox'),
            focusedIcon: require('@/assets/images/navigation/inbox.png'),
            badge: inboxBadge,
        },
        {
            key: 'sessions',
            title: t('tabs.sessions'),
            focusedIcon: require('@/assets/images/navigation/session.png'),
        },
        ...(showDootaskTab ? [{
            key: 'dootask' as const,
            title: t('tabs.dootask'),
            focusedIcon: require('@/assets/images/navigation/todo.png'),
        }] : []),
        ...(showGithubTab ? [{
            key: 'github' as const,
            title: t('tabs.github'),
            focusedIcon: require('@/assets/images/navigation/github.png'),
        }] : []),
        {
            key: 'settings',
            title: t('tabs.settings'),
            focusedIcon: require('@/assets/images/navigation/setting.png'),
        },
    ];
    const nativeActiveIndex = Math.max(0, nativeTabRoutes.findIndex(r => r.key === activeTab));
    const handleNativeIndexChange = React.useCallback((idx: number) => {
        const next = nativeTabRoutes[idx];
        if (next) setActiveTab(next.key);
    }, [nativeTabRoutes]);
    const renderNativeScene = React.useCallback(({ route }: { route: NativeTabRoute }) => {
        switch (route.key) {
            case 'sessions': return <SessionsListWrapper />;
            case 'inbox': return <InboxView />;
            case 'dootask': return <DooTaskListView />;
            case 'github': return <GitHubListView onRepoChange={setGithubRepo} onLoadingChange={setGithubLoading} repoPickerTriggerRef={githubRepoPickerTriggerRef} />;
            case 'settings': return <SettingsViewWrapper />;
            default: return null;
        }
    }, []);

    // Sidebar variant
    if (variant === 'sidebar') {
        // Loading state
        if (sessionListViewData === null) {
            return (
                <View style={styles.sidebarContentContainer}>
                    {isDesktopWindows && <SessionsSidebarTitle />}
                    <View style={styles.tabletLoadingContainer}>
                        <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                    </View>
                </View>
            );
        }

        // Empty state
        if (sessionListViewData.length === 0) {
            return (
                <View style={styles.sidebarContentContainer}>
                    {isDesktopWindows && <SessionsSidebarTitle />}
                    <View style={styles.emptyStateContainer}>
                        <EmptySessionsTablet />
                    </View>
                </View>
            );
        }

        // Sessions list
        return (
            <View style={styles.sidebarContentContainer}>
                <SessionsList />
            </View>
        );
    }

    // Phone variant
    // Tablet in phone mode - special case (when showing index view on tablets, show empty view)
    if (isTablet) {
        // Just show an empty view on tablets for the index view
        // The sessions list is shown in the sidebar, so the main area should be blank.
        // Also explicitly clear any phone-mode header options that may have been set
        // before the window resized into tablet split view.
        return (
            <>
                <Stack.Screen options={{ headerShown: false }} />
                <View style={styles.emptyStateContentContainer}>
                    <Image
                        source={theme.dark
                            ? require('@/assets/images/logo-white.png')
                            : require('@/assets/images/logo-black.png')}
                        resizeMode="contain"
                        style={styles.emptyDetailLogo}
                    />
                    {isDesktopMacOS && (
                        <View
                            {...({
                                'data-tauri-drag-region': true,
                                onMouseDown: handleDesktopTitleBarMouseDown,
                            } as any)}
                            style={styles.emptyDetailDragRegion}
                        />
                    )}
                </View>
            </>
        );
    }

    // Regular phone mode with tabs
    const stackScreen = (
        <Stack.Screen
            options={{
                headerShown: true,
                headerShadowVisible: false,
                headerStyle: { backgroundColor: theme.colors.groupped.background },
                headerTitle: () => <HeaderTitle activeTab={activeTab as ActiveTabType} githubRepo={githubRepo} githubLoading={githubLoading} onGithubRepoPress={handleOpenRepoPicker} />,
                headerLeft: () => <HeaderLogo />,
                headerRight: shouldProvideMainHeaderRight(activeTab) && !(activeTab === 'settings' && !isCustomServer)
                    ? () => <HeaderRight activeTab={activeTab as ActiveTabType} onDootaskCreate={handleCreatePress} />
                    : undefined,
            }}
        />
    );

    const dootaskSheet = showDootaskTab && (
        <DooTaskCreateSheet
            visible={createMenuVisible}
            onClose={handleCreateMenuClose}
            onSelectTask={handleSelectTask}
            onSelectProject={handleSelectProject}
        />
    );

    // Web: keep state-based content swap + custom TabBar (no native tab bar primitives on web)
    if (Platform.OS === 'web') {
        return (
            <>
                {stackScreen}
                <View style={styles.phoneContainer}>
                    {realtimeStatus !== 'disconnected' && (
                        <VoiceAssistantStatusBar variant="full" />
                    )}
                    {renderTabContent()}
                </View>
                <TabBar
                    activeTab={activeTab}
                    onTabPress={handleTabPress}
                    inboxBadgeCount={friendRequests.length}
                    showDootaskTab={showDootaskTab}
                    showGithubTab={showGithubTab}
                />
                {dootaskSheet}
            </>
        );
    }

    // Native (iOS / Android): use real UITabBar / Material BottomNavigationView
    return (
        <>
            {stackScreen}
            <View style={styles.phoneContainer}>
                {realtimeStatus !== 'disconnected' && (
                    <VoiceAssistantStatusBar variant="full" />
                )}
                <TabView
                    navigationState={{ index: nativeActiveIndex, routes: nativeTabRoutes }}
                    onIndexChange={handleNativeIndexChange}
                    renderScene={renderNativeScene}
                    tabBarActiveTintColor={theme.colors.text}
                    tabBarInactiveTintColor={theme.colors.textSecondary}
                    activeIndicatorColor={theme.colors.transparent}
                    tabBarStyle={{ backgroundColor: theme.colors.surface }}
                    translucent={false}
                    scrollEdgeAppearance="opaque"
                    labeled={Platform.OS === 'android' ? true : undefined}
                    tabLabelStyle={Platform.OS === 'android' ? { fontSize: 11 } : undefined}
                    hapticFeedbackEnabled
                />
            </View>
            {dootaskSheet}
        </>
    );
});
