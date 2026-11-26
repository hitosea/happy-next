/**
 * Agent CLI updates: the versions of the agent CLIs installed on this machine, checked like the
 * happy CLI's (a few minutes after the daemon starts, about every hour, and when the app asks),
 * and their updates, installed only when the app asks. Reported in `daemonState.agentClis`.
 *
 * Each CLI is updated the way it was installed:
 *
 *   a global npm package (Claude Code, Codex, Gemini CLI)  npm, as the happy CLI is (sudo -n included)
 *   anything else with its own updater                     `claude update`, `qodercli update`, `agy update`
 *   anything else                                          not from here (no manual command either)
 *
 * The latest version comes from npm for the CLIs published there (also for a native Claude Code,
 * whose releases are the same), from `qodercli update --check` for Qoder, and from the release
 * list of Antigravity's site for Antigravity. Claude Code's is that of its release channel
 * (`autoUpdatesChannel` in its settings: the `stable` dist-tag, else `latest`), which an npm
 * install of it also updates to.
 *
 * A failed update is reported until the CLI's version changes or no newer one is left (updated by
 * hand, say). When a lookup fails the next check comes sooner, as the happy CLI's does.
 *
 * An update takes the happy CLI's update lock, so neither restarts the daemon in the middle of the
 * other. It does not restart anything: running sessions keep the version they started with. Once
 * a CLI's version changes, however it happened, its model list is asked for again.
 */

import { existsSync } from 'node:fs';
import { readFile, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, delimiter, isAbsolute, join } from 'node:path';
import axios from 'axios';
import type { ModelListingAgent } from 'happy-wire';
import type { AgentCliStatus } from '@/api/types';
import { readSettings } from '@/persistence';
import { logger } from '@/ui/logger';
import { markAgentModelsStale } from '@/agentModels/listAgentModels';
import { resolveQoderCommand } from '@/qoder/constants';
import { resolveAntigravityCommand } from '@/antigravity/constants';
import { resolveDeepSeekCommand } from '@/deepseek/constants';
import {
    acquireUpdateLock,
    checkAutoUpdateSupport,
    compareVersions,
    detectPackageManager,
    fetchLatestVersion,
    getUpgradeCommand,
    installLatest,
    run,
    type AutoUpdateSupport,
} from '@/update/cliUpdate';

const FIRST_CHECK_MIN_DELAY_MS = 60_000;
const FIRST_CHECK_JITTER_MS = 2 * 60_000;
const CHECK_INTERVAL_MS = 60 * 60_000;
const CHECK_JITTER_MS = 10 * 60_000;
const FAILED_CHECK_RETRY_MS = 30 * 60_000;
const VERSION_TIMEOUT_MS = 20_000;
const CHECK_TIMEOUT_MS = 30_000;
const ANTIGRAVITY_RELEASES_URL = 'https://antigravity.google/assets/data/releases-live.json';
const INSTALL_TIMEOUT_MS = 10 * 60_000;
// How fresh the versions must be when an update is asked for
const UPDATE_MAX_AGE_MS = 10 * 60_000;

const VERSION_PATTERN = /\d+\.\d+\.\d+(?:-[\w.]+)?/g;

type AgentCliSpec = {
    agent: ModelListingAgent;
    /** The executable, when installed */
    locate: () => string | null;
    /** Its npm package: how it is updated when installed with npm */
    npmPackage?: string;
    /** The npm dist-tag it follows (`latest` when not given) */
    npmTag?: () => Promise<string>;
    /** Arguments of its own updater */
    updateArgs?: string[];
    /** Its latest version (the `tag` one, on npm), looked up with the installed `command` at hand; null when that fails */
    latestVersion: (command: string, tag: string) => Promise<string | null>;
};

/** `name` on PATH or in ~/.local/bin, where native installers put their CLIs (often not on a daemon's PATH). */
function findExecutable(name: string): string | null {
    const dirs = [...(process.env.PATH ?? '').split(delimiter).filter(Boolean), join(homedir(), '.local', 'bin')];
    const dir = dirs.find((candidate) => existsSync(join(candidate, name)));
    return dir ? join(dir, name) : null;
}

/** A resolver's answer when it found the executable: it falls back to the bare name otherwise. */
function found(command: string): string | null {
    return isAbsolute(command) && existsSync(command) ? command : null;
}

/** The last version in `output`. */
function lastVersion(output: string): string | null {
    return output.match(VERSION_PATTERN)?.at(-1) ?? null;
}

/** Qoder's own update check prints the latest version last. */
function qoderLatestVersion(command: string): Promise<string | null> {
    return run(command, ['update', '--check'], CHECK_TIMEOUT_MS).then(lastVersion, () => null);
}

/** The newest CLI release on Antigravity's site. */
async function antigravityLatestVersion(): Promise<string | null> {
    try {
        const response = await axios.get(ANTIGRAVITY_RELEASES_URL, { timeout: CHECK_TIMEOUT_MS });
        const releases: { product?: unknown; version?: unknown }[] = Array.isArray(response.data?.releases) ? response.data.releases : [];
        const versions = releases.flatMap((release) => (release.product === 'cli' && typeof release.version === 'string' && /^\d+\.\d+\.\d+/.test(release.version) ? [release.version] : []));
        return versions.reduce<string | null>((latest, version) => (!latest || compareVersions(version, latest) > 0 ? version : latest), null);
    } catch {
        return null;
    }
}

