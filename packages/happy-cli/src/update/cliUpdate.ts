/**
 * Shared CLI upgrade primitives, used by `happy update`, the daemon's CLI updater and, for the agent
 * CLIs installed with npm (Claude Code, Codex, Gemini CLI), the agent CLI updater. Each takes the
 * package, happy-next-cli by default.
 */

import { execFile } from 'node:child_process';
import { constants, realpathSync } from 'node:fs';
import { access, mkdir, open, readFile, rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import axios from 'axios';
import { configuration } from '@/configuration';
import { projectPath } from '@/projectPath';

export const PACKAGE_NAME = 'happy-next-cli';

export type PackageManager = 'npm' | 'pnpm' | 'yarn';

const DEFAULT_REGISTRY = 'https://registry.npmjs.org/';
const VIEW_TIMEOUT_MS = 30_000;
const FETCH_TIMEOUT_MS = 15_000;
const INSTALL_TIMEOUT_MS = 10 * 60_000;
// A lock older than this belongs to an install that died without cleaning up
const STALE_LOCK_MS = 15 * 60_000;

// The end of a command's output, from the start of a line: where the package manager says what went
// wrong, short enough to report in the daemon state
const MAX_ERROR_LENGTH = 4000;

function tail(output: string): string {
    if (output.length <= MAX_ERROR_LENGTH) return output;
    const end = output.slice(-MAX_ERROR_LENGTH);
    const lineStart = end.indexOf('\n');
    return lineStart === -1 ? end : end.slice(lineStart + 1);
}

export function run(command: string, args: string[], timeout: number): Promise<string> {
    return new Promise((resolve, reject) => {
        execFile(command, args, {
            // npm refuses some commands (e.g. `config get`) inside a workspace
            cwd: homedir(),
            encoding: 'utf-8',
            timeout,
            maxBuffer: 10 * 1024 * 1024,
            shell: process.platform === 'win32',
        }, (error, stdout, stderr) => {
            if (error) {
                const output = `${stderr || ''}${stdout || ''}`.trim();
                reject(new Error(output ? tail(output) : error.message));
                return;
            }
            resolve(stdout.trim());
        });
    });
}

/** Real path of the installed package root (follows the global bin/link symlinks). */
export function installedPackageDir(): string {
    try {
        return realpathSync(projectPath());
    } catch {
        return projectPath();
    }
}

export function detectPackageManager(installDir: string = installedPackageDir()): PackageManager {
    const normalized = installDir.replace(/\\/g, '/');
    if (normalized.includes('/pnpm/') || normalized.includes('/pnpm-global/') || normalized.includes('/.pnpm/')) {
        return 'pnpm';
    }
    if (normalized.includes('/.yarn/') || normalized.includes('/yarn/')) {
        return 'yarn';
    }
    return 'npm';
}

export function getUpgradeCommand(pm: PackageManager, packageName: string = PACKAGE_NAME, tag = 'latest'): string[] {
    switch (pm) {
        case 'pnpm':
            return ['pnpm', 'add', '-g', `${packageName}@${tag}`];
        case 'yarn':
            return ['yarn', 'global', 'add', `${packageName}@${tag}`];
        case 'npm':
            return ['npm', 'install', '-g', `${packageName}@${tag}`];
    }
}

// The registry from the user's npm config (mirrors included), looked up once per process
let registryUrl: Promise<string> | null = null;

function getRegistryUrl(): Promise<string> {
    registryUrl ??= run('npm', ['config', 'get', 'registry'], VIEW_TIMEOUT_MS)
        .then((url) => /^https?:\/\//.test(url) ? url : DEFAULT_REGISTRY)
        .catch(() => DEFAULT_REGISTRY);
    return registryUrl;
}

/**
 * Latest published version (of the `tag` dist-tag), as seen through the user's registry. Asks the
 * registry for that manifest alone (a few KB, no subprocess); falls
 * back to `npm view` for registries that need npm's auth or proxy settings.
 */
export async function fetchLatestVersion(packageName: string = PACKAGE_NAME, tag = 'latest'): Promise<string | null> {
    try {
        const response = await axios.get(`${(await getRegistryUrl()).replace(/\/+$/, '')}/${packageName}/${tag}`, { timeout: FETCH_TIMEOUT_MS });
        if (isVersion(response.data?.version)) return response.data.version;
    } catch {
        // Fall through to npm itself
    }
    try {
        const version = await run('npm', ['view', `${packageName}@${tag}`, 'version'], VIEW_TIMEOUT_MS);
        return isVersion(version) ? version : null;
    } catch {
        return null;
    }
}

function isVersion(value: unknown): value is string {
    return typeof value === 'string' && /^\d+\.\d+\.\d+/.test(value);
}

/** Version of the package currently on disk (changes as soon as an install lands). */
export async function readInstalledVersion(): Promise<string | null> {
    try {
        const packageJson = JSON.parse(await readFile(join(projectPath(), 'package.json'), 'utf-8'));
        return typeof packageJson.version === 'string' ? packageJson.version : null;
    } catch {
        return null;
    }
}

/**
 * Compare two versions: -1, 0 or 1. A pre-release sorts before its release
 * (0.12.0-1 < 0.12.0); pre-release identifiers are compared as plain strings.
 */
export function compareVersions(a: string, b: string): number {
    const [aMain, aPre] = a.split('-', 2);
    const [bMain, bPre] = b.split('-', 2);
    const aParts = aMain.split('.').map(Number);
    const bParts = bMain.split('.').map(Number);
    for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
        const diff = (aParts[i] || 0) - (bParts[i] || 0);
        if (diff !== 0) return diff > 0 ? 1 : -1;
    }
    if (aPre === bPre) return 0;
    if (aPre === undefined) return 1;
    if (bPre === undefined) return -1;
    return aPre > bPre ? 1 : -1;
}

export type AutoUpdateSupport =
    | { supported: true; packageManager: PackageManager; sudo: boolean }
    | { supported: false; reason: 'not-global-install' | 'no-permission' };

/** Whether the current user can write the global directory a package (the CLI by default) is installed in. */
export async function canWriteInstallDir(installDir: string = installedPackageDir()): Promise<boolean> {
    try {
        await access(dirname(installDir), constants.W_OK);
        return true;
    } catch {
        return false;
    }
}

/**
 * Whether an installation (the CLI's by default) can be upgraded without a human: it must be a
 * global install (not a source checkout, `yarn link` or npx cache) whose directory the current
 * user can write to, or, for npm, reach through sudo without a password (such a user can already
 * do anything root can).
 */
export async function checkAutoUpdateSupport(options: {
    allowSudo: boolean;
    installDir?: string;
    packageName?: string;
}): Promise<AutoUpdateSupport> {
    const { installDir = installedPackageDir(), packageName = PACKAGE_NAME } = options;
    const normalized = installDir.replace(/\\/g, '/');
    if (!normalized.endsWith(`/node_modules/${packageName}`) || normalized.includes('/_npx/')) {
        return { supported: false, reason: 'not-global-install' };
    }
    // node_modules itself: a scoped package sits one level deeper
    const modulesDir = packageName.split('/').reduce((dir) => dirname(dir), installDir);

    const packageManager = detectPackageManager(installDir);
    if (packageManager === 'npm') {
        // Rule out a project-local install that happens to be on PATH
        try {
            const globalRoot = realpathSync(await run('npm', ['root', '-g'], VIEW_TIMEOUT_MS));
            if (realpathSync(modulesDir) !== globalRoot) {
                return { supported: false, reason: 'not-global-install' };
            }
        } catch {
            return { supported: false, reason: 'not-global-install' };
        }
    }

    if (await canWriteInstallDir(installDir)) {
        return { supported: true, packageManager, sudo: false };
    }
    const sudo = options.allowSudo && packageManager === 'npm' && process.platform !== 'win32'
        && await run('sudo', ['-n', 'true'], VIEW_TIMEOUT_MS).then(() => true, () => false);
    return sudo ? { supported: true, packageManager, sudo } : { supported: false, reason: 'no-permission' };
}

/**
 * The global upgrade command. With `sudo` (npm only) it runs as root, and since
 * sudo resets PATH and HOME it carries over the user's PATH (same node and npm),
 * npm config, registry and global prefix, so it installs over the same copy.
 * `no-prompt` makes sudo fail instead of asking for a password.
 */
export async function getInstallCommand(pm: PackageManager, sudo?: 'prompt' | 'no-prompt', packageName: string = PACKAGE_NAME, tag = 'latest'): Promise<string[]> {
    const command = getUpgradeCommand(pm, packageName, tag);
    if (!sudo || pm !== 'npm') return command;
    const [prefix, userconfig, registry] = await Promise.all([
        run('npm', ['config', 'get', 'prefix'], VIEW_TIMEOUT_MS),
        run('npm', ['config', 'get', 'userconfig'], VIEW_TIMEOUT_MS),
        getRegistryUrl(),
    ]);
    return [
        'sudo', ...(sudo === 'no-prompt' ? ['-n'] : []), 'env', `PATH=${process.env.PATH ?? ''}`,
        ...command, '--prefix', prefix, '--userconfig', userconfig, '--registry', registry,
    ];
}

/** Run the global upgrade unattended. Throws with the tail of the package manager's output on failure. */
export async function installLatest(pm: PackageManager, sudo: boolean, packageName: string = PACKAGE_NAME, tag = 'latest'): Promise<void> {
    const [command, ...args] = await getInstallCommand(pm, sudo ? 'no-prompt' : undefined, packageName, tag);
    await run(command, args, INSTALL_TIMEOUT_MS);
}

/**
 * Take the cross-process upgrade lock, so `happy update` and the daemon never
 * install at the same time. Returns a release function, or null when another
 * live upgrade holds the lock.
 */
export async function acquireUpdateLock(): Promise<(() => Promise<void>) | null> {
    const path = join(configuration.happyHomeDir, 'update.lock');
    await mkdir(configuration.happyHomeDir, { recursive: true });
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const handle = await open(path, 'wx');
            await handle.writeFile(String(process.pid));
            await handle.close();
            return async () => {
                await rm(path, { force: true });
            };
        } catch (error: any) {
            if (error?.code !== 'EEXIST') {
                return null;
            }
            if (!(await isLockStale(path))) {
                return null;
            }
            await rm(path, { force: true });
        }
    }
    return null;
}

async function isLockStale(path: string): Promise<boolean> {
    try {
        const [content, info] = await Promise.all([readFile(path, 'utf-8'), stat(path)]);
        if (Date.now() - info.mtimeMs > STALE_LOCK_MS) return true;
        const pid = Number(content.trim());
        if (!Number.isInteger(pid) || pid <= 0) return true;
        process.kill(pid, 0);
        return false;
    } catch (error: any) {
        // ESRCH: the holder is gone. EPERM: it is alive under another user.
        return error?.code !== 'EPERM';
    }
}
