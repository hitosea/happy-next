import { create } from 'zustand';
import { isRpcMethodNotAvailable, sessionArchive } from './ops';
import { storage } from './storage';
import { sync } from './sync';
import type { Session } from './storageTypes';
import { HappyError } from '@/utils/errors';
import { t } from '@/text';
import { shouldArchiveAfterResume } from '@/utils/sessionLifecycle';

// Sessions with an archive in flight, kept out of the Disconnected block meanwhile.
const archivingSessions = create<{ ids: Record<string, true> }>(() => ({ ids: {} }));

export function useArchivingSessionIds(): Record<string, true> {
    return archivingSessions((state) => state.ids);
}

function setArchiving(sessionId: string, archiving: boolean) {
    archivingSessions.setState(({ ids }) => {
        const next = { ...ids };
        if (archiving) next[sessionId] = true;
        else delete next[sessionId];
        return { ids: next };
    });
}

/**
 * Archive a session from the app: a live one leaves the live list at once and comes back if
 * archiving fails. Archiving is idempotent, so a session whose RPC target is gone counts as
 * archived already. Throws on failure, including a stop whose archived mark was lost; a native
 * (Codex) archive error is returned for the caller.
 */
export async function archiveSessionFromApp(session: Session): Promise<{ nativeArchiveError?: string }> {
    const wasActive = storage.getState().sessions[session.id]?.active ?? session.active;
    setArchiving(session.id, true);
    try {
        // Only a live session is flipped: marking a stopped one pending archive would keep a later
        // resume showing offline if this archive fails.
        if (wasActive) storage.getState().updateSessionActivity(session.id, false);
        const result = await sessionArchive(session.id, { wasActive });
        if (!result.success) {
            if (wasActive) storage.getState().updateSessionActivity(session.id, true);
            // A stopped session archives without its process, so a missing RPC here is a live one
            // whose machine just dropped: nothing was archived, and once the server marks it offline
            // it archives from the Disconnected block.
            const message = isRpcMethodNotAvailable(result.message) ? t('sessionInfo.archiveSessionUnreachable') : result.message;
            throw new HappyError(message || t('sessionInfo.failedToArchiveSession'), false);
        }
        await sync.clearSessionMessageCache(session.id);
        if (result.archiveMetadataError) {
            throw new HappyError(t('sessionInfo.failedToArchiveSession') + ': ' + result.archiveMetadataError, false);
        }
        return { nativeArchiveError: result.success ? result.nativeArchiveError : undefined };
    } finally {
        setArchiving(session.id, false);
    }
}

/**
 * Once a resume has spawned the session taking over, archive the original it was forked from, so
 * a resume reads as the session coming back rather than a second one beside it. Runs in the
 * background after the new session is up: a failure leaves the original listed as disconnected,
 * to archive by hand, and does not undo the resume.
 */
export function archiveAfterResume(original: Session) {
    const session = storage.getState().sessions[original.id] ?? original;
    if (!shouldArchiveAfterResume(session)) return;
    archiveSessionFromApp(session).catch(error => console.warn('Archiving the resumed session failed:', error));
}