/** Claude Code's release channel as a dist-tag: `stable` when its settings choose it, else `latest`. */
async function claudeChannel(): Promise<string> {
    const settingsPath = join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'settings.json');
    const settings = await readFile(settingsPath, 'utf8').then((text) => JSON.parse(text), () => null);
    return settings?.autoUpdatesChannel === 'stable' ? 'stable' : 'latest';
}

const SPECS: AgentCliSpec[] = [
    { agent: 'claude', locate: () => findExecutable('claude'), npmPackage: '@anthropic-ai/claude-code', npmTag: claudeChannel, updateArgs: ['update'], latestVersion: (_command, tag) => fetchLatestVersion('@anthropic-ai/claude-code', tag) },
    { agent: 'codex', locate: () => findExecutable('codex'), npmPackage: '@openai/codex', latestVersion: () => fetchLatestVersion('@openai/codex') },
    { agent: 'gemini', locate: () => findExecutable('gemini'), npmPackage: '@google/gemini-cli', latestVersion: () => fetchLatestVersion('@google/gemini-cli') },
    { agent: 'qoder', locate: () => found(resolveQoderCommand(process.env, 'intl')), updateArgs: ['update'], latestVersion: qoderLatestVersion },
    { agent: 'qodercn', locate: () => found(resolveQoderCommand(process.env, 'cn')), updateArgs: ['update'], latestVersion: qoderLatestVersion },
    { agent: 'antigravity', locate: () => found(resolveAntigravityCommand()), updateArgs: ['update'], latestVersion: antigravityLatestVersion },
    { agent: 'deepseek', locate: () => found(resolveDeepSeekCommand()), npmPackage: '@deepseek-ai/dsh', latestVersion: () => fetchLatestVersion('@deepseek-ai/dsh') },
];

/** How the daemon updates a CLI, and what to run by hand when that fails or it cannot (when known) */
type Method = (
    | { kind: 'npm'; support: Extract<AutoUpdateSupport, { supported: true }>; packageName: string; tag: string }
    | { kind: 'self'; args: string[] }
    | { kind: 'manual' }
) & { manualCommand?: string };

type InstalledCli = {
    spec: AgentCliSpec;
    command: string;
    version: string | null;
    latestVersion: string | null;
    method: Method;
};

type Phase = { state: 'installing' } | { state: 'failed'; error: string };

export type AgentCliUpdateResult = { status: 'started' | 'up-to-date' | 'busy' | 'unsupported' | 'not-installed' };

async function methodFor(spec: AgentCliSpec, command: string, tag: string, allowSudo: boolean): Promise<Method> {
    const resolved = (await realpath(command).catch(() => command)).replace(/\\/g, '/');
    const marker = spec.npmPackage && `/node_modules/${spec.npmPackage}/`;
    const at = marker ? resolved.indexOf(marker) : -1;
    if (spec.npmPackage && marker && at !== -1) {
        const installDir = resolved.slice(0, at + marker.length - 1);
        const support = await checkAutoUpdateSupport({ allowSudo, installDir, packageName: spec.npmPackage });
        const upgrade = getUpgradeCommand(detectPackageManager(installDir), spec.npmPackage, tag).join(' ');
        const asRoot = support.supported ? support.sudo : support.reason === 'no-permission';
        const manualCommand = asRoot ? `sudo ${upgrade}` : upgrade;
        return support.supported ? { kind: 'npm', support, packageName: spec.npmPackage, tag, manualCommand } : { kind: 'manual', manualCommand };
    }
    return spec.updateArgs
        ? { kind: 'self', args: spec.updateArgs, manualCommand: [basename(command), ...spec.updateArgs].join(' ') }
        : { kind: 'manual' };
}

/** What is installed of `spec`, or null when nothing is. */
async function inspect(spec: AgentCliSpec, allowSudo: boolean): Promise<InstalledCli | null> {
    const command = spec.locate();
    if (!command) return null;
    const tag = (await spec.npmTag?.()) ?? 'latest';
    const [version, latestVersion, method] = await Promise.all([
        run(command, ['--version'], VERSION_TIMEOUT_MS).then((output) => output.match(VERSION_PATTERN)?.[0] ?? null, () => null),
        spec.latestVersion(command, tag),
        methodFor(spec, command, tag, allowSudo),
    ]);
    return { spec, command, version, latestVersion, method };
}

function hasUpdate(cli: InstalledCli): boolean {
    return !!cli.version && !!cli.latestVersion && compareVersions(cli.latestVersion, cli.version) > 0;
}

