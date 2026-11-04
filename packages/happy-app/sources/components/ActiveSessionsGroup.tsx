import React from 'react';
import { View, Pressable, Platform, Animated } from 'react-native';
import { Text } from '@/components/StyledText';
import { useRouter } from 'expo-router';
import { Session } from '@/sync/storageTypes';
import { Ionicons } from '@expo/vector-icons';
import { getSessionName, useSessionStatus, getSessionAvatarId, formatLastSeen } from '@/utils/sessionUtils';
import { useMinuteTick } from '@/hooks/useMinuteTick';
import { Avatar } from './Avatar';
import { Typography } from '@/constants/Typography';
import { StatusDot } from './StatusDot';
import { useOrchestratorRunningTaskCount, useSetting, useSessionHasDraft, useSessionHasScheduled, useSessionMarkerColor } from '@/sync/storage';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { isMachineOnline } from '@/utils/machineUtils';
import { machineSpawnNewSession } from '@/sync/ops';
import { ProjectGitStatus } from './ProjectGitStatus';
import { t } from '@/text';
import { useNavigateToSession } from '@/hooks/useNavigateToSession';
import { SessionContextMenu } from './SessionContextMenu';
import { SessionForkSpinner } from './SessionForkSpinner';
import { useSessionForking } from '@/utils/sessionForkProgress';
import { sessionLastMessageAt } from '@/utils/sessionLastMessageAt';
import { SessionRowFlash } from './SessionRowFlash';
import { PressHighlight } from './PressHighlight';
import { getProjectHeaderFlashId, registerProjectHeader } from './sessionProjectLocate';
import { ProjectLabelText } from './ProjectLabelText';
import { SESSION_MARKER_COLOR_VALUES, SESSION_SELECTION_BAR_GRAY, sessionMarkerTint } from './SessionColorMarker';
import { SessionProjectGroup, useCollapsedSessionProjectGroups, useSessionProjectGroups } from '@/hooks/useSessionProjectGroups';

// The list sits flat on the background: no cards, just headers and rows. A row is inset from the
// list's edges and rounded, so its hover and selection read as a pill.
const ROW_INSET = 8;
const ROW_RADIUS = 6;
const LIST_INSET = 16;
const SESSION_ROW_HEIGHT = 72;
// Two-line rows stand further apart than the compact ones, so tinted rows don't run together.
const SESSION_ROW_GAP = 4;
const SESSION_AVATAR_SIZE = 44;
// The colour marker is a short pill, centred on the row: a tag, not a selection.
const MARKER_HEIGHT = 20;
const MARKER_INSET = (SESSION_ROW_HEIGHT - MARKER_HEIGHT) / 2;

