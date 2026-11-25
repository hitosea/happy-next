import { describe, expect, it, vi } from 'vitest';
import { fillMachineModelModes, modelModesFromListing } from './machineModelModes';

const listing = {
    success: true,
    models: [
        { code: 'auto', value: 'Auto' },
        { code: 'performance', value: 'Performance', efforts: [{ code: 'low', value: 'Low' }, { code: 'high', value: 'High' }] },
    ],
};
const listedModes = ['default', 'auto', 'performance', 'performance:low', 'performance:high'];

describe('modelModesFromListing', () => {
    it('lists default, each model and each model:effort', () => {
        expect(modelModesFromListing(listing)).toEqual(listedModes);
    });

    it('returns null for a failed or empty listing', () => {
        expect(modelModesFromListing({ success: false, errorMessage: 'no' })).toBeNull();
        expect(modelModesFromListing({ success: true, models: [] })).toBeNull();
        expect(modelModesFromListing(null)).toBeNull();
    });
});

describe('fillMachineModelModes', () => {
    it('asks only online machines, and only for the providers they have', async () => {
        const call = vi.fn().mockImplementation(async (_method: string, params: { agent: string }) => params.agent === 'qoder' ? listing : { success: false });
        const machines = [
            { machineId: 'a', online: true, providers: ['claude', 'qoder'], modelModes: { claude: ['default'], qoder: ['default'] } },
            { machineId: 'b', online: true, providers: ['claude'], modelModes: { claude: ['default'] } },
            { machineId: 'c', online: false, providers: ['qoder'], modelModes: { qoder: ['default'] } },
        ];

        const filled = await fillMachineModelModes(machines, call);

        expect(call.mock.calls.map(([method, params]) => `${method} ${params.agent}`).sort())
            .toEqual(['a:agent-list-models claude', 'a:agent-list-models qoder', 'b:agent-list-models claude']);
        expect(filled[0].modelModes).toEqual({ claude: ['default'], qoder: listedModes });
        expect(filled[1]).toBe(machines[1]);
        expect(filled[2]).toBe(machines[2]);
    });

    it('asks every agent the same way', async () => {
        const call = vi.fn().mockResolvedValue(listing);
        const providers = ['claude', 'codex', 'gemini', 'qoder', 'qodercn', 'antigravity'];
        const [filled] = await fillMachineModelModes([{ machineId: 'a', online: true, providers, modelModes: {} }], call);

        expect(filled.modelModes).toEqual(Object.fromEntries(providers.map((provider) => [provider, listedModes])));
    });

    it('keeps what the server sent when the daemon does not answer', async () => {
        const call = vi.fn().mockRejectedValue(new Error('RPC method not available'));
        const machine = { machineId: 'a', online: true, providers: ['qoder'], modelModes: { qoder: ['default'] } };

        expect(await fillMachineModelModes([machine], call)).toEqual([machine]);
    });
});
