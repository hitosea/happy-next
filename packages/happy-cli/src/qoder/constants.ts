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
 */

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';

/** Overrides which Qoder executable Happy spawns. */
export const QODER_PATH_ENV = 'HAPPY_QODER_PATH';

/** Set by the daemon to restore a Qoder conversation through ACP `session/load`. */
export const QODER_RESUME_SESSION_ID_ENV = 'HAPPY_QODER_RESUME_SESSION_ID';

const QODER_INTL_COMMAND = 'qodercli';
const QODER_CN_COMMAND = 'qoderclicn';

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
 * Executable to spawn: `HAPPY_QODER_PATH`, else the preferred build found on PATH or
 * in ~/.local/bin, else the preferred build's bare name so the spawn error names it.
 */
export function resolveQoderCommand(env: NodeJS.ProcessEnv = process.env): string {
  const override = env[QODER_PATH_ENV]?.trim();
  if (override) return override;

  const candidates = isQoderCnHost(env) ? [QODER_CN_COMMAND, QODER_INTL_COMMAND] : [QODER_INTL_COMMAND, QODER_CN_COMMAND];
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
  return `Qoder CLI is not signed in. Run \`${command} login\` in a terminal, then start the session again. The international (qodercli) and China (qoderclicn) builds sign in separately.`;
}
