/**
 * Codex runtime resolution
 *
 * Happy runs the `codex` installed on the machine, whatever its version. Without one it falls
 * back to the latest Codex through `npx`. HAPPY_CODEX_PACKAGE can pin an exact version instead
 * (`@openai/codex@x.y.z`): then a local binary is only used when it is that version.
 */

import { execSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { logger } from '@/ui/logger';

export interface CodexRuntime {
  command: string;
  args: string[];
}

const DEFAULT_INITIALIZE_TIMEOUT_MS = 5 * 60_000;

/**
 * The `initialize` handshake doubles as the cold-start budget: it is the first request a
 * freshly spawned Codex answers, and a cold `npx` fetch of Codex can take
 * minutes on a slow machine.
 */
const configuredInitializeTimeout = Number(process.env.HAPPY_CODEX_INIT_TIMEOUT_MS);
export const CODEX_INITIALIZE_TIMEOUT_MS = Number.isFinite(configuredInitializeTimeout) && configuredInitializeTimeout > 0
  ? configuredInitializeTimeout
  : DEFAULT_INITIALIZE_TIMEOUT_MS;

const EXACT_VERSION_SPEC = /^(@?[^@/]+(?:\/[^@]+)?)@(\d+\.\d+\.\d+(?:-[\w.]+)?)$/;
const CODEX_VERSION_OUTPUT = /\b(\d+\.\d+\.\d+(?:-[\w.]+)?)\b/;

let cachedLocalVersion: string | null | undefined;

/** Version pinned by a package spec, or null when it is a range/dist-tag we cannot match. */
export function codexPackageVersion(packageSpec: string): string | null {
  return packageSpec.match(EXACT_VERSION_SPEC)?.[2] ?? null;
}

/** Version of the `codex` on PATH, or null when there is none. */
export function localCodexVersion(): string | null {
  if (cachedLocalVersion !== undefined) return cachedLocalVersion;
  cachedLocalVersion = null;
  // Windows installs are `.cmd` shims, which spawn() refuses without a shell.
  if (process.platform !== 'win32') {
    try {
      const output = execSync('codex --version', {
        encoding: 'utf-8',
        timeout: 5_000,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      cachedLocalVersion = output.match(CODEX_VERSION_OUTPUT)?.[1] ?? null;
    } catch {
      // No local Codex — it comes from npx instead.
    }
  }
  return cachedLocalVersion;
}

/**
 * The local binary runs unless the spec pins an exact version it is not; without a local
 * binary an unpinned spec runs the latest release through npx.
 */
export function pickCodexRuntime(packageSpec: string, args: readonly string[], localVersion: string | null): CodexRuntime {
  const pinnedVersion = codexPackageVersion(packageSpec);
  if (localVersion !== null && (pinnedVersion === null || pinnedVersion === localVersion)) {
    return { command: 'codex', args: [...args] };
  }
  return { command: 'npx', args: ['-y', pinnedVersion === null ? latestSpec(packageSpec) : packageSpec, ...args] };
}

/** `@openai/codex` → `@openai/codex@latest`; a spec that names a tag or range keeps it. */
function latestSpec(packageSpec: string): string {
  return /^@?[^@]+$/.test(packageSpec) ? `${packageSpec}@latest` : packageSpec;
}

export function resolveCodexRuntime(packageSpec: string, args: readonly string[]): CodexRuntime {
  const runtime = pickCodexRuntime(packageSpec, args, localCodexVersion());
  logger.debug(`[Codex] Runtime for ${packageSpec}: ${runtime.command} ${runtime.args.join(' ')}`);
  return runtime;
}

/**
 * Pins the `fast_mode` feature on or off for one Codex process. Codex inherits a `service_tier`
 * persisted in the user's config.toml (e.g. by `/fast`), so leaving the feature alone would run
 * a session fast although fast mode was never asked for; disabling it overrides that tier.
 * Asking for fast still needs the tier itself (`serviceTier` on thread start, `-c service_tier`
 * for `codex exec`) — this only decides whether Codex may honour it.
 */
export function codexFastModeArgs(fast: boolean): string[] {
  return fast ? ['--enable', 'fast_mode'] : ['--disable', 'fast_mode'];
}

/** Whether Codex can start without a download: a usable local binary, or a fitting npx cache entry. */
export function isCodexRuntimeWarm(packageSpec: string): boolean {
  if (pickCodexRuntime(packageSpec, [], localCodexVersion()).command === 'codex') return true;
  return isVersionInNpxCache(codexPackageVersion(packageSpec));
}

/** Whether the npx cache holds Codex `version`, or any Codex at all when `version` is null. */
function isVersionInNpxCache(version: string | null): boolean {
  const cacheRoot = join(process.env.npm_config_cache ?? join(homedir(), '.npm'), '_npx');
  try {
    return readdirSync(cacheRoot, { withFileTypes: true }).some((entry) => {
      if (!entry.isDirectory()) return false;
      const cached = readCachedCodexVersion(join(cacheRoot, entry.name));
      return cached !== null && (version === null || cached === version);
    });
  } catch {
    return false; // No npx cache on this machine
  }
}

function readCachedCodexVersion(npxDir: string): string | null {
  try {
    const manifest = JSON.parse(readFileSync(join(npxDir, 'node_modules', '@openai', 'codex', 'package.json'), 'utf-8'));
    return typeof manifest.version === 'string' ? manifest.version : null;
  } catch {
    return null; // Half-installed entries have no manifest yet
  }
}
