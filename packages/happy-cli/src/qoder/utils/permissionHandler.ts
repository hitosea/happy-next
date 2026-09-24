/**
 * Qoder Permission Handler
 *
 * Second-line approval gate for Qoder ACP sessions, on top of whatever Qoder itself
 * enforces from the `--permission-mode` we pass at spawn time. Both layers exist on
 * purpose: the CLI mode governs autonomous behaviour, this one governs what the Happy
 * app is asked to approve when the CLI still escalates to the client.
 *
 * Mirrors src/gemini/utils/permissionHandler.ts, using Qoder's ACP mode ids
 * (`default` / `acceptEdits` / `auto` / `dontAsk` / `yolo`) — see the switch below for what
 * each one means in the CLI's own words.
 */

import { logger } from '@/ui/logger';
import { ApiSessionClient } from '@/api/apiSession';
import { PushNotificationClient } from '@/api/pushNotifications';
import { BasePermissionHandler, isAlwaysAutoApproved, type PermissionResult } from '@/utils/BasePermissionHandler';
import type { QoderPermissionMode } from 'happy-wire';

const EDIT_TOOL_HINTS = ['write', 'edit', 'replace', 'patch', 'fs-edit', 'apply_patch', 'multiedit'];

export class QoderPermissionHandler extends BasePermissionHandler {
    private currentPermissionMode: QoderPermissionMode = 'default';

    constructor(session: ApiSessionClient, pushClient: PushNotificationClient) {
        super(session, pushClient);
    }

    protected getLogPrefix(): string {
        return '[Qoder]';
    }

    protected getAgentName(): string {
        return 'Qoder';
    }

    setPermissionMode(mode: QoderPermissionMode): void {
        this.currentPermissionMode = mode;
        logger.debug(`${this.getLogPrefix()} Permission mode set to: ${mode}`);
    }

    /**
     * Auto-approval policy per ACP mode id.
     *
     * Semantics are the CLI's own, read off the `session/new` `availableModes` payload
     * rather than guessed from the flag docs:
     *   default      "Prompts for approval"        -> ask the user
     *   acceptEdits  "Auto-approves edit tools"    -> edits yes, shell/exec still ask
     *   auto         "Auto-approves via the safety classifier" -> if it still escalates to
     *                  the client, the classifier already decided a human should decide,
     *                  so Happy treats it like acceptEdits instead of rubber-stamping
     *   dontAsk      "Refuses instead of prompting" -> DENY, not approve
     *   yolo         "Bypass Permissions"          -> approve everything
     */
    protected decideAutoApproval(toolCallId: string, toolName: string): PermissionResult | null {
        if (!isAlwaysAutoApproved(toolName, toolCallId) && !this.autoApprovesByMode(toolName)) {
            return null;
        }
        // `yolo` is the whole point of that mode, so keep approving for the rest of the
        // session; every other auto-approval is per-call.
        return { decision: this.currentPermissionMode === 'yolo' ? 'approved_for_session' : 'approved' };
    }

    private autoApprovesByMode(toolName: string): boolean {
        const lowerName = toolName.toLowerCase();

        switch (this.currentPermissionMode) {
            case 'yolo':
                return true;

            case 'dontAsk':
                // Measured, and counter-intuitive enough to be worth the comment: the
                // label reads like "stop asking me", but the CLI's own description is
                // "Refuses instead of prompting".
                return false;

            case 'auto':
            case 'acceptEdits':
                return EDIT_TOOL_HINTS.some(hint => lowerName.includes(hint));

            case 'default':
            default:
                return false;
        }
    }
}
