/**
 * Qoder Constants
 *
 * Environment variable names, distribution identity and defaults for the Qoder CLI
 * integration. Mirrors src/gemini/constants.ts.
 *
 * THERE ARE TWO DISTRIBUTIONS OF THE SAME CLI, not two products:
 *
 *   international  command `qoder`     npm @qoder-ai/qodercli      config ~/.qoder
 *   china (CN)     command `qodercn`   npm @qodercn-ai/qoderclicn  config ~/.qoder-cn
 *
 * They share one codebase — the shipped bundle contains `QODERCN_CONFIG_DIR_NAME":
 * "QODER_CONFIG_DIR_NAME"`, `configDirName ?? ".qoder"`, `.qoder-cn`, and
 * `@qodercn-ai/qoderclicn` — and both speak the same ACP surface, so Happy models this as
 * ONE agent flavor with two candidate executables. Signing in is per distribution: a
 * Qoder CN desktop account does not authenticate the international CLI, so picking the
 * wrong binary looks exactly like "not logged in".
 */

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';

import { logger } from '@/ui/logger';


/** Env var that overrides which Qoder executable Happy spawns. */
export const QODER_PATH_ENV = 'HAPPY_QODER_PATH';

/** Env var that seeds the model tier for a new Qoder session (mirrors GEMINI_MODEL). */
export const QODER_MODEL_ENV = 'HAPPY_QODER_MODEL';

/** Env var the daemon sets to resume through the CLI's own ACP `session/load`. */
export const QODER_RESUME_SESSION_ID_ENV = 'HAPPY_QODER_RESUME_SESSION_ID';

/** International distribution. */
export const QODER_INTL_COMMAND = 'qoder';
export const QODER_INTL_NPM_PACKAGE = '@qoder-ai/qodercli';

/** China (CN) distribution. */
export const QODER_CN_COMMAND = 'qodercn';
export const QODER_CN_NPM_PACKAGE = '@qodercn-ai/qoderclicn';

/** @deprecated Use the per-distribution constants. Kept for the install-hint fallback. */
export const QODER_NPM_PACKAGE = QODER_INTL_NPM_PACKAGE;

/** Flag that puts either distribution into Agent Client Protocol server mode. */
export const QODER_ACP_FLAG = '--acp';

/**
 * Qoder's own runtime marker.
 *
 * When a process is launched from inside the Qoder desktop app (either edition) or the
 * Qoder Agent SDK, `QODER_AGENT_SDK_ENTRYPOINT` is present in the inherited environment.
 * Qoder then switches into "Agent SDK" mode and rejects any invocation that is not
 * exactly `--print --input-format stream-json --output-format stream-json`, so
 * `qoder --acp` dies before it speaks a single protocol byte:
 *
 *   sdk_invalid_args: Agent SDK entrypoint env is set but required flags are missing
 *
 * Verified empirically: the check tests truthiness of this one variable, so overriding
 * it with an empty string restores normal CLI behaviour. There is no `QODERCN_`-prefixed
 * counterpart in the bundle, so this list covers both distributions. AcpBackend spawns
 * with `{ ...process.env, ...options.env }`, which can only override (never delete),
 * hence empty strings rather than deletion.
 */
export const QODER_SDK_ENTRYPOINT_ENV = 'QODER_AGENT_SDK_ENTRYPOINT';

/** Companion variables the same launcher injects alongside the entrypoint marker. */
export const QODER_SDK_ISOLATION_VARS = [
  QODER_SDK_ENTRYPOINT_ENV,
  'QODER_AGENT_SDK_VERSION',
  'QODER_SDK_AUTH_PAYLOAD_FILE',
  'QODER_WORKER_RUNTIME_ASSET_ROOT',
  'QODERCLI_RUNTIME_PACKAGING',
] as const;

/**
 * Config-location variables that must survive isolation, for both editions.
 *
 * Clearing these would move the CLI off the credentials it needs: on a Qoder CN machine
 * QODERCN_CONFIG_DIR/~/.qoder-cn is exactly where its login lives. Happy therefore never
 * touches them; users who want a separate config dir pass `--config-dir` themselves.
 */
export const QODER_CONFIG_DIR_VARS = [
  'QODER_CONFIG_DIR',
  'QODERCN_CONFIG_DIR',
] as const;

/** Signals that this machine is a Qoder CN host rather than the international one. */
export const QODER_CN_PRODUCT_ID = 'qoder-cn';
export const QODER_CN_ENV_MARKERS = ['QODERCN_CONFIG_DIR', 'QODERCN_CLI'] as const;

/**
 * Env entries that neutralise an inherited Qoder Agent SDK launch context.
 * Spread into every Qoder spawn (ACP backend and one-shot alike).
 */
export function qoderSdkIsolationEnv(): Record<string, string> {
  return Object.fromEntries(QODER_SDK_ISOLATION_VARS.map(name => [name, '']));
}

