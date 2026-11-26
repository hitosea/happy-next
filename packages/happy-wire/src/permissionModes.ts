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

export const QODER_PERMISSION_MODES = [
  'default',
  'acceptEdits',
  'auto',
  'yolo',
] as const;

/**
 * Antigravity (`agy acp`) offers default, accept-edits, auto (when the OS terminal sandbox is
 * available on a personal account) and plan as ACP modes; `yolo` runs in its default mode with
 * Happy approving every request it asks about.
 */
export const ANTIGRAVITY_PERMISSION_MODES = [
  'default',
  'acceptEdits',
  'auto',
  'plan',
  'yolo',
] as const;

/**
 * DeepSeek Harness (`dsh --profile acp`) bundles sandbox mode and approval policy under
 * `DSH_PERMISSION_MODE`: `default` runs `workspace-write`, `read-only` and `plan` run
 * `read-only` (with plan guidance + `ExitPlanMode` for `plan`), and `yolo` runs `danger-full-access`.
 */
export const DEEPSEEK_PERMISSION_MODES = [
  'default',
  'read-only',
  'plan',
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
] as const;

export const PERMISSION_MODES_BY_AGENT = {
  claude: CLAUDE_PERMISSION_MODES,
  codex: CODEX_PERMISSION_MODES,
  gemini: GEMINI_PERMISSION_MODES,
  antigravity: ANTIGRAVITY_PERMISSION_MODES,
  deepseek: DEEPSEEK_PERMISSION_MODES,
  qoder: QODER_PERMISSION_MODES,
} as const;

export const PermissionModeSchema = z.enum(ALL_PERMISSION_MODES);

export type ClaudePermissionMode = typeof CLAUDE_PERMISSION_MODES[number];
export type CodexPermissionMode = typeof CODEX_PERMISSION_MODES[number];
export type GeminiPermissionMode = typeof GEMINI_PERMISSION_MODES[number];
export type AntigravityPermissionMode = typeof ANTIGRAVITY_PERMISSION_MODES[number];
export type DeepSeekPermissionMode = typeof DEEPSEEK_PERMISSION_MODES[number];
export type QoderPermissionMode = typeof QODER_PERMISSION_MODES[number];
export type PermissionMode = typeof ALL_PERMISSION_MODES[number];
export type PermissionModeAgent = keyof typeof PERMISSION_MODES_BY_AGENT;

export function getPermissionModesForAgent(agent: PermissionModeAgent): readonly PermissionMode[] {
  return PERMISSION_MODES_BY_AGENT[agent] as readonly PermissionMode[];
}

export function isPermissionModeForAgent(agent: PermissionModeAgent, mode: string): mode is PermissionMode {
  return (PERMISSION_MODES_BY_AGENT[agent] as readonly string[]).includes(mode);
}
