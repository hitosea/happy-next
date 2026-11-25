import { describe, it, expect, vi } from 'vitest';
import type { Machine } from '@/sync/storageTypes';

vi.mock('@/sync/storage', () => ({ storage: { getState: () => ({ machines: {} }), subscribe: () => () => {} } }));
vi.mock('@/sync/ops', () => ({ machineCheckCliUpdate: vi.fn() }));
vi.mock('@/text', () => ({ t: (key: string) => key }));

import { getMachineCliUpdate, getMachineUpdates, getSessionCliUpgrade } from './cliUpdate';

function machine(running: string, cliUpdate: Record<string, unknown> | undefined, active = true, agentClis?: Record<string, unknown>[]): Machine {
    return {
        id: 'm1',
        active,
        metadata: { happyCliVersion: running },
        daemonState: { status: 'running', cliUpdate, agentClis },
    } as unknown as Machine;
}

describe('getMachineCliUpdate', () => {
    it('offers a newer published version', () => {
        expect(getMachineCliUpdate(machine('0.12.0', { state: 'idle', latestVersion: '0.13.0' }))).toEqual({ state: 'available', version: '0.13.0' });
        expect(getMachineCliUpdate(machine('0.13.0', { state: 'idle', latestVersion: '0.13.0' }))).toEqual({ state: 'none' });
    });

    it('reads what 0.12 daemons report the same way', () => {
        expect(getMachineCliUpdate(machine('0.12.0', { state: 'available', waitingFor: 'sessions', latestVersion: '0.13.0' }))).toEqual({ state: 'available', version: '0.13.0' });
        expect(getMachineCliUpdate(machine('0.12.0', { state: 'up-to-date', latestVersion: '0.12.0' }))).toEqual({ state: 'none' });
    });

    it('keeps an install shown while the daemon restarts offline, and drops it once the new version runs', () => {
        expect(getMachineCliUpdate(machine('0.12.0', { state: 'installing', targetVersion: '0.13.0' }, false))).toEqual({ state: 'installing', version: '0.13.0' });
        expect(getMachineCliUpdate(machine('0.13.0', { state: 'installing', targetVersion: '0.13.0' }))).toEqual({ state: 'none' });
    });

    it('reports a failed install with its error, only while the machine is online', () => {
        const failed = { state: 'failed', targetVersion: '0.13.0', error: 'EACCES' };
        expect(getMachineCliUpdate(machine('0.12.0', failed))).toEqual({ state: 'failed', version: '0.13.0', error: 'EACCES' });
        expect(getMachineCliUpdate(machine('0.12.0', failed, false))).toEqual({ state: 'none' });
    });

    it('says nothing for daemons that report no update state', () => {
        expect(getMachineCliUpdate(machine('0.11.0', undefined))).toEqual({ state: 'none' });
        expect(getMachineCliUpdate(null)).toEqual({ state: 'none' });
    });
});

describe('getSessionCliUpgrade', () => {
    it('is the daemon version when it is newer than the session', () => {
        expect(getSessionCliUpgrade('0.12.0', machine('0.13.0', undefined))).toBe('0.13.0');
        expect(getSessionCliUpgrade('0.13.0', machine('0.13.0', undefined))).toBeNull();
        expect(getSessionCliUpgrade(undefined, machine('0.13.0', undefined))).toBeNull();
    });
});

describe('getMachineUpdates', () => {
    const upToDate = { state: 'idle', latestVersion: '0.13.0' };

    it('offers an agent CLI with a newer version that the daemon or a command can install', () => {
        const updates = getMachineUpdates(machine('0.13.0', upToDate, true, [
            { agent: 'codex', version: '0.167.1', latestVersion: '0.172.0', updatable: true, state: 'idle' },
            { agent: 'gemini', version: '0.71.0', latestVersion: '0.71.1', updatable: false, manualCommand: 'sudo npm install -g @google/gemini-cli@latest', state: 'idle' },
            { agent: 'qoder', version: '1.1.97', latestVersion: '1.1.97', updatable: true, state: 'idle' },
            { agent: 'claude', version: '2.1.300', latestVersion: '2.1.332', updatable: false, state: 'idle' },
        ]));
        expect(updates.state).toBe('available');
        expect(updates.agents).toEqual([
            { agent: 'codex', state: 'available', version: '0.172.0' },
            { agent: 'gemini', state: 'available', version: '0.71.1' },
        ]);
    });

    it('shows the most pressing state of the CLI and the agent CLIs', () => {
        const agents = [
            { agent: 'codex', state: 'installing' },
            { agent: 'qoder', state: 'failed', error: 'timeout' },
        ];
        expect(getMachineUpdates(machine('0.12.0', upToDate, true, agents)).state).toBe('failed');
        expect(getMachineUpdates(machine('0.12.0', upToDate, true, agents.slice(0, 1))).state).toBe('installing');
        expect(getMachineUpdates(machine('0.12.0', upToDate, true, [])).state).toBe('available');
        expect(getMachineUpdates(machine('0.13.0', upToDate, true, [])).state).toBe('none');
    });

    it('ignores the agent CLIs of an offline machine and agents the app does not know', () => {
        const agents = [{ agent: 'codex', state: 'failed', error: 'x' }, { agent: 'opencode', version: '1.0.0', latestVersion: '2.0.0', updatable: true, state: 'idle' }];
        expect(getMachineUpdates(machine('0.13.0', upToDate, false, agents)).agents).toEqual([]);
        expect(getMachineUpdates(machine('0.13.0', upToDate, true, agents.slice(1))).agents).toEqual([]);
    });
});
