/**
 * Codex Permission Handler
 *
 * Handles tool permission requests and responses for Codex sessions.
 * Extends BasePermissionHandler with Codex-specific configuration.
 */

import { logger } from "@/ui/logger";
import { ApiSessionClient } from "@/api/apiSession";
import { PushNotificationClient } from "@/api/pushNotifications";
import type { PermissionMode } from '@/api/types';
import {
    BasePermissionHandler,
    isAlwaysAutoApproved,
    PermissionResult,
    PendingRequest
} from '@/utils/BasePermissionHandler';

// Re-export types for backwards compatibility
export type { PermissionResult, PendingRequest };

/**
 * Codex-specific permission handler.
 */
export class CodexPermissionHandler extends BasePermissionHandler {
    private currentPermissionMode: PermissionMode = 'default';

    constructor(session: ApiSessionClient, pushClient: PushNotificationClient) {
        super(session, pushClient);
    }

    protected getLogPrefix(): string {
        return '[Codex]';
    }

    protected getAgentName(): string {
        return 'Codex';
    }

    setPermissionMode(mode: PermissionMode): void {
        this.currentPermissionMode = mode;
        logger.debug(`${this.getLogPrefix()} Permission mode set to: ${mode}`);
    }

    protected decideAutoApproval(toolCallId: string, toolName: string): PermissionResult | null {
        // User-input requests always need an explicit answer, even in full-auto mode.
        if (toolName === 'AskUserQuestion') {
            return null;
        }
        if (!isAlwaysAutoApproved(toolName, toolCallId) && !this.autoApprovesByMode(toolName)) {
            return null;
        }
        return { decision: this.currentPermissionMode === 'full-auto' ? 'approved_for_session' : 'approved' };
    }

    /** Codex records auto-approvals so its tool cards keep the permission footer. */
    protected recordAutoApproval(
        toolCallId: string,
        toolName: string,
        decision: PermissionResult['decision'],
    ): void {
        this.session.updateAgentState((currentState) => ({
            ...currentState,
            completedRequests: {
                ...currentState.completedRequests,
                [toolCallId]: {
                    tool: toolName,
                    createdAt: Date.now(),
                    completedAt: Date.now(),
                    status: 'approved',
                    decision
                }
            }
        }));
    }

    private autoApprovesByMode(toolName: string): boolean {
        switch (this.currentPermissionMode) {
            case 'full-auto':
                return true;
            case 'on-failure':
                return true;
            case 'read-only': {
                const writeTools = ['write', 'edit', 'create', 'delete', 'patch', 'fs-edit'];
                return !writeTools.some(wt => toolName.toLowerCase().includes(wt));
            }
            case 'default':
            default:
                return false;
        }
    }
}
