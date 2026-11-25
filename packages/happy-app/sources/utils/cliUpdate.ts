/**
 * What the app shows about a machine's CLI update, derived from what its daemon reports in
 * `daemonState.cliUpdate` (happy-cli/src/daemon/cliUpdater.ts). Only the daemon looks the latest
 * version up, through the machine's own registry; the app compares it with the version the
 * daemon runs. 0.12 daemons report other states (available, up-to-date, ...) with the same
 * `latestVersion`, so they are read the same way.
 *
 * The agent CLIs installed on the machine report theirs in `daemonState.agentClis`
 * (happy-cli/src/daemon/agentCliUpdater.ts). The indicators beside the session list's "+", in the
 * machine switcher and in settings show both at once (`getMachineUpdates`).
 */
import type { AgentCliStatus, Machine } from '@/sync/storageTypes';
import { isAgentChoice, type AgentChoice } from '@/utils/agentChoice';
import { storage } from '@/sync/storage';
import { machineCheckCliUpdate } from '@/sync/ops';
import { compareVersions } from '@/utils/versionUtils';

export type MachineCliUpdate =
    | { state: 'none' }
    | { state: 'available'; version: string }
    | { state: 'installing'; version: string }
    | { state: 'failed'; version: string; error: string };

const NONE: MachineCliUpdate = { state: 'none' };

/** An agent CLI's update: a newer version, an install running, or one that failed. */
export type AgentCliUpdate =
    | { agent: AgentChoice; state: 'available'; version: string }
    | { agent: AgentChoice; state: 'installing' }
    | { agent: AgentChoice; state: 'failed'; error: string };

/**
 * A machine's updates as one indicator: the most pressing state of the CLI's and the agent CLIs'
 * (a failure, then an install running, then a newer version), with each of them.
 */
export type MachineUpdates = {
    state: 'none' | 'available' | 'installing' | 'failed';
    cli: MachineCliUpdate;
    agents: AgentCliUpdate[];
};

/** Whether an agent CLI has a newer version that can be installed, by the daemon or by hand. */
export function agentCliHasUpdate(cli: AgentCliStatus): boolean {
    return !!cli.version && !!cli.latestVersion && compareVersions(cli.latestVersion, cli.version) > 0
        && (!!cli.updatable || !!cli.manualCommand);
}

// How old the daemon's last lookup may be when the app asks for one in passing
export const CLI_UPDATE_CHECK_MAX_AGE_MS = 10 * 60_000;
// The app asks a machine at most this often in passing; the daemon decides whether to look it up
const PASSING_CHECK_THROTTLE_MS = 60_000;

export function getMachineCliUpdate(machine: Machine | null | undefined): MachineCliUpdate {
    const running = machine?.metadata?.happyCliVersion;
    const status = machine?.daemonState?.cliUpdate;
    const version = status?.targetVersion ?? status?.latestVersion;
    if (!machine || !running || !status || !version || compareVersions(version, running) <= 0) {
        return NONE;
    }
    // Kept while the machine is offline: the daemon goes away to restart on the new version
    if (status.state === 'installing') {
        return { state: 'installing', version };
    }
    if (!machine.active) {
        return NONE;
    }
    if (status.state === 'failed') {
        return { state: 'failed', version, error: status.error ?? '' };
    }
    return { state: 'available', version };
}

/** The agent CLIs of an online machine with an update, in the daemon's order. */
export function getMachineAgentCliUpdates(machine: Machine | null | undefined): AgentCliUpdate[] {
    if (!machine?.active) return [];
    return (machine.daemonState?.agentClis ?? []).flatMap((cli): AgentCliUpdate[] => {
        const agent = cli.agent;
        if (!isAgentChoice(agent)) return [];
        if (cli.state === 'installing') return [{ agent, state: 'installing' }];
        if (cli.state === 'failed') return [{ agent, state: 'failed', error: cli.error ?? '' }];
        return agentCliHasUpdate(cli) ? [{ agent, state: 'available', version: cli.latestVersion! }] : [];
    });
}

const PRESSING_FIRST = ['failed', 'installing', 'available'] as const;


export function getMachineUpdates(machine: Machine | null | undefined): MachineUpdates {
    const cli = getMachineCliUpdate(machine);
    const agents = getMachineAgentCliUpdates(machine);
    const states: string[] = [cli.state, ...agents.map((update) => update.state)];
    return { state: PRESSING_FIRST.find((state) => states.includes(state)) ?? 'none', cli, agents };
}

/**
 * The CLI version a session can be restarted on: the one its machine's daemon now runs, when that
 * is newer than the version the session was started with. Null otherwise.
 */
export function getSessionCliUpgrade(sessionVersion: string | undefined, machine: Machine | null | undefined): string | null {
    const daemonVersion = machine?.metadata?.happyCliVersion;
    if (!sessionVersion || !daemonVersion) return null;
    return compareVersions(daemonVersion, sessionVersion) > 0 ? daemonVersion : null;
}

const lastPassingCheck = new Map<string, number>();

/** Ask a machine's daemon to look up the latest CLI if its last lookup is over 10 minutes old. */
export function requestCliUpdateCheck(machineId: string) {
    const machine = storage.getState().machines[machineId];
    const last = lastPassingCheck.get(machineId) ?? 0;
    if (!machine?.active || Date.now() - last < PASSING_CHECK_THROTTLE_MS) return;
    lastPassingCheck.set(machineId, Date.now());
    machineCheckCliUpdate(machineId, CLI_UPDATE_CHECK_MAX_AGE_MS).catch(() => {
        // The daemon checks hourly by itself anyway
    });
}

/**
 * Follow an install started from the app until the daemon runs the new version or reports a
 * failure. Gives up after a while: an install that never finishes is then left to the UI.
 */
export function watchCliInstall(machineId: string, version: string, onDone: (result: 'installed' | 'failed') => void) {
    let unsubscribe: (() => void) | null = null;
    const finish = (result: 'installed' | 'failed' | null) => {
        unsubscribe?.();
        unsubscribe = null;
        clearTimeout(timeout);
        if (result) onDone(result);
    };
    // A failure from an earlier attempt may still be in the state until this one is reported
    let sawInstalling = false;
    const evaluate = () => {
        const machine = storage.getState().machines[machineId];
        const running = machine?.metadata?.happyCliVersion;
        const state = getMachineCliUpdate(machine).state;
        sawInstalling ||= state === 'installing';
        if (running && compareVersions(running, version) >= 0) {
            finish('installed');
        } else if (sawInstalling && state === 'failed') {
            finish('failed');
        }
    };
    const timeout = setTimeout(() => finish(null), 15 * 60_000);
    unsubscribe = storage.subscribe(evaluate);
    return () => finish(null);
}
