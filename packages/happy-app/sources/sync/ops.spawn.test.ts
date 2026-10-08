import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ machineSpawnHTTP: vi.fn() }));
vi.mock('./apiSocket', () => ({ apiSocket: mocks }));
vi.mock('./sync', () => ({ sync: {} }));
vi.mock('./storage', () => ({ storage: {} }));
import { machineSpawnNewSession } from './ops';
import { getBuiltInProfile } from './profileUtils';
import { getSessionProfileEnvironment, shouldInheritMachineConfig } from '@/utils/sessionProfile';

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


describe('spawn machine configuration inheritance', () => {
    it.each([true, false])('passes the explicit inheritance choice (%s) alongside GitHub variables', async inheritMachineConfig => {
        mocks.machineSpawnHTTP.mockResolvedValue({ type: 'success', sessionId: 'session-1' });
        const environmentVariables = { GITHUB_PERSONAL_ACCESS_TOKEN: 'github-token' };
        await machineSpawnNewSession({ ...options, inheritMachineConfig, environmentVariables });
        expect(mocks.machineSpawnHTTP).toHaveBeenLastCalledWith(options.machineId, expect.objectContaining({
            inheritMachineConfig,
            environmentVariables,
        }));
    });
});


describe('GitHub session creation with the existing profile selector', () => {
    it.each(['claude', 'codex', 'gemini'] as const)('decides inheritance before adding GitHub variables for %s', async agent => {
        const profileEnvironment = getSessionProfileEnvironment(getBuiltInProfile('deepseek')!, agent);
        mocks.machineSpawnHTTP.mockResolvedValue({ type: 'success', sessionId: 'session-1' });
        await machineSpawnNewSession({
            ...options, agent,
            inheritMachineConfig: shouldInheritMachineConfig(profileEnvironment),
            environmentVariables: { ...profileEnvironment, GITHUB_PERSONAL_ACCESS_TOKEN: 'github-token' },
        });
        expect(mocks.machineSpawnHTTP).toHaveBeenLastCalledWith(options.machineId, expect.objectContaining({
            inheritMachineConfig: agent !== 'claude',
            environmentVariables: expect.objectContaining({ GITHUB_PERSONAL_ACCESS_TOKEN: 'github-token' }),
        }));
        const request = mocks.machineSpawnHTTP.mock.lastCall![1];
        if (agent !== 'claude') expect(request.environmentVariables).toEqual({ GITHUB_PERSONAL_ACCESS_TOKEN: 'github-token' });
    });
});