const stylesheet = StyleSheet.create((theme) => ({
    // Projects stand 16 apart; the first one starts where its group does.
    projectSection: {
        marginBottom: 16,
    },
    pinnedSection: {
        marginBottom: 16,
    },
    // The pinned group's title, laid out like a project's header.
    sectionHeader: {
        height: 44,
        paddingHorizontal: LIST_INSET,
        marginBottom: 2,
        flexDirection: 'row',
        alignItems: 'center',
    },
    projectHeader: {
        height: 44,
        paddingHorizontal: LIST_INSET,
        marginBottom: 2,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    sectionHeaderRight: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: 8,
        maxWidth: '55%',
    },
    // Square and centred like the + beside it, so the turn pivots on the icon itself.
    sectionHeaderChevronRight: {
        width: 24,
        height: 24,
        alignItems: 'center',
        justifyContent: 'center',
    },
    sectionHeaderLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
        marginRight: 8,
    },
    sectionHeaderSharedIcon: {
        marginRight: 6,
    },
    // The project's name in the text colour; its path follows in the section-title grey.
    projectHeaderName: {
        ...Typography.default('medium'),
        color: theme.colors.sessionList.text,
        fontSize: 16,
        lineHeight: 22,
        flexShrink: 1,
    },
    projectHeaderDetail: {
        ...Typography.default(),
        color: theme.colors.sessionList.projectDetail,
        fontSize: 13,
        opacity: 1,
    },
    sectionHeaderPath: {
        ...Typography.default('regular'),
        color: theme.colors.groupped.sectionTitle,
        fontSize: Platform.select({ ios: 13, default: 14 }),
        lineHeight: Platform.select({ ios: 18, default: 20 }),
        letterSpacing: Platform.select({ ios: -0.08, default: 0.1 }),
        fontWeight: Platform.select({ ios: 'normal', default: '500' }),
        flexShrink: 1,
    },
    sectionHeaderMachine: {
        ...Typography.default('regular'),
        color: theme.colors.groupped.sectionTitle,
        fontSize: Platform.select({ ios: 13, default: 14 }),
        lineHeight: Platform.select({ ios: 18, default: 20 }),
        letterSpacing: Platform.select({ ios: -0.08, default: 0.1 }),
        fontWeight: Platform.select({ ios: 'normal', default: '500' }),
        maxWidth: 150,
        textAlign: 'right',
    },
    newSessionHeaderButton: {
        width: 24,
        height: 24,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 6,
    },
    sectionHeaderActionSlot: {
        position: 'relative',
        minWidth: 24,
        minHeight: 24,
        alignItems: 'flex-end',
        justifyContent: 'center',
    },
    // The + fades in over the git status, right-aligned in the slot.
    sectionHeaderNewSessionLayer: {
        position: 'absolute',
        right: 0,
        top: 0,
        bottom: 0,
        justifyContent: 'center',
    },
    // Opens from nothing so an expanded project's git status keeps the right edge. The negative
    // margin takes back the row's gap, which would otherwise stand where the hidden chevron is.
    sectionHeaderChevronReveal: {
        height: 24,
        marginLeft: -8,
        overflow: 'hidden',
        alignItems: 'flex-end',
    },
    // Puts the chevron's glyph, not its box, on the header's padding.
    sectionHeaderChevronEdge: {
        marginRight: -4,
    },
    // Full width, so the selection's bar can stand at the list's edge beside the inset row.
    sessionRowOuter: {
        position: 'relative',
    },
    sessionRowFrame: {
        marginHorizontal: ROW_INSET,
        marginBottom: SESSION_ROW_GAP,
    },
    rowShape: {
        borderRadius: ROW_RADIUS,
    },
    // The avatar starts where the project's name does.
    sessionRow: {
        height: SESSION_ROW_HEIGHT,
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: ROW_RADIUS,
        overflow: 'hidden',
        paddingHorizontal: LIST_INSET - ROW_INSET,
    },
    sessionRowHovered: {
        backgroundColor: theme.colors.sessionList.rowHover,
    },
    sessionRowSelected: {
        backgroundColor: theme.colors.surfaceSelected,
    },
    // The selected row's bar, at the list's own edge rather than the row's: in the row's colour, or
    // grey when it has none. The row's bottom margin is under the wrapper too.
    selectionBar: {
        position: 'absolute',
        left: 0,
        top: MARKER_INSET,
        bottom: MARKER_INSET + SESSION_ROW_GAP,
        width: 3,
        borderRadius: 1.5,
    },
    sessionContent: {
        flex: 1,
        marginLeft: 12,
        justifyContent: 'center',
    },
    sessionTitleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 4,
    },
    sessionTitle: {
        fontSize: 16,
        flex: 1,
        ...Typography.default('medium'),
    },
    sessionTitleConnected: {
        color: theme.colors.sessionList.text,
    },
    sessionTitleDisconnected: {
        color: theme.colors.textSecondary,
    },
    statusRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between'
    },
    // As tall as the dot and status text it stands in for.
    lastActivity: {
        height: 18,
        justifyContent: 'center',
    },
    lastActivityText: {
        fontSize: 13,
        lineHeight: 16,
        color: theme.colors.textSecondary,
        ...Typography.default(),
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
    statusIndicatorsRight: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        transform: [{ translateY: 1 }],
    },
    avatarContainer: {
        position: 'relative',
        width: SESSION_AVATAR_SIZE,
        height: SESSION_AVATAR_SIZE,
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
    unreadDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: '#007AFF',
        marginRight: 6,
    },
}));

