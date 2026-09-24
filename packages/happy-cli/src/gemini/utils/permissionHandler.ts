/**
 * Gemini Permission Handler
 *
 * Handles tool permission requests and responses for Gemini ACP sessions.
 * Extends BasePermissionHandler with Gemini-specific permission mode logic.
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
 * Gemini-specific permission handler with permission mode support.
 */
export class GeminiPermissionHandler extends BasePermissionHandler {
    private currentPermissionMode: PermissionMode = 'default';

    constructor(session: ApiSessionClient, pushClient: PushNotificationClient) {
        super(session, pushClient);
    }

    protected getLogPrefix(): string {
        return '[Gemini]';
    }

    protected getAgentName(): string {
        return 'Gemini';
    }

    /**
     * Update session reference (override for type visibility)
     */
    updateSession(newSession: ApiSessionClient): void {
        super.updateSession(newSession);
    }

    /**
     * Set the current permission mode
     * This affects how tool calls are automatically approved/denied
     */
    setPermissionMode(mode: PermissionMode): void {
        this.currentPermissionMode = mode;
        logger.debug(`${this.getLogPrefix()} Permission mode set to: ${mode}`);
    }

    protected decideAutoApproval(toolCallId: string, toolName: string): PermissionResult | null {
        if (!isAlwaysAutoApproved(toolName, toolCallId) && !this.autoApprovesByMode(toolName)) {
            return null;
        }
        // `yolo` approves for the rest of the session; every other auto-approval is per-call.
        return { decision: this.currentPermissionMode === 'yolo' ? 'approved_for_session' : 'approved' };
    }

    /**
     * Check if a tool should be auto-approved based on permission mode
     */
    private autoApprovesByMode(toolName: string): boolean {
        switch (this.currentPermissionMode) {
            case 'yolo':
                // Auto-approve everything in yolo mode
                return true;
            case 'auto_edit': {
                const editTools = ['write', 'edit', 'replace', 'patch', 'fs-edit'];
                return editTools.some(wt => toolName.toLowerCase().includes(wt));
            }
            case 'plan':
                // Deny all write operations - only allow read operations
                // Check if tool is a write operation (can be enhanced with tool metadata)
                const writeTools = ['write', 'edit', 'create', 'delete', 'patch', 'fs-edit'];
                const isWriteTool = writeTools.some(wt => toolName.toLowerCase().includes(wt));
                return !isWriteTool;
            case 'default':
            default:
                // Default mode - always ask for permission (except for always-auto-approve tools above)
                return false;
        }
    }
}
