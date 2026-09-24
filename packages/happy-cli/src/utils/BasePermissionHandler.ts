/**
 * Base Permission Handler
 *
 * Abstract base class for permission handlers that manage tool approval requests.
 * Shared by Codex and Gemini permission handlers.
 *
 * @module BasePermissionHandler
 */

import { logger } from "@/ui/logger";
import { ApiSessionClient } from "@/api/apiSession";
import { AgentState } from "@/api/types";
import { PushNotificationClient } from "@/api/pushNotifications";

/**
 * Permission response from the mobile app.
 */
export interface PermissionResponse {
    id: string;
    approved: boolean;
    decision?: 'approved' | 'approved_for_session' | 'denied' | 'abort';
    answers?: Record<string, string>;
}

/**
 * Pending permission request stored while awaiting user response.
 */
export interface PendingRequest {
    resolve: (value: PermissionResult) => void;
    reject: (error: Error) => void;
    toolName: string;
    input: unknown;
}

/**
 * Result of a permission request.
 */
export interface PermissionResult {
    decision: 'approved' | 'approved_for_session' | 'denied' | 'abort';
}

/**
 * Happy-owned tools, and tools that only display thinking: none of them describe an
 * action on the user's machine, so none is worth a prompt.
 */
const ALWAYS_AUTO_APPROVE_NAMES = [
    'change_title',
    'happy__change_title',
    'preview_html',
    'happy__preview_html',
    'think',
    'save_memory',
];
const ALWAYS_AUTO_APPROVE_CALL_IDS = ['change_title', 'preview_html', 'save_memory'];
/** `<Vendor>Reasoning` streams chain-of-thought; every agent spells the vendor its own way. */
const REASONING_TOOL_SUFFIX = 'reasoning';

/** True when a tool may run without asking, whatever the agent's approval mode is. */
export function isAlwaysAutoApproved(toolName: string, toolCallId: string): boolean {
    const lowerName = toolName.toLowerCase();
    if (lowerName.endsWith(REASONING_TOOL_SUFFIX)) return true;
    if (ALWAYS_AUTO_APPROVE_NAMES.some(name => lowerName.includes(name))) return true;
    return ALWAYS_AUTO_APPROVE_CALL_IDS.some(id => toolCallId.toLowerCase().includes(id));
}

/**
 * Abstract base class for permission handlers.
 *
 * Subclasses must implement:
 * - `getLogPrefix()` - returns the log prefix (e.g., '[Codex]')
 * - `getAgentName()` - the agent's display name, used in push notification text
 * - `decideAutoApproval()` - the agent's own auto-approval policy
 */
export abstract class BasePermissionHandler {
    protected pendingRequests = new Map<string, PendingRequest>();
    protected session: ApiSessionClient;
    protected pushClient: PushNotificationClient;
    private isResetting = false;

    /**
     * Returns the log prefix for this handler.
     */
    protected abstract getLogPrefix(): string;

    /**
     * Returns the agent name used in push notification text (e.g. "Codex", "Gemini").
     */
    protected abstract getAgentName(): string;

    /**
     * The result to return without asking the user, or null to raise a permission request.
     * Everything agent-specific about approval - the mode policy, which tools are exempt,
     * and whether an auto-approval lasts the session or one call - belongs in here.
     */
    protected abstract decideAutoApproval(toolCallId: string, toolName: string): PermissionResult | null;

    /**
     * Called after an auto-approval, for agents that mirror it into AgentState.
     *
     * Agents that keep auto-approved tools out of `completedRequests` (so the app shows no
     * permission footer on the tool card) leave this as the no-op default.
     */
    protected recordAutoApproval(
        _toolCallId: string,
        _toolName: string,
        _decision: PermissionResult['decision'],
    ): void {
        // No-op by default.
    }

    /**
     * Handle a tool permission request: auto-approve, or queue it and wait for the user.
     */
    async handleToolCall(
        toolCallId: string,
        toolName: string,
        input: unknown,
    ): Promise<PermissionResult> {
        const autoApproval = this.decideAutoApproval(toolCallId, toolName);
        if (autoApproval) {
            logger.debug(`${this.getLogPrefix()} Auto-approving tool ${toolName} (${toolCallId})`);
            this.recordAutoApproval(toolCallId, toolName, autoApproval.decision);
            return autoApproval;
        }

        return new Promise<PermissionResult>((resolve, reject) => {
            this.pendingRequests.set(toolCallId, { resolve, reject, toolName, input });
            this.addPendingRequestToState(toolCallId, toolName, input);
            logger.debug(`${this.getLogPrefix()} Permission request sent for tool: ${toolName} (${toolCallId})`);
        });
    }

