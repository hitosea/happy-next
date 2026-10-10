import React from 'react';
import { View, Pressable, Platform, ActivityIndicator, Animated } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { Text } from '@/components/StyledText';
import { router, useRouter } from 'expo-router';
import { Session } from '@/sync/storageTypes';
import { Ionicons } from '@expo/vector-icons';
import { getSessionName, useSessionStatus, getSessionAvatarId } from '@/utils/sessionUtils';
import { Avatar } from './Avatar';
import { Typography } from '@/constants/Typography';
import { StatusDot } from './StatusDot';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { sessionArchive } from '@/sync/ops';
import { storage, useOrchestratorRunningTaskCount, useSessionHasDraft } from '@/sync/storage';
import { Modal } from '@/modal';
import { t } from '@/text';
import { useNavigateToSession } from '@/hooks/useNavigateToSession';
import { useDismissToHomeIfViewing } from '@/hooks/useDismissToHome';
import { ProjectGitStatus } from './ProjectGitStatus';
import { useHappyAction } from '@/hooks/useHappyAction';
import { HappyError } from '@/utils/errors';
import { getWorktreeInfo, cleanupWorktree } from '@/utils/worktreeOps';
import { ActionMenuModal } from '@/components/ActionMenuModal';
import { ActionMenuItem } from '@/components/ActionMenu';
import { sync } from '@/sync/sync';
import { SessionContextMenu } from './SessionContextMenu';
import { SessionForkSpinner } from './SessionForkSpinner';
import { useSessionForking } from '@/utils/sessionForkProgress';
import { canArchiveSession } from '@/utils/sessionLifecycle';
import { SessionRowFlash } from './SessionRowFlash';
import { getProjectHeaderFlashId, registerProjectHeader } from './sessionProjectLocate';
import { ProjectLabelText } from './ProjectLabelText';
import { SessionMarkerBar } from './SessionColorMarker';
import { SessionProjectGroup, useCollapsedSessionProjectGroups, useSessionProjectGroups } from '@/hooks/useSessionProjectGroups';

// Rounds the project card, and with it the first and last row inside it.
const CARD_RADIUS = Platform.select({ ios: 10, default: 16 });

