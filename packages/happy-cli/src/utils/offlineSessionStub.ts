/**
 * Offline Session Stub Factory
 *
 * Creates a session stub for offline mode that can be used across all backends
 * (Codex, Gemini, Qoder). Sending becomes a no-op until reconnection.
 *
 * This follows DRY principles by providing a single implementation for all backends,
 * satisfying REQ-8 from serverConnectionErrors.ts.
 *
 * @module offlineSessionStub
 */

import type { ApiSessionClient } from '@/api/apiSession';

/**
 * Creates a session stub for offline mode, and the hand-over to the real session once the server
 * is reachable.
 *
 * What a backend registers on the stub — the handlers for the app's messages and steers, being
 * archived, and its RPCs (abort, kill, permission mode) — is kept and passed to the real session by
 * `handOver`, and anything registered on the stub after that goes straight to it: a backend can
 * keep using the stub for a while after the swap (one queued until a message finishes). Without
 * this, a session started offline would ignore the app once it came online.
 *
 * @param sessionTag - Unique session tag (used to create offline session ID)
 *
 * @example
 * ```typescript
 * const offline = createOfflineSessionStub(sessionTag);
 * let session: ApiSessionClient = offline.session;
 *
 * // When reconnected:
 * const realSession = api.sessionSyncClient(response);
 * offline.handOver(realSession);
 * session = realSession;
 * ```
 */
export function createOfflineSessionStub(sessionTag: string): { session: ApiSessionClient; handOver: (real: ApiSessionClient) => void } {
    let real: ApiSessionClient | null = null;
    const registrations: Array<(target: ApiSessionClient) => void> = [];
    const register = (apply: (target: ApiSessionClient) => void) => {
        if (real) apply(real);
        else registrations.push(apply);
    };

    const session = {
        sessionId: `offline-${sessionTag}`,
        sendCodexMessage: () => {},
        sendAgentMessage: () => {},
        sendClaudeSessionMessage: () => {},
        keepAlive: () => {},
        sendSessionEvent: () => {},
        sendSessionDeath: () => {},
        updateLifecycleState: () => {},
        requestControlTransfer: async () => {},
        flush: async () => {},
        close: async () => {},
        updateMetadata: () => {},
        updateCapabilities: () => {},
        updateAgentState: () => {},
        onUserMessage: (...args: Parameters<ApiSessionClient['onUserMessage']>) => register(target => target.onUserMessage(...args)),
        onPendingSteer: (...args: Parameters<ApiSessionClient['onPendingSteer']>) => register(target => target.onPendingSteer(...args)),
        reportPendingSteer: () => {},
        onArchived: (...args: Parameters<ApiSessionClient['onArchived']>) => register(target => target.onArchived(...args)),
        rpcHandlerManager: {
            registerHandler: (...args: Parameters<ApiSessionClient['rpcHandlerManager']['registerHandler']>) =>
                register(target => target.rpcHandlerManager.registerHandler(...args)),
        },
    } as unknown as ApiSessionClient;

    const handOver = (next: ApiSessionClient) => {
        real = next;
        for (const apply of registrations.splice(0)) apply(next);
    };

    return { session, handOver };
}
