import { log } from "@/utils/log";
import { Expo, ExpoPushMessage } from "expo-server-sdk";
import { db } from "@/storage/db";
import { getSessionTurnState, type SessionTurnState } from "@/app/presence/sessionTurnRuntime";

/**
 * NotificationReadyState interface for notification stability checks.
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
 * NotificationManager handles Expo push notification delivery with stability checks.
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
    private expo: Expo;
    
    // Timeouts
    private readonly STABILITY_THRESHOLD_MS = 2_000; // 2 seconds - must wait this long after last activity
    private readonly TIMEOUT_THRESHOLD_MS = 30_000; // 30 seconds - considered stuck if no activity this long

    private constructor() {
        this.expo = new Expo();
    }

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
     * Get session owner ID from conversation ID
     */
    private async getSessionOwnerId(conversationId: string): Promise<string | null> {
        const session = await db.session.findUnique({
            where: { id: conversationId },
            select: { accountId: true },
        });
        return session?.accountId ?? null;
    }

    /**
     * Send push notification via Expo Push API
     */
    private async sendPushViaExpo(tokens: string[], title: string, body: string, data: Record<string, unknown>): Promise<void> {
        // Filter out invalid tokens
        const validMessages: ExpoPushMessage[] = tokens
            .filter(token => Expo.isExpoPushToken(token))
            .map(token => ({
                to: token,
                title,
                body,
                data,
                sound: 'default' as const,
                priority: 'high' as const,
            }));

        if (validMessages.length === 0) {
            log({ module: 'notification-manager' }, `[⚠️ 跳过] 没有有效的 Expo Push Token`);
            return;
        }

        // Chunk and send with retry
        const chunks = this.expo.chunkPushNotifications(validMessages);
        
        for (const chunk of chunks) {
            try {
                const ticketChunk = await this.expo.sendPushNotificationsAsync(chunk);
                
                // Log any errors
                const errors = ticketChunk.filter(ticket => ticket.status === 'error');
                if (errors.length > 0) {
                    log({ module: 'notification-manager' }, 
                        `[⚠️ 部分推送失败] ${errors.length}/${ticketChunk.length}`, 
                        errors.map(e => e.message)
                    );
                }
            } catch (error) {
                log({ module: 'notification-manager', level: 'error' }, 
                    `[❌ 推送发送失败] chunk error: ${error}`);
            }
        }
    }

    /**
     * Actually send the push notification
     */
    private async sendNotification(
        conversationId: string, 
        state: NotificationReadyState
    ): Promise<void> {
        log({ module: 'notification-manager', sessionId: conversationId }, 
            `[🚀 准备发送推送] 会话 ${conversationId}:`, {
                finalStatus: state.status,
                isThinking: state.isThinking,
                timestamp: new Date().toISOString(),
            });

        try {
            // Get session owner
            const ownerId = await this.getSessionOwnerId(conversationId);
            if (!ownerId) {
                log({ module: 'notification-manager', sessionId: conversationId }, 
                    `[⚠️ 跳过] 会话不存在或无 owner`);
                return;
            }

            // Fetch user's push tokens
            const pushTokens = await db.accountPushToken.findMany({
                where: { accountId: ownerId },
                select: { token: true },
            });

            if (pushTokens.length === 0) {
                log({ module: 'notification-manager', sessionId: conversationId }, 
                    `[⚠️ 跳过] 用户没有注册推送 token`);
                return;
            }

            const tokens = pushTokens.map(pt => pt.token);

            // Prepare notification content
            const title = '💬 新消息';
            const body = '你的对话有新消息';
            const data = {
                type: 'session_message',
                sessionId: conversationId,
                timestamp: Date.now(),
            };

            // Send push via Expo
            await this.sendPushViaExpo(tokens, title, body, data);

            // Increment badge count
            await db.account.update({
                where: { id: ownerId },
                data: { badgeCount: { increment: 1 } },
            });

            log({ module: 'notification-manager', sessionId: conversationId }, 
                `[✅ 推送已发送] 已发送到 ${tokens.length} 个设备`, {
                    finalStatus: state.status,
                    timestamp: new Date().toISOString(),
                });

        } catch (error) {
            log({ module: 'notification-manager', level: 'error', sessionId: conversationId }, 
                `[❌ 发送推送失败] ${error}`);
        }
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