    constructor(session: ApiSessionClient, pushClient: PushNotificationClient) {
        this.session = session;
        this.pushClient = pushClient;
        this.setupRpcHandler();
    }

    /**
     * Update the session reference (used after offline reconnection swaps sessions).
     * This is critical for avoiding stale session references after onSessionSwap.
     */
    updateSession(newSession: ApiSessionClient): void {
        logger.debug(`${this.getLogPrefix()} Session reference updated`);
        this.session = newSession;
        // Re-setup RPC handler with new session
        this.setupRpcHandler();
    }

    /**
     * Setup RPC handler for permission responses.
     */
    protected setupRpcHandler(): void {
        this.session.rpcHandlerManager.registerHandler<PermissionResponse, void>(
            'permission',
            async (response) => {
                const pending = this.pendingRequests.get(response.id);
                if (!pending) {
                    logger.debug(`${this.getLogPrefix()} Permission request not found or already resolved`);
                    return;
                }

                // Remove from pending
                this.pendingRequests.delete(response.id);

                // Resolve the permission request
                const result: PermissionResult = response.approved
                    ? {
                        decision: response.decision === 'approved_for_session' ? 'approved_for_session' : 'approved',
                        ...(response.answers ? { answers: response.answers } : {})
                    }
                    : { decision: response.decision === 'denied' ? 'denied' : 'abort' };

                pending.resolve(result);

                // Move request to completed in agent state
                this.session.updateAgentState((currentState) => {
                    const request = currentState.requests?.[response.id];
                    if (!request) return currentState;

                    const { [response.id]: _, ...remainingRequests } = currentState.requests || {};

                    let res = {
                        ...currentState,
                        requests: remainingRequests,
                        completedRequests: {
                            ...currentState.completedRequests,
                            [response.id]: {
                                tool: request.tool,
                                createdAt: request.createdAt,
                                completedAt: Date.now(),
                                status: response.approved ? 'approved' : 'denied',
                                decision: result.decision
                            }
                        }
                    } satisfies AgentState;
                    return res;
                });

                logger.debug(`${this.getLogPrefix()} Permission ${response.approved ? 'approved' : 'denied'} for ${pending.toolName}`);
            }
        );
    }

    /**
     * Add a pending request to the agent state and send a push notification.
     */
    protected addPendingRequestToState(toolCallId: string, toolName: string, input: unknown): void {
        // Send push notification to mobile app
        this.pushClient.sendToAllDevices(
            'Permission Request',
            `${this.getAgentName()} wants to ${toolName}`,
            {
                sessionId: this.session.sessionId,
                requestId: toolCallId,
                tool: toolName,
                type: 'permission_request'
            }
        );

        this.session.updateAgentState((currentState) => ({
            ...currentState,
            requests: {
                ...currentState.requests,
                [toolCallId]: {
                    tool: toolName,
                    arguments: input,
                    createdAt: Date.now()
                }
            }
        }));
    }

    /**
     * Reset state for new sessions.
     * This method is idempotent - safe to call multiple times.
     */
    reset(): void {
        // Guard against re-entrant/concurrent resets
        if (this.isResetting) {
            logger.debug(`${this.getLogPrefix()} Reset already in progress, skipping`);
            return;
        }
        this.isResetting = true;

        try {
            // Snapshot pending requests to avoid Map mutation during iteration
            const pendingSnapshot = Array.from(this.pendingRequests.entries());
            this.pendingRequests.clear(); // Clear immediately to prevent new entries being processed

            // Reject all pending requests from snapshot
            for (const [id, pending] of pendingSnapshot) {
                try {
                    pending.reject(new Error('Session reset'));
                } catch (err) {
                    logger.debug(`${this.getLogPrefix()} Error rejecting pending request ${id}:`, err);
                }
            }

            // Clear requests in agent state
            this.session.updateAgentState((currentState) => {
                const pendingRequests = currentState.requests || {};
                const completedRequests = { ...currentState.completedRequests };

                // Move all pending to completed as canceled
                for (const [id, request] of Object.entries(pendingRequests)) {
                    completedRequests[id] = {
                        tool: request.tool,
                        createdAt: request.createdAt,
                        completedAt: Date.now(),
                        status: 'canceled',
                        reason: 'Session reset'
                    };
                }

                return {
                    ...currentState,
                    requests: {},
                    completedRequests
                };
            });

            logger.debug(`${this.getLogPrefix()} Permission handler reset`);
        } finally {
            this.isResetting = false;
        }
    }
}
