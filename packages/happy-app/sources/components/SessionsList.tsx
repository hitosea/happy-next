import React from 'react';
import { View, Pressable, FlatList, Platform, RefreshControl, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { Text } from '@/components/StyledText';
import { usePathname } from 'expo-router';
import { SessionListViewItem, storage, useOrchestratorRunningTaskCount, useSessionHasDraft, useSocketStatus } from '@/sync/storage';
import { useCompactSessionView } from '@/hooks/useCompactSessionView';
import { Ionicons } from '@expo/vector-icons';
import { getSessionName, useSessionStatus, getSessionAvatarId, hasUnreadCompletion } from '@/utils/sessionUtils';
import { getSessionProjectCollapseKey } from '@/hooks/useSessionProjectGroups';
import { getSessionJumpPriority, pickNextJumpSession, subscribeToSessionListJump } from './sessionListJump';
import { SessionProjectLabelsContext, useSessionProjectLabel, useSessionProjectLabels } from '@/hooks/useSessionProjectLabel';
import { ProjectLabelText } from './ProjectLabelText';
import { Avatar } from './Avatar';
import { ActiveSessionsGroup } from './ActiveSessionsGroup';
import { ActiveSessionsGroupCompact } from './ActiveSessionsGroupCompact';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSessionListScope, collectListSessions } from '@/hooks/useSessionListScope';
import { isSharingSelection, type SessionListSelection, type SessionMachineGroup } from './sessionListScope';
import { useLocalSettingMutable } from '@/sync/storage';
import { useMachineNameMap } from '@/hooks/useMachineNameMap';
import { Typography } from '@/constants/Typography';
import { Session } from '@/sync/storageTypes';
import { StatusDot } from './StatusDot';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { useIsTablet } from '@/utils/responsive';
import { requestReview } from '@/utils/requestReview';
import { layout } from './layout';
import { useNavigateToSession } from '@/hooks/useNavigateToSession';
import { t } from '@/text';
import { useRouter } from 'expo-router';
import { Item } from './Item';
import { ItemGroup } from './ItemGroup';
import { useHappyAction } from '@/hooks/useHappyAction';
import { sessionDelete } from '@/sync/ops';
import { HappyError } from '@/utils/errors';
import { Modal } from '@/modal';
import { sync } from '@/sync/sync';
import { SessionContextMenu } from './SessionContextMenu';
import { PressHighlight } from './PressHighlight';
import { SessionMarkerBar } from './SessionColorMarker';

