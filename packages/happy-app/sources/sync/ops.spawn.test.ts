import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ machineSpawnHTTP: vi.fn() }));
vi.mock('./apiSocket', () => ({ apiSocket: mocks }));
vi.mock('./sync', () => ({ sync: {} }));
vi.mock('./storage', () => ({ storage: {} }));
import { machineSpawnNewSession } from './ops';

const options = { machineId: 'machine-1', directory: '/repo', agent: 'codex' as const };
const reason = 'ANTHROPIC_AUTH_TOKEN references ${DEEPSEEK_AUTH_TOKEN} which is not defined';

describe('spawn response handling', () => {
    beforeEach(() => vi.resetAllMocks());

    it.each([{ error: reason }, { type: 'error', errorMessage: reason }])('preserves daemon failures in either response format', async response => {
        mocks.machineSpawnHTTP.mockResolvedValue(response);
        expect(await machineSpawnNewSession(options)).toEqual({ type: 'error', errorMessage: reason });
    });

    it('preserves HTTP transport errors', async () => {
        mocks.machineSpawnHTTP.mockRejectedValue(new Error('RPC method not available'));
        expect(await machineSpawnNewSession(options)).toEqual({ type: 'error', errorMessage: 'RPC method not available' });
    });

    it('returns a readable timeout for aborted HTTP requests', async () => {
        mocks.machineSpawnHTTP.mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        expect(await machineSpawnNewSession(options)).toEqual({ type: 'error', errorMessage: 'Session startup timed out.' });
    });

    it.each([{ type: 'success', sessionId: 'session-1' }, { type: 'requestToApproveDirectoryCreation', directory: '/repo' }])('preserves successful and directory approval responses', async response => {
        mocks.machineSpawnHTTP.mockResolvedValue(response);
        expect(await machineSpawnNewSession(options)).toEqual(response);
    });
});

describe('spawn environment variables', () => {
    it('passes GitHub variables through to the daemon', async () => {
        mocks.machineSpawnHTTP.mockResolvedValue({ type: 'success', sessionId: 'session-1' });
        const environmentVariables = { GITHUB_PERSONAL_ACCESS_TOKEN: 'github-token' };
        await machineSpawnNewSession({ ...options, environmentVariables });
        expect(mocks.machineSpawnHTTP).toHaveBeenLastCalledWith(options.machineId, expect.objectContaining({ environmentVariables }));
    });
});
