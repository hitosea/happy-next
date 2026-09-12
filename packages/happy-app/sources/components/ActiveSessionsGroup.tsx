import React from 'react';
import { View, Pressable, Platform, ActivityIndicator, Animated } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { Text } from '@/components/StyledText';
import { useRouter } from 'expo-router';
import { Session } from '@/sync/storageTypes';
import { Ionicons } from '@expo/vector-icons';
import { getSessionName, useSessionStatus, getSessionAvatarId } from '@/utils/sessionUtils';
import { Avatar } from './Avatar';
import { Typography } from '@/constants/Typography';
import { StatusDot } from './StatusDot';
import { useOrchestratorRunningTaskCount, useSetting, useSessionHasDraft } from '@/sync/storage';
import { StyleSheet } from 'react-native-unistyles';
import { isMachineOnline } from '@/utils/machineUtils';
import { machineSpawnNewSession, sessionArchive } from '@/sync/ops';
import { storage } from '@/sync/storage';
import { Modal } from '@/modal';
import { ProjectGitStatus } from './ProjectGitStatus';
import { t } from '@/text';
import { useNavigateToSession } from '@/hooks/useNavigateToSession';
import { useHappyAction } from '@/hooks/useHappyAction';
import { HappyError } from '@/utils/errors';
import { getWorktreeInfo, cleanupWorktree } from '@/utils/worktreeOps';
import { ActionMenuModal } from '@/components/ActionMenuModal';
import { ActionMenuItem } from '@/components/ActionMenu';
import { sync } from '@/sync/sync';
import { SessionContextMenu } from './SessionContextMenu';
import { SessionColorMarkerForSession } from './SessionColorMarker';
import { SessionProjectGroup, useCollapsedSessionProjectGroups, useSessionProjectGroups } from '@/hooks/useSessionProjectGroups';

const stylesheet = StyleSheet.create((theme, runtime) => ({
    container: {
        backgroundColor: theme.colors.groupped.background,
        paddingTop: 8,
    },
    projectCard: {
        backgroundColor: theme.colors.surface,
        marginBottom: 8,
        marginHorizontal: Platform.select({ ios: 16, default: 12 }),
        borderRadius: Platform.select({ ios: 10, default: 16 }),
        overflow: 'hidden',
        shadowColor: theme.colors.shadow.color,
        shadowOffset: { width: 0, height: 0.33 },
        shadowOpacity: theme.colors.shadow.opacity,
        shadowRadius: 0,
        elevation: 1,
    },
    sectionHeader: {
        paddingTop: 12,
        paddingBottom: Platform.select({ ios: 6, default: 8 }),
        paddingHorizontal: Platform.select({ ios: 32, default: 24 }),
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
    sectionHeaderChevron: {
        width: 16,
        height: 16,
        marginRight: 5,
        alignItems: 'center',
        justifyContent: 'center',
    },
    sectionHeaderLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
        marginRight: 8,
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
        height: 88,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        backgroundColor: theme.colors.surface,
    },
    sessionDivider: {
        height: StyleSheet.hairlineWidth,
        backgroundColor: theme.colors.divider,
        marginLeft: 80, // 16px paddingHorizontal + 48px avatar + 16px gap
    },
    sessionRowSelected: {
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
        marginBottom: 4,
    },
    sessionTitle: {
        fontSize: 15,
        fontWeight: '500',
        flex: 1,
        ...Typography.default('semiBold'),
    },
    sessionTitleConnected: {
        color: theme.colors.text,
    },
    sessionTitleDisconnected: {
        color: theme.colors.textSecondary,
    },
    statusRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between'
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
        width: 48,
        height: 48,
    },
    newSessionButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 12,
        paddingHorizontal: 16,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: theme.colors.divider,
        backgroundColor: theme.colors.surface,
    },
    newSessionButtonDisabled: {
        opacity: 0.5,
    },
    newSessionButtonContent: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    newSessionButtonIcon: {
        marginRight: 6,
        width: 18,
        height: 18,
        alignItems: 'center',
        justifyContent: 'center',
    },
    newSessionButtonText: {
        fontSize: 14,
        fontWeight: '500',
        color: theme.colors.text,
        ...Typography.default('semiBold'),
    },
    newSessionButtonTextDisabled: {
        color: theme.colors.textSecondary,
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
}));

interface ActiveSessionsGroupProps {
    sessions: Session[];
    selectedSessionId?: string;
    registerSessionRowRef?: (sessionId: string, ref: View | null) => void;
}

