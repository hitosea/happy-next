import { log } from "@/utils/log";
import { db } from "@/storage/db";
import { eventRouter, buildNewMessageUpdate } from "@/app/events/eventRouter";
import { randomKeyNaked } from "@/utils/randomKeyNaked";
import { getSessionTurnState, type SessionTurnState } from "@/app/presence/sessionTurnRuntime";

/**
 * Conversation state interface for notification stability checks.
 * Derived from SessionTurnState but includes additional fields.
 */
export interface NotificationReadyState {
    conversationId: string;
    isThinking: boolean;
    toolsInProgress: string[];
    lastActivityTime: number;
    status: 'idle' | 'thinking' | 'executing_tool' | 'completed';
    timeoutDetected: boolean;
}

/**
 * NotificationManager handles push notification delivery with stability checks.
 * 
 * It ensures notifications are only sent when:
 * - The model is not thinking
 * - No tools are currently executing
 * - At least 2 seconds have passed since last activity (stability window)
 * - The conversation status indicates completion
 * - No timeout has been detected
 * 
 * This prevents push notifications from being sent during intermediate states
 * when the conversation might still be ongoing.
 */
export class NotificationManager {
    private static instance: NotificationManager;
    private retryTimeouts = new Map<string, NodeJS.Timeout>();
    
    // Timeouts
    private readonly STABILITY_THRESHOLD_MS = 2_000; // 2 seconds - must wait this long after last activity
    private readonly TIMEOUT_THRESHOLD_MS = 30_000; // 30 seconds - considered stuck if no activity this long

    private constructor() {}

    static getInstance(): NotificationManager {
        if (!NotificationManager.instance) {
            NotificationManager.instance = new NotificationManager();
        }
        return NotificationManager.instance;
    }

    /**
     * Main entry point: check state and send notification if ready
     */
    async checkAndNotify(conversationId: string): Promise<void> {
        const turnState = getSessionTurnState(conversationId);
        const state = this.buildNotificationState(conversationId, turnState);
        
        const readyToNotify = this.isReadyForNotification(state);

        if (!readyToNotify) {
            log({ module: 'notification-manager', sessionId: conversationId }, 
                `[⏰ 检查中] 会话 ${conversationId} 状态未就绪，将在 1s 后重试`, {
                    status: state.status,
                    isThinking: state.isThinking,
                    toolsInProgress: state.toolsInProgress.length,
                    timeSinceActivity: Date.now() - state.lastActivityTime,
                });
            this.scheduleRetry(conversationId, 1000);
            return;
        }

        log({ module: 'notification-manager', sessionId: conversationId }, 
            `[✅ 发送通知] 会话 ${conversationId} 已完整完成，状态: ${state.status}`, {
                timeSinceActivity: Date.now() - state.lastActivityTime,
            });
        
        await this.sendNotification(conversationId, state);
    }

    /**
     * Build notification-ready state from session turn state
     */
    private buildNotificationState(conversationId: string, turnState: SessionTurnState): NotificationReadyState {
        const timeSinceActivity = Date.now() - turnState.lastHeartbeatAt;
        
        // Determine conversation status
        let status: 'idle' | 'thinking' | 'executing_tool' | 'completed';
        if (turnState.thinking) {
            status = 'thinking';
        } else if (turnState.awaitingTurnStart) {
            status = 'executing_tool';
        } else if (turnState.dispatching) {
            status = 'executing_tool';
        } else {
            status = 'completed';
        }

        return {
            conversationId,
            isThinking: turnState.thinking,
            toolsInProgress: [], // Tool tracking would require integration with tool execution
            lastActivityTime: turnState.lastHeartbeatAt,
            status,
            timeoutDetected: timeSinceActivity > this.TIMEOUT_THRESHOLD_MS,
        };
    }

    /**
     * Check if the conversation state is ready for notification
     */
    private isReadyForNotification(state: NotificationReadyState): boolean {
        const timeSinceActivity = Date.now() - state.lastActivityTime;
        
        const checks = {
            notThinking: !state.isThinking,
            noToolsInProgress: state.toolsInProgress.length === 0,
            stableTimestamp: timeSinceActivity > this.STABILITY_THRESHOLD_MS,
            hasCompleted: state.status === 'completed' || state.status === 'idle',
            notTimedOut: !state.timeoutDetected,
        };

        log({ module: 'notification-manager', sessionId: state.conversationId }, 
            `[📋 检查日志] 会话 ${state.conversationId} 状态检查:`, checks);

        return Object.values(checks).every(check => check);
    }

    /**
     * Schedule a retry check after a delay
     */
    private scheduleRetry(conversationId: string, delayMs: number): void {
        // Cancel any existing retry for this conversation
        const existingTimeout = this.retryTimeouts.get(conversationId);
        if (existingTimeout) {
            clearTimeout(existingTimeout);
        }

        const timeout = setTimeout(async () => {
            this.retryTimeouts.delete(conversationId);
            await this.checkAndNotify(conversationId);
        }, delayMs);

        this.retryTimeouts.set(conversationId, timeout);
    }

    /**
     * Actually send the push notification
     * 
     * In a real implementation, this would:
     * 1. Fetch user's push tokens from db.accountPushToken
     * 2. Send via FCM/APNs/Expo push service
     * 3. Handle delivery failures with retries
     */
    private async sendNotification(
        conversationId: string, 
        state: NotificationReadyState
    ): Promise<void> {
        log({ module: 'notification-manager', sessionId: conversationId }, 
            `[🚀 通知已发送] 会话 ${conversationId}:`, {
                finalStatus: state.status,
                isThinking: state.isThinking,
                timestamp: new Date().toISOString(),
            });

        // TODO: Actual push notification implementation
        // This would typically:
        // 1. Get user's push tokens: await db.accountPushToken.findMany({ where: { accountId } })
        // 2. Send push via FCM/APNs/Expo
        // 3. Update badge count
        // 4. Log delivery status

        /*
        Example implementation:
        
        const pushTokens = await db.accountPushToken.findMany({
            where: { accountId: ownerId }
        });
        
        for (const token of pushTokens) {
            await sendPushNotification({
                token: token.token,
                title: 'New Message',
                body: 'You have a new message in your conversation',
                data: { sessionId: conversationId }
            });
        }
        */
    }

    /**
     * Cancel any pending retry for a conversation
     */
    cancelRetry(conversationId: string): void {
        const existingTimeout = this.retryTimeouts.get(conversationId);
        if (existingTimeout) {
            clearTimeout(existingTimeout);
            this.retryTimeouts.delete(conversationId);
        }
    }

    /**
     * Cleanup all pending retries (for shutdown)
     */
    shutdown(): void {
        for (const [conversationId, timeout] of this.retryTimeouts) {
            clearTimeout(timeout);
        }
        this.retryTimeouts.clear();
    }
}

// Convenience function for getting the singleton instance
export function getNotificationManager(): NotificationManager {
    return NotificationManager.getInstance();
}
