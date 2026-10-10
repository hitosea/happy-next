import * as React from 'react';
import { Modal } from '@/modal';
import type { Session } from '@/sync/storageTypes';
import { machineForkClaudeSession, machineForkGeminiSession, machineForkCodexSession, machineForkQoderSession, machineSpawnNewSession } from '@/sync/ops';
import { sync } from '@/sync/sync';
import { t } from '@/text';
import { copySessionMetadata, copySessionModeSettings, generateCopyTitle, getSessionName } from '@/utils/sessionUtils';
import { useNavigateToSession } from '@/hooks/useNavigateToSession';

export type SessionForkMode = 'resume' | 'copy';

/**
 * Picks up a past session again: `resume` brings an ended one back, `copy` starts a second session
 * from where a running one is. Either way the agent's own session is forked on the machine and a new
 * Happy session spawned on it, after asking the user first; one at a time, `resumingSessionId` being
 * the session in progress. Shared by the session history and a machine's recent sessions.
 */
export function useSessionFork() {
    const navigateToSession = useNavigateToSession();
    const [resumingSessionId, setResumingSessionId] = React.useState<string | null>(null);

const forkSession = React.useCallback(async (session: Session, mode: SessionForkMode) => {
    if (resumingSessionId) return;
    const flavor = session.metadata?.flavor;
    const claudeSessionId = session.metadata?.claudeSessionId;
    const codexSessionId = session.metadata?.codexSessionId;
    const qoderSessionId = session.metadata?.qoderSessionId;
    const machineId = session.metadata?.machineId;
    const directory = session.metadata?.path;

    // Guard: must have a forkable session identifier
    if (!claudeSessionId && flavor !== 'gemini' && !codexSessionId && !qoderSessionId) return;
    if (!directory) {
        Modal.alert(t('common.error'), t('claudeHistory.pathUnavailable'));
        return;
    }
    if (!machineId) {
        Modal.alert(t('common.error'), t('claudeHistory.noMachines'));
        return;
    }

    const provider = flavor === 'gemini' ? 'Gemini' : flavor === 'codex' ? 'Codex' : flavor === 'qoder' ? 'Qoder' : 'Claude';
    const confirmTitle = mode === 'copy' ? t('sessionHistory.copyConfirmTitle') : t('sessionHistory.resumeConfirmTitle');
    const confirmMessage = mode === 'copy' ? t('sessionHistory.copyConfirmMessage', { provider }) : t('sessionHistory.resumeConfirmMessage', { provider });
    const confirmed = await Modal.confirm(
        confirmTitle,
        confirmMessage,
        { confirmText: t('common.continue'), cancelText: t('common.cancel') }
    );
    if (!confirmed) return;

    setResumingSessionId(session.id);
    try {
        const originalTitle = session.metadata?.summary?.text || getSessionName(session);
        let sessionTitle = originalTitle;
        if (mode === 'copy') {
            sessionTitle = generateCopyTitle(originalTitle);
        }

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
            const forkResult = await machineForkCodexSession(machineId, codexSessionId, { restoreArchived: mode !== 'copy' });
            if (!forkResult.success || !forkResult.newFilePath) {
                Modal.alert(t('common.error'), forkResult.errorMessage || t('claudeHistory.resumeFailed'));
                return;
            }
            resumeSessionId = forkResult.newFilePath;
            agent = 'codex';
        } else if (flavor === 'qoder' && qoderSessionId) {
            const forkResult = await machineForkQoderSession(machineId, qoderSessionId, directory);
            if (!forkResult.success || !forkResult.newSessionId) {
                Modal.alert(t('common.error'), forkResult.errorMessage || t('claudeHistory.resumeFailed'));
                return;
            }
            resumeSessionId = forkResult.newSessionId;
            agent = 'qoder';
        } else if (claudeSessionId) {
            const forkResult = await machineForkClaudeSession(machineId, claudeSessionId);
            if (!forkResult.success || !forkResult.newSessionId) {
                Modal.alert(t('common.error'), forkResult.errorMessage || t('claudeHistory.resumeFailed'));
                return;
            }
            resumeSessionId = forkResult.newSessionId;
            agent = 'claude';
        } else {
            return;
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
        if (result.type === 'success') {
            await sync.refreshSessions();
            await copySessionMetadata(session, result.sessionId).catch(e => console.warn('copySessionMetadata failed:', e));
            copySessionModeSettings(session, result.sessionId);
            navigateToSession(result.sessionId);
        }
    } catch (error) {
        console.error('Failed to fork session', error);
        Modal.alert(t('common.error'), t('claudeHistory.resumeFailed'));
    } finally {
        setResumingSessionId(null);
    }
}, [navigateToSession, resumingSessionId]);

    return { resumingSessionId, forkSession };
}
