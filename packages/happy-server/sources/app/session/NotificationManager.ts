import { log } from "@/utils/log";
import { Expo, ExpoPushMessage } from "expo-server-sdk";
import { db } from "@/storage/db";

export type NotificationType = 'session_completed' | 'permission_request' | 'session_error' | 'rate_limit';

interface NotifyOptions {
    conversationId: string;
    type: NotificationType;
    title: string;
    body: string;
    /** Extra key/value pairs merged into push data payload */
    extra?: Record<string, unknown>;
}

/**
 * NotificationManager handles server-side Expo push delivery.
 *
 * Triggered directly by server events — no client heartbeat dependency:
 *   - session_completed  : turn ended, CLI set taskCompleted
 *   - permission_request : CLI needs user approval for a tool
 *   - session_error      : unrecoverable error during execution
 *   - rate_limit         : API quota exhausted
 */
export class NotificationManager {
    private static instance: NotificationManager;
    private expo: Expo;

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
     * Notify that the current turn completed successfully.
     * Called by sessionUpdateHandler when turnEnded is detected.
     */
    async notifyCompleted(conversationId: string): Promise<void> {
        await this.notify({
            conversationId,
            type: 'session_completed',
            title: '✅ 任务完成',
            body: '你的会话已完成，点击查看结果',
        });
    }

    /**
     * Notify that a tool requires user approval.
     * Called directly from CLI via the existing permission push path —
     * this server-side variant is for future consolidation.
     */
    async notifyPermissionRequest(conversationId: string, toolName: string): Promise<void> {
        await this.notify({
            conversationId,
            type: 'permission_request',
            title: '🔐 需要授权',
            body: `Claude 想执行 ${toolName}，点击确认或拒绝`,
            extra: { tool: toolName },
        });
    }

    /**
     * Notify that an unrecoverable error occurred.
     * Called when CLI signals a fatal error via agentState or session event.
     */
    async notifyError(conversationId: string, errorMessage: string): Promise<void> {
        await this.notify({
            conversationId,
            type: 'session_error',
            title: '❌ 执行出错',
            body: errorMessage.length > 80 ? errorMessage.slice(0, 80) + '…' : errorMessage,
            extra: { errorMessage },
        });
    }

    /**
     * Notify that the API rate limit has been exhausted.
     */
    async notifyRateLimit(conversationId: string): Promise<void> {
        await this.notify({
            conversationId,
            type: 'rate_limit',
            title: '⚠️ 限额用完',
            body: 'API 限额已用完，点击查看详情',
        });
    }

    /**
     * Core send path: resolve owner → fetch tokens → push via Expo.
     */
    private async notify(opts: NotifyOptions): Promise<void> {
        const { conversationId, type, title, body, extra } = opts;

        try {
            const ownerId = await this.getSessionOwnerId(conversationId);
            if (!ownerId) {
                log({ module: 'notification-manager', sessionId: conversationId },
                    `[⚠️ 跳过] 会话不存在或无 owner (type=${type})`);
                return;
            }

            const pushTokenRows = await db.accountPushToken.findMany({
                where: { accountId: ownerId },
                select: { token: true },
            });

            if (pushTokenRows.length === 0) {
                log({ module: 'notification-manager', sessionId: conversationId },
                    `[⚠️ 跳过] 用户无推送 token (type=${type})`);
                return;
            }

            const badgeCount = await this.incrementBadgeCount(ownerId);

            const data: Record<string, unknown> = {
                type,
                sessionId: conversationId,
                timestamp: Date.now(),
                ...extra,
            };

            const messages: ExpoPushMessage[] = pushTokenRows
                .filter(row => Expo.isExpoPushToken(row.token))
                .map(row => ({
                    to: row.token,
                    title,
                    body,
                    data,
                    sound: 'default' as const,
                    priority: 'high' as const,
                    badge: badgeCount,
                    channelId: 'default',
                }));

            if (messages.length === 0) {
                log({ module: 'notification-manager', sessionId: conversationId },
                    `[⚠️ 跳过] 无有效 Expo token (type=${type})`);
                return;
            }

            await this.sendChunked(messages, conversationId, type);

            log({ module: 'notification-manager', sessionId: conversationId },
                `[✅ 已推送] type=${type}, devices=${messages.length}`);
        } catch (error) {
            log({ module: 'notification-manager', level: 'error', sessionId: conversationId },
                `[❌ 推送失败] type=${type}: ${error}`);
        }
    }

    private async getSessionOwnerId(conversationId: string): Promise<string | null> {
        const session = await db.session.findUnique({
            where: { id: conversationId },
            select: { accountId: true },
        });
        return session?.accountId ?? null;
    }

    private async incrementBadgeCount(ownerId: string): Promise<number> {
        const updated = await db.account.update({
            where: { id: ownerId },
            data: { badgeCount: { increment: 1 } },
            select: { badgeCount: true },
        });
        return updated.badgeCount;
    }

    private async sendChunked(messages: ExpoPushMessage[], conversationId: string, type: NotificationType): Promise<void> {
        const chunks = this.expo.chunkPushNotifications(messages);
        for (const chunk of chunks) {
            try {
                const tickets = await this.expo.sendPushNotificationsAsync(chunk);
                const errors = tickets.filter(t => t.status === 'error');
                if (errors.length > 0) {
                    log({ module: 'notification-manager', sessionId: conversationId },
                        `[⚠️ 部分失败] type=${type}, failed=${errors.length}/${tickets.length}`,
                        errors.map(e => e.message));
                }
            } catch (error) {
                log({ module: 'notification-manager', level: 'error', sessionId: conversationId },
                    `[❌ chunk 发送失败] type=${type}: ${error}`);
            }
        }
    }
}

export function getNotificationManager(): NotificationManager {
    return NotificationManager.getInstance();
}
