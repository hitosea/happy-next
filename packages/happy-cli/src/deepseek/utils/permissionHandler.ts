/**
 * DeepSeek Permission Handler
 *
 * DeepSeek Harness enforces workspace sandboxing under `DSH_PERMISSION_MODE` and only asks
 * `session/request_permission` on sandbox escalation (or `plugin_manager`) with one-shot
 * choices (`allow-once` / `reject-once`). Happy's interactive MCP tools (`AskUserQuestion`
 * and `ExitPlanMode`) also route through this handler so the app renders their native cards
 * and returns structured answers / plan approval decisions.
 */

import { logger } from '@/ui/logger';
import type { PermissionMode } from '@/api/types';
import { BasePermissionHandler, type PermissionResult } from '@/utils/BasePermissionHandler';
import { HAPPY_TOOLS_APPROVED_WITHOUT_ASKING_PREFIXED } from '@/agent/mcp/happyToolsApproved';

export const HAPPY_TOOLS_APPROVED_WITHOUT_ASKING = HAPPY_TOOLS_APPROVED_WITHOUT_ASKING_PREFIXED;

const ALWAYS_INTERACTIVE_TOOLS = new Set(['AskUserQuestion', 'ExitPlanMode', 'exit_plan_mode']);

export class DeepSeekPermissionHandler extends BasePermissionHandler {
    private permissionMode: PermissionMode = 'default';
    /**
     * Set when the user approves `ExitPlanMode` mid-turn while the running `dsh` process is
     * still in `read-only` sandbox mode: workspace-write escalations for the rest of that
     * turn are auto-approved seamlessly until the process switches to `workspace-write` on idle.
     */
    private planExitedInCurrentTurn = false;

    protected getLogPrefix(): string {
        return '[DeepSeek]';
    }

    protected getAgentName(): string {
        return 'DeepSeek';
    }

    setPermissionMode(mode: PermissionMode): void {
        this.permissionMode = mode;
    }

    getPermissionMode(): PermissionMode {
        return this.permissionMode;
    }

    markPlanExitedForTurn(): void {
        this.planExitedInCurrentTurn = true;
    }

    clearTurnFlags(): void {
        this.planExitedInCurrentTurn = false;
    }

    async handleToolCall(toolCallId: string, toolName: string, toolInput: Record<string, unknown>): Promise<PermissionResult> {
        const isInteractive = ALWAYS_INTERACTIVE_TOOLS.has(toolName);

        if (!isInteractive) {
            const requestedSandbox = typeof toolInput?.sandbox_permissions === 'string' ? toolInput.sandbox_permissions : undefined;
            const autoApprovePostPlanWorkspaceWrite = this.planExitedInCurrentTurn
                && this.permissionMode === 'default'
                && requestedSandbox === 'workspace-write';

            if (
                this.permissionMode === 'yolo'
                || HAPPY_TOOLS_APPROVED_WITHOUT_ASKING.includes(toolName)
                || autoApprovePostPlanWorkspaceWrite
            ) {
                logger.debug(`${this.getLogPrefix()} Auto-approving ${toolName} (${toolCallId}) in ${this.permissionMode} mode`);
                return { decision: 'approved' };
            }
        }

        return new Promise<PermissionResult>((resolve, reject) => {
            this.pendingRequests.set(toolCallId, { resolve, reject, toolName, input: toolInput });
            this.addPendingRequestToState(toolCallId, toolName, toolInput);
            logger.debug(`${this.getLogPrefix()} Permission request sent for ${toolName} (${toolCallId})`);
        });
    }
}