const stylesheet = StyleSheet.create((theme, runtime) => ({
    container: {
        backgroundColor: theme.colors.groupped.background,
        paddingTop: 8,
    },
    projectCard: {
        backgroundColor: theme.colors.surface,
        marginVertical: 10,
        marginHorizontal: Platform.select({ ios: 16, default: 12 }),
        borderRadius: CARD_RADIUS,
        overflow: 'hidden',
        shadowColor: theme.colors.shadow.color,
        shadowOffset: { width: 0, height: 0.33 },
        shadowOpacity: theme.colors.shadow.opacity,
        shadowRadius: 0,
        elevation: 1,
    },
    // The card clips its own rounded corners, so its first and last rows carry the same radius: the
    // context-menu ring is drawn on the row, and a square ring there loses its corners to the clip.
    // Middle rows are square-edged and need nothing.
    cardRowFirst: {
        borderTopLeftRadius: CARD_RADIUS,
        borderTopRightRadius: CARD_RADIUS,
    },
    cardRowLast: {
        borderBottomLeftRadius: CARD_RADIUS,
        borderBottomRightRadius: CARD_RADIUS,
    },
    cardRowSingle: {
        borderRadius: CARD_RADIUS,
    },
    sectionHeader: {
        paddingTop: 12,
        paddingBottom: Platform.select({ ios: 6, default: 8 }),
        paddingHorizontal: Platform.select({ ios: 32, default: 24 }),
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    // Inset to the card's width below, so a located header lights up as a band of its own.
    sectionHeaderFlash: {
        top: 6,
        bottom: 2,
        left: Platform.select({ ios: 16, default: 12 }),
        right: Platform.select({ ios: 16, default: 12 }),
        borderRadius: 8,
    },
    sectionHeaderRight: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: 8,
        maxWidth: '52%',
    },
    sectionHeaderChevron: {
        width: 16,
        height: 16,
        marginRight: 4,
        alignItems: 'center',
        justifyContent: 'center',
    },
    sectionHeaderLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
        marginRight: 8,
    },
    sectionHeaderAvatar: {
        marginRight: 8,
    },
    // As wide as the avatar it stands in for.
    sectionHeaderSharedIcon: {
        width: 24,
        height: 24,
        alignItems: 'center',
        justifyContent: 'center',
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
        fontSize: Platform.select({ ios: 12, default: 13 }),
        lineHeight: Platform.select({ ios: 16, default: 18 }),
        letterSpacing: Platform.select({ ios: -0.08, default: 0.1 }),
        fontWeight: Platform.select({ ios: 'normal', default: '500' }),
        maxWidth: 140,
        textAlign: 'right',
    },
    newSessionHeaderButton: {
        width: 28,
        height: 28,
        alignItems: 'flex-end',
        justifyContent: 'center',
        borderRadius: 6,
    },
    sectionHeaderActionSlot: {
        position: 'relative',
        minWidth: 28,
        minHeight: 28,
        alignItems: 'flex-end',
        justifyContent: 'center',
    },
    sessionRow: {
        height: 48,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingInlineStart: 36,
        backgroundColor: theme.colors.surface,
    },
    sessionRowUnindented: {
        paddingInlineStart: 16,
    },
    sessionDivider: {
        height: StyleSheet.hairlineWidth,
        backgroundColor: theme.colors.divider,
        marginLeft: 16,
    },
    sessionRowSelected: {
        backgroundColor: theme.colors.surfaceSelected,
    },
    sessionContent: {
        flex: 1,
        justifyContent: 'center',
    },
    sessionTitleRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    sessionTitle: {
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
    newSessionButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'flex-start',
        height: 56,
        paddingHorizontal: 16,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: theme.colors.divider,
        backgroundColor: theme.colors.surface,
    },
    newSessionButtonDisabled: {
        opacity: 0.4,
    },
    newSessionButtonContent: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    newSessionButtonIcon: {
        marginRight: 8,
        width: 16,
        alignItems: 'center',
        justifyContent: 'center',
    },
    newSessionButtonText: {
        fontSize: 15,
        color: theme.colors.textSecondary,
        ...Typography.default('regular'),
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
    // Finished while you were away: the one right-hand mark that is not a session state.
    unreadDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: '#007AFF',
    },
    // Gap between the title and the right-hand status mark.
    statusMark: {
        marginLeft: 8,
    },
    // Delegated tasks still running under this session. Sits beside the status mark rather than
    // competing for its slot: it is a fact about the session, not one of its states.
    taskMark: {
        flexDirection: 'row',
        alignItems: 'center',
        marginLeft: 8,
    },
    taskMarkText: {
        fontSize: 11,
        marginLeft: 2,
        color: theme.colors.textSecondary,
        ...Typography.default('semiBold'),
    },
}));

interface ActiveSessionsGroupProps {
    sessions: Session[];
    selectedSessionId?: string;
    registerSessionRowRef?: (sessionId: string, ref: View | null) => void;
    // Sessions shared with me: their projects are marked as such rather than by a session's avatar.
    shared?: boolean;
    // The pinned sessions: one card, in the order given.
    pinned?: boolean;
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
    avatar,
    rightContent,
}: {
    projectGroup: SessionProjectGroup;
    collapsed: boolean;
    onToggle: () => void;
    onNewSession?: () => void;
    avatar: React.ReactNode;
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
    const collapseKey = projectGroup.collapseKey;
    const headerRef = React.useCallback((node: View | null) => registerProjectHeader(collapseKey, node), [collapseKey]);

    return (
        <View ref={headerRef} {...(hoverHandlers as any)}>
            <SessionRowFlash sessionId={getProjectHeaderFlashId(collapseKey)} style={styles.sectionHeaderFlash} />
            <Pressable
                style={styles.sectionHeader}
                onPress={onToggle}
                accessibilityRole="button"
                accessibilityState={{ expanded: !collapsed }}
                accessibilityLabel={`${collapsed ? t('duplicate.expandText') : t('duplicate.collapseText')} ${[projectGroup.label.name, projectGroup.label.detail].filter(Boolean).join(', ')}`}
            >
            <View style={styles.sectionHeaderLeft}>
                <Animated.View
                    style={[
                        styles.sectionHeaderChevron,
                        {
                            transform: [{
                                rotate: expansion.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '90deg'] }),
                            }],
                        },
                    ]}
                >
                    <Ionicons name="chevron-forward" size={14} color={styles.sectionHeaderPath.color} />
                </Animated.View>
                {avatar && <View style={styles.sectionHeaderAvatar}>{avatar}</View>}
                <ProjectLabelText
                    label={projectGroup.label}
                    fullPath={projectGroup.path}
                    style={styles.sectionHeaderPath}
                />
            </View>
                <View style={styles.sectionHeaderRight}>
                    <View style={styles.sectionHeaderActionSlot}>
                        <View style={hovered && onNewSession ? { opacity: 0 } : undefined}>
                            {rightContent}
                        </View>
                        {onNewSession && hovered && Platform.OS === 'web' && (
                            <Pressable
                                style={({ pressed }) => [
                                    styles.newSessionHeaderButton,
                                    { position: 'absolute', right: 0 },
                                    pressed && { backgroundColor: '#00000012' },
                                ]}
                                onPress={(event) => {
                                    event.stopPropagation?.();
                                    onNewSession();
                                }}
                                accessibilityRole="button"
                                accessibilityLabel={t('newSession.startNewSessionInFolder')}
                            >
                                <Ionicons name="add" size={20} color={styles.sectionHeaderPath.color} />
                            </Pressable>
                        )}
                    </View>
                </View>
            </Pressable>
        </View>
    );
}


