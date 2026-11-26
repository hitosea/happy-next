// Upgrading a session to the CLI version its machine now runs, from its info page or the chat
// header's menu: once confirmed, the session is stopped, its agent conversation forked and resumed
// in a new session on the same folder (as resuming one does), and the app moves to that session.
// Refused while the session is thinking. `upgrade` is stable across renders, reading the session
// as it is when pressed.
import * as React from 'react';
import { useRouter } from 'expo-router';
import { Modal } from '@/modal';
import { machineForkClaudeSession, machineForkCodexSession, machineForkGeminiSession, machineForkQoderSession, machineForkAntigravitySession, machineForkDeepSeekSession, machineSpawnNewSession, sessionKill } from '@/sync/ops';
import { storage } from '@/sync/storage';
import type { Session } from '@/sync/storageTypes';
import { t } from '@/text';
import { copySessionMetadata, copySessionModeSettings, getSessionName } from '@/utils/sessionUtils';

export function useSessionUpgrade(session: Session | null | undefined) {
    const router = useRouter();
    const sessionRef = React.useRef(session);
    sessionRef.current = session;
    const [upgrading, setUpgrading] = React.useState(false);
    const upgradingRef = React.useRef(false);

    const upgrade = React.useCallback(async () => {
        const session = sessionRef.current;
        const machineId = session?.metadata?.machineId;
        if (!session || !machineId || upgradingRef.current) return;

        // Block if session is thinking
        if (session.thinking) {
            Modal.alert(
                t('sessionInfo.cliUpgradeAvailable'),
                t('sessionInfo.cliUpgradeSessionBusy')
            );
            return;
        }

        // Confirm before upgrading
        const confirmed = await Modal.confirm(
            t('sessionInfo.cliUpgradeAvailable'),
            t('sessionInfo.cliUpgradeConfirm')
        );
        if (!confirmed) return;

        // Set upgrading flag only after confirmation
        upgradingRef.current = true;
        setUpgrading(true);
        storage.getState().setSessionUpgrading(session.id, true);

        try {
            // Kill old session
            await sessionKill(session.id);

            // Fork and resume — mirrors the "resume session" flow exactly
            const flavor = session.metadata?.flavor;
            let resumeSessionId: string | undefined;
            let agent: 'claude' | 'codex' | 'gemini' | 'antigravity' | 'deepseek' | 'qoder' = 'claude';

            if (flavor === 'gemini') {
                const forkResult = await machineForkGeminiSession(machineId, session.id);
                if (!forkResult.success || !forkResult.newSessionId) {
                    Modal.alert(t('common.error'), forkResult.errorMessage || t('claudeHistory.resumeFailed'));
                    return;
                }
                resumeSessionId = forkResult.newSessionId;
                agent = 'gemini';
            } else if (flavor === 'codex' && session.metadata?.codexSessionId) {
                const forkResult = await machineForkCodexSession(machineId, session.metadata.codexSessionId);
                if (!forkResult.success || !forkResult.newFilePath) {
                    Modal.alert(t('common.error'), forkResult.errorMessage || t('claudeHistory.resumeFailed'));
                    return;
                }
                resumeSessionId = forkResult.newFilePath;
                agent = 'codex';
            } else if (flavor === 'qoder' && session.metadata?.qoderSessionId) {
                const forkResult = await machineForkQoderSession(machineId, session.metadata.qoderSessionId, session.metadata.path || '', session.metadata.qoderBuild);
                if (!forkResult.success || !forkResult.newSessionId) {
                    Modal.alert(t('common.error'), forkResult.errorMessage || t('claudeHistory.resumeFailed'));
                    return;
                }
                resumeSessionId = forkResult.newSessionId;
                agent = 'qoder';
            } else if (flavor === 'antigravity' && session.metadata?.antigravitySessionId) {
                const forkResult = await machineForkAntigravitySession(machineId, session.metadata.antigravitySessionId);
                if (!forkResult.success || !forkResult.newSessionId) {
                    Modal.alert(t('common.error'), forkResult.errorMessage || t('claudeHistory.resumeFailed'));
                    return;
                }
                resumeSessionId = forkResult.newSessionId;
                agent = 'antigravity';
            } else if (flavor === 'deepseek' && session.metadata?.deepseekSessionId) {
                const forkResult = await machineForkDeepSeekSession(machineId, session.metadata.deepseekSessionId);
                if (!forkResult.success || !forkResult.newSessionId) {
                    Modal.alert(t('common.error'), forkResult.errorMessage || t('claudeHistory.resumeFailed'));
                    return;
                }
                resumeSessionId = forkResult.newSessionId;
                agent = 'deepseek';
            } else if (session.metadata?.claudeSessionId) {
                const forkResult = await machineForkClaudeSession(machineId, session.metadata.claudeSessionId);
                if (!forkResult.success || !forkResult.newSessionId) {
                    Modal.alert(t('common.error'), forkResult.errorMessage || t('claudeHistory.resumeFailed'));
                    return;
                }
                resumeSessionId = forkResult.newSessionId;
                agent = 'claude';
            } else {
                Modal.alert(t('common.error'), t('claudeHistory.resumeFailed'));
                return;
            }

            // Spawn new session with forked data
            const result = await machineSpawnNewSession({
                machineId,
                directory: session.metadata?.path || '',
                agent,
                qoderBuild: session.metadata?.qoderBuild,
                resumeSessionId,
                skipForkSession: true,
                sessionTitle: session.metadata?.summary?.text,
                forkedFrom: { sessionId: session.id, title: session.metadata?.summary?.text || getSessionName(session), contextWindowSize: session.agentState?.contextWindowSize ?? undefined },
            });

            if (result.type !== 'success') {
                Modal.alert(t('common.error'), result.type === 'error' ? result.errorMessage : 'Upgrade failed');
                return;
            }

            await copySessionMetadata(session, result.sessionId).catch(e => console.warn('copySessionMetadata failed:', e));
            copySessionModeSettings(session, result.sessionId);

            // Navigate to the new session: go back to root then push new session
            try { router.dismissAll(); } catch (_) { /* stack may already be at root */ }
            router.push(`/session/${result.sessionId}`);
        } catch (e) {
            Modal.alert(t('common.error'), e instanceof Error ? e.message : 'Unknown error');
        } finally {
            upgradingRef.current = false;
            setUpgrading(false);
            storage.getState().setSessionUpgrading(session.id, false);
        }
    }, [router]);

    return { upgrading, upgrade };
}