/** True when the host looks like Qoder CN (desktop app or CLI CN launcher). */
export function isQoderCnHost(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.QODER_PRODUCT_ID?.trim().toLowerCase() === QODER_CN_PRODUCT_ID) return true;
  return QODER_CN_ENV_MARKERS.some(name => !!env[name]?.trim());
}

/**
 * Executables to try, preferred edition first.
 *
 * Ordering matters more than it looks: the two editions authenticate independently, so
 * driving the international binary on a CN machine yields "Authentication required" even
 * though the user is plainly logged in to Qoder.
 */
export function qoderCommandCandidates(env: NodeJS.ProcessEnv = process.env): string[] {
  return isQoderCnHost(env)
    ? [QODER_CN_COMMAND, QODER_INTL_COMMAND]
    : [QODER_INTL_COMMAND, QODER_CN_COMMAND];
}

/** npm package that matches the preferred edition, for install hints. */
export function qoderNpmPackageForHost(env: NodeJS.ProcessEnv = process.env): string {
  return isQoderCnHost(env) ? QODER_CN_NPM_PACKAGE : QODER_INTL_NPM_PACKAGE;
}

/**
 * How the user signs in, in their own words.
 *
 * Neither edition has a documented dedicated login subcommand on CN (`qodercn` guides
 * you through login on first run); the international build prints `qodercli login`.
 */
export function qoderLoginHint(command?: string, env: NodeJS.ProcessEnv = process.env): string {
  // A named command wins over the host guess: callers resolve the executable they are
  // actually about to spawn, and on a CN host that may still be the international build.
  const cn = command === QODER_CN_COMMAND
    ? true
    : command === QODER_INTL_COMMAND
      ? false
      : isQoderCnHost(env);
  return cn
    ? `run \`${QODER_CN_COMMAND}\` in a terminal and complete the first-run sign-in`
    : `run \`${QODER_INTL_COMMAND}\` (or \`qodercli login\`) in a terminal and sign in`;
}

/**
 * Which Qoder executable to spawn: `HAPPY_QODER_PATH` wins, else the preferred
 * distribution that is actually on PATH, else the preferred one (so the error message
 * can name what we tried). Not memoised — it is called a few times per session and tests
 * vary PATH to exercise both distributions.
 */
export function resolveQoderCommand(env: NodeJS.ProcessEnv = process.env): string {
  const override = env[QODER_PATH_ENV]?.trim();
  if (override) return override;

  const candidates = qoderCommandCandidates(env);
  const foundOnPath = candidates.find(name => isQoderExecutableOnPath(name, env));
  if (foundOnPath) {
    if (foundOnPath !== candidates[0]) {
      // The other edition is installed but the host says otherwise; say so, because the
      // two sign in independently and this is the usual cause of a phantom "not logged in".
      logger.debug(`[Qoder] Preferred \`${candidates[0]}\` not found on PATH; using \`${foundOnPath}\`.`);
    }
    return foundOnPath;
  }
  const foundDefault = candidates.map(name => qoderExecutablePath(name, env)).find((path): path is string => path !== null);
  if (foundDefault) return foundDefault;
  return candidates[0];
}

function isQoderExecutableOnPath(name: string, env: NodeJS.ProcessEnv): boolean {
  const searchPath = env.PATH ?? '';
  return searchPath
    .split(delimiter)
    .filter(Boolean)
    .some(dir => existsSync(join(dir, name)));
}

function qoderExecutablePath(name: string, env: NodeJS.ProcessEnv): string | null {
  const home = env.HOME?.trim() || homedir();
  const defaultPath = name === QODER_CN_COMMAND
    ? join(home, '.qoder-cn', 'entry', QODER_CN_COMMAND)
    : name === QODER_INTL_COMMAND
      ? join(home, '.qoder', 'entry', QODER_INTL_COMMAND)
      : null;
  return defaultPath !== null && existsSync(defaultPath) ? defaultPath : null;
}

/** Error text Qoder emits when no credentials exist (stderr and JSON-RPC -32000). */
export const QODER_AUTH_ERROR_MARKERS = [
  'Authentication required',
  'Not logged in',
  'qodercli login',
] as const;

export function isQoderAuthError(text: string | null | undefined): boolean {
  if (!text) return false;
  return QODER_AUTH_ERROR_MARKERS.some(marker => text.includes(marker));
}

/**
 * The one user-facing sentence for "not signed in", shared by the transport (stderr) and
 * the runner (RPC rejection) so the same failure cannot be described two ways.
 *
 * Pass the executable actually being spawned: on a Qoder CN host the international binary
 * is signed out even when the user is plainly logged in to the desktop app.
 */
export function qoderAuthErrorMessage(command?: string): string {
  return [
    'Qoder CLI is not signed in.',
    `To authenticate, ${qoderLoginHint(command)}, then start the session again.`,
    'Note: the international (`qoder`) and China (`qodercn`) builds sign in separately.',
  ].join(' ');
}
