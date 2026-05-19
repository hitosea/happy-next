import { logger } from "@/ui/logger";
import { ApiSessionClient } from "@/api/apiSession";
import { PushNotificationClient } from "@/api/pushNotifications";
import type { PermissionMode } from '@/api/types';
import {
    BasePermissionHandler,
    PermissionResult,
    PendingRequest
} from '@/utils/BasePermissionHandler';

export type { PermissionResult, PendingRequest };

export class OpenCodePermissionHandler extends BasePermissionHandler {
    private currentPermissionMode: PermissionMode = 'default';

    constructor(session: ApiSessionClient, pushClient: PushNotificationClient) {
        super(session, pushClient);
    }

    protected getLogPrefix(): string {
        return '[OpenCode]';
    }

    protected getAgentName(): string {
        return 'OpenCode';
    }

    updateSession(newSession: ApiSessionClient): void {
        super.updateSession(newSession);
    }

    setPermissionMode(mode: PermissionMode): void {
        this.currentPermissionMode = mode;
        logger.debug(`[OpenCode] Permission mode set to: ${mode}`);
    }

    getPermissionMode(): PermissionMode {
        return this.currentPermissionMode;
    }

    private shouldAutoApprove(toolName: string, toolCallId: string): boolean {
        const alwaysAutoApproveNames = ['change_title', 'happy__change_title', 'preview_html', 'happy__preview_html', 'OpenCodeReasoning', 'think', 'save_memory'];
        const alwaysAutoApproveIds = ['change_title', 'preview_html', 'save_memory'];

        if (alwaysAutoApproveNames.some(name => toolName.toLowerCase().includes(name.toLowerCase()))) {
            return true;
        }
        if (alwaysAutoApproveIds.some(id => toolCallId.toLowerCase().includes(id.toLowerCase()))) {
            return true;
        }

        const dangerousTools = ['write', 'edit', 'create', 'delete', 'patch', 'fs-edit', 'bash', 'shell', 'terminal', 'exec'];
        const isDangerous = dangerousTools.some(wt => toolName.toLowerCase().includes(wt));

        switch (this.currentPermissionMode) {
            case 'yolo':
                return true;
            case 'safe-yolo':
                return !isDangerous;
            case 'read-only':
                return !isDangerous;
            case 'default':
            default:
                return false;
        }
    }

    async handleToolCall(
        toolCallId: string,
        toolName: string,
        input: unknown
    ): Promise<PermissionResult> {
        if (this.shouldAutoApprove(toolName, toolCallId)) {
            logger.debug(`${this.getLogPrefix()} Auto-approving tool ${toolName} (${toolCallId}) in ${this.currentPermissionMode} mode`);

            return {
                decision: this.currentPermissionMode === 'yolo' ? 'approved_for_session' : 'approved'
            };
        }

        return new Promise<PermissionResult>((resolve, reject) => {
            this.pendingRequests.set(toolCallId, {
                resolve,
                reject,
                toolName,
                input
            });

            this.addPendingRequestToState(toolCallId, toolName, input);

            logger.debug(`${this.getLogPrefix()} Permission request sent for tool: ${toolName} (${toolCallId}) in ${this.currentPermissionMode} mode`);
        });
    }
}