export function startAgentCliUpdater(options: { reportStatus: (statuses: AgentCliStatus[]) => void }) {
    const installed = new Map<ModelListingAgent, InstalledCli>();
    const phases = new Map<ModelListingAgent, Phase>();
    let checkedAt: number | undefined;
    let inflight: Promise<AgentCliStatus[]> | null = null;
    let busy = false;
    let timer: NodeJS.Timeout | null = null;
    let lastReported = '';

    const statuses = (): AgentCliStatus[] => SPECS.flatMap(({ agent }) => {
        const cli = installed.get(agent);
        if (!cli) return [];
        const phase = phases.get(agent);
        return [{
            agent,
            ...(cli.version ? { version: cli.version } : {}),
            ...(cli.latestVersion ? { latestVersion: cli.latestVersion } : {}),
            updatable: cli.method.kind !== 'manual',
            ...(cli.method.manualCommand ? { manualCommand: cli.method.manualCommand } : {}),
            state: phase?.state ?? 'idle',
            ...(phase?.state === 'failed' ? { error: phase.error } : {}),
        }];
    });

    const publish = () => {
        const current = statuses();
        const serialized = JSON.stringify(current);
        if (serialized === lastReported) return;
        lastReported = serialized;
        logger.debug(`[AGENT CLI UPDATE] ${serialized}`);
        options.reportStatus(current);
    };

    // Recomputed every time: sudo rights and the install locations can change while the daemon runs
    const allowSudo = async () => (await readSettings()).autoUpdateNoSudo !== true;

    /**
     * Takes in what is now installed of `spec`, asking for its models again if its version changed, and
     * dropping a failed update once the version changed or the newest one is known to be installed.
     */
    const record = (spec: AgentCliSpec, cli: InstalledCli | null) => {
        const previous = installed.get(spec.agent);
        const versionChanged = previous?.version !== cli?.version;
        if (previous?.version && versionChanged) markAgentModelsStale(spec.agent);
        if (phases.get(spec.agent)?.state === 'failed' && (versionChanged || !cli || (!!cli.latestVersion && !hasUpdate(cli)))) phases.delete(spec.agent);
        if (cli) installed.set(spec.agent, cli);
        else installed.delete(spec.agent);
    };

    const schedule = (delayMs: number) => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => void check(0), delayMs);
        timer.unref();
    };

    /** Every installed agent CLI, looked up again unless the last lookup is at most `maxAgeMs` old */
    const check = (maxAgeMs: number): Promise<AgentCliStatus[]> => {
        if (checkedAt && Date.now() - checkedAt <= maxAgeMs) return Promise.resolve(statuses());
        let lookupFailed = true;
        inflight ??= allowSudo()
            .then((sudo) => Promise.all(SPECS.map(async (spec) => record(spec, await inspect(spec, sudo)))))
            .then(() => {
                checkedAt = Date.now();
                lookupFailed = [...installed.values()].some((cli) => !cli.latestVersion);
                publish();
                return statuses();
            })
            .finally(() => {
                inflight = null;
                schedule(lookupFailed ? FAILED_CHECK_RETRY_MS : CHECK_INTERVAL_MS + Math.random() * CHECK_JITTER_MS);
            });
        return inflight;
    };

    const install = async (cli: InstalledCli) => {
        try {
            if (cli.method.kind === 'npm') await installLatest(cli.method.support.packageManager, cli.method.support.sudo, cli.method.packageName, cli.method.tag);
            if (cli.method.kind === 'self') await run(cli.command, cli.method.args, INSTALL_TIMEOUT_MS);
            phases.delete(cli.spec.agent);
        } catch (error) {
            phases.set(cli.spec.agent, { state: 'failed', error: error instanceof Error ? error.message : String(error) });
        }
        record(cli.spec, await inspect(cli.spec, await allowSudo()));
        publish();
    };

    // A fresh daemon has nothing in progress: clear whatever the previous one left behind
    publish();
    schedule(FIRST_CHECK_MIN_DELAY_MS + Math.random() * FIRST_CHECK_JITTER_MS);

    return {
        check,
        /**
         * Update `agent`'s CLI now (run even with no newer version known, as its own updater may know
         * one), or with no agent every CLI with a newer version, one after another.
         */
        updateNow: async (agent?: string): Promise<AgentCliUpdateResult> => {
            if (busy) return { status: 'busy' };
            // Claimed before the first await, so a second request sees it
            busy = true;
            let started = false;
            try {
                await check(UPDATE_MAX_AGE_MS);
                const chosen = agent ? [...installed.values()].filter((cli) => cli.spec.agent === agent) : [...installed.values()].filter(hasUpdate);
                if (agent && !chosen.length) return { status: 'not-installed' };
                const targets = chosen.filter((cli) => cli.method.kind !== 'manual');
                if (!targets.length) return { status: chosen.length ? 'unsupported' : 'up-to-date' };
                const release = await acquireUpdateLock();
                if (!release) return { status: 'busy' };
                for (const cli of targets) phases.set(cli.spec.agent, { state: 'installing' });
                publish();
                started = true;
                void (async () => {
                    for (const cli of targets) await install(cli);
                })().finally(async () => {
                    await release();
                    busy = false;
                });
                return { status: 'started' };
            } finally {
                if (!started) busy = false;
            }
        },
        stop: () => {
            if (timer) clearTimeout(timer);
        },
    };
}
