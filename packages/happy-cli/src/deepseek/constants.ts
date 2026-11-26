/**
 * DeepSeek Harness CLI Constants
 *
 * DeepSeek Harness ships on npm as `@deepseek-ai/dsh` (executable `dsh`) and speaks
 * standard ACP v1 via `dsh --profile acp`, plus one-shot NDJSON via `dsh --profile headless --json`.
 * Users often install it globally under ~/.local/bin (without sudo) or on PATH, and authenticate
 * via `DEEPSEEK_API_KEY` or `$DSH_HOME/.credentials.yaml` (`dsh web`).
 */

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';

/** Overrides which DeepSeek Harness (`dsh`) executable Happy spawns. */
export const DEEPSEEK_PATH_ENV = 'HAPPY_DEEPSEEK_PATH';

/** Set by the daemon to restore a DeepSeek Harness conversation through ACP `session/resume`. */
export const DEEPSEEK_RESUME_SESSION_ID_ENV = 'HAPPY_DEEPSEEK_RESUME_SESSION_ID';

const DEEPSEEK_COMMAND = process.platform === 'win32' ? 'dsh.cmd' : 'dsh';
const DEEPSEEK_DISPLAY_COMMAND = 'dsh';

const ANSI_ESCAPE_REGEX = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;

/** Text dsh emits (stderr or JSON-RPC error) when DeepSeek credentials are missing or invalid. */
const DEEPSEEK_AUTH_ERROR_MARKERS = [
  'no api key for provider route',
  'missing_credential',
  'invalid api key',
  'authentication required',
  'not authenticated',
];

/**
 * Executable to spawn: `HAPPY_DEEPSEEK_PATH`, else `dsh` on PATH or in ~/.local/bin,
 * falling back to the bare name so the spawn error names it.
 */
export function resolveDeepSeekCommand(env: NodeJS.ProcessEnv = process.env): string {
  const override = env[DEEPSEEK_PATH_ENV]?.trim();
  if (override) return override;
  const home = env.HOME?.trim() || homedir();
  const searchDirs = [...(env.PATH ?? '').split(delimiter).filter(Boolean), join(home, '.local', 'bin')];
  const candidates = process.platform === 'win32' ? ['dsh.cmd', 'dsh.exe', 'dsh'] : [DEEPSEEK_COMMAND];
  for (const candidateDir of searchDirs) {
    for (const candidateName of candidates) {
      const fullPath = join(candidateDir, candidateName);
      if (existsSync(fullPath)) return fullPath;
    }
  }
  return DEEPSEEK_DISPLAY_COMMAND;
}

/** Resolves DeepSeek Harness's home directory (`$DSH_HOME`, defaulting to `~/.dsh`). */
export function resolveDeepSeekHome(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.DSH_HOME?.trim();
  if (explicit) return explicit;
  return join(env.HOME?.trim() || homedir(), '.dsh');
}

export function isDeepSeekAuthError(text: string): boolean {
  const lower = text.toLowerCase();
  return DEEPSEEK_AUTH_ERROR_MARKERS.some((marker) => lower.includes(marker));
}

/** Strips ANSI control sequences and redacts `DEEPSEEK_API_KEY` before surfacing errors to chat. */
export function sanitizeDeepSeekErrorText(text: string, env: NodeJS.ProcessEnv = process.env): string {
  let clean = text.replace(ANSI_ESCAPE_REGEX, '');
  const apiKey = env.DEEPSEEK_API_KEY?.trim();
  if (apiKey && apiKey.length >= 6) {
    clean = clean.split(apiKey).join('[REDACTED]');
  }
  return clean.trim();
}

export function deepSeekAuthErrorMessage(): string {
  return 'DeepSeek API key is missing or invalid. Export `DEEPSEEK_API_KEY` in the daemon environment or save a key via `dsh web`, then try again.';
}

export function deepSeekNotFoundMessage(command: string): string {
  return `DeepSeek Harness CLI (${command}) was not found. Install it with \`npm install -g @deepseek-ai/dsh\`, configure \`DEEPSEEK_API_KEY\` or \`dsh web\`, then start the session again.`;
}
