/**
 * Qoder Permission Handler
 *
 * qodercli applies its own permission mode (set over ACP with session/set_mode)
 * and only sends `session/request_permission` when that mode wants a human, so
 * every request it does send goes to the app. Happy's own MCP tools are the one
 * exception: they only touch Happy state and are approved without asking.
 */

import { logger } from '@/ui/logger';
import { BasePermissionHandler, type PermissionResult } from '@/utils/BasePermissionHandler';

// Named as QoderTransport reads them back from qodercli's permission titles.
export const HAPPY_TOOLS_APPROVED_WITHOUT_ASKING = ['mcp__happy__change_title', 'mcp__happy__preview_html'];

export class QoderPermissionHandler extends BasePermissionHandler {
    protected getLogPrefix(): string {
        return '[Qoder]';
    }

    protected getAgentName(): string {
        return 'Qoder';
    }

    async handleToolCall(toolCallId: string, toolName: string, input: unknown): Promise<PermissionResult> {
        if (HAPPY_TOOLS_APPROVED_WITHOUT_ASKING.includes(toolName)) {
            logger.debug(`${this.getLogPrefix()} Auto-approving ${toolName} (${toolCallId})`);
            return { decision: 'approved' };
        }

        return new Promise<PermissionResult>((resolve, reject) => {
            this.pendingRequests.set(toolCallId, { resolve, reject, toolName, input });
            this.addPendingRequestToState(toolCallId, toolName, input);
            logger.debug(`${this.getLogPrefix()} Permission request sent for ${toolName} (${toolCallId})`);
        });
    }
}
