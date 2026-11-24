/**
 * Antigravity Constants
 *
 * Google Antigravity CLI ships as `agy` and speaks ACP with `agy acp`. Its
 * installer puts it in ~/.local/bin, which a daemon started outside a login
 * shell often does not have on PATH. It signs in on its own (`agy`, then
 * "Log in with Google") and keeps its state under ~/.gemini/antigravity-cli.
 */

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';

/** Overrides which Antigravity executable Happy spawns. */
export const ANTIGRAVITY_PATH_ENV = 'HAPPY_ANTIGRAVITY_PATH';

/** Set by the daemon to restore an Antigravity conversation through ACP `session/load`. */
export const ANTIGRAVITY_RESUME_SESSION_ID_ENV = 'HAPPY_ANTIGRAVITY_RESUME_SESSION_ID';

const ANTIGRAVITY_COMMAND = 'agy';

/** Text agy emits (stderr or JSON-RPC error) when it has no credentials. */
const ANTIGRAVITY_AUTH_ERROR_MARKERS = ['Authentication required', 'Not logged in', 'not authenticated', 'auth_required'];

/**
 * Executable to spawn: `HAPPY_ANTIGRAVITY_PATH`, else `agy` on PATH or in ~/.local/bin,
 * falling back to the bare name so the spawn error names it.
 */
export function resolveAntigravityCommand(env: NodeJS.ProcessEnv = process.env): string {
  const override = env[ANTIGRAVITY_PATH_ENV]?.trim();
  if (override) return override;
  const searchDirs = [...(env.PATH ?? '').split(delimiter).filter(Boolean), join(env.HOME?.trim() || homedir(), '.local', 'bin')];
  const dir = searchDirs.find((candidateDir) => existsSync(join(candidateDir, ANTIGRAVITY_COMMAND)));
  return dir ? join(dir, ANTIGRAVITY_COMMAND) : ANTIGRAVITY_COMMAND;
}

export function isAntigravityAuthError(text: string): boolean {
  return ANTIGRAVITY_AUTH_ERROR_MARKERS.some((marker) => text.toLowerCase().includes(marker.toLowerCase()));
}

export function antigravityAuthErrorMessage(command: string): string {
  return `Antigravity CLI is not signed in. Run \`${command}\` in a terminal and sign in, then start the session again.`;
}

export function antigravityNotFoundMessage(command: string): string {
  return `Antigravity CLI (${command}) was not found. Install it, sign in with \`agy\`, then start the session again.`;
}
