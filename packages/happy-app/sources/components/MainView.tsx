import * as React from 'react';
import { View, ActivityIndicator, Text, Pressable, Platform, Image } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import TabView from './NativeBottomTabs';
import { useFriendRequests, useSocketStatus, useRealtimeStatus, useDootaskProfile, useProfile } from '@/sync/storage';
import { useInboxHasContent } from '@/hooks/useInboxHasContent';
import { useIsTablet } from '@/utils/responsive';
import { useRouter, Stack } from 'expo-router';
import { EmptySessionsTablet } from './EmptySessionsTablet';
import { SessionsList } from './SessionsList';
import { TabBar, TabType } from './TabBar';
import { InboxView } from './InboxView';
import { SettingsViewWrapper } from './SettingsViewWrapper';
import { DooTaskListView } from './DooTaskListView';
import { GitHubListView } from './GitHubListView';
import { SessionsListWrapper } from './SessionsListWrapper';
import { HeaderLogo } from './HeaderLogo';
import { softHeaderOptions } from './navigation/softHeader';
import { VoiceAssistantStatusBar } from './VoiceAssistantStatusBar';
import { Ionicons } from '@expo/vector-icons';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { isUsingCustomServer } from '@/sync/serverConfig';
import { trackFriendsSearch } from '@/track';
import { DooTaskCreateSheet, useDooTaskCreateItems } from './dootask/DooTaskCreateSheet';
import { useAuth } from '@/auth/AuthContext';
import { prefetchGithubData } from '@/hooks/useGithubData';
import { shouldProvideMainHeaderRight } from './mainHeaderOptions';
import { headerMenuOptions } from './navigation/headerMenu';
import type { BottomSheetModal } from '@gorhom/bottom-sheet';
import { ActionMenuModal } from './ActionMenuModal';
import { MachineSwitcherSheet } from './MachineSwitcherSheet';
import { useSessionListScope, type SessionListScope } from '@/hooks/useSessionListScope';
import { getSwitcherDot, type SessionScopeDot as Dot } from './sessionListScope';
import { SessionScopeDot } from './SessionScopeDot';
import { requestSessionListJump } from './sessionListJump';
import { useAddMachine } from '@/hooks/useAddMachine';
import { useSessionsCreateItems } from '@/hooks/useSessionsCreateItems';

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
    chevronContainer: {
        marginLeft: 4,
    },
    chevronDot: {
        position: 'absolute',
        top: -4,
        right: -8,
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

const SESSIONS_TAB_DOUBLE_TAP_MS = 400;

// Active tabs
type ActiveTabType = 'sessions' | 'inbox' | 'dootask' | 'github' | 'settings';

// Connection status rendered underneath the header title. On iOS the system draws it itself now,
// through the native subtitle (`headerSubtitle` → `UINavigationItem.subtitle`, iOS 26+): a custom
// title view (`headerTitle` as a component) makes UIKit drop the header's scroll-edge effect, so
// the subtitle may not live inside the title view anymore. Only the dot is lost — the text keeps
// the status color.
const useConnectionStatusSubtitle = () => {
    const { theme } = useUnistyles();
    const socketStatus = useSocketStatus();

    return React.useMemo(() => {
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
};

// Header title that opens a picker: the title with a chevron. It has to be a custom title view (a
// pressable with a chevron); the connection status under it stays the native `headerSubtitle`, as
// with a subtitle drawn in the title view the scroll edge effect under the header comes out thinner.
// An optional status dot sits on the chevron as a badge: something in the picker wants a look.
const HeaderPickerTitle = React.memo(({ title, dot = 'none', onPress }: {
    title: string;
    dot?: Dot;
    onPress?: () => void;
}) => {
    const { theme } = useUnistyles();

    return (
        <Pressable style={styles.titleContainer} onPress={onPress}>
            <View style={styles.repoTitleRow}>
                <Text style={[styles.titleText, { maxWidth: 200 }]} numberOfLines={1} ellipsizeMode="tail">
                    {title}
                </Text>
                <View style={styles.chevronContainer}>
                    <Ionicons name="chevron-down" size={13} color={theme.colors.textSecondary} />
                    <SessionScopeDot dot={dot} size={7} style={styles.chevronDot} />
                </View>
            </View>
        </Pressable>
    );
});

// Header title of the github tab — the repository picker.
const GitHubHeaderTitle = React.memo(({ githubRepo, onGithubRepoPress }: { githubRepo?: string | null; onGithubRepoPress?: () => void }) => {
    const repoName = githubRepo ? githubRepo.split('/').pop() || githubRepo : '';
    return <HeaderPickerTitle title={repoName || t('github.allRepos')} onPress={onGithubRepoPress} />;
});

// Header title of the sessions tab — the machine switcher.
// With one machine or none it reads "Sessions" but still opens the switcher, which is also where
// machines get added. The chevron carries the strongest dot in the switcher, so a permission
// request or finished task on another machine is not missed.
const SessionsHeaderTitle = React.memo(({ scope, onPress }: { scope: SessionListScope; onPress: () => void }) => {
    const { selection, switchable, groups, sharedDot, sharedByMeDot } = scope;
    const dot = React.useMemo(
        () => getSwitcherDot({ groups, sharedDot, sharedByMeDot }),
        [groups, sharedDot, sharedByMeDot],
    );
    let title = t('tabs.sessions');
    if (switchable) {
        if (selection === 'all') title = t('sessionScope.allMachines');
        else if (selection === 'shared') title = t('session.sharing.sharedWithMeSessions');
        else if (selection === 'sharedByMe') title = t('session.sharing.sharedByMeSessions');
        else title = scope.groups.find(group => group.id === selection)?.name ?? t('sessionScope.allMachines');
    }

    return (
        <HeaderPickerTitle
            title={title}
            dot={dot}
            onPress={onPress}
        />
    );
});

// Header right button - varies by tab
const HeaderRight = React.memo(({ activeTab, onDootaskCreate, onSessionsCreate }: { activeTab: ActiveTabType; onDootaskCreate?: () => void; onSessionsCreate?: () => void }) => {
    const router = useRouter();
    const { theme } = useUnistyles();
    const isCustomServer = isUsingCustomServer();

    if (activeTab === 'sessions') {
        return (
            <Pressable
                onPress={onSessionsCreate}
                hitSlop={15}
                style={styles.headerButton}
                accessibilityLabel={t('sessionScope.addMenu')}
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
    const sessionScope = useSessionListScope();
    const sessionListViewData = sessionScope.data;
    const isTablet = useIsTablet();
    const router = useRouter();
    const friendRequests = useFriendRequests();
    const realtimeStatus = useRealtimeStatus();
    const connectionStatus = useConnectionStatusSubtitle();
    const dootaskProfile = useDootaskProfile();
    const inboxHasContent = useInboxHasContent();
    const showDootaskTab = !!dootaskProfile;
    const isCustomServer = isUsingCustomServer();
    const profile = useProfile();
    const showGithubTab = !!profile?.github;
    const { credentials } = useAuth();

    const [githubRepo, setGithubRepo] = React.useState<string | null>(null);
    const [activeTab, setActiveTab] = React.useState<TabType>('sessions');
    const githubRepoPickerTriggerRef = React.useRef<(() => void) | null>(null);
    const handleOpenRepoPicker = React.useCallback(() => {
        githubRepoPickerTriggerRef.current?.();
    }, []);

    React.useEffect(() => {
        if (showGithubTab && credentials && activeTab === 'github') {
            prefetchGithubData(credentials);
        }
    }, [showGithubTab, credentials, activeTab]);

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

    // Two taps on the already selected sessions tab in quick succession jump the list to the next
    // session that wants a look (see sessionListJump).
    const lastSessionsTabTapRef = React.useRef(0);
    const handleTabReselect = React.useCallback((tab: TabType) => {
        if (tab !== 'sessions') return;
        const now = Date.now();
        if (now - lastSessionsTabTapRef.current < SESSIONS_TAB_DOUBLE_TAP_MS) {
            lastSessionsTabTapRef.current = 0;
            requestSessionListJump();
        } else {
            lastSessionsTabTapRef.current = now;
        }
    }, []);

    const handleTabPress = React.useCallback((tab: TabType) => {
        if (tab === activeTab) handleTabReselect(tab);
        setActiveTab(tab);
    }, [activeTab, handleTabReselect]);

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

    const dootaskCreateItems = useDooTaskCreateItems(handleSelectTask, handleSelectProject);

    const machineSwitcherRef = React.useRef<BottomSheetModal>(null);
    const handleOpenMachineSwitcher = React.useCallback(() => {
        machineSwitcherRef.current?.present();
    }, []);
    const addMachine = useAddMachine();
    const [sessionsMenuVisible, setSessionsMenuVisible] = React.useState(false);
    const handleSessionsCreatePress = React.useCallback(() => setSessionsMenuVisible(true), []);
    const handleSessionsMenuClose = React.useCallback(() => setSessionsMenuVisible(false), []);
    const sessionsCreateItems = useSessionsCreateItems(sessionScope, addMachine);

    // Web fallback content swap
    const renderTabContent = React.useCallback(() => {
        switch (activeTab) {
            case 'inbox':
                return <InboxView />;
            case 'dootask':
                return <DooTaskListView />;
            case 'github':
                return <GitHubListView onRepoChange={setGithubRepo} repoPickerTriggerRef={githubRepoPickerTriggerRef} />;
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
        if (!next) return;
        // The native tab bar reports a tap on the selected tab as a change to the same index.
        if (next.key === activeTab) handleTabReselect(next.key);
        setActiveTab(next.key);
    }, [nativeTabRoutes, activeTab, handleTabReselect]);
    const renderNativeScene = React.useCallback(({ route }: { route: NativeTabRoute }) => {
        switch (route.key) {
            case 'sessions': return <SessionsListWrapper />;
            case 'inbox': return <InboxView />;
            case 'dootask': return <DooTaskListView />;
            case 'github': return <GitHubListView onRepoChange={setGithubRepo} repoPickerTriggerRef={githubRepoPickerTriggerRef} />;
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
                    <View style={styles.tabletLoadingContainer}>
                        <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                    </View>
                </View>
            );
        }

        // Empty state — unless there are machines to switch between, which the list's rail shows
        if (sessionListViewData.length === 0 && !sessionScope.switchable) {
            return (
                <View style={styles.sidebarContentContainer}>
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
                            ? require('@/assets/images/logo-white.svg')
                            : require('@/assets/images/logo-black.svg')}
                        resizeMode="contain"
                        style={styles.emptyDetailLogo}
                    />
                </View>
            </>
        );
    }

    // Regular phone mode with tabs
    const stackScreen = (
        <Stack.Screen
            options={{
                headerShown: true,
                ...softHeaderOptions,
                headerTitle: activeTab === 'github'
                    ? () => <GitHubHeaderTitle githubRepo={githubRepo} onGithubRepoPress={handleOpenRepoPicker} />
                    : activeTab === 'sessions'
                        ? () => <SessionsHeaderTitle scope={sessionScope} onPress={handleOpenMachineSwitcher} />
                        : t(TAB_TITLES[activeTab as ActiveTabType]),
                headerSubtitle: connectionStatus.text || undefined,
                headerSubtitleColor: connectionStatus.color,
                headerLeft: () => <HeaderLogo />,
                headerRight: shouldProvideMainHeaderRight(activeTab) && !(activeTab === 'settings' && !isCustomServer)
                    ? () => <HeaderRight activeTab={activeTab as ActiveTabType} onDootaskCreate={handleCreatePress} onSessionsCreate={handleSessionsCreatePress} />
                    : undefined,
                ...headerMenuOptions(
                    activeTab === 'dootask' ? dootaskCreateItems : activeTab === 'sessions' ? sessionsCreateItems : null,
                    { icon: 'plus', label: activeTab === 'sessions' ? t('sessionScope.addMenu') : t('common.create') },
                ),
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

    const sessionsSheets = (
        <>
            <MachineSwitcherSheet ref={machineSwitcherRef} onAddMachine={addMachine} />
            <ActionMenuModal
                visible={sessionsMenuVisible}
                items={sessionsCreateItems}
                onClose={handleSessionsMenuClose}
                deferItemPress
            />
        </>
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
                {sessionsSheets}
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
                    // Native selection can retain stale indices when an integration inserts a tab.
                    key={nativeTabRoutes.map((route) => route.key).join(':')}
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
            {sessionsSheets}
        </>
    );
});