export function ActiveSessionsGroupCompact({ sessions, selectedSessionId, registerSessionRowRef, shared, pinned }: ActiveSessionsGroupProps) {
    const styles = stylesheet;
    const router = useRouter();
    const projectGroups = useSessionProjectGroups(sessions);
    const { collapsedGroups, toggleGroup } = useCollapsedSessionProjectGroups(projectGroups, selectedSessionId);

    if (pinned) {
        return (
            <View style={styles.container}>
                <PinnedSessionsHeader />
                <View style={styles.projectCard}>
                    {sessions.map((session, index) => (
                        <CompactSessionRow
                            key={session.id}
                            session={session}
                            selected={selectedSessionId === session.id}
                            registerSessionRowRef={registerSessionRowRef}
                            isCardFirst={index === 0}
                            isCardLast={index === sessions.length - 1}
                            unindented
                        />
                    ))}
                </View>
            </View>
        );
    }

    return (
        <View style={styles.container}>
            {projectGroups.map((projectGroup) => {
                const projectPath = projectGroup.path;
                const collapseKey = projectGroup.collapseKey;
                const machineEntries = Array.from(projectGroup.machines.entries());
                // The card is one rounded box spanning every machine in the project, so the rows
                // the card rounds are its first and last overall — see `cardRowFirst`.
                const cardMachines = [...machineEntries]
                    .sort(([, machineA], [, machineB]) => machineA.machineName.localeCompare(machineB.machineName));
                const firstSession = machineEntries[0]?.[1]?.sessions[0];
                const avatarId = firstSession ? getSessionAvatarId(firstSession) : undefined;
                const singleMachineEntry = machineEntries.length === 1 ? machineEntries[0] : null;
                const singleMachineId = singleMachineEntry?.[0];
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
                    <View key={projectPath}>
                        {/* Section header on grouped background */}
                        <ProjectSectionHeader
                            projectGroup={projectGroup}
                            collapsed={!!collapsedGroups[collapseKey]}
                            onToggle={() => toggleGroup(collapseKey)}
                            onNewSession={handleNewSession}
                            avatar={shared ? (
                                <View style={styles.sectionHeaderSharedIcon}>
                                    <Ionicons name="people-outline" size={18} color={styles.sectionHeaderPath.color} />
                                </View>
                            ) : avatarId && firstSession ? (
                                // No flavor badge here: the header marks a directory, and the vendor of
                                // whichever session happens to sort first is not the directory's identity.
                                <Avatar id={avatarId} size={24} hideFlavorBadge sessionIcon={firstSession.metadata?.sessionIcon} />
                            ) : null}
                            rightContent={(
                                <>
                                    {singleMachineId && firstSession?.metadata?.path ? (
                                        <ProjectGitStatus
                                            machineId={singleMachineId}
                                            path={firstSession.metadata.path}
                                            sessionId={firstSession.id}
                                        />
                                    ) : null}
                                    {!singleMachineEntry && (
                                        <Text style={styles.sectionHeaderMachine} numberOfLines={1}>
                                            {t('sessionScope.machineCount', { count: projectGroup.machines.size })}
                                        </Text>
                                    )}
                                </>
                            )}
                        />

                        {/* Card with just the sessions */}
                        {!collapsedGroups[collapseKey] && <View style={styles.projectCard}>
                            {/* Sessions grouped by machine within the card */}
                            {cardMachines.map(([machineId, machineGroup], machineIndex) => (
                                <View key={`${projectPath}-${machineId}`}>
                                    {machineGroup.sessions.map((session, index) => (
                                        <CompactSessionRow
                                            key={session.id}
                                            session={session}
                                            selected={selectedSessionId === session.id}
                                            registerSessionRowRef={registerSessionRowRef}
                                            isCardFirst={machineIndex === 0 && index === 0}
                                            isCardLast={machineIndex === cardMachines.length - 1
                                                && index === machineGroup.sessions.length - 1}
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
const CompactSessionRow = React.memo(({ session, selected, showBorder, isCardFirst, isCardLast, registerSessionRowRef, unindented }: {
    session: Session;
    selected?: boolean;
    // Not under a project header (the pinned card), so not indented under one.
    unindented?: boolean;
    showBorder?: boolean;
    isCardFirst?: boolean;
    isCardLast?: boolean;
    registerSessionRowRef?: (sessionId: string, ref: View | null) => void;
}) => {
    const styles = stylesheet;
    // Both, when the card holds this row alone.
    const cardRowShape = isCardFirst && isCardLast ? styles.cardRowSingle :
        isCardFirst ? styles.cardRowFirst :
            isCardLast ? styles.cardRowLast : undefined;
    const sessionStatus = useSessionStatus(session);
    const { theme } = useUnistyles();
    const hasDraft = useSessionHasDraft(session.id);
    const forking = useSessionForking(session.id);
    const runningTaskCount = useOrchestratorRunningTaskCount(session.id);
    const sessionName = getSessionName(session);
    const navigateToSession = useNavigateToSession();
    const dismissIfViewing = useDismissToHomeIfViewing(session.id);
    const swipeableRef = React.useRef<Swipeable | null>(null);
    // The pinned card can hold offline, archived or shared sessions, which the menu does not archive either.
    const swipeEnabled = Platform.OS !== 'web' && canArchiveSession(session, sessionStatus.isConnected);
    const setRowRef = React.useCallback((ref: View | null) => {
        registerSessionRowRef?.(session.id, ref);
    }, [registerSessionRowRef, session.id]);

    const [archivingSession, performArchive] = useHappyAction(async () => {
        // Home first: the flip to inactive empties the composer on the session's own screen, so
        // archiving it would reflow that screen for the whole archive round trip before it pops.
        dismissIfViewing();
        const previousActive = storage.getState().sessions[session.id]?.active ?? session.active;
        storage.getState().updateSessionActivity(session.id, false);

        const result = await sessionArchive(session.id);
        const errorMessage = result.message || t('sessionInfo.failedToArchiveSession');

        // Archiving is idempotent: if RPC target is gone, session is effectively already archived.
        if (!result.success && /RPC method not available/i.test(errorMessage)) {
            await sync.clearSessionMessageCache(session.id);
            return;
        }

        if (!result.success) {
            storage.getState().updateSessionActivity(session.id, previousActive);
            throw new HappyError(errorMessage, false);
        }

        await sync.clearSessionMessageCache(session.id);
        if (result.nativeArchiveError) throw new HappyError(t('sessionInfo.codexArchiveFailed') + ': ' + result.nativeArchiveError, false);
    });

    const [archiveMenuVisible, setArchiveMenuVisible] = React.useState(false);
    const [archiveMenuItems, setArchiveMenuItems] = React.useState<ActionMenuItem[]>([]);

    const handleArchive = React.useCallback(() => {
        swipeableRef.current?.close();
        const worktreeInfo = getWorktreeInfo(session.metadata);
        if (worktreeInfo && session.metadata?.machineId) {
            const machineId = session.metadata.machineId;
            const { basePath, branchName } = worktreeInfo;
            setArchiveMenuItems([
                {
                    label: t('sessionInfo.worktree.archiveKeepWorktree'),
                    onPress: () => { setArchiveMenuVisible(false); performArchive(); },
                },
                {
                    label: t('sessionInfo.worktree.archiveCleanupKeepBranch'),
                    onPress: async () => {
                        setArchiveMenuVisible(false);
                        try { await cleanupWorktree(machineId, basePath, branchName, false); } catch (e) { console.warn('Worktree cleanup failed:', e); }
                        await performArchive();
                    },
                },
                {
                    label: t('sessionInfo.worktree.archiveCleanupDeleteBranch'),
                    destructive: true,
                    onPress: async () => {
                        setArchiveMenuVisible(false);
                        try { await cleanupWorktree(machineId, basePath, branchName, true); } catch (e) { console.warn('Worktree cleanup failed:', e); }
                        await performArchive();
                    },
                },
            ]);
            setArchiveMenuVisible(true);
        } else {
            Modal.alert(
                t('sessionInfo.archiveSession'),
                t('sessionInfo.archiveSessionConfirm'),
                [
                    { text: t('common.cancel'), style: 'cancel' },
                    {
                        text: t('sessionInfo.archiveSession'),
                        style: 'destructive',
                        onPress: performArchive
                    }
                ]
            );
        }
    }, [performArchive, session.metadata]);

    const itemContent = (
        <SessionContextMenu session={session} highlightShape={cardRowShape}>
            <Pressable
                // Selected, hovered (web, mouse) and pressed rows share one background.
                style={({ hovered, pressed }: any) => [
                styles.sessionRow,
                unindented && styles.sessionRowUnindented,
                (selected || hovered || pressed) && styles.sessionRowSelected
            ]}
            onPress={() => {
                navigateToSession(session.id);
            }}
        >
            <SessionRowFlash sessionId={session.id} style={cardRowShape} />
            {/* The session's colour marker, down the leading edge — out of flow, so an
                unmarked row costs nothing and nothing shifts. See SessionMarkerBar. */}
            <SessionMarkerBar sessionId={session.id} />
            <View style={styles.sessionContent}>
                {/* Title line with status */}
                <View style={styles.sessionTitleRow}>
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
                    {/* Delegated tasks running under this session, before the status mark. */}
                    {runningTaskCount > 0 && (
                        <View style={styles.taskMark}>
                            <Ionicons name="layers-outline" size={12} color={theme.colors.textSecondary} />
                            <Text style={styles.taskMarkText}>
                                {runningTaskCount > 99 ? '99+' : runningTaskCount}
                            </Text>
                        </View>
                    )}
                    {/* The status mark a compact row draws, at the far end so it can never move the
                        title. Restricted to the things worth interrupting for — see below. */}
                    {(() => {
                        // Finished while you were away. The one signal here that is not a session
                        // state, so it outranks them: a still blue dot.
                        if (sessionStatus.hasUnreadCompletion) {
                            return <View style={[styles.unreadDot, styles.statusMark]} />;
                        }
                        // permission_required / syncing (orange) and thinking / awaiting (blue):
                        // "you are needed" and "work is happening". Idle (waiting) and offline
                        // (disconnected) draw nothing of their own — an offline row's title is
                        // already greyed, and the old grey dot only restated it.
                        if (sessionStatus.state === 'permission_required' || sessionStatus.state === 'thinking'
                            || sessionStatus.state === 'syncing' || sessionStatus.state === 'awaiting') {
                            return (
                                <StatusDot
                                    color={sessionStatus.statusDotColor}
                                    isPulsing={sessionStatus.isPulsing}
                                    style={styles.statusMark}
                                />
                            );
                        }
                        // An unsent message of yours. Not a state, and the quietest of the
                        // three, so it takes the slot only from a row that has nothing else to
                        // say: a working session keeps its colour, an unread completion its dot.
                        if (hasDraft) {
                            return (
                                <Ionicons
                                    name="create-outline"
                                    size={14}
                                    color={theme.colors.textSecondary}
                                    style={[styles.statusMark, { marginLeft: 8, marginRight: -4 }]}
                                />
                            );
                        }
                        return null;
                    })()}
                    {/* Being copied or resumed: after whatever mark the row has, so after the
                        draft icon, and shown whatever state the session is in. */}
                    {forking && <SessionForkSpinner size={14} style={styles.statusMark} />}
                </View>
            </View>
            </Pressable>
        </SessionContextMenu>
    );

    const archiveModal = (
        <ActionMenuModal
            visible={archiveMenuVisible}
            title={t('sessionInfo.worktree.archiveWorktreeConfirm')}
            items={archiveMenuItems}
            onClose={() => setArchiveMenuVisible(false)}
        />
    );

    if (!swipeEnabled) {
        return (
            <View ref={setRowRef}>
                {itemContent}
                {showBorder && <View style={styles.sessionDivider} />}
                {archiveModal}
            </View>
        );
    }

    const renderRightActions = () => (
        <Pressable
            style={styles.swipeAction}
            onPress={handleArchive}
            disabled={archivingSession}
        >
            <Ionicons name="archive-outline" size={20} color="#FFFFFF" />
            <Text style={styles.swipeActionText} numberOfLines={2}>
                {t('sessionInfo.archiveSession')}
            </Text>
        </Pressable>
    );

    return (
        <View ref={setRowRef}>
            <Swipeable
                ref={swipeableRef}
                renderRightActions={renderRightActions}
                overshootRight={false}
                enabled={!archivingSession}
            >
                {itemContent}
            </Swipeable>
            {showBorder && <View style={styles.sessionDivider} />}
            {archiveModal}
        </View>
    );
});
