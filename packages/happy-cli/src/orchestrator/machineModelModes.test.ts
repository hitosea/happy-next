import { describe, expect, it, vi } from 'vitest';
import { fillMachineModelModes, qoderModelModesFromListing } from './machineModelModes';

const listing = {
    success: true,
    models: [
        { code: 'auto', name: 'Auto' },
        { code: 'performance', name: 'Performance', efforts: [{ code: 'low', value: 'Low' }, { code: 'high', value: 'High' }] },
    ],
};

describe('qoderModelModesFromListing', () => {
    it('lists default, each model and each model:effort', () => {
        expect(qoderModelModesFromListing(listing)).toEqual(['default', 'auto', 'performance', 'performance:low', 'performance:high']);
    });

    it('returns null for a failed listing', () => {
        expect(qoderModelModesFromListing({ success: false, errorMessage: 'no' })).toBeNull();
        expect(qoderModelModesFromListing(null)).toBeNull();
    });
});

describe('fillMachineModelModes', () => {
    it('asks only online machines, and only for the providers they have', async () => {
        const call = vi.fn().mockImplementation(async (method: string) => method.endsWith(':qoder-list-models') ? listing : { success: false });
        const machines = [
            { machineId: 'a', online: true, providers: ['claude', 'qoder'], modelModes: { claude: ['default'], qoder: ['default'] } },
            { machineId: 'b', online: true, providers: ['claude'], modelModes: { claude: ['default'] } },
            { machineId: 'c', online: false, providers: ['qoder'], modelModes: { qoder: ['default'] } },
        ];

        const filled = await fillMachineModelModes(machines, call);

        expect(call.mock.calls.map(([method]) => method).sort()).toEqual(['a:agent-list-models', 'a:qoder-list-models', 'b:agent-list-models']);
        expect(call).toHaveBeenCalledWith('a:qoder-list-models', { build: 'intl' }, expect.any(Number));
        expect(filled[0].modelModes).toEqual({ claude: ['default'], qoder: ['default', 'auto', 'performance', 'performance:low', 'performance:high'] });
        expect(filled[1]).toBe(machines[1]);
        expect(filled[2]).toBe(machines[2]);
    });

    it('asks Claude, Codex and Gemini for the models their CLIs list', async () => {
        const call = vi.fn().mockImplementation(async (_method: string, params: { agent: string }) => ({
            success: true,
            agent: params.agent,
            version: '1.0.0',
            models: [{ id: `${params.agent}-m`, label: 'M', efforts: params.agent === 'gemini' ? [] : ['high'] }],
        }));
        const machine = { machineId: 'a', online: true, providers: ['claude', 'codex', 'gemini'], modelModes: {} };

        const [filled] = await fillMachineModelModes([machine], call);

        expect(filled.modelModes).toEqual({
            claude: ['default', 'claude-m', 'claude-m-high'],
            codex: ['default', 'codex-m-high'],
            gemini: ['default', 'gemini-m'],
        });
    });

    it('asks each Qoder build its own models', async () => {
        const call = vi.fn().mockResolvedValue(listing);
        const machine = { machineId: 'a', online: true, providers: ['qoder', 'qodercn'], modelModes: { qoder: ['default'], qodercn: ['default'] } };

        const [filled] = await fillMachineModelModes([machine], call);

        expect(call).toHaveBeenCalledWith('a:qoder-list-models', { build: 'intl' }, expect.any(Number));
        expect(call).toHaveBeenCalledWith('a:qoder-list-models', { build: 'cn' }, expect.any(Number));
        expect(filled.modelModes.qodercn).toEqual(['default', 'auto', 'performance', 'performance:low', 'performance:high']);
    });

    it('asks Antigravity through its own listing', async () => {
        const call = vi.fn().mockResolvedValue(listing);
        const machine = { machineId: 'a', online: true, providers: ['antigravity'], modelModes: { antigravity: ['default'] } };

        const [filled] = await fillMachineModelModes([machine], call);

        expect(call).toHaveBeenCalledWith('a:antigravity-list-models', {}, expect.any(Number));
        expect(filled.modelModes.antigravity).toEqual(['default', 'auto', 'performance', 'performance:low', 'performance:high']);
    });

    it('keeps what the server sent when the daemon does not answer', async () => {
        const call = vi.fn().mockRejectedValue(new Error('RPC method not available'));
        const machine = { machineId: 'a', online: true, providers: ['qoder'], modelModes: { qoder: ['default'] } };

        expect(await fillMachineModelModes([machine], call)).toEqual([machine]);
    });
});