interface ActiveSessionsGroupProps {
    sessions: Session[];
    selectedSessionId?: string;
    registerSessionRowRef?: (sessionId: string, ref: View | null) => void;
    // Sessions shared with me: their projects are marked as such rather than by a session's avatar.
    shared?: boolean;
    // The pinned sessions: one group, in the order given.
    pinned?: boolean;
    // The phone's "All machines" view: a project on each machine is a group of its own, naming it.
    byMachine?: boolean;
    // Sessions cut off by their machine: their projects fold apart from the same live ones.
    disconnected?: boolean;
}

function PinnedSessionsHeader() {
    const styles = stylesheet;
    return (
        <View style={styles.sectionHeader}>
            <View style={styles.sectionHeaderLeft}>
                <Text style={styles.sectionHeaderPath} numberOfLines={1}>{t('sessionScope.pinnedSessions')}</Text>
            </View>
        </View>
    );
}

function ProjectSectionHeader({
    projectGroup,
    collapsed,
    onToggle,
    onNewSession,
    shared,
    rightContent,
}: {
    projectGroup: SessionProjectGroup;
    collapsed: boolean;
    onToggle: () => void;
    onNewSession?: () => void;
    shared?: boolean;
    rightContent: React.ReactNode;
}) {
    const styles = stylesheet;
    const [hovered, setHovered] = React.useState(false);
    const hoverHandlers = Platform.OS === 'web' ? {
        onPointerEnter: () => setHovered(true),
        onPointerLeave: () => setHovered(false),
    } : {};
    const expansion = React.useRef(new Animated.Value(collapsed ? 0 : 1)).current;
    React.useEffect(() => {
        Animated.timing(expansion, {
            toValue: collapsed ? 0 : 1,
            duration: 140,
            useNativeDriver: true,
        }).start();
    }, [collapsed, expansion]);
    // The chevron sits on the right, after the git status. In the app it always shows. On the
    // desktop it shows under the pointer, opening out beside the + that fades in over the git
    // status, and while the project is collapsed, so it still reads as collapsed.
    const isWeb = Platform.OS === 'web';
    const hover = React.useRef(new Animated.Value(0)).current;
    const chevronReveal = React.useRef(new Animated.Value(collapsed ? 1 : 0)).current;
    React.useEffect(() => {
        if (!isWeb) return;
        // Width can't run on the native driver, so neither value does.
        Animated.parallel([
            Animated.timing(hover, { toValue: hovered ? 1 : 0, duration: 150, useNativeDriver: false }),
            Animated.timing(chevronReveal, { toValue: hovered || collapsed ? 1 : 0, duration: 150, useNativeDriver: false }),
        ]).start();
    }, [isWeb, hovered, collapsed, hover, chevronReveal]);
    const chevron = (
        <Animated.View
            style={[
                styles.sectionHeaderChevronRight,
                {
                    transform: [{
                        rotate: expansion.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '90deg'] }),
                    }],
                },
            ]}
        >
            <Ionicons name="chevron-forward" size={16} color={styles.sectionHeaderPath.color} />
        </Animated.View>
    );
    const collapseKey = projectGroup.collapseKey;
    const headerRef = React.useCallback((node: View | null) => registerProjectHeader(collapseKey, node), [collapseKey]);

    return (
        <View ref={headerRef} {...(hoverHandlers as any)}>
            <SessionRowFlash sessionId={getProjectHeaderFlashId(collapseKey)} />
            <Pressable
                style={styles.projectHeader}
                onPress={onToggle}
                accessibilityRole="button"
                accessibilityState={{ expanded: !collapsed }}
                accessibilityLabel={`${collapsed ? t('duplicate.expandText') : t('duplicate.collapseText')} ${[projectGroup.label.name, projectGroup.label.detail].filter(Boolean).join(', ')}`}
            >
            <View style={styles.sectionHeaderLeft}>
                {shared && (
                    <View style={styles.sectionHeaderSharedIcon}>
                        <Ionicons name="people-outline" size={16} color={styles.sectionHeaderPath.color} />
                    </View>
                )}
                <ProjectLabelText
                    label={projectGroup.label}
                    fullPath={projectGroup.path}
                    style={styles.projectHeaderName}
                    detailStyle={styles.projectHeaderDetail}
                />
            </View>
                <View style={styles.sectionHeaderRight}>
                    {isWeb ? (
                        <>
                            <View style={styles.sectionHeaderActionSlot}>
                                <Animated.View style={{ opacity: hover.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }}>
                                    {rightContent}
                                </Animated.View>
                                {onNewSession && (
                                    <Animated.View
                                        pointerEvents={hovered ? 'auto' : 'none'}
                                        style={[styles.sectionHeaderNewSessionLayer, { opacity: hover }]}
                                    >
                                        <Pressable
                                            style={({ pressed }) => [
                                                styles.newSessionHeaderButton,
                                                pressed && { backgroundColor: '#00000012' },
                                            ]}
                                            onPress={(event) => {
                                                event.stopPropagation?.();
                                                onNewSession();
                                            }}
                                            accessibilityRole="button"
                                            accessibilityLabel={t('newSession.startNewSessionInFolder')}
                                        >
                                            <Ionicons name="add" size={18} color={styles.sectionHeaderPath.color} />
                                        </Pressable>
                                    </Animated.View>
                                )}
                            </View>
                            <Animated.View
                                style={[
                                    styles.sectionHeaderChevronReveal,
                                    {
                                        width: chevronReveal.interpolate({ inputRange: [0, 1], outputRange: [0, 24] }),
                                        marginRight: chevronReveal.interpolate({ inputRange: [0, 1], outputRange: [0, styles.sectionHeaderChevronEdge.marginRight] }),
                                        opacity: chevronReveal,
                                    },
                                ]}
                            >
                                {chevron}
                            </Animated.View>
                        </>
                    ) : (
                        <>
                            <View style={styles.sectionHeaderActionSlot}>
                                {rightContent}
                            </View>
                            <View style={[styles.sectionHeaderChevronReveal, styles.sectionHeaderChevronEdge, { width: 24 }]}>
                                {chevron}
                            </View>
                        </>
                    )}
                </View>
            </Pressable>
        </View>
    );
}