const stylesheet = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'stretch',
        backgroundColor: theme.colors.groupped.background,
    },
    contentContainer: {
        flex: 1,
        maxWidth: layout.maxWidth,
    },
    headerSection: {
        backgroundColor: theme.colors.groupped.background,
        paddingHorizontal: 24,
        paddingTop: 20,
        paddingBottom: 8,
    },
    headerText: {
        fontSize: 14,
        fontWeight: '600',
        color: theme.colors.groupped.sectionTitle,
        letterSpacing: 0.1,
        ...Typography.default('semiBold'),
    },
    projectGroup: {
        paddingHorizontal: 16,
        paddingVertical: 10,
        backgroundColor: theme.colors.surface,
    },
    projectGroupTitle: {
        fontSize: 13,
        fontWeight: '600',
        color: theme.colors.text,
        ...Typography.default('semiBold'),
    },
    projectGroupSubtitle: {
        fontSize: 11,
        color: theme.colors.textSecondary,
        marginTop: 2,
        ...Typography.default(),
    },
    sessionItem: {
        height: 88,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        backgroundColor: theme.colors.surface,
    },
    sessionItemCompact: {
        height: 56,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        backgroundColor: theme.colors.surface,
    },
    sessionItemContainer: {
        marginHorizontal: 16,
        overflow: 'hidden',
    },
    sessionItemFirst: {
        borderTopLeftRadius: 12,
        borderTopRightRadius: 12,
    },
    sessionItemLast: {
        borderBottomLeftRadius: 12,
        borderBottomRightRadius: 12,
    },
    sessionItemSingle: {
        borderRadius: 12,
    },
    sessionItemContainerFirst: {
        borderTopLeftRadius: 12,
        borderTopRightRadius: 12,
    },
    sessionItemContainerLast: {
        borderBottomLeftRadius: 12,
        borderBottomRightRadius: 12,
        marginBottom: 12,
    },
    sessionItemContainerSingle: {
        borderRadius: 12,
        marginBottom: 12,
    },
    sessionItemSelected: {
        backgroundColor: theme.colors.surfaceSelected,
    },
    sessionContent: {
        flex: 1,
        marginLeft: 16,
        justifyContent: 'center',
    },
    sessionTitleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 2,
    },
    sessionTitle: {
        fontSize: 15,
        fontWeight: '500',
        flex: 1,
        ...Typography.default('semiBold'),
    },
    sessionTitleCompact: {
        fontSize: 15,
        flex: 1,
        ...Typography.default('regular'),
    },
    sessionTitleConnected: {
        color: theme.colors.text,
    },
    sessionTitleDisconnected: {
        color: theme.colors.textSecondary,
    },
    sessionSubtitle: {
        fontSize: 13,
        color: theme.colors.textSecondary,
        marginBottom: 4,
        ...Typography.default(),
    },
    statusRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    statusDotContainer: {
        alignItems: 'center',
        justifyContent: 'center',
        height: 16,
        marginTop: 2,
        marginRight: 4,
    },
    statusText: {
        fontSize: 12,
        fontWeight: '500',
        lineHeight: 16,
        ...Typography.default(),
    },
    taskStatusContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: theme.colors.surfaceHighest,
        paddingHorizontal: 4,
        height: 16,
        borderRadius: 4,
    },
    taskStatusText: {
        fontSize: 10,
        fontWeight: '500',
        color: theme.colors.textSecondary,
        ...Typography.default(),
    },
    statusIndicatorsRight: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        transform: [{ translateY: 1 }],
    },
    avatarContainer: {
        position: 'relative',
        width: 48,
        height: 48,
    },
    draftIconContainer: {
        position: 'absolute',
        bottom: -2,
        right: -2,
        width: 18,
        height: 18,
        alignItems: 'center',
        justifyContent: 'center',
    },
    draftIconOverlay: {
        color: theme.colors.textSecondary,
    },
    artifactsSection: {
        paddingHorizontal: 16,
        paddingBottom: 12,
        backgroundColor: theme.colors.groupped.background,
    },
    swipeAction: {
        width: 112,
        height: '100%',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.status.error,
    },
    swipeActionText: {
        marginTop: 4,
        fontSize: 12,
        color: '#FFFFFF',
        textAlign: 'center',
        ...Typography.default('semiBold'),
    },
    unreadDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: '#007AFF',
        marginRight: 6,
    },
    sessionDivider: {
        height: StyleSheet.hairlineWidth,
        backgroundColor: theme.colors.divider,
        marginLeft: 80, // 16px paddingHorizontal + 48px avatar + 16px gap
    },
    emptyContainer: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 48,
    },
    emptyText: {
        fontSize: 16,
        color: theme.colors.textSecondary,
        textAlign: 'center',
        ...Typography.default(),
    },
    emptyDescription: {
        marginTop: 8,
        fontSize: 13,
        lineHeight: 20,
        color: theme.colors.textSecondary,
        textAlign: 'center',
        ...Typography.default(),
    },
    emptyAction: {
        marginTop: 20,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 18,
        height: 40,
        borderRadius: 20,
        backgroundColor: theme.colors.button.primary.background,
    },
    emptyActionText: {
        fontSize: 14,
        color: theme.colors.button.primary.tint,
        ...Typography.default('semiBold'),
    },
    sectionDividerHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingTop: 14,
        paddingBottom: 4,
        paddingHorizontal: Platform.select({ ios: 20, default: 16 }),
        backgroundColor: theme.colors.groupped.background,
    },
    sectionDividerName: {
        flexShrink: 1,
        fontSize: 12,
        color: theme.colors.textSecondary,
        ...Typography.default('semiBold'),
    },
    sectionDividerCount: {
        fontSize: 12,
        color: theme.colors.textSecondary,
        ...Typography.default(),
    },
    sectionDividerLine: {
        flex: 1,
        height: StyleSheet.hairlineWidth,
        marginHorizontal: 4,
        backgroundColor: theme.colors.divider,
    },
    machineOnlineDot: {
        width: 6,
        height: 6,
        borderRadius: 3,
    },
}));

type SessionTab = SessionListSelection;
type SessionRowRef = View | null;
type RegisterSessionRowRef = (sessionId: string, ref: SessionRowRef) => void;

// A section of the sidebar's "All machines" view: one per machine with sessions, then the shared sessions.
type SessionSection = {
    id: string;
    name: string;
    // Machines only; the shared sections have no online state.
    online?: boolean;
    sessions: Session[];
};

const SHARED_SECTION_ID = 'shared';
const SHARED_BY_ME_SECTION_ID = 'sharedByMe';

function machineSection(group: SessionMachineGroup): SessionSection {
    return {
        id: group.id,
        name: group.unknown ? t('sessionScope.unknownMachine') : group.name,
        online: group.unknown ? undefined : group.online,
        sessions: group.sessions,
    };
}

// The list's rows: the synced list items, plus the sections of the sidebar's "All machines" view.
type ListItem = (
    | SessionListViewItem
    | { type: 'machine-header'; section: SessionSection }
    | { type: 'machine-sessions'; section: SessionSection }
    | { type: 'shared-sessions'; sessions: Session[] }
) & { selected?: boolean };

function getSessionIdFromPathname(pathname: string): string | null {
    if (!pathname.startsWith('/session/')) return null;
    return pathname.split('/')[2] || null;
}

function newSessionPath(machineId?: string): '/new' | `/new?${string}` {
    return machineId ? `/new?${new URLSearchParams({ machineId }).toString()}` : '/new';
}

type ViewportInsets = { top: number; bottom: number; height: number };

// Reports the iOS safe area of the list's viewport — the header and tab bar that the list's automatic
// content inset adjustment insets it by. A nested provider measures the safe area of its own native
// view, which fills the viewport, rather than the screen's.
const ViewportInsetsProbe = React.memo(({ onChange }: { onChange: (insets: ViewportInsets) => void }) => {
    const [height, setHeight] = React.useState(0);
    return (
        <View
            pointerEvents="none"
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
            onLayout={event => setHeight(event.nativeEvent.layout.height)}
        >
            <SafeAreaProvider style={{ flex: 1 }}>
                <ViewportInsetsReporter height={height} onChange={onChange} />
            </SafeAreaProvider>
        </View>
    );
});