function ProjectSectionHeader({
    projectGroup,
    collapsed,
    onToggle,
    onNewSession,
    rightContent,
}: {
    projectGroup: SessionProjectGroup;
    collapsed: boolean;
    onToggle: () => void;
    onNewSession?: () => void;
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

    return (
        <View {...(hoverHandlers as any)}>
            <Pressable
                style={styles.sectionHeader}
                onPress={onToggle}
                accessibilityRole="button"
                accessibilityState={{ expanded: !collapsed }}
                accessibilityLabel={`${collapsed ? t('duplicate.expandText') : t('duplicate.collapseText')} ${projectGroup.displayPath}`}
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
                <Text
                    style={styles.sectionHeaderPath}
                    numberOfLines={1}
                    ref={(el: any) => { if (el) el.title = projectGroup.displayPath; }}
                >
                    {projectGroup.displayPath}
                </Text>
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


export function ActiveSessionsGroup({ sessions, selectedSessionId, registerSessionRowRef }: ActiveSessionsGroupProps) {
    const styles = stylesheet;
    const router = useRouter();
    const projectGroups = useSessionProjectGroups(sessions);
    const { collapsedGroups, toggleGroup } = useCollapsedSessionProjectGroups(projectGroups, selectedSessionId);

    return (
        <View style={styles.container}>
            {projectGroups.map((projectGroup) => {
                const projectPath = projectGroup.path;
                const collapseKey = projectGroup.collapseKey;
                // Get the first machine name from this project's machines
                const machineEntries = Array.from(projectGroup.machines.entries());
                const firstMachine = machineEntries[0]?.[1];
                const machineName = projectGroup.machines.size === 1
                    ? firstMachine?.machineName
                    : `${projectGroup.machines.size} machines`;
                const singleMachineEntry = machineEntries.length === 1 ? machineEntries[0] : null;
                const singleMachineId = singleMachineEntry?.[0];
                const singleMachineSession = singleMachineEntry?.[1]?.sessions[0];
                const newSessionSource = projectGroup.sessions[0];
                const newSessionMetadata = newSessionSource?.metadata;
                const handleNewSession = newSessionMetadata?.path ? () => {
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

                        {/* Card with just the sessions */}
                        {!collapsedGroups[collapseKey] && <View style={styles.projectCard}>
                            {/* Sessions grouped by machine within the card */}
                            {Array.from(projectGroup.machines.entries())
                                .sort(([, machineA], [, machineB]) => machineA.machineName.localeCompare(machineB.machineName))
                                .map(([machineId, machineGroup]) => (
                                    <View key={`${projectPath}-${machineId}`}>
                                        {machineGroup.sessions.map((session, index) => (
                                            <CompactSessionRow
                                                key={session.id}
                                                session={session}
                                                selected={selectedSessionId === session.id}
                                                registerSessionRowRef={registerSessionRowRef}
                                                showBorder={index < machineGroup.sessions.length - 1 ||
                                                    Array.from(projectGroup.machines.keys()).indexOf(machineId) < projectGroup.machines.size - 1}
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
const CompactSessionRow = React.memo(({ session, selected, showBorder, registerSessionRowRef }: {
    session: Session;
    selected?: boolean;
    showBorder?: boolean;
    registerSessionRowRef?: (sessionId: string, ref: View | null) => void;
}) => {
    const styles = stylesheet;
    const sessionStatus = useSessionStatus(session);
    const hasDraft = useSessionHasDraft(session.id);
    const sessionName = getSessionName(session);
    const runningTaskCount = useOrchestratorRunningTaskCount(session.id);
    const navigateToSession = useNavigateToSession();
    const swipeableRef = React.useRef<Swipeable | null>(null);
    const swipeEnabled = Platform.OS !== 'web';
    const setRowRef = React.useCallback((ref: View | null) => {
        registerSessionRowRef?.(session.id, ref);
    }, [registerSessionRowRef, session.id]);

    const [archivingSession, performArchive] = useHappyAction(async () => {
        const previousActive = storage.getState().sessions[session.id]?.active ?? session.active;
        storage.getState().updateSessionActivity(session.id, false);

        const result = await sessionArchive(session.id);
        const errorMessage = result.message || t('sessionInfo.failedToArchiveSession');

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

    const avatarId = React.useMemo(() => {
        return getSessionAvatarId(session);
    }, [session]);

    const itemContent = (
        <SessionContextMenu session={session}>
            <Pressable
                style={[
                styles.sessionRow,
                selected && styles.sessionRowSelected
            ]}
            onPress={() => {
                navigateToSession(session.id);
            }}
        >
            <View style={styles.avatarContainer}>
                <Avatar id={avatarId} size={48} monochrome={!sessionStatus.isConnected} flavor={session.metadata?.flavor} sessionIcon={session.metadata?.sessionIcon} />
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
                    <SessionColorMarkerForSession sessionId={session.id} />
                </View>

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
