/**
 * Antigravity Permission Handler
 *
 * agy applies its own mode (set over ACP) and only sends `session/request_permission`
 * when that mode wants a human. Its requests offer "Allow" and "Deny" alone, with no
 * "always allow", so "don't ask again" is kept here: the tools approved for the session,
 * and the shell commands the user's `Bash(...)` rules cover. Yolo, which agy has no
 * mode for, approves every request, as does Happy's own MCP tools.
 */

import { logger } from '@/ui/logger';
import type { PermissionMode } from '@/api/types';
import { BasePermissionHandler, type PermissionResult } from '@/utils/BasePermissionHandler';
import { HAPPY_TOOLS_APPROVED_WITHOUT_ASKING_PREFIXED } from '@/agent/mcp/happyToolsApproved';

// Named as AntigravityTransport identifies them.
export const HAPPY_TOOLS_APPROVED_WITHOUT_ASKING = HAPPY_TOOLS_APPROVED_WITHOUT_ASKING_PREFIXED;

export class AntigravityPermissionHandler extends BasePermissionHandler {
    private permissionMode: PermissionMode = 'default';
    /** Tools approved for the rest of the session; kept across turns, unlike pending requests. */
    private readonly toolsApprovedForSession = new Set<string>();

    protected getLogPrefix(): string {
        return '[Antigravity]';
    }

    protected getAgentName(): string {
        return 'Antigravity';
    }

    setPermissionMode(mode: PermissionMode): void {
        this.permissionMode = mode;
    }

    async handleToolCall(toolCallId: string, toolName: string, toolInput: Record<string, unknown>): Promise<PermissionResult> {
        if (
            this.permissionMode === 'yolo'
            || HAPPY_TOOLS_APPROVED_WITHOUT_ASKING.includes(toolName)
            || this.toolsApprovedForSession.has(toolName)
            || this.isShellCommandAllowed(toolName, toolInput)
        ) {
            logger.debug(`${this.getLogPrefix()} Auto-approving ${toolName} (${toolCallId}) in ${this.permissionMode} mode`);
            return { decision: 'approved' };
        }

        const result = await new Promise<PermissionResult>((resolve, reject) => {
            this.pendingRequests.set(toolCallId, { resolve, reject, toolName, input: toolInput });
            this.addPendingRequestToState(toolCallId, toolName, toolInput);
            logger.debug(`${this.getLogPrefix()} Permission request sent for ${toolName} (${toolCallId})`);
        });
        if (result.decision === 'approved_for_session') this.toolsApprovedForSession.add(toolName);
        return result;
    }

    /** Forgets the tools approved for the session too: /clear starts a new conversation. */
    clearSessionApprovals(): void {
        this.toolsApprovedForSession.clear();
    }
}