export function ActiveSessionsGroup({ sessions, selectedSessionId, registerSessionRowRef, shared, pinned, byMachine, disconnected }: ActiveSessionsGroupProps) {
    const styles = stylesheet;
    const router = useRouter();
    const projectGroups = useSessionProjectGroups(sessions, { byMachine, disconnected });
    const { collapsedGroups, toggleGroup } = useCollapsedSessionProjectGroups(projectGroups, selectedSessionId);

    if (pinned) {
        return (
            <View style={styles.pinnedSection}>
                <PinnedSessionsHeader />
                {sessions.map((session) => (
                    <CompactSessionRow
                        key={session.id}
                        session={session}
                        selected={selectedSessionId === session.id}
                        registerSessionRowRef={registerSessionRowRef}
                    />
                ))}
            </View>
        );
    }

    return (
        <View>
            {projectGroups.map((projectGroup) => {
                const projectPath = projectGroup.path;
                const collapseKey = projectGroup.collapseKey;
                // Get the first machine name from this project's machines
                const machineEntries = Array.from(projectGroup.machines.entries());
                // Every machine in the project lists under the one header, in name order.
                const cardMachines = [...machineEntries]
                    .sort(([, machineA], [, machineB]) => machineA.machineName.localeCompare(machineB.machineName));
                const firstMachine = machineEntries[0]?.[1];
                const machineName = projectGroup.machines.size === 1
                    ? firstMachine?.machineName
                    : t('sessionScope.machineCount', { count: projectGroup.machines.size });
                const singleMachineEntry = machineEntries.length === 1 ? machineEntries[0] : null;
                const singleMachineId = singleMachineEntry?.[0];
                const singleMachineSession = singleMachineEntry?.[1]?.sessions[0];
                const newSessionSource = projectGroup.sessions[0];
                const newSessionMetadata = newSessionSource?.metadata;
                // The + opens /new pre-filled with this directory, which only works on a machine of
                // my own — a session shared with me points at the owner's machine and directory —
                // and only while that machine is online to start it.
                const newSessionMachineOnline = !!newSessionMetadata?.machineId
                    && !!projectGroup.machines.get(newSessionMetadata.machineId)?.machine;
                const handleNewSession = newSessionMetadata?.path && newSessionSource && !newSessionSource.accessLevel && newSessionMachineOnline ? () => {
                    const params = new URLSearchParams();
                    if (newSessionMetadata.machineId) params.set('machineId', newSessionMetadata.machineId);
                    params.set('path', newSessionMetadata.path);
                    router.push(`/new?${params.toString()}`);
                } : undefined;

                return (
                    <View key={collapseKey} style={styles.projectSection}>
                        <ProjectSectionHeader
                            projectGroup={projectGroup}
                            collapsed={!!collapsedGroups[collapseKey]}
                            onToggle={() => toggleGroup(collapseKey)}
                            onNewSession={handleNewSession}
                            shared={shared}
                            rightContent={singleMachineId && singleMachineSession?.metadata?.path ? (
                                <ProjectGitStatus
                                    machineId={singleMachineId}
                                    path={singleMachineSession.metadata.path}
                                    sessionId={singleMachineSession.id}
                                />
                            ) : (
                                <Text style={styles.sectionHeaderMachine} numberOfLines={1}>
                                    {machineName}
                                </Text>
                            )}
                        />

                        {/* Sessions grouped by machine under the header */}
                        {!collapsedGroups[collapseKey] && <View>
                            {cardMachines.map(([machineId, machineGroup]) => (
                                <View key={`${projectPath}-${machineId}`}>
                                    {machineGroup.sessions.map((session) => (
                                        <CompactSessionRow
                                            key={session.id}
                                            session={session}
                                            selected={selectedSessionId === session.id}
                                            registerSessionRowRef={registerSessionRowRef}
                                        />
                                    ))}
                                </View>
                            ))}
                        </View>}
                    </View>
                );
            })}
        </View>
    );
}