function ViewportInsetsReporter({ height, onChange }: { height: number; onChange: (insets: ViewportInsets) => void }) {
    const { top, bottom } = useSafeAreaInsets();
    React.useEffect(() => onChange({ top, bottom, height }), [top, bottom, height, onChange]);
    return null;
}

// Header of one section in the sidebar's "All machines" view: a plain divider that stays pinned while
// its sessions scroll by. Only the project groups below it fold, so the list has a single fold level.
const SessionSectionHeader = React.memo(({ section }: { section: SessionSection }) => {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    return (
        <View style={styles.sectionDividerHeader}>
            {section.online !== undefined && (
                <View style={[styles.machineOnlineDot, { backgroundColor: section.online ? theme.colors.status.connected : theme.colors.textSecondary }]} />
            )}
            <Text
                style={styles.sectionDividerName}
                numberOfLines={1}
                ref={(el: any) => { if (Platform.OS === 'web' && el) el.title = section.name; }}
            >
                {section.name}
            </Text>
            <View style={styles.sectionDividerLine} />
            <Text style={styles.sectionDividerCount}>{section.sessions.length}</Text>
        </View>
    );
});

export function SessionsList() {
    const styles = stylesheet;
    const safeArea = useSafeAreaInsets();
    const scope = useSessionListScope();
    const {
        data,
        sharedData,
        sharedByMeData,
        groups,
        switchable,
        selection: activeTab,
        setSelection: setActiveTab,
        activeSessions: allActiveSessions,
        sharedSessions,
        sharedByMeSessions,
    } = scope;
    const machineNames = useMachineNameMap();
    const socketStatus = useSocketStatus();
    // machineId -> name cache, so machine labels survive a restart before machines sync.
    const [machineNameCache, setMachineNameCache] = useLocalSettingMutable('machineNameCache');
    const [pendingSessionNavigationId, setPendingSessionNavigationId] = React.useState<string | null>(null);

    // Machines that can be picked on their own; the unknown-machine group only shows under "All".
    const machineGroups = React.useMemo(() => groups.filter(group => !group.unknown), [groups]);

    // Persist live machine names so they survive app restarts (machines sync lazily).
    React.useEffect(() => {
        let changed = false;
        const next = { ...machineNameCache };
        for (const [id, name] of machineNames) {
            if (next[id] !== name) {
                next[id] = name;
                changed = true;
            }
        }
        if (changed) setMachineNameCache(next);
    }, [machineNames, machineNameCache, setMachineNameCache]);
    const pathname = usePathname();
    const selectedSessionId = React.useMemo(() => getSessionIdFromPathname(pathname), [pathname]);
    const previousSelectedSessionIdRef = React.useRef<string | null>(null);
    React.useEffect(() => {
        if (previousSelectedSessionIdRef.current === selectedSessionId) return;
        previousSelectedSessionIdRef.current = selectedSessionId;
        setPendingSessionNavigationId(selectedSessionId);
    }, [selectedSessionId]);
    const isTablet = useIsTablet();
    // The sidebar (tablet / desktop / wide web) switches machines from the rail at its left edge
    // (see SidebarView); there "All machines" lists every machine with sessions as its own section.
    const groupByMachine = isTablet && switchable && activeTab === 'all';
    const compactSessionView = useCompactSessionView();
    const router = useRouter();
    const { theme } = useUnistyles();
    const [refreshing, setRefreshing] = React.useState(false);
    const [viewportInsets, setViewportInsets] = React.useState<ViewportInsets | null>(null);
    const handleRefresh = React.useCallback(async () => {
        setRefreshing(true);
        try {
            await sync.refreshSessionsWithReconcile();
        } finally {
            setRefreshing(false);
        }
    }, []);

    // The active sessions shared with me, a section of the "All machines" view.
    const sharedSection = React.useMemo<SessionSection | null>(() => {
        const sharedActive = sharedSessions.filter(session => session.active);
        return sharedActive.length > 0
            ? { id: SHARED_SECTION_ID, name: t('session.sharing.sharedWithMeSessions'), sessions: sharedActive }
            : null;
    }, [sharedSessions]);

    // The "All machines" view's sections: each machine, then the active sessions shared with me and by me.
    const sections = React.useMemo<SessionSection[]>(() => {
        if (!groupByMachine) return [];
        const result = groups.filter(group => group.sessions.length > 0).map(machineSection);
        if (sharedSection) result.push(sharedSection);
        const sharedByMeActive = sharedByMeSessions.filter(session => session.active);
        if (sharedByMeActive.length > 0) {
            result.push({ id: SHARED_BY_ME_SECTION_ID, name: t('session.sharing.sharedByMeSessions'), sessions: sharedByMeActive });
        }
        return result;
    }, [groupByMachine, groups, sharedSection, sharedByMeSessions]);

    const selectedGroup = React.useMemo(
        () => machineGroups.find(group => group.id === activeTab),
        [machineGroups, activeTab],
    );

    const tabData = React.useMemo<ListItem[] | null>(() => {
        if (activeTab === 'shared') return sharedData;
        if (activeTab === 'sharedByMe') return sharedByMeData;
        if (activeTab !== 'all') {
            if (!selectedGroup) return data;
            return selectedGroup.sessions.length > 0 ? [{ type: 'active-sessions', sessions: selectedGroup.sessions }] : [];
        }
        if (!data) return data;
        if (!groupByMachine) {
            // Without the sidebar there are no machine sections, only sessions by project: the ones
            // shared with me are grouped the same way, after my own projects, in place of their list.
            const sharedAt = data.findIndex(item => item.type === 'header' && item.title === 'Shared with me');
            if (sharedAt < 0 || !sharedSection) return data;
            return [...data.slice(0, sharedAt), { type: 'shared-sessions', sessions: sharedSection.sessions }];
        }
        return sections.flatMap<ListItem>(section => [
            { type: 'machine-header', section },
            { type: 'machine-sessions', section },
        ]);
    }, [activeTab, sharedData, sharedByMeData, data, selectedGroup, groupByMachine, sections, sharedSection]);
    const tabSessions = React.useMemo(() => (tabData ?? []).flatMap(item =>
        item.type === 'session' ? [item.session]
            : item.type === 'active-sessions' || item.type === 'shared-sessions' ? item.sessions
                : item.type === 'machine-sessions' ? item.section.sessions
                    : []), [tabData]);
    const projectLabel = useSessionProjectLabels(tabSessions);

    const pendingActiveSession = React.useMemo(
        () => pendingSessionNavigationId ? allActiveSessions.find(session => session.id === pendingSessionNavigationId) : undefined,
        [allActiveSessions, pendingSessionNavigationId],
    );
    const pendingSessionTargetTab = React.useMemo<SessionTab | null>(() => {
        if (!pendingSessionNavigationId) return null;
        if (pendingActiveSession) {
            const machineId = pendingActiveSession.metadata?.machineId;
            if (switchable && machineId && machineGroups.some(group => group.id === machineId)) {
                return machineId;
            }
            return 'all';
        }
        if (sharedSessions.some(session => session.id === pendingSessionNavigationId)) return 'shared';
        if (sharedByMeSessions.some(session => session.id === pendingSessionNavigationId)) return 'sharedByMe';
        if (collectListSessions(data).some(session => session.id === pendingSessionNavigationId)) return 'all';
        return null;
    }, [pendingSessionNavigationId, pendingActiveSession, switchable, machineGroups, sharedSessions, sharedByMeSessions, data]);
    const activeTabContainsPendingSession = React.useMemo(() => {
        if (!pendingSessionNavigationId) return false;
        if (activeTab === 'all') return collectListSessions(data).some(session => session.id === pendingSessionNavigationId);
        if (activeTab === 'shared') return sharedSessions.some(session => session.id === pendingSessionNavigationId);
        if (activeTab === 'sharedByMe') return sharedByMeSessions.some(session => session.id === pendingSessionNavigationId);
        return selectedGroup?.sessions.some(session => session.id === pendingSessionNavigationId) ?? false;
    }, [pendingSessionNavigationId, activeTab, data, sharedSessions, sharedByMeSessions, selectedGroup]);

    const selectable = isTablet;
    const dataWithSelected = React.useMemo(() => {
        if (!selectable) return tabData;
        return tabData?.map(item => ({
            ...item,
            selected: selectedSessionId === (item.type === 'session' ? item.session.id : null)
        }));
    }, [selectable, tabData, selectedSessionId]);
    // The machine dividers of the "All machines" view stay pinned while their sessions scroll by.
    const stickyHeaderIndices = React.useMemo(() => {
        if (!groupByMachine || !dataWithSelected) return undefined;
        return dataWithSelected.flatMap((item, index) => item.type === 'machine-header' ? [index] : []);
    }, [groupByMachine, dataWithSelected]);

    const listRef = React.useRef<FlatList<ListItem> | null>(null);
    const listViewportRef = React.useRef<View | null>(null);
    const sessionRowRefs = React.useRef(new Map<string, View>());
    const scrollOffsetRef = React.useRef(0);
    // What scrolling has to respect: on iOS the header and tab bar overlap the viewport (the
    // automatic content inset), so the visible part excludes them and the top sits at -inset.top.
    const viewportInsetsRef = React.useRef<ViewportInsets | null>(null);
    viewportInsetsRef.current = viewportInsets;
    const contentHeightRef = React.useRef(0);
    const viewportHeightRef = React.useRef(0);
    const getVisibleInsets = React.useCallback(() => {
        const insets = Platform.OS === 'ios' ? viewportInsetsRef.current : null;
        return { top: insets?.top ?? 0, bottom: insets?.bottom ?? 0 };
    }, []);
    const clampScrollOffset = React.useCallback((offset: number) => {
        const { top, bottom } = getVisibleInsets();
        const max = Math.max(-top, contentHeightRef.current + bottom - viewportHeightRef.current);
        return Math.min(Math.max(offset, -top), max);
    }, [getVisibleInsets]);
    const scrollListToTop = React.useCallback(() => {
        listRef.current?.scrollToOffset({ offset: -getVisibleInsets().top, animated: true });
    }, [getVisibleInsets]);
    const revealFrameRef = React.useRef<number | null>(null);
    const registerSessionRowRef = React.useCallback<RegisterSessionRowRef>((sessionId, ref) => {
        if (ref) sessionRowRefs.current.set(sessionId, ref);
        else sessionRowRefs.current.delete(sessionId);
    }, []);
    // 'nearest' scrolls just enough to bring the row into view; 'center' puts it mid-view.
    const revealSessionRow = React.useCallback((sessionId: string, align: 'nearest' | 'center' = 'nearest'): boolean => {
        const row = sessionRowRefs.current.get(sessionId);
        if (!row) return false;

        if (Platform.OS === 'web' && typeof (row as any).scrollIntoView === 'function') {
            (row as any).scrollIntoView({ behavior: 'smooth', block: align });
            return true;
        }

        const viewport = listViewportRef.current;
        if (!viewport) return false;
        row.measureInWindow((_rowX, rowY, _rowWidth, rowHeight) => {
            viewport.measureInWindow((_viewportX, viewportY, _viewportWidth, viewportHeight) => {
                const margin = 8;
                const insets = getVisibleInsets();
                const visibleTop = viewportY + insets.top + margin;
                const visibleBottom = viewportY + viewportHeight - insets.bottom - margin;
                const rowBottom = rowY + rowHeight;
                let delta = 0;
                if (align === 'center') delta = (rowY + rowBottom) / 2 - (visibleTop + visibleBottom) / 2;
                else if (rowY < visibleTop) delta = rowY - visibleTop;
                else if (rowBottom > visibleBottom) delta = rowBottom - visibleBottom;
                if (Math.abs(delta) >= 1) {
                    listRef.current?.scrollToOffset({
                        offset: clampScrollOffset(scrollOffsetRef.current + delta),
                        animated: true,
                    });
                }
            });
        });
        return true;
    }, [getVisibleInsets, clampScrollOffset]);
    const scheduleRevealSelectedSession = React.useCallback((sessionId: string, align: 'nearest' | 'center' = 'nearest') => {
        if (revealFrameRef.current !== null) cancelAnimationFrame(revealFrameRef.current);
        revealFrameRef.current = requestAnimationFrame(() => {
            revealFrameRef.current = null;
            if (revealSessionRow(sessionId, align)) return;

            const topLevelIndex = dataWithSelected?.findIndex(item =>
                item.type === 'session'
                    ? item.session.id === sessionId
                    : item.type === 'active-sessions' || item.type === 'shared-sessions'
                        ? item.sessions.some(session => session.id === sessionId)
                        : item.type === 'machine-sessions' && item.section.sessions.some(session => session.id === sessionId)
            ) ?? -1;
            if (topLevelIndex < 0) return;

            listRef.current?.scrollToIndex({ index: topLevelIndex, animated: false, viewPosition: 0.5 });
            revealFrameRef.current = requestAnimationFrame(() => {
                revealFrameRef.current = null;
                revealSessionRow(sessionId, align);
            });
        });
    }, [dataWithSelected, revealSessionRow]);

    // Double-tapping the sessions tab reveals the next session that wants a look (see
    // sessionListJump), unfolding its project group first if needed; with none, back to the top.
    const [collapsedProjectGroups, setCollapsedProjectGroups] = useLocalSettingMutable('collapsedSessionProjectGroups');
    const lastJumpedSessionIdRef = React.useRef<string | null>(null);
    React.useEffect(() => subscribeToSessionListJump(() => {
        const state = storage.getState();
        const candidates: { id: string; priority: number }[] = [];
        for (const session of tabSessions) {
            const priority = getSessionJumpPriority(session, {
                unread: hasUnreadCompletion(session),
                delegating: Object.values(state.orchestratorActivity[session.id] ?? {}).some(taskIds => taskIds.length > 0),
                hasDraft: !!state.drafts[session.id],
            });
            if (priority !== null) candidates.push({ id: session.id, priority });
        }
        const nextId = pickNextJumpSession(candidates, lastJumpedSessionIdRef.current);
        lastJumpedSessionIdRef.current = nextId;
        if (!nextId) {
            scrollListToTop();
            return;
        }
        // Sessions in the grouped blocks sit in foldable project groups; plain rows do not.
        const inProjectGroup = (tabData ?? []).some(item =>
            (item.type === 'active-sessions' || item.type === 'shared-sessions') ? item.sessions.some(session => session.id === nextId)
                : item.type === 'machine-sessions' && item.section.sessions.some(session => session.id === nextId));
        // Its group folds by path and machine, or by path alone when it spans machines: unfold either.
        const metadata = tabSessions.find(session => session.id === nextId)?.metadata;
        const collapseKeys = [
            getSessionProjectCollapseKey(metadata?.path || ''),
            ...(metadata?.machineId ? [getSessionProjectCollapseKey(metadata.path || '', metadata.machineId)] : []),
        ].filter(key => collapsedProjectGroups[key]);
        if (inProjectGroup && collapseKeys.length > 0) {
            const next = { ...collapsedProjectGroups };
            for (const key of collapseKeys) delete next[key];
            setCollapsedProjectGroups(next);
        }
        scheduleRevealSelectedSession(nextId, 'center');
    }), [tabSessions, tabData, collapsedProjectGroups, setCollapsedProjectGroups, scheduleRevealSelectedSession, scrollListToTop]);

    // A manual switch on the rail or the phone switcher, to anywhere but where the pending session
    // lives, takes precedence over revealing it.
    const previousActiveTabRef = React.useRef(activeTab);
    React.useEffect(() => {
        if (previousActiveTabRef.current === activeTab) return;
        previousActiveTabRef.current = activeTab;
        if (pendingSessionNavigationId && activeTab !== pendingSessionTargetTab) setPendingSessionNavigationId(null);
    }, [activeTab, pendingSessionNavigationId, pendingSessionTargetTab]);

    // Process each route-driven session change once. Realtime list updates must not
    // repeatedly reveal the same session after the user has manually scrolled away.
    React.useEffect(() => {
        if (!pendingSessionNavigationId || !pendingSessionTargetTab) return;
        if (!activeTabContainsPendingSession) {
            if (activeTab !== pendingSessionTargetTab) setActiveTab(pendingSessionTargetTab);
            return;
        }
        scheduleRevealSelectedSession(pendingSessionNavigationId);
        setPendingSessionNavigationId(null);
    }, [pendingSessionNavigationId, pendingSessionTargetTab, activeTabContainsPendingSession, activeTab, setActiveTab, scheduleRevealSelectedSession]);

    React.useEffect(() => () => {
        if (revealFrameRef.current !== null) cancelAnimationFrame(revealFrameRef.current);
    }, []);

    // Request review
    React.useEffect(() => {
        if (data && data.length > 0) {
            requestReview();
        }
    }, [data && data.length > 0]);

    const keyExtractor = React.useCallback((item: ListItem, index: number) => {
        switch (item.type) {
            case 'header': return `header-${item.title}-${index}`;
            case 'active-sessions': return 'active-sessions';
            case 'shared-sessions': return 'shared-sessions';
            case 'project-group': return `project-group-${item.machine.id}-${item.displayPath}-${index}`;
            case 'session': return `session-${item.session.id}`;
            case 'machine-header': return `machine-header-${item.section.id}`;
            case 'machine-sessions': return `machine-sessions-${item.section.id}`;
        }
    }, []);

    const renderItem = React.useCallback(({ item, index }: { item: ListItem, index: number }) => {
        const ActiveComponent = compactSessionView ? ActiveSessionsGroupCompact : ActiveSessionsGroup;
        const selectedId = isTablet && selectedSessionId ? selectedSessionId : undefined;
        switch (item.type) {
            case 'header':
                return (
                    <View style={styles.headerSection}>
                        <Text style={styles.headerText}>
                            {item.title}
                        </Text>
                    </View>
                );

            case 'active-sessions':
                return (
                    <ActiveComponent
                        sessions={item.sessions}
                        selectedSessionId={selectedId}
                        registerSessionRowRef={registerSessionRowRef}
                    />
                );

            case 'shared-sessions':
                return (
                    <ActiveComponent
                        sessions={item.sessions}
                        selectedSessionId={selectedId}
                        registerSessionRowRef={registerSessionRowRef}
                        shared
                    />
                );

            case 'machine-header':
                return <SessionSectionHeader section={item.section} />;

            case 'machine-sessions':
                return (
                    <ActiveComponent
                        sessions={item.section.sessions}
                        selectedSessionId={selectedId}
                        registerSessionRowRef={registerSessionRowRef}
                    />
                );

            case 'project-group':
                return (
                    <View style={styles.projectGroup}>
                        <Text style={styles.projectGroupTitle}>
                            {item.displayPath}
                        </Text>
                        <Text style={styles.projectGroupSubtitle}>
                            {item.machine.metadata?.displayName || item.machine.metadata?.host || item.machine.id}
                        </Text>
                    </View>
                );

            case 'session':
                // Determine card styling based on position within date group
                const prevItem = index > 0 && dataWithSelected ? dataWithSelected[index - 1] : null;
                const nextItem = index < (dataWithSelected?.length || 0) - 1 && dataWithSelected ? dataWithSelected[index + 1] : null;

                const isFirst = prevItem?.type === 'header';
                const isLast = nextItem?.type === 'header' || nextItem == null || nextItem?.type === 'active-sessions';
                const isSingle = isFirst && isLast;

                return (
                    <SessionItem
                        session={item.session}
                        selected={item.selected}
                        isFirst={isFirst}
                        isLast={isLast}
                        isSingle={isSingle}
                        registerSessionRowRef={registerSessionRowRef}
                    />
                );
        }
    }, [isTablet, selectedSessionId, dataWithSelected, compactSessionView, registerSessionRowRef]);

    const isDisconnected = socketStatus.status === 'disconnected' || socketStatus.status === 'error';
    const canStartAnywhere = !isDisconnected && machineGroups.some(group => group.online);
    const EmptyComponent = React.useCallback(() => {
        const machine = selectedGroup;
        const canStart = !isDisconnected && (machine ? machine.online : canStartAnywhere);
        const title = machine ? t('sessionScope.machineNoSessions') : t('components.emptySessions.noActiveSessions');
        const description = machine
            ? (machine.online ? t('sessionScope.machineNoSessionsHint', { name: machine.name }) : t('sessionScope.offlineText'))
            : canStart ? t('components.emptySessions.startOnConnectedMachines') : null;
        return (
            <View style={styles.emptyContainer}>
                <Ionicons name="chatbubbles-outline" size={48} color={theme.colors.textSecondary} style={{ marginBottom: 12, opacity: 0.5 }} />
                <Text style={styles.emptyText}>{title}</Text>
                {description && <Text style={styles.emptyDescription}>{description}</Text>}
                {canStart && !isSharingSelection(activeTab) && (
                    <Pressable
                        onPress={() => router.push(newSessionPath(machine?.id))}
                        style={({ pressed }) => [styles.emptyAction, pressed && { opacity: 0.85 }]}
                        accessibilityRole="button"
                    >
                        <Ionicons name="add" size={16} color={theme.colors.button.primary.tint} />
                        <Text style={styles.emptyActionText}>{t('sessionScope.newSession')}</Text>
                    </Pressable>
                )}
            </View>
        );
    }, [theme, selectedGroup, isDisconnected, canStartAnywhere, activeTab, router]);

    const isEmpty = dataWithSelected?.length === 0;
    // The empty state fills exactly the visible part of the viewport, so it centers itself and the
    // list cannot scroll, yet still bounces for pull-to-refresh. On iOS the visible part excludes the
    // header and tab bar insets the system adds around the content; elsewhere there are none.
    const emptyContentStyle = Platform.OS === 'ios' && viewportInsets && viewportInsets.height > 0
        ? { height: viewportInsets.height - viewportInsets.top - viewportInsets.bottom, paddingBottom: 0 }
        : { flexGrow: 1, paddingBottom: safeArea.bottom };

    // Early return if no data yet
    if (!data) {
        return (
            <View style={styles.container} />
        );
    }

    return (
        <View style={styles.container}>
            <View ref={listViewportRef} style={styles.contentContainer}>
                {Platform.OS === 'ios' && <ViewportInsetsProbe onChange={setViewportInsets} />}
                <SessionProjectLabelsContext.Provider value={projectLabel}>
                    <FlatList
                        // A different machine or sharing view starts from its top. Remounting rather than
                        // scrolling to offset 0: on iOS the top of the list sits at minus the header inset
                        // the system adds, so offset 0 would leave it scrolled under the header.
                        key={activeTab}
                        ref={listRef}
                        contentInsetAdjustmentBehavior={Platform.OS === 'ios' ? 'automatic' : undefined}
                        // iOS clamps programmatic scrolls to -contentInset.top, which leaves out the
                        // automatic inset: the top (-inset.top) would end up under the header. The
                        // offsets are bounded by clampScrollOffset instead.
                        scrollToOverflowEnabled
                        data={dataWithSelected}
                        renderItem={renderItem}
                        keyExtractor={keyExtractor}
                        stickyHeaderIndices={stickyHeaderIndices}
                        contentContainerStyle={[
                            { paddingBottom: safeArea.bottom + 128, maxWidth: layout.maxWidth },
                            isEmpty && emptyContentStyle,
                        ]}
                        ListEmptyComponent={EmptyComponent}
                        removeClippedSubviews={true}
                        onLayout={event => {
                            viewportHeightRef.current = event.nativeEvent.layout.height;
                        }}
                        onContentSizeChange={(_width, height) => {
                            contentHeightRef.current = height;
                        }}
                        onScroll={(event: NativeSyntheticEvent<NativeScrollEvent>) => {
                            scrollOffsetRef.current = event.nativeEvent.contentOffset.y;
                        }}
                        scrollEventThrottle={16}
                        onScrollToIndexFailed={({ index, averageItemLength }) => {
                            listRef.current?.scrollToOffset({
                                offset: Math.max(0, index * averageItemLength),
                                animated: false,
                            });
                        }}
                        refreshControl={
                            <RefreshControl
                                refreshing={refreshing}
                                onRefresh={handleRefresh}
                                tintColor={theme.colors.textSecondary}
                            />
                        }
                    />
                </SessionProjectLabelsContext.Provider>
            </View>
        </View>
    );
}

