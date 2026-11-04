// Archiving a session, wherever it is offered: its row's menu in the list, its info page and the
// chat header's menu. A session in a worktree (or a multi-repo workspace) first asks what becomes
// of the worktree — kept, cleaned up keeping the branch, or cleaned up with the branch deleted —
// and any other session confirms in an alert. `archiveMenu` is that worktree choice; the caller
// renders it.
//
// `archive` is stable across renders, reading the session as it is when pressed, so it can sit in
// memoized menu items (the chat header's go into navigator options, which re-render the stack).
// The session may be missing (a screen still loading it), and then there is nothing to archive.
import * as React from 'react';
import { ActionMenuModal } from '@/components/ActionMenuModal';
import type { ActionMenuItem } from '@/components/ActionMenu';
import { useHappyAction } from '@/hooks/useHappyAction';
import { Modal } from '@/modal';
import { archiveSessionFromApp } from '@/sync/archiveSessionFromApp';
import type { Session } from '@/sync/storageTypes';
import { t } from '@/text';
import { HappyError } from '@/utils/errors';
import { getWorkspaceRepos } from '@/utils/workspaceRepos';
import { cleanupWorkspace, cleanupWorktree } from '@/utils/worktreeOps';

export function useSessionArchive(session: Session | null | undefined, options: {
    /** Runs as the archive starts, before the request. */
    beforeArchive?: () => void;
    /** Runs once the session is archived. */
    onArchived?: () => void;
} = {}) {
    const latestRef = React.useRef({ session, options });
    latestRef.current = { session, options };

    const runArchive = React.useCallback(async () => {
        const { session, options } = latestRef.current;
        if (!session) return;
        options.beforeArchive?.();
        const { nativeArchiveError } = await archiveSessionFromApp(session);
        if (nativeArchiveError) throw new HappyError(t('sessionInfo.codexArchiveFailed') + ': ' + nativeArchiveError, false);
        options.onArchived?.();
    }, []);
    const [archiving, performArchive] = useHappyAction(runArchive);

    const [archiveMenuVisible, setArchiveMenuVisible] = React.useState(false);
    const [archiveMenuItems, setArchiveMenuItems] = React.useState<ActionMenuItem[]>([]);

    const archive = React.useCallback(() => {
        const session = latestRef.current.session;
        if (!session) return;
        const metadata = session.metadata;
        const workspaceRepos = getWorkspaceRepos(metadata);
        const machineId = metadata?.machineId;
        if (workspaceRepos.length > 0 && machineId) {
            const firstRepo = workspaceRepos[0];
            const cleanUpThenArchive = (deleteBranch: boolean) => async () => {
                try {
                    if (workspaceRepos.length > 1 && metadata?.workspacePath) {
                        await cleanupWorkspace(machineId, metadata.workspacePath, workspaceRepos, deleteBranch);
                    } else if (firstRepo?.basePath && firstRepo.branchName) {
                        await cleanupWorktree(machineId, firstRepo.basePath, firstRepo.branchName, deleteBranch);
                    }
                } catch (error) {
                    console.warn('Worktree cleanup failed:', error);
                }
                performArchive();
            };
            setArchiveMenuItems([
                { label: t('sessionInfo.worktree.archiveKeepWorktree'), onPress: performArchive },
                { label: t('sessionInfo.worktree.archiveCleanupKeepBranch'), onPress: cleanUpThenArchive(false) },
                { label: t('sessionInfo.worktree.archiveCleanupDeleteBranch'), destructive: true, onPress: cleanUpThenArchive(true) },
            ]);
            setArchiveMenuVisible(true);
            return;
        }
        Modal.alert(t('sessionInfo.archiveSession'), t('sessionInfo.archiveSessionConfirm'), [
            { text: t('common.cancel'), style: 'cancel' },
            { text: t('sessionInfo.archiveSession'), style: 'destructive', onPress: performArchive },
        ]);
    }, [performArchive]);

    const archiveMenu = (
        <ActionMenuModal
            visible={archiveMenuVisible}
            title={t('sessionInfo.worktree.archiveWorktreeConfirm')}
            items={archiveMenuItems}
            onClose={() => setArchiveMenuVisible(false)}
        />
    );

    return { archiving, archive, archiveMenu };
}