// Compact session row component with status line
// When a plain-online session last moved ("3 minutes ago"), aging on screen once a minute.
const SessionLastActivity = React.memo(({ at }: { at: number }) => {
    const styles = stylesheet;
    useMinuteTick();
    return (
        <View style={styles.lastActivity}>
            <Text style={styles.lastActivityText} numberOfLines={1}>{formatLastSeen(at)}</Text>
        </View>
    );
});

const CompactSessionRow = React.memo(({ session, selected, registerSessionRowRef }: {
    session: Session;
    selected?: boolean;
    registerSessionRowRef?: (sessionId: string, ref: View | null) => void;
}) => {
    const styles = stylesheet;
    const rowShape = styles.rowShape;
    const { theme } = useUnistyles();
    const sessionStatus = useSessionStatus(session);
    const hasDraft = useSessionHasDraft(session.id);
    const hasScheduled = useSessionHasScheduled(session.id);
    const forking = useSessionForking(session.id);
    const markerColor = useSessionMarkerColor(session.id);
    const sessionName = getSessionName(session);
    const runningTaskCount = useOrchestratorRunningTaskCount(session.id);
    const navigateToSession = useNavigateToSession();
    const setRowRef = React.useCallback((ref: View | null) => {
        registerSessionRowRef?.(session.id, ref);
    }, [registerSessionRowRef, session.id]);

    const avatarId = React.useMemo(() => {
        return getSessionAvatarId(session);
    }, [session]);
    const plainOnline = sessionStatus.state === 'waiting';

    const itemContent = (
        <View style={styles.sessionRowFrame}>
        <SessionContextMenu session={session} highlightShape={rowShape}>
            <Pressable
                // On web a row lights under the pointer, and the selected one stays lit. In the app a
                // press tints the row like an Item (inbox, settings) does: an overlay on iOS, a ripple
                // on Android.
                style={({ hovered, pressed }: any) => [
                styles.sessionRow,
                // A marked row is tinted with its colour, deeper under the pointer and while selected.
                markerColor
                    ? { backgroundColor: sessionMarkerTint(markerColor, selected ? 'selected' : Platform.OS === 'web' && (hovered || pressed) ? 'hover' : 'rest', theme.dark) }
                    : [
                        Platform.OS === 'web' && (hovered || pressed) && styles.sessionRowHovered,
                        selected && styles.sessionRowSelected,
                    ],
            ]}
            android_ripple={Platform.OS === 'android' ? { color: theme.colors.surfaceRipple, borderless: false, foreground: true } : undefined}
            onPress={() => {
                navigateToSession(session.id);
            }}
        >
            {({ pressed }) => (<>
            {pressed && Platform.OS === 'ios' && <PressHighlight style={rowShape} />}
            <SessionRowFlash sessionId={session.id} style={rowShape} />
            <View style={styles.avatarContainer}>
                <Avatar id={avatarId} size={SESSION_AVATAR_SIZE} monochrome={!sessionStatus.isConnected} flavor={session.metadata?.flavor} sessionIcon={session.metadata?.sessionIcon} />
            </View>
            <View style={styles.sessionContent}>
                {/* Title line */}
                <View style={styles.sessionTitleRow}>
                    {sessionStatus.hasUnreadCompletion && (
                        <View style={styles.unreadDot} />
                    )}
                    <Text
                        style={[
                            styles.sessionTitle,
                            sessionStatus.isConnected ? styles.sessionTitleConnected : styles.sessionTitleDisconnected
                        ]}
                        numberOfLines={1}
                        ref={(el: any) => {
                            if (Platform.OS === 'web' && el) {
                                el.title = sessionName;
                            }
                        }}
                    >
                        {sessionName}
                    </Text>
                </View>

                {/* Status line with dot. Plain online is every row's state, so it goes unsaid: the line
                    tells when the session last moved instead, in grey and at the same height, so the
                    title holds still as the state comes and goes. */}
                <View style={styles.statusRow}>
                    {plainOnline ? <SessionLastActivity at={sessionLastMessageAt(session)} /> : <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <View style={styles.statusDotContainer}>
                            <StatusDot color={sessionStatus.statusDotColor} isPulsing={sessionStatus.isPulsing} />
                        </View>
                        <Text style={[
                            styles.statusText,
                            { color: sessionStatus.statusColor }
                        ]}>
                            {sessionStatus.statusText}
                        </Text>
                    </View>}

                    {/* Status indicators on the right side */}
                    <View style={styles.statusIndicatorsRight}>
                        {/* Draft status indicator */}
                        {hasDraft && (
                            <View style={styles.taskStatusContainer}>
                                <Ionicons
                                    name="create-outline"
                                    size={10}
                                    color={styles.taskStatusText.color}
                                />
                            </View>
                        )}

                        {/* Has scheduled messages waiting to go out */}
                        {hasScheduled && (
                            <View style={styles.taskStatusContainer}>
                                <Ionicons
                                    name="time-outline"
                                    size={10}
                                    color={styles.taskStatusText.color}
                                />
                            </View>
                        )}

                        {/* Being copied or resumed: after the draft icon, in the same chip */}
                        {forking && (
                            <View style={styles.taskStatusContainer}>
                                <SessionForkSpinner size={10} />
                            </View>
                        )}

                        {/* No longer showing git status per item - it's in the header */}

                        {runningTaskCount > 0 && (
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
                </View>
            </View>
            </>)}
            </Pressable>
        </SessionContextMenu>
        </View>
    );
    const selectionBar = selected ? (
        <View
            pointerEvents="none"
            style={[styles.selectionBar, { backgroundColor: markerColor ? SESSION_MARKER_COLOR_VALUES[markerColor] : SESSION_SELECTION_BAR_GRAY }]}
        />
    ) : null;

    return (
        <View ref={setRowRef} style={styles.sessionRowOuter}>
            {itemContent}
            {selectionBar}
        </View>
    );
});
