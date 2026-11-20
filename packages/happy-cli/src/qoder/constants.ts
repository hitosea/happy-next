/**
 * Qoder Constants
 *
 * Qoder ships two builds of the same CLI that sign in separately:
 *
 *   international  `qodercli`    install: curl -fsSL https://qoder.com/install | bash
 *   China          `qoderclicn`  install: curl -fsSL https://qoder.com.cn/install | bash
 *
 * Both speak ACP with `--acp`. The installers put the entry point in ~/.local/bin,
 * which a daemon started outside a login shell often does not have on PATH.
 *
 * To users they are two products, Qoder and Qoder CN, and a machine may have both:
 * a session names its build, and everything it touches (the executable, its config
 * directory, the account's models) follows that build.
 */

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, delimiter, join } from 'node:path';

/** Overrides which Qoder executable Happy spawns. */
export const QODER_PATH_ENV = 'HAPPY_QODER_PATH';

/** Set by the daemon on a session the app started on a chosen build (`intl` or `cn`). */
export const QODER_BUILD_ENV = 'HAPPY_QODER_BUILD';

/** Set by the daemon to restore a Qoder conversation through ACP `session/load`. */
export const QODER_RESUME_SESSION_ID_ENV = 'HAPPY_QODER_RESUME_SESSION_ID';

export type QoderBuild = 'intl' | 'cn';

const QODER_COMMANDS: Record<QoderBuild, string> = { intl: 'qodercli', cn: 'qoderclicn' };

/** Each build's name in Happy's own files and logs (`qoder-models.json`, `qoder-cn-models.json`, ...). */
export const QODER_SLUGS: Record<QoderBuild, string> = { intl: 'qoder', cn: 'qoder-cn' };

/** Where a build keeps its sign-in, conversations and caches: `$QODER_CONFIG_DIR` / `$QODERCN_CONFIG_DIR`, else `~/.qoder` / `~/.qoder-cn`. */
export function qoderConfigDir(build: QoderBuild, env: NodeJS.ProcessEnv = process.env): string {
  return (build === 'cn' ? env.QODERCN_CONFIG_DIR : env.QODER_CONFIG_DIR) || join(homedir(), `.${QODER_SLUGS[build]}`);
}

/** `value` as a build, or undefined when it names none (absent, or from an unknown client). */
export function parseQoderBuild(value: unknown): QoderBuild | undefined {
  return value === 'intl' || value === 'cn' ? value : undefined;
}

/** The build an executable belongs to; a custom `HAPPY_QODER_PATH` counts as international unless named like the China build. */
export function qoderBuildOf(command: string): QoderBuild {
  return basename(command) === QODER_COMMANDS.cn ? 'cn' : 'intl';
}

/**
 * A Qoder desktop app or Agent SDK launch exports these. With the entrypoint set,
 * qodercli only accepts SDK stream-json flags and exits on `--acp` with
 * `sdk_invalid_args`. Spawn env can only override, so they are blanked.
 */
export const QODER_SDK_ISOLATION_ENV: Record<string, string> = {
  QODER_AGENT_SDK_ENTRYPOINT: '',
  QODER_AGENT_SDK_VERSION: '',
  QODER_SDK_AUTH_PAYLOAD_FILE: '',
  QODER_WORKER_RUNTIME_ASSET_ROOT: '',
  QODERCLI_RUNTIME_PACKAGING: '',
};

/** Text qodercli emits (stderr or JSON-RPC error) when it has no credentials. */
const QODER_AUTH_ERROR_MARKERS = ['Authentication required', 'Not logged in', 'qodercli login'];

/** True on a Qoder CN machine, where the China build should win over the international one. */
function isQoderCnHost(env: NodeJS.ProcessEnv): boolean {
  return env.QODER_PRODUCT_ID?.trim().toLowerCase() === 'qoder-cn' || !!env.QODERCN_CONFIG_DIR?.trim() || !!env.QODERCN_CLI?.trim();
}

/**
 * Executable to spawn. A chosen build (`build`, else `HAPPY_QODER_BUILD`) is that build
 * only. Without one: `HAPPY_QODER_PATH`, else the preferred build. Either way it is looked
 * for on PATH and in ~/.local/bin, falling back to the bare name so the spawn error names it.
 */
export function resolveQoderCommand(env: NodeJS.ProcessEnv = process.env, build = parseQoderBuild(env[QODER_BUILD_ENV])): string {
  const override = env[QODER_PATH_ENV]?.trim();
  if (override && !build) return override;

  const preferred: QoderBuild[] = isQoderCnHost(env) ? ['cn', 'intl'] : ['intl', 'cn'];
  const candidates = (build ? [build] : preferred).map((candidate) => QODER_COMMANDS[candidate]);
  const searchDirs = [...(env.PATH ?? '').split(delimiter).filter(Boolean), join(env.HOME?.trim() || homedir(), '.local', 'bin')];
  for (const name of candidates) {
    const dir = searchDirs.find((candidateDir) => existsSync(join(candidateDir, name)));
    if (dir) return join(dir, name);
  }
  return candidates[0];
}

export function isQoderAuthError(text: string): boolean {
  return QODER_AUTH_ERROR_MARKERS.some((marker) => text.includes(marker));
}

export function qoderAuthErrorMessage(command: string): string {
  return `Qoder CLI is not signed in. Run \`${command} login\` in a terminal, then start the session again. Qoder (qodercli) and Qoder CN (qoderclicn) sign in separately.`;
}
