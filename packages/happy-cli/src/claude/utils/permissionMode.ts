import type { QueryOptions } from '@/claude/sdk';
import type { PermissionMode } from '@/api/types';

/** Modes Claude Code CLI accepts for --permission-mode. */
export type ClaudeSdkPermissionMode = NonNullable<QueryOptions['permissionMode']>;

const CLAUDE_PERMISSION_MODES: readonly ClaudeSdkPermissionMode[] = ['default', 'acceptEdits', 'auto', 'bypassPermissions', 'plan'];

/** Whether a Happy permission mode is one Claude Code accepts. */
export function isClaudeMode(mode: PermissionMode | undefined): mode is ClaudeSdkPermissionMode {
    return !!mode && (CLAUDE_PERMISSION_MODES as readonly string[]).includes(mode);
}

/**
 * Map Happy's Claude permission mode to the Claude CLI mode.
 * The UI/validation layer must only send Claude-supported modes here.
 */
export function mapToClaudeMode(mode: PermissionMode): ClaudeSdkPermissionMode {
    if (isClaudeMode(mode)) return mode;
    throw new Error(`Unsupported Claude permission mode: ${mode}`);
}

/**
 * Whether Claude Code will run in bypassPermissions at all. It exits at startup when that mode, or the
 * capability to switch to it (--allow-dangerously-skip-permissions), is asked for as root outside a
 * deliberate sandbox — this mirrors the check it makes (IS_SANDBOX=1, or CLAUDE_CODE_BUBBLEWRAP truthy).
 */
export function canUseBypassPermissions(
    getuid: (() => number) | undefined = process.getuid,
    env: NodeJS.ProcessEnv = process.env,
): boolean {
    const isRoot = typeof getuid === 'function' && getuid.call(process) === 0;
    const bubblewrap = ['1', 'true', 'yes', 'on'].includes((env.CLAUDE_CODE_BUBBLEWRAP ?? '').trim().toLowerCase());
    return !isRoot || env.IS_SANDBOX === '1' || bubblewrap;
}

/**
 * The Claude CLI mode to actually run for a Happy mode: bypassPermissions becomes default where Claude
 * Code would refuse it (see canUseBypassPermissions), so a launch or switch never asks for a mode that
 * makes Claude exit.
 */
export function toRunnableClaudeMode(mode: PermissionMode, bypassAvailable = canUseBypassPermissions()): ClaudeSdkPermissionMode {
    const claudeMode = mapToClaudeMode(mode);
    return claudeMode === 'bypassPermissions' && !bypassAvailable ? 'default' : claudeMode;
}
