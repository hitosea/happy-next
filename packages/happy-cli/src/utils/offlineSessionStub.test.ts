import { describe, expect, it, vi } from 'vitest';
import type { ApiSessionClient } from '@/api/apiSession';
import { createOfflineSessionStub } from './offlineSessionStub';

function fakeRealSession() {
    return {
        onUserMessage: vi.fn(),
        onPendingSteer: vi.fn(),
        onArchived: vi.fn(),
        rpcHandlerManager: { registerHandler: vi.fn() },
    };
}

describe('createOfflineSessionStub', () => {
    it('passes what was registered offline to the real session', () => {
        const offline = createOfflineSessionStub('tag');
        const onMessage = vi.fn();
        const onSteer = vi.fn();
        const onArchived = vi.fn();
        const abort = vi.fn();
        const kill = vi.fn();
        offline.session.onUserMessage(onMessage);
        offline.session.onPendingSteer(onSteer);
        offline.session.onArchived(onArchived);
        offline.session.rpcHandlerManager.registerHandler('abort', abort);
        offline.session.rpcHandlerManager.registerHandler('killSession', kill);

        const real = fakeRealSession();
        offline.handOver(real as unknown as ApiSessionClient);

        expect(real.onUserMessage).toHaveBeenCalledWith(onMessage);
        expect(real.onPendingSteer).toHaveBeenCalledWith(onSteer);
        expect(real.onArchived).toHaveBeenCalledWith(onArchived);
        expect(real.rpcHandlerManager.registerHandler).toHaveBeenCalledWith('abort', abort);
        expect(real.rpcHandlerManager.registerHandler).toHaveBeenCalledWith('killSession', kill);
    });

    it('forwards what is registered on it after the hand-over, once each', () => {
        const offline = createOfflineSessionStub('tag');
        const early = vi.fn();
        offline.session.rpcHandlerManager.registerHandler('abort', early);
        const real = fakeRealSession();
        offline.handOver(real as unknown as ApiSessionClient);

        const late = vi.fn();
        offline.session.rpcHandlerManager.registerHandler('permission-mode-changed', late);
        expect(real.rpcHandlerManager.registerHandler).toHaveBeenCalledTimes(2);
        expect(real.rpcHandlerManager.registerHandler).toHaveBeenLastCalledWith('permission-mode-changed', late);
    });

    it('sends nothing while offline', () => {
        const offline = createOfflineSessionStub('tag');
        expect(offline.session.sessionId).toBe('offline-tag');
        expect(() => offline.session.sendSessionDeath()).not.toThrow();
    });
});
