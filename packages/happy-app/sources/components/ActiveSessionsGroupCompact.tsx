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
import { useSetting, useSessionHasDraft } from '@/sync/storage';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { isMachineOnline } from '@/utils/machineUtils';
import { machineSpawnNewSession, sessionArchive } from '@/sync/ops';
import { resolveAbsolutePath } from '@/utils/pathUtils';
import { storage } from '@/sync/storage';
import { Modal } from '@/modal';
import { t } from '@/text';
import { useNavigateToSession } from '@/hooks/useNavigateToSession';
import { ProjectGitStatus } from './ProjectGitStatus';
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
    sectionHeaderPath: {
        ...Typography.default('regular'),
        color: theme.colors.groupped.sectionTitle,
        fontSize: Platform.select({ ios: 13, default: 14 }),
        lineHeight: Platform.select({ ios: 18, default: 20 }),
        letterSpacing: Platform.select({ ios: -0.08, default: 0.1 }),
        fontWeight: Platform.select({ ios: 'normal', default: '500' }),
        flex: 1,
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
        height: 56,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        backgroundColor: theme.colors.surface,
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
    statusDotContainer: {
        alignItems: 'center',
        justifyContent: 'center',
        width: 16,
        height: 16,
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
    unreadDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: '#007AFF',
        marginLeft: 4,
        marginRight: 8,
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
                {avatar && <View style={styles.sectionHeaderAvatar}>{avatar}</View>}
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


export function ActiveSessionsGroupCompact({ sessions, selectedSessionId, registerSessionRowRef }: ActiveSessionsGroupProps) {
    const styles = stylesheet;
    const router = useRouter();
    const projectGroups = useSessionProjectGroups(sessions);
    const { collapsedGroups, toggleGroup } = useCollapsedSessionProjectGroups(projectGroups, selectedSessionId);

    return (
        <View style={styles.container}>
            {projectGroups.map((projectGroup) => {
                const projectPath = projectGroup.path;
                const collapseKey = projectGroup.collapseKey;
                const machineEntries = Array.from(projectGroup.machines.entries());
                const firstSession = machineEntries[0]?.[1]?.sessions[0];
                const avatarId = firstSession ? getSessionAvatarId(firstSession) : undefined;
                const singleMachineEntry = machineEntries.length === 1 ? machineEntries[0] : null;
                const singleMachineId = singleMachineEntry?.[0];
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
                            avatar={avatarId && firstSession ? (
                                <Avatar id={avatarId} size={24} flavor={firstSession.metadata?.flavor} sessionIcon={firstSession.metadata?.sessionIcon} />
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
                                            {`${projectGroup.machines.size} machines`}
                                        </Text>
                                    )}
                                </>
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
    const { theme } = useUnistyles();
    const sessionStatus = useSessionStatus(session);
    const hasDraft = useSessionHasDraft(session.id);
    const sessionName = getSessionName(session);
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
            <View style={styles.sessionContent}>
                {/* Title line with status */}
                <View style={styles.sessionTitleRow}>
                    {/* Status dot or draft icon on the left */}
                    {(() => {
                        // Show draft icon when online with draft
                        if (sessionStatus.state === 'waiting' && hasDraft) {
                            return (
                                <Ionicons
                                    name="create-outline"
                                    size={14}
                                    color={theme.colors.textSecondary}
                                    style={{ marginRight: 8 }}
                                />
                            );
                        }
                        
                        // Show status dot only for permission_required/thinking states
                        if (sessionStatus.state === 'permission_required' || sessionStatus.state === 'thinking') {
                            return (
                                <View style={[styles.statusDotContainer, { marginRight: 8 }]}>
                                    <StatusDot 
                                        color={sessionStatus.statusDotColor} 
                                        isPulsing={sessionStatus.isPulsing} 
                                    />
                                </View>
                            );
                        }
                        
                        // Show blue unread dot for completed tasks
                        if (sessionStatus.hasUnreadCompletion) {
                            return (
                                <View style={[styles.unreadDot, { marginRight: 8 }]} />
                            );
                        }
                        
                        // Show grey dot for online without draft
                        if (sessionStatus.state === 'waiting') {
                            return (
                                <View style={[styles.statusDotContainer, { marginRight: 8 }]}>
                                    <StatusDot 
                                        color={theme.colors.textSecondary} 
                                        isPulsing={false} 
                                    />
                                </View>
                            );
                        }
                        
                        return null;
                    })()}
                    
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
