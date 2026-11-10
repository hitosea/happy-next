/**
 * Canonical EnhancedMode hashes used to decide how a mode change is applied.
 *
 * The queue hash covers every field that affects a running Claude subprocess
 * and is used by the message queue to batch messages with identical modes.
 * It keeps the plan flag so plan and non-plan messages never merge into one
 * batch — a batch carries a single mode, and merging would silently drop the
 * plan toggle.
 *
 * The restart hash excludes the model and the plan flag: those are applied to
 * the live subprocess via the set_model / set_permission_mode control requests
 * (no respawn), while a change to any remaining field requires tearing the
 * subprocess down and resuming the session with new CLI flags.
 */

import { hashObject } from '@/utils/deterministicJson';
import type { EnhancedMode } from '@/claude/loop';

export function enhancedModeQueueHash(mode: EnhancedMode): string {
    return hashObject({
        model: mode.model,
        isPlan: mode.permissionMode === 'plan',
        restart: enhancedModeRestartHash(mode)
    });
}

/**
 * The mode as the running Claude Code would take it: a context window equal to the one it already runs
 * with changes nothing, so it is read as the window the running mode was started with and costs no restart.
 */
export function withRunningContextWindow(next: EnhancedMode, running: EnhancedMode | null, runningWindow: number | undefined): EnhancedMode {
    return running && runningWindow !== undefined && next.contextWindow === runningWindow
        ? { ...next, contextWindow: running.contextWindow }
        : next;
}

export function enhancedModeRestartHash(mode: EnhancedMode): string {
    return hashObject({
        reasoningEffort: mode.reasoningEffort,
        contextWindow: mode.contextWindow,
        fallbackModel: mode.fallbackModel,
        customSystemPrompt: mode.customSystemPrompt,
        appendSystemPrompt: mode.appendSystemPrompt,
        allowedTools: mode.allowedTools,
        disallowedTools: mode.disallowedTools
    });
}
