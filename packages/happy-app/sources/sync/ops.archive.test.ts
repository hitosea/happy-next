import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getState: vi.fn(), sessionRPC: vi.fn(), machineRPC: vi.fn(), request: vi.fn(),
    emitWithAck: vi.fn(), encryptRaw: vi.fn(), decryptRaw: vi.fn(), getSessionEncryption: vi.fn() }));
vi.mock('./apiSocket', () => ({ apiSocket: mocks }));
vi.mock('./sync', () => ({ sync: { encryption: { getSessionEncryption: mocks.getSessionEncryption } } }));
vi.mock('./storage', () => ({ storage: { getState: mocks.getState } }));
import { sessionArchive, sessionKill, machineForkCodexSession, machineDuplicateCodexSession } from './ops';
import { getSessionQuickActionKinds } from '@/components/sessionQuickActions';
import { canArchiveSession, canEditSession, canForkSession } from '@/utils/sessionLifecycle';
import type { Session } from './storageTypes';

describe('stop-based archive with Codex native synchronization', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        mocks.getState.mockReturnValue({ sessions: { s1: { metadataVersion: 4, metadata: { flavor: 'codex', machineId: 'm1', codexSessionId: 'native-1', lifecycleState: 'running' } } } });
        mocks.sessionRPC.mockResolvedValue({ success: true });
        mocks.machineRPC.mockResolvedValue({ success: true, stopped: true });
        mocks.getSessionEncryption.mockReturnValue({ encryptRaw: mocks.encryptRaw, decryptRaw: mocks.decryptRaw });
        mocks.encryptRaw.mockImplementation(async value => JSON.stringify(value));
        mocks.decryptRaw.mockImplementation(async value => JSON.parse(value));
        mocks.emitWithAck.mockResolvedValue({ result: 'success', version: 5 });
    });

    it('stops first, then archives through the machine without a server archive endpoint', async () => {
        expect(await sessionArchive('s1')).toEqual({ success: true });
        expect(mocks.sessionRPC).toHaveBeenCalledWith('s1', 'killSession', {});
        expect(mocks.machineRPC).toHaveBeenCalledWith('m1', 'codex-archive-session', { sessionId: 's1', nativeSessionId: 'native-1' }, 120_000);
        expect(mocks.sessionRPC.mock.invocationCallOrder[0]).toBeLessThan(mocks.machineRPC.mock.invocationCallOrder[0]);
        expect(mocks.request).not.toHaveBeenCalled();
    });

    it.each(['claude', 'gemini'])('keeps the existing %s archive behavior', async flavor => {
        mocks.getState.mockReturnValue({ sessions: { s1: { metadata: { flavor } } } });
        expect(await sessionArchive('s1')).toEqual({ success: true });
        expect(mocks.machineRPC).not.toHaveBeenCalled();
    });

    it('does not add native side effects to ordinary stop operations', async () => {
        await sessionKill('s1');
        expect(mocks.machineRPC).not.toHaveBeenCalled();
    });

    it('can retry native archive after the session RPC has exited', async () => {
        mocks.sessionRPC.mockRejectedValue(new Error('RPC method not available'));
        expect(await sessionArchive('s1')).toEqual({ success: true });
        expect(mocks.machineRPC).toHaveBeenCalledOnce();
        const current = mocks.getState().sessions.s1 as Session;
        expect(mocks.emitWithAck).toHaveBeenCalledWith('update-metadata', {
            sid: 's1', expectedVersion: 4,
            metadata: JSON.stringify({ ...current.metadata, lifecycleState: 'archived' }),
        });
        expect(mocks.machineRPC.mock.invocationCallOrder[0]).toBeLessThan(mocks.emitWithAck.mock.invocationCallOrder[0]);
        // Apply the persisted metadata as received through session synchronization.
        current.metadata = await mocks.decryptRaw(mocks.emitWithAck.mock.calls[0][1].metadata);
        expect(canEditSession(current)).toBe(false);
        expect(canForkSession(current)).toBe(false);
    });

    it('retries lifecycle persistence without overwriting concurrent metadata changes', async () => {
        const latest = { ...mocks.getState().sessions.s1.metadata, name: 'updated elsewhere' };
        mocks.emitWithAck.mockResolvedValueOnce({ result: 'version-mismatch', version: 6, metadata: JSON.stringify(latest) });
        expect(await sessionArchive('s1')).toEqual({ success: true });
        expect(mocks.emitWithAck).toHaveBeenLastCalledWith('update-metadata', {
            sid: 's1', expectedVersion: 6, metadata: JSON.stringify({ ...latest, lifecycleState: 'archived' }),
        });
    });

    it.each([true, false])('preserves the confirmed stop on metadata failure with session RPC success %s', async success => {
        mocks.sessionRPC.mockResolvedValue({ success, message: 'RPC method not available' });
        mocks.emitWithAck.mockRejectedValue(new Error('Disconnected'));
        expect(await sessionArchive('s1')).toEqual({ success: true, nativeArchiveError: 'archive-metadata-update-failed: Disconnected' });
    });

    it.each([true, false])('preserves the confirmed target stop when another session uses its native thread (session RPC success %s)', async success => {
        mocks.sessionRPC.mockResolvedValue({ success, message: 'RPC method not available' });
        mocks.machineRPC.mockResolvedValue({ success: false, stopped: true, error: 'native-session-in-use' });
        expect(await sessionArchive('s1')).toEqual({ success: true, nativeArchiveError: 'native-session-in-use' });
        expect(mocks.emitWithAck).not.toHaveBeenCalled();
    });

    it('does not archive after an unacknowledged stop failure', async () => {
        mocks.sessionRPC.mockRejectedValue(new Error('Disconnected'));
        expect(await sessionArchive('s1')).toEqual({ success: false, message: 'Disconnected' });
        expect(mocks.machineRPC).not.toHaveBeenCalled();
    });

    it.each(['session-identity-unavailable', 'session-provider-mismatch', 'native-session-id-unavailable'])('keeps an acknowledged stop when native archive reports %s', async error => {
        mocks.machineRPC.mockResolvedValue({ success: false, stopped: false, error });
        expect(await sessionArchive('s1')).toEqual({ success: true, nativeArchiveError: error });
    });

    it.each(['session-identity-unavailable', 'session-provider-mismatch', 'native-session-id-unavailable'])('requires stop confirmation when native archive reports %s', async error => {
        mocks.sessionRPC.mockRejectedValue(new Error('RPC method not available'));
        mocks.machineRPC.mockResolvedValue({ success: false, stopped: false, error });
        expect(await sessionArchive('s1')).toEqual({ success: false, message: error });
    });

    it.each([true, false])('preserves daemon stop rejection when session stop success is %s', async success => {
        mocks.sessionRPC.mockResolvedValue({ success, message: 'RPC method not available' });
        for (const error of ['native-session-in-use', 'stop-not-confirmed', 'stop-failed', 'process-verification-unsupported', 'unknown-error']) {
            mocks.machineRPC.mockResolvedValue({ success: false, stopped: false, error });
            expect(await sessionArchive('s1')).toEqual({ success: false, message: error });
        }
    });

    it.each(['daemon offline', 'RPC timeout', 'RPC method not available'])('fails without stop confirmation when daemon reports %s', async message => {
        mocks.sessionRPC.mockRejectedValue(new Error('RPC method not available'));
        mocks.machineRPC.mockRejectedValue(new Error(message));
        expect(await sessionArchive('s1')).toEqual({ success: false, message: message === 'RPC method not available' ? 'daemon-rpc-unavailable' : message });
    });

    it('does not infer stop confirmation from a legacy daemon response', async () => {
        mocks.sessionRPC.mockRejectedValue(new Error('RPC method not available'));
        mocks.machineRPC.mockResolvedValue({ success: true });
        expect(await sessionArchive('s1')).toEqual({ success: false, message: 'stop-not-confirmed' });
    });

    it('warns on native failure when only the daemon confirmed the stop', async () => {
        mocks.sessionRPC.mockRejectedValue(new Error('RPC method not available'));
        mocks.machineRPC.mockResolvedValue({ success: false, stopped: true, error: 'native-archive-failed' });
        expect(await sessionArchive('s1')).toEqual({ success: true, nativeArchiveError: 'native-archive-failed' });
    });

    it('reports native failure separately without rolling back the stop', async () => {
        mocks.machineRPC.mockResolvedValue({ success: false, stopped: true, error: 'native-archive-failed' });
        expect(await sessionArchive('s1')).toEqual({ success: true, nativeArchiveError: 'native-archive-failed' });
    });

    it.each(['daemon offline', 'RPC timeout'])('keeps the details retry usable after %s while hiding archive in the list', async error => {
        const current = mocks.getState().sessions.s1 as Session;
        current.active = true;
        mocks.machineRPC.mockRejectedValueOnce(new Error(error));
        expect(await sessionArchive('s1')).toEqual({ success: true, nativeArchiveError: error });

        current.active = false;
        current.metadata!.lifecycleState = 'archived';
        expect(canArchiveSession(current, false)).toBe(true);
        expect(getSessionQuickActionKinds({ session: current, isConnected: false, isLocalMachine: false })).not.toContain('archiveSession');

        mocks.sessionRPC.mockRejectedValue(new Error('RPC method not available'));
        expect(await sessionArchive('s1')).toEqual({ success: true });
        expect(current.active).toBe(false);
        expect(mocks.machineRPC).toHaveBeenCalledTimes(2);
        for (const call of mocks.machineRPC.mock.calls) {
            expect(call[1]).toBe('codex-archive-session');
        }
    });

    it('does not swallow an unavailable daemon RPC as native success', async () => {
        mocks.machineRPC.mockRejectedValue(new Error('RPC method not available'));
        expect(await sessionArchive('s1')).toEqual({ success: true, nativeArchiveError: 'RPC method not available' });
    });

    it('reports a missing machine after stopping', async () => {
        mocks.getState.mockReturnValue({ sessions: { s1: { metadata: { flavor: 'codex' } } } });
        expect(await sessionArchive('s1')).toEqual({ success: true, nativeArchiveError: 'machine-id-unavailable' });
        expect(mocks.machineRPC).not.toHaveBeenCalled();
    });

    it('allows native restore to finish within the resume RPC timeout', async () => {
        await machineForkCodexSession('m1', 'native-1', { restoreArchived: true });
        expect(mocks.machineRPC).toHaveBeenCalledWith('m1', 'codex-fork-session', { codexSessionId: 'native-1', restoreArchived: true }, 120000);
    });

    it('does not request restoration for ordinary forks', async () => {
        await machineForkCodexSession('m1', 'native-1');
        expect(mocks.machineRPC).toHaveBeenCalledWith('m1', 'codex-fork-session', { codexSessionId: 'native-1', restoreArchived: undefined }, 120000);
    });

    it('passes caller timeouts through to the duplicate RPC', async () => {
        await machineDuplicateCodexSession('m1', 'native-1', 'message-1', { timeoutMs: 45000 });
        expect(mocks.machineRPC).toHaveBeenCalledWith('m1', 'codex-duplicate-session', { codexSessionId: 'native-1', truncateBeforeUuid: 'message-1' }, 45000);
    });
});
