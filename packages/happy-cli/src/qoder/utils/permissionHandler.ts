/**
 * Qoder Permission Handler
 *
 * qodercli applies its own permission mode (set over ACP with session/set_mode)
 * and only sends `session/request_permission` when that mode wants a human, so
 * every request it does send goes to the app. Happy's own MCP tools are the one
 * exception: they only touch Happy state and are approved without asking, as are the shell
 * commands "don't ask again" covers.
 */

import { join } from 'node:path';
import { logger } from '@/ui/logger';
import type { ApiSessionClient } from '@/api/apiSession';
import type { PushNotificationClient } from '@/api/pushNotifications';
import { BasePermissionHandler, type PermissionResult } from '@/utils/BasePermissionHandler';
import { persistAllowRules } from '@/utils/allowRulesSettings';
import { HAPPY_TOOLS_APPROVED_WITHOUT_ASKING_PREFIXED } from '@/agent/mcp/happyToolsApproved';

// Named as QoderTransport identifies them: from qodercli's titles, or from the tool an mcp_call runs.
export const HAPPY_TOOLS_APPROVED_WITHOUT_ASKING = HAPPY_TOOLS_APPROVED_WITHOUT_ASKING_PREFIXED;

export class QoderPermissionHandler extends BasePermissionHandler {
    /** `shownInput` gives the input the app shows for a request (ExitPlanMode's gets its plan). */
    constructor(
        session: ApiSessionClient,
        pushClient: PushNotificationClient,
        private readonly shownInput: (toolName: string, input: Record<string, unknown>) => Record<string, unknown> = (_toolName, input) => input,
    ) {
        super(session, pushClient);
    }

    protected getLogPrefix(): string {
        return '[Qoder]';
    }

    protected getAgentName(): string {
        return 'Qoder';
    }

    /** qodercli reads Claude-format rules from the project's .qoder/settings.local.json when it starts (it runs in the CLI's cwd). */
    protected persistShellRules(rules: string[]): void {
        void persistAllowRules(join(process.cwd(), '.qoder', 'settings.local.json'), rules);
    }

    async handleToolCall(toolCallId: string, toolName: string, toolInput: Record<string, unknown>): Promise<PermissionResult> {
        if (HAPPY_TOOLS_APPROVED_WITHOUT_ASKING.includes(toolName) || this.isShellCommandAllowed(toolName, toolInput)) {
            logger.debug(`${this.getLogPrefix()} Auto-approving ${toolName} (${toolCallId})`);
            return { decision: 'approved' };
        }

        const input = this.shownInput(toolName, toolInput);
        return new Promise<PermissionResult>((resolve, reject) => {
            this.pendingRequests.set(toolCallId, { resolve, reject, toolName, input });
            this.addPendingRequestToState(toolCallId, toolName, input);
            logger.debug(`${this.getLogPrefix()} Permission request sent for ${toolName} (${toolCallId})`);
        });
    }
}