// Sub-component that handles session message logic
const SessionItem = React.memo(({ session, selected, isFirst, isLast, isSingle, registerSessionRowRef }: {
    session: Session;
    selected?: boolean;
    isFirst?: boolean;
    isLast?: boolean;
    isSingle?: boolean;
    registerSessionRowRef?: RegisterSessionRowRef;
}) => {
    const styles = stylesheet;
    const sessionStatus = useSessionStatus(session);
    const hasDraft = useSessionHasDraft(session.id);
    const sessionName = getSessionName(session);
    const sessionSubtitle = useSessionProjectLabel(session);
    const compactSessionView = useCompactSessionView();
    const runningTaskCount = useOrchestratorRunningTaskCount(session.id);
    const navigateToSession = useNavigateToSession();
    const swipeableRef = React.useRef<Swipeable | null>(null);
    const swipeEnabled = Platform.OS !== 'web';
    const setRowRef = React.useCallback((ref: View | null) => {
        registerSessionRowRef?.(session.id, ref);
    }, [registerSessionRowRef, session.id]);

    const [deletingSession, performDelete] = useHappyAction(async () => {
        const result = await sessionDelete(session.id);
        if (!result.success) {
            throw new HappyError(result.message || t('sessionInfo.failedToDeleteSession'), false);
        }
    });

    const handleDelete = React.useCallback(() => {
        swipeableRef.current?.close();
        Modal.alert(
            t('sessionInfo.deleteSession'),
            t('sessionInfo.deleteSessionWarning'),
            [
                { text: t('common.cancel'), style: 'cancel' },
                {
                    text: t('sessionInfo.deleteSession'),
                    style: 'destructive',
                    onPress: performDelete
                }
            ]
        );
    }, [performDelete]);

    const avatarId = React.useMemo(() => {
        return getSessionAvatarId(session);
    }, [session]);

    // The row's corners where it ends a group. The container that clips it rounds at the same
    // radii, so the context-menu ring has to be rounded to match or it gets notched.
    const rowShape = isSingle ? styles.sessionItemSingle :
        isFirst ? styles.sessionItemFirst :
            isLast ? styles.sessionItemLast : {};

    const itemContent = (
        <SessionContextMenu session={session} highlightShape={rowShape}>
            <Pressable
                style={[
                compactSessionView ? styles.sessionItemCompact : styles.sessionItem,
                selected && styles.sessionItemSelected,
                rowShape
            ]}
            onPress={() => {
                navigateToSession(session.id);
            }}
        >
            {({ pressed }) => (<>
            {pressed && <PressHighlight style={rowShape} />}
            {/* The session's colour marker, down the leading edge — out of flow, so an
                unmarked row costs nothing and nothing shifts. See SessionMarkerBar. */}
            <SessionMarkerBar sessionId={session.id} />
            {!compactSessionView && (
                <View style={styles.avatarContainer}>
                    <Avatar id={avatarId} size={48} monochrome={!sessionStatus.isConnected} flavor={session.metadata?.flavor} sessionIcon={session.metadata?.sessionIcon} />
                    {hasDraft && (
                        <View style={styles.draftIconContainer}>
                            <Ionicons
                                name="create-outline"
                                size={12}
                                style={styles.draftIconOverlay}
                            />
                        </View>
                    )}
                </View>
            )}
            <View style={[styles.sessionContent, compactSessionView && { marginLeft: 0 }]}>
                {/* Title line */}
                <View style={styles.sessionTitleRow}>
                    {sessionStatus.hasUnreadCompletion && (
                        <View style={styles.unreadDot} />
                    )}
                    <Text style={[
                        compactSessionView ? styles.sessionTitleCompact : styles.sessionTitle,
                        sessionStatus.isConnected ? styles.sessionTitleConnected : styles.sessionTitleDisconnected
                    ]} numberOfLines={1} ref={(el: any) => {
                        if (Platform.OS === 'web' && el) {
                            el.title = sessionName;
                        }
                    }}>
                        {sessionName}
                    </Text>
                </View>

                {!compactSessionView && (
                    <>
                        {/* Subtitle line */}
                        <ProjectLabelText label={sessionSubtitle} style={styles.sessionSubtitle} />

                        {/* Status line with dot */}
                        <View style={styles.statusRow}>
                            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                <View style={styles.statusDotContainer}>
                                    <StatusDot color={sessionStatus.statusDotColor} isPulsing={sessionStatus.isPulsing} />
                                </View>
                                <Text style={[
                                    styles.statusText,
                                    { color: sessionStatus.statusColor }
                                ]}>
                                    {sessionStatus.statusText}
                                </Text>
                            </View>

                            {(runningTaskCount > 0 || session.ownerProfile || session.isShared) && (
                                <View style={styles.statusIndicatorsRight}>
                                    {runningTaskCount > 0 && !compactSessionView && (
                                        <View style={styles.taskStatusContainer}>
                                            <Ionicons
                                                name="layers-outline"
                                                size={10}
                                                color={styles.taskStatusText.color}
                                                style={{ marginRight: 2 }}
                                            />
                                            <Text style={styles.taskStatusText}>
                                                {runningTaskCount > 99 ? '99+' : runningTaskCount}
                                            </Text>
                                        </View>
                                    )}

                                    {/* Shared status indicator */}
                                    {session.ownerProfile ? (
                                        <Avatar id={session.ownerProfile.id} size={18} imageUrl={session.ownerProfile.avatar ?? undefined} />
                                    ) : session.isShared ? (
                                        <View style={styles.taskStatusContainer}>
                                            <Ionicons
                                                name="share-social-outline"
                                                size={10}
                                                color={styles.taskStatusText.color}
                                            />
                                        </View>
                                    ) : null}
                                </View>
                            )}
                        </View>
                    </>
                )}
            </View>
            </>)}
            </Pressable>
        </SessionContextMenu>
    );

    const containerStyles = [
        styles.sessionItemContainer,
        isSingle ? styles.sessionItemContainerSingle :
            isFirst ? styles.sessionItemContainerFirst :
                isLast ? styles.sessionItemContainerLast : {}
    ];

    const showDivider = !isLast && !isSingle;
    const dividerStyle = compactSessionView
        ? [styles.sessionDivider, { marginLeft: 16 }]
        : styles.sessionDivider;

    if (!swipeEnabled) {
        return (
            <View ref={setRowRef} style={containerStyles}>
                {itemContent}
                {showDivider && <View style={dividerStyle} />}
            </View>
        );
    }

    const renderRightActions = () => (
        <Pressable
            style={styles.swipeAction}
            onPress={handleDelete}
            disabled={deletingSession}
        >
            <Ionicons name="trash-outline" size={20} color="#FFFFFF" />
            <Text style={styles.swipeActionText} numberOfLines={2}>
                {t('sessionInfo.deleteSession')}
            </Text>
        </Pressable>
    );

    return (
        <View ref={setRowRef} style={containerStyles}>
            <Swipeable
                ref={swipeableRef}
                renderRightActions={renderRightActions}
                overshootRight={false}
                enabled={!deletingSession}
            >
                {itemContent}
            </Swipeable>
            {showDivider && <View style={dividerStyle} />}
        </View>
    );
});
