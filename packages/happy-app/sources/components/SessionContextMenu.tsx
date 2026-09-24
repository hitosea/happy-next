import React from 'react';
import { Platform, Pressable, StyleProp, useWindowDimensions, View, ViewStyle } from 'react-native';
import * as Haptics from 'expo-haptics';
import { AntDesign, Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '@/components/StyledText';
import { Typography } from '@/constants/Typography';
import { Session } from '@/sync/storageTypes';
import { useSessionMarkerColor } from '@/sync/storage';
import { getSessionName, useSessionStatus, generateCopyTitle, copySessionMetadata, copySessionModeSettings, forkQoderSessionForCopy } from '@/utils/sessionUtils';
import { promptRenameSession } from '@/utils/sessionRename';
import { showToast } from './Toast';
import { useRouter } from 'expo-router';
import { t } from '@/text';
import { Modal } from '@/modal';
import { useHappyAction } from '@/hooks/useHappyAction';
import { HappyError } from '@/utils/errors';
import { storage } from '@/sync/storage';
import { sync } from '@/sync/sync';
import { hasForkableNativeId } from '@/utils/sessionLifecycle';
import { agentDisplayName } from 'happy-wire';
import { leaveSharedSession } from '@/sync/apiSharing';
import {
    machineForkClaudeSession,
    machineForkCodexSession,
    machineForkGeminiSession,
    machineSpawnNewSession,
    sessionDelete,
    sessionArchive,
} from '@/sync/ops';
import { cleanupWorkspace, cleanupWorktree } from '@/utils/worktreeOps';
import { getWorkspaceRepos } from '@/utils/workspaceRepos';
import { ActionMenuModal } from './ActionMenuModal';
import { ActionMenuItem } from './ActionMenu';
import { getSessionQuickActionKinds, getSessionQuickActionSections, SessionQuickActionKind } from './sessionQuickActions';
import { resolveTerminalDirectory, spawnTerminal } from '@/terminal/openTerminal';
import { isTauriDesktop } from '@/utils/tauri';
import { SessionContextMenuPortal } from './SessionContextMenuPortal';
import { SessionColorPalette } from './SessionColorMarker';
import type { SessionMarkerColor } from '@/sync/sessionAppearance';
import { hasLiveCompletion, hasUnreadCompletionSince } from '@/utils/sessionAttention';
import { useDismissToHome } from '@/hooks/useDismissToHome';
import { shouldDismissSessionMenuOnScroll, ScrollTarget } from './sessionContextMenuScroll';
import { getDesktopPlatform } from '@/desktop/desktopWindowUtils';
import { getRevealLabelKey, revealItemInFileManager } from '@/desktop/desktopReveal';
import { useLocalMachineIds } from '@/desktop/desktopLocalMachine';
import { openDesktopTerminalWindow } from '@/desktop/desktopWindowUtils';

type MenuPosition = { x: number; y: number };
type ActionIconSpec =
    | { family: 'ionicons'; name: React.ComponentProps<typeof Ionicons>['name'] }
    | { family: 'antdesign'; name: React.ComponentProps<typeof AntDesign>['name'] };
type QuickAction = {
    kind: SessionQuickActionKind;
    label: string;
    icon: ActionIconSpec;
    destructive?: boolean;
    disabled?: boolean;
    // First item of a section: the menu draws a divider above it.
    startsSection: boolean;
    onPress: () => void;
};

const MENU_WIDTH = 212;
const ITEM_HEIGHT = 42;
const MENU_PADDING = 8;
const PALETTE_HEIGHT = 46;
const ICON_SIZE = 18;
// The rule plus its margins. Counted into the menu's height so it still clamps against the
// window edge with the dividers in.
const SECTION_DIVIDER_HEIGHT = 9;

function ActionIcon({ icon, color }: { icon: ActionIconSpec; color: string }) {
    if (icon.family === 'antdesign') {
        return <AntDesign name={icon.name} size={ICON_SIZE} color={color} />;
    }
    return <Ionicons name={icon.name} size={ICON_SIZE} color={color} />;
}

const styles = StyleSheet.create((theme) => ({
    menu: {
        position: 'absolute',
        width: MENU_WIDTH,
        paddingTop: MENU_PADDING,
        paddingBottom: 0,
        borderRadius: 10,
        backgroundColor: theme.colors.surface,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider,
        shadowColor: theme.colors.shadow.color,
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.22,
        shadowRadius: 20,
        elevation: 12,
        overflow: 'hidden',
    },
    item: {
        height: ITEM_HEIGHT,
        paddingHorizontal: 12,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    itemText: {
        flex: 1,
        fontSize: 14,
        color: theme.colors.text,
        ...Typography.default(),
    },
    destructiveText: {
        color: theme.colors.textDestructive,
    },
    disabled: {
        opacity: 0.45,
    },
    // Between two sections. The palette carries its own top border, so it needs no divider.
    sectionDivider: {
        height: StyleSheet.hairlineWidth,
        backgroundColor: theme.colors.divider,
        marginVertical: 4,
    },
    // Anchors the overlay below to the row it wraps.
    highlightHost: {
        position: 'relative',
    },
    // The row the menu belongs to. The menu opens at the cursor, which can land well away from
    // the row it acts on, so the row has to say which one it is. A ring rather than a background
    // wash: a row's background already means "currently open" (`surfaceSelected`), and the two
    // states can be true of different rows at once.
    highlightOverlay: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        borderWidth: 2,
        borderColor: theme.colors.textLink,
        // The same hue as `textLink`, held back so the title stays legible over it.
        backgroundColor: theme.dark ? 'rgba(10, 132, 255, 0.18)' : 'rgba(0, 122, 255, 0.08)',
    },
}));

function useSessionQuickActions(session: Session) {
    const router = useRouter();
    const sessionStatus = useSessionStatus(session);
    // Revealing a folder only means something for a session spawned by the CLI on this very
    // computer; anywhere else the path is on another disk.
    const localMachineIds = useLocalMachineIds();
    const sessionMachineId = session.metadata?.machineId;
    const isLocalMachine = !!sessionMachineId && localMachineIds.has(sessionMachineId);
    // See `markSessionUnread`. Reading always lands, so only the unread direction needs a guard:
    // it rewinds both timestamps, which means the question is whether a live completion is left —
    // except on a session shared with me, whose `completionDismissedAt` is the owner's to write,
    // so there the owner's dismissal is one more thing that can leave the dot hidden.
    //
    // Mid-task is the other thing that leaves it hidden. `taskCompleted` is stamped when the CLI
    // goes idle and is never cleared, so a session running its next task still has a live
    // completion behind it — but the row is showing the pulsing mark for that task, and
    // `useSessionStatus` reports no unread completion in any of the states that pulse, so a
    // rewind here would change nothing on screen.
    const isUnread = sessionStatus.hasUnreadCompletion === true;
    const isWorking = sessionStatus.isPulsing === true;
    const canMarkUnread = hasLiveCompletion(session)
        && !isWorking
        && (!session.accessLevel || hasUnreadCompletionSince(session, 0));
    const canToggleRead = isUnread || canMarkUnread;
    const [forkingSession, setForkingSession] = React.useState(false);
    const [archiveMenuVisible, setArchiveMenuVisible] = React.useState(false);
    const [archiveMenuItems, setArchiveMenuItems] = React.useState<ActionMenuItem[]>([]);

    const dismissToHome = useDismissToHome();

    const [, performArchive] = useHappyAction(async () => {
        // Home first: the flip to inactive empties the composer on the session's own screen, so
        // archiving from the list would reflow that screen for the whole archive round trip
        // before it pops.
        dismissToHome();
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

    const [, performDelete] = useHappyAction(async () => {
        const result = await sessionDelete(session.id);
        if (!result.success) throw new HappyError(result.message || t('sessionInfo.failedToDeleteSession'), false);
    });

    const [, performLeaveSharedSession] = useHappyAction(async () => {
        const credentials = sync.getCredentials();
        if (!credentials) throw new HappyError(t('common.error'), false);
        await leaveSharedSession(credentials, session.id);
        storage.getState().removeSharedSession(session.id);
    });

    const handleNewSession = React.useCallback(() => {
        const params = new URLSearchParams();
        if (session.metadata?.machineId) params.set('machineId', session.metadata.machineId);
        if (session.metadata?.path) params.set('path', session.metadata.path);
        const query = params.toString();
        router.push(query ? `/new?${query}` : '/new');
    }, [router, session.metadata?.machineId, session.metadata?.path]);

    const handleOpenTerminal = React.useCallback(() => {
        const machineId = session.metadata?.machineId;
        if (!machineId) return;
        // The session's checkout is the directory someone wants a shell in; a session that has
        // not been given one yet still deserves a terminal, so fall back to the machine's home.
        const homeDir = storage.getState().machines[machineId]?.metadata?.homeDir;
        const cwd = resolveTerminalDirectory({ sessionPath: session.metadata?.path, homeDir });
        void (async () => {
            try {
                // A second shell rather than the one already in that directory:
                // asking for a terminal is asking for a prompt, and being handed
                // the shell that is already open — perhaps in a window that is
                // already showing it — reads as the command having done nothing.
                const terminal = await spawnTerminal({ machineId, cwd });
                // On the desktop the terminals get their own window — they are a
                // place you go and stay, not a page inside the session list. Any-
                // where without windows, the workspace is an ordinary screen.
                if (isTauriDesktop()) {
                    await openDesktopTerminalWindow({ machineId, terminalId: terminal.id });
                    return;
                }
                router.push(`/terminals?machineId=${machineId}&terminalId=${terminal.id}`);
            } catch (error) {
                console.warn('Failed to open a terminal:', error);
                showToast(t('terminalSession.openFailed'));
            }
        })();
    }, [router, session.metadata?.machineId, session.metadata?.path]);

    const handleArchive = React.useCallback(() => {
        const workspaceRepos = getWorkspaceRepos(session.metadata);
        const machineId = session.metadata?.machineId;
        if (workspaceRepos.length > 0 && machineId) {
            const firstRepo = workspaceRepos[0];
            setArchiveMenuItems([
                { label: t('sessionInfo.worktree.archiveKeepWorktree'), onPress: performArchive },
                {
                    label: t('sessionInfo.worktree.archiveCleanupKeepBranch'),
                    onPress: async () => {
                        try {
                            if (workspaceRepos.length > 1 && session.metadata?.workspacePath) {
                                await cleanupWorkspace(machineId, session.metadata.workspacePath, workspaceRepos, false);
                            } else if (firstRepo?.basePath && firstRepo.branchName) {
                                await cleanupWorktree(machineId, firstRepo.basePath, firstRepo.branchName, false);
                            }
                        } catch (error) {
                            console.warn('Worktree cleanup failed:', error);
                        }
                        await performArchive();
                    },
                },
                {
                    label: t('sessionInfo.worktree.archiveCleanupDeleteBranch'),
                    destructive: true,
                    onPress: async () => {
                        try {
                            if (workspaceRepos.length > 1 && session.metadata?.workspacePath) {
                                await cleanupWorkspace(machineId, session.metadata.workspacePath, workspaceRepos, true);
                            } else if (firstRepo?.basePath && firstRepo.branchName) {
                                await cleanupWorktree(machineId, firstRepo.basePath, firstRepo.branchName, true);
                            }
                        } catch (error) {
                            console.warn('Worktree cleanup failed:', error);
                        }
                        await performArchive();
                    },
                },
            ]);
            setArchiveMenuVisible(true);
            return;
        }
        Modal.alert(t('sessionInfo.archiveSession'), t('sessionInfo.archiveSessionConfirm'), [
            { text: t('common.cancel'), style: 'cancel' },
            { text: t('sessionInfo.archiveSession'), style: 'destructive', onPress: performArchive },
        ]);
    }, [performArchive, session.metadata]);

    const handleRename = React.useCallback(async () => {
        if (await promptRenameSession(session)) {
            showToast(t('sessionInfo.renameSessionSuccess'));
        }
    }, [session]);

    const handleDelete = React.useCallback(() => {
        Modal.alert(t('sessionInfo.deleteSession'), t('sessionInfo.deleteSessionWarning'), [
            { text: t('common.cancel'), style: 'cancel' },
            { text: t('sessionInfo.deleteSession'), style: 'destructive', onPress: performDelete },
        ]);
    }, [performDelete]);

    const handleLeave = React.useCallback(() => {
        Modal.alert(t('sessionInfo.leaveSharedSession'), t('sessionInfo.leaveSharedSessionConfirm'), [
            { text: t('common.cancel'), style: 'cancel' },
            { text: t('sessionInfo.leaveSharedSession'), style: 'destructive', onPress: performLeaveSharedSession },
        ]);
    }, [performLeaveSharedSession]);

    const handleFork = React.useCallback(async () => {
        if (forkingSession) return;
        const flavor = session.metadata?.flavor;
        const claudeSessionId = session.metadata?.claudeSessionId;
        const codexSessionId = session.metadata?.codexSessionId;
        const qoderSessionId = session.metadata?.qoderSessionId;
        const machineId = session.metadata?.machineId;
        const directory = session.metadata?.path;
        if (!machineId || !directory || !hasForkableNativeId(session)) return;

        const provider = agentDisplayName(flavor);
        const confirmed = await Modal.confirm(
            session.active ? t('sessionHistory.copyConfirmTitle') : t('sessionHistory.resumeConfirmTitle'),
            session.active
                ? t('sessionHistory.copyConfirmMessage', { provider })
                : t('sessionHistory.resumeConfirmMessage', { provider }),
            { confirmText: t('common.continue'), cancelText: t('common.cancel') },
        );
        if (!confirmed) return;

        setForkingSession(true);
        try {
            const originalTitle = session.metadata?.summary?.text || getSessionName(session);
            const sessionTitle = session.active ? generateCopyTitle(originalTitle) : originalTitle;
            let resumeSessionId: string | undefined;
            let agent: 'claude' | 'gemini' | 'codex' | 'qoder' = 'claude';

            if (flavor === 'gemini') {
                const forkResult = await machineForkGeminiSession(machineId, session.id);
                if (!forkResult.success || !forkResult.newSessionId) {
                    Modal.alert(t('common.error'), forkResult.errorMessage || t('claudeHistory.resumeFailed'));
                    return;
                }
                resumeSessionId = forkResult.newSessionId;
                agent = 'gemini';
            } else if (flavor === 'codex' && codexSessionId) {
                const forkResult = await machineForkCodexSession(machineId, codexSessionId, { restoreArchived: !session.active });
                if (!forkResult.success || !forkResult.newFilePath) {
                    Modal.alert(t('common.error'), forkResult.errorMessage || t('claudeHistory.resumeFailed'));
                    return;
                }
                resumeSessionId = forkResult.newFilePath;
                agent = 'codex';
            } else if (claudeSessionId) {
                const forkResult = await machineForkClaudeSession(machineId, claudeSessionId);
                if (!forkResult.success || !forkResult.newSessionId) {
                    Modal.alert(t('common.error'), forkResult.errorMessage || t('claudeHistory.resumeFailed'));
                    return;
                }
                resumeSessionId = forkResult.newSessionId;
            } else if (flavor === 'qoder') {
                const qoderFork = await forkQoderSessionForCopy(machineId, qoderSessionId, directory);
                if ('error' in qoderFork) {
                    Modal.alert(t('common.error'), qoderFork.error ?? t('claudeHistory.resumeFailed'));
                    return;
                }
                resumeSessionId = qoderFork.newSessionId;
                agent = 'qoder';
            }

            const result = await machineSpawnNewSession({
                machineId,
                directory,
                approvedNewDirectoryCreation: false,
                agent,
                resumeSessionId,
                sessionTitle,
                skipForkSession: true,
            });
            if (result.type === 'requestToApproveDirectoryCreation') {
                Modal.alert(t('common.error'), t('claudeHistory.directoryNotFound'));
                return;
            }
            if (result.type === 'error') {
                Modal.alert(t('common.error'), result.errorMessage || t('claudeHistory.resumeFailed'));
                return;
            }
            await sync.refreshSessions();
            await copySessionMetadata(session, result.sessionId).catch(error => console.warn('copySessionMetadata failed:', error));
            copySessionModeSettings(session, result.sessionId);
            router.push(`/session/${result.sessionId}`);
        } catch (error) {
            console.error('Failed to fork session', error);
            Modal.alert(t('common.error'), t('claudeHistory.resumeFailed'));
        } finally {
            setForkingSession(false);
        }
    }, [forkingSession, router, session]);

    const handlers: Record<SessionQuickActionKind, () => void> = {
        details: () => router.push(`/session/${session.id}/info`),
        renameSession: handleRename,
        toggleRead: () => {
            if (isUnread) {
                sync.markSessionRead(session.id);
                return;
            }
            // Nothing can read as unread while its own screen is open, so leave it the way the
            // logo does. `markSessionUnread` stops the view being tracked first, which is what
            // makes the dot stick; this is only about not leaving someone staring at it.
            if (sync.isViewingSession(session.id)) {
                dismissToHome();
            }
            sync.markSessionUnread(session.id);
        },
        newSession: handleNewSession,
        terminal: handleOpenTerminal,
        revealInFileManager: () => {
            const path = session.metadata?.path;
            if (!path) return;
            void revealItemInFileManager(path).catch((error) => {
                console.warn('Failed to reveal the session folder:', error);
                showToast(t('sessionInfo.revealInFileManagerFailed'));
            });
        },
        leaveSharedSession: handleLeave,
        forkSession: handleFork,
        archiveSession: handleArchive,
        deleteSession: handleDelete,
    };
    const labels: Record<SessionQuickActionKind, string> = {
        details: t('common.details'),
        renameSession: t('common.rename'),
        toggleRead: isUnread ? t('sessionInfo.markAsRead') : t('sessionInfo.markAsUnread'),
        newSession: t('sessionInfo.newSession'),
        terminal: t('sessionInfo.openTerminal'),
        revealInFileManager: t(getRevealLabelKey(getDesktopPlatform())),
        leaveSharedSession: t('sessionInfo.leaveSharedSession'),
        forkSession: session.active ? t('sessionInfo.copySession') : t('sessionInfo.resumeSession'),
        archiveSession: t('sessionInfo.archiveSession'),
        deleteSession: t('sessionInfo.deleteSession'),
    };
    const icons: Record<SessionQuickActionKind, ActionIconSpec> = {
        details: { family: 'ionicons', name: 'information-circle-outline' },
        renameSession: { family: 'antdesign', name: 'edit' },
        toggleRead: { family: 'ionicons', name: isUnread ? 'mail-open-outline' : 'mail-unread-outline' },
        newSession: { family: 'ionicons', name: 'add-circle-outline' },
        terminal: { family: 'ionicons', name: 'terminal-outline' },
        revealInFileManager: { family: 'ionicons', name: 'folder-open-outline' },
        leaveSharedSession: { family: 'ionicons', name: 'exit-outline' },
        forkSession: { family: 'ionicons', name: session.active ? 'copy-outline' : 'play-circle-outline' },
        archiveSession: { family: 'ionicons', name: 'archive-outline' },
        deleteSession: { family: 'ionicons', name: 'trash-outline' },
    };
    const sections = getSessionQuickActionSections(getSessionQuickActionKinds({
        session,
        isConnected: sessionStatus.isConnected,
        isLocalMachine,
    }));
    // Flattened, with the head of every section after the first flagged so the renderer knows
    // where the dividers go.
    const actions = sections.flatMap((section, sectionIndex): QuickAction[] => section.map((kind, indexInSection) => ({
        kind,
        label: labels[kind],
        icon: icons[kind],
        destructive: kind === 'leaveSharedSession' || kind === 'archiveSession' || kind === 'deleteSession',
        disabled: (kind === 'forkSession' && forkingSession)
            || (kind === 'toggleRead' && !canToggleRead),
        startsSection: sectionIndex > 0 && indexInSection === 0,
        onPress: handlers[kind],
    })));

    return {
        actions,
        archiveMenu: (
            <ActionMenuModal
                visible={archiveMenuVisible}
                title={t('sessionInfo.worktree.archiveWorktreeConfirm')}
                items={archiveMenuItems}
                onClose={() => setArchiveMenuVisible(false)}
            />
        ),
    };
}

export function SessionContextMenu({ session, children, highlightShape }: {
    session: Session;
    children: React.ReactNode;
    // The row's corner radii, where the list rounds and clips its first and last rows. Left out,
    // the ring's corners are square and the clip shaves them off.
    highlightShape?: StyleProp<ViewStyle>;
}) {
    const { theme } = useUnistyles();
    const { width, height } = useWindowDimensions();
    const safeArea = useSafeAreaInsets();
    const [position, setPosition] = React.useState<MenuPosition | null>(null);
    const [hoveredAction, setHoveredAction] = React.useState<SessionQuickActionKind | null>(null);
    const [nativeMenuVisible, setNativeMenuVisible] = React.useState(false);
    const menuRef = React.useRef<HTMLElement | null>(null);
    // The row this menu belongs to, as a DOM node. A scroll only invalidates the menu when it
    // moves this row — see `shouldDismissSessionMenuOnScroll`.
    const anchorRef = React.useRef<ScrollTarget>(null);
    // Stable identity: an inline callback ref is re-run on every render, which would drop the
    // anchor between commits.
    const setAnchorRef = React.useCallback((node: unknown) => {
        anchorRef.current = (node as ScrollTarget) ?? null;
    }, []);
    const lastLongPressAtRef = React.useRef(0);
    const { actions, archiveMenu } = useSessionQuickActions(session);
    const markerColor = useSessionMarkerColor(session.id);
    const nativeQuickActionsMaxHeight = Math.max(
        240,
        height - safeArea.top - safeArea.bottom - 72,
    );

    const closeMenu = React.useCallback(() => {
        setPosition(null);
        setHoveredAction(null);
    }, []);

    // Whichever menu this platform opens — the floating one on web, the modal elsewhere.
    const menuOpen = position !== null || nativeMenuVisible;
    // Rendered over `children` here rather than set on the row, so every list gets it without
    // having to know the menu exists. `pointerEvents: 'none'` keeps the row clickable underneath.
    const highlight = menuOpen
        ? <View pointerEvents="none" style={[styles.highlightOverlay, highlightShape]} />
        : null;

    const selectMarkerColor = React.useCallback((color: SessionMarkerColor | null) => {
        closeMenu();
        setNativeMenuVisible(false);
        sync.queueSessionMarkerColorUpdate(session.id, color);
    }, [closeMenu, session.id]);

    React.useEffect(() => {
        if (Platform.OS !== 'web' || position === null || typeof document === 'undefined') return;

        const isInsideMenu = (target: EventTarget | null) => (
            target instanceof Node && menuRef.current?.contains(target)
        );
        const handlePointerDown = (event: PointerEvent) => {
            if (!isInsideMenu(event.target)) closeMenu();
        };
        const handleContextMenuOutside = (event: MouseEvent) => {
            if (isInsideMenu(event.target)) {
                event.preventDefault();
                return;
            }
            // Do not prevent the event here. A session row may replace this menu,
            // while every other target should keep the browser/system menu.
            closeMenu();
        };
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') closeMenu();
        };
        // Capture phase, so this sees scrolls from every container in the document — the chat
        // pane rewriting its own scrollTop on each streaming update included. Only a scroll that
        // moves the row the menu belongs to makes the menu stale; the rest are none of its
        // business.
        const handleScroll = (event: Event) => {
            if (shouldDismissSessionMenuOnScroll(event.target as ScrollTarget, anchorRef.current)) {
                closeMenu();
            }
        };

        document.addEventListener('pointerdown', handlePointerDown, true);
        document.addEventListener('contextmenu', handleContextMenuOutside, true);
        document.addEventListener('keydown', handleKeyDown, true);
        window.addEventListener('scroll', handleScroll, true);
        return () => {
            document.removeEventListener('pointerdown', handlePointerDown, true);
            document.removeEventListener('contextmenu', handleContextMenuOutside, true);
            document.removeEventListener('keydown', handleKeyDown, true);
            window.removeEventListener('scroll', handleScroll, true);
        };
    }, [closeMenu, position]);

    if (Platform.OS !== 'web') {
        const child = React.isValidElement(children)
            ? React.cloneElement(children as React.ReactElement<any>, {
                onLongPress: (event: unknown) => {
                    (children.props as { onLongPress?: (event: unknown) => void }).onLongPress?.(event);
                    lastLongPressAtRef.current = Date.now();
                    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                    setNativeMenuVisible(true);
                },
                onPress: (event: unknown) => {
                    if (Date.now() - lastLongPressAtRef.current < 1_000) return;
                    (children.props as { onPress?: (event: unknown) => void }).onPress?.(event);
                },
                delayLongPress: 450,
            })
            : children;
        const nativeItems: ActionMenuItem[] = actions.map(action => ({
            label: action.label,
            destructive: action.destructive,
            disabled: action.disabled,
            onPress: action.onPress,
        }));

        return (
            <>
                <View style={styles.highlightHost}>
                    {child}
                    {highlight}
                </View>
                <ActionMenuModal
                    visible={nativeMenuVisible}
                    title={t('sessionInfo.quickActions')}
                    items={nativeItems}
                    onClose={() => setNativeMenuVisible(false)}
                    maxHeight={nativeQuickActionsMaxHeight}
                    footerContent={(
                        <SessionColorPalette
                            selectedColor={markerColor}
                            onSelect={selectMarkerColor}
                        />
                    )}
                />
                {archiveMenu}
            </>
        );
    }

    const dividerCount = actions.filter(action => action.startsSection).length;
    const menuHeight = actions.length * ITEM_HEIGHT + dividerCount * SECTION_DIVIDER_HEIGHT + MENU_PADDING + PALETTE_HEIGHT;
    const left = position ? Math.max(8, Math.min(position.x, width - MENU_WIDTH - 8)) : 0;
    const top = position ? Math.max(8, Math.min(position.y, height - menuHeight - 8)) : 0;
    const handleContextMenu = (event: {
        preventDefault: () => void;
        stopPropagation: () => void;
        nativeEvent: { pageX: number; pageY: number; clientX?: number; clientY?: number };
    }) => {
        event.preventDefault();
        event.stopPropagation();
        setHoveredAction(null);
        setPosition({
            x: event.nativeEvent.clientX ?? event.nativeEvent.pageX,
            y: event.nativeEvent.clientY ?? event.nativeEvent.pageY,
        });
    };
    const webContextMenuProps = { onContextMenu: handleContextMenu };

    return (
        <>
            <View {...webContextMenuProps} ref={setAnchorRef} style={styles.highlightHost}>
                {children}
                {highlight}
            </View>
            {position !== null && (
                <SessionContextMenuPortal>
                    <View
                        ref={(node) => { menuRef.current = node as unknown as HTMLElement | null; }}
                        pointerEvents="auto"
                        style={[styles.menu, { left, top }]}
                    >
                        {actions.map(action => (
                            <React.Fragment key={action.kind}>
                                {action.startsSection && <View style={styles.sectionDivider} />}
                                <Pressable
                                    disabled={action.disabled}
                                    onHoverIn={() => setHoveredAction(action.kind)}
                                    onHoverOut={() => setHoveredAction(current => current === action.kind ? null : current)}
                                    onPress={(event) => {
                                        event.stopPropagation?.();
                                        closeMenu();
                                        action.onPress();
                                    }}
                                    style={({ pressed }) => [
                                        styles.item,
                                        (pressed || hoveredAction === action.kind) && { backgroundColor: theme.colors.surfacePressed },
                                        action.disabled && styles.disabled,
                                    ]}
                                >
                                    <ActionIcon
                                        icon={action.icon}
                                        color={action.destructive ? theme.colors.textDestructive : theme.colors.textSecondary}
                                    />
                                    <Text style={[styles.itemText, action.destructive && styles.destructiveText]} numberOfLines={1}>
                                        {action.label}
                                    </Text>
                                </Pressable>
                            </React.Fragment>
                        ))}
                        <SessionColorPalette
                            selectedColor={markerColor}
                            onSelect={selectMarkerColor}
                            compact
                        />
                    </View>
                </SessionContextMenuPortal>
            )}
            {archiveMenu}
        </>
    );
}
