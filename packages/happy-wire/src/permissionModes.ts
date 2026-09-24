import * as z from 'zod';

export const CLAUDE_PERMISSION_MODES = [
  'default',
  'acceptEdits',
  'plan',
  'auto',
  'bypassPermissions',
] as const;

export const CODEX_PERMISSION_MODES = [
  'default',
  'read-only',
  'on-failure',
  'full-auto',
] as const;

export const GEMINI_PERMISSION_MODES = [
  'default',
  'auto_edit',
  'plan',
  'yolo',
] as const;

/**
 * Qoder has TWO approval-mode vocabularies and they do not share spellings:
 *
 *   CLI flag `--permission-mode`  default | plan | auto | accept_edits | bypass_permissions | dont_ask
 *   ACP mode id (`session/set_mode`)  default | acceptEdits | auto | dontAsk | yolo
 *
 * Happy drives Qoder over ACP, so the ids that actually travel to and from the app are
 * the ACP ones — measured from a signed-in qodercn 1.1.62 `session/new` response:
 *   availableModes = default "Prompts for approval", acceptEdits "Auto-approves edit
 *   tools", auto "Auto-approves via the safety classifier", dontAsk "Refuses instead of
 *   prompting", yolo "Bypass Permissions".
 * Note ACP has no `plan` mode, and its `yolo` is the CLI's `bypass_permissions`.
 * `qoderPermissionModeToCliFlag` in happy-cli maps an ACP id onto the flag for spawns.
 */
export const QODER_PERMISSION_MODES = [
  'default',
  'acceptEdits',
  'auto',
  'dontAsk',
  'yolo',
] as const;

export const ALL_PERMISSION_MODES = [
  'default',
  'acceptEdits',
  'plan',
  'auto',
  'bypassPermissions',
  'read-only',
  'on-failure',
  'full-auto',
  'auto_edit',
  'yolo',
  'accept_edits',
  'bypass_permissions',
  'dont_ask',
  'dontAsk',
] as const;

export const PERMISSION_MODES_BY_AGENT = {
  claude: CLAUDE_PERMISSION_MODES,
  codex: CODEX_PERMISSION_MODES,
  gemini: GEMINI_PERMISSION_MODES,
  qoder: QODER_PERMISSION_MODES,
} as const;

export const PermissionModeSchema = z.enum(ALL_PERMISSION_MODES);

export type ClaudePermissionMode = typeof CLAUDE_PERMISSION_MODES[number];
export type CodexPermissionMode = typeof CODEX_PERMISSION_MODES[number];
export type GeminiPermissionMode = typeof GEMINI_PERMISSION_MODES[number];
export type QoderPermissionMode = typeof QODER_PERMISSION_MODES[number];
export type PermissionMode = typeof ALL_PERMISSION_MODES[number];
export type PermissionModeAgent = keyof typeof PERMISSION_MODES_BY_AGENT;

export function getPermissionModesForAgent(agent: PermissionModeAgent): readonly PermissionMode[] {
  return PERMISSION_MODES_BY_AGENT[agent] as readonly PermissionMode[];
}

/**
 * Narrows to the modes the given agent accepts, so a caller that has just checked a user
 * supplied id does not need a cast to hand it to an agent-specific API.
 */
export function isPermissionModeForAgent<A extends PermissionModeAgent>(
  agent: A,
  mode: string,
): mode is typeof PERMISSION_MODES_BY_AGENT[A][number] {
  return (PERMISSION_MODES_BY_AGENT[agent] as readonly string[]).includes(mode);
}
