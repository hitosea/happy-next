import { z } from "zod";
import { type Fastify } from "../types";
import { db } from "@/storage/db";
import { inferPushTokenProvider } from "./pushTokenProvider";
import { selectPushTokensForClient, supportsDooPushRelay } from "./pushTokenSelection";
import {
    beginPushRelay,
    completePushRelay,
    failPushRelay,
} from "./pushRelayGuard";

const MAX_RELAY_DEVICE_COUNT = 100;
const OPPO_PUSH_CATEGORY = 'TODO';
const dooPushBatchResponseSchema = z.object({
    data: z.array(z.unknown()),
});
const DEFINITELY_NOT_SENT_ERROR_CODES = new Set([
    'ECONNREFUSED',
    'ENOTFOUND',
    'EAI_AGAIN',
    'UND_ERR_CONNECT_TIMEOUT',
]);

function isDefinitelyNotSent(error: unknown): boolean {
    if (!error || typeof error !== 'object' || !('cause' in error)) {
        return false;
    }
    const cause = error.cause;
    return Boolean(
        cause
        && typeof cause === 'object'
        && 'code' in cause
        && typeof cause.code === 'string'
        && DEFINITELY_NOT_SENT_ERROR_CODES.has(cause.code),
    );
}

function isDefinitelyRejectedStatus(status: number): boolean {
    return status >= 400 && status < 500;
}

export function pushRoutes(app: Fastify) {

    // Relay one logical notification to every DooPush device owned by the
    // authenticated account. Tokens remain a server-side implementation detail.
    app.post('/v1/push/send', {
        bodyLimit: 16 * 1024,
        schema: {
            body: z.object({
                idempotencyKey: z.string().uuid(),
                title: z.string().min(1).max(200),
                body: z.string().min(1).max(2_048),
                badge: z.number().int().nonnegative().optional(),
                data: z.record(z.unknown()).optional()
            }),
            response: {
                200: z.object({
                    accepted: z.literal(true),
                    duplicate: z.boolean(),
                    deviceCount: z.number().int().nonnegative()
                }),
                202: z.object({
                    accepted: z.literal(false),
                    duplicate: z.literal(true),
                    state: z.literal('processing'),
                    deviceCount: z.number().int().nonnegative()
                }),
                409: z.object({ error: z.literal('Too many push devices') }),
                429: z.object({ error: z.literal('Push rate limit exceeded'), retryAfterSeconds: z.number().int().positive() }),
                503: z.object({ error: z.enum(['DooPush is not configured', 'Push relay unavailable']) }),
                502: z.object({ error: z.literal('Failed to send push notification') })
            }
        },
        preHandler: app.authenticate
    }, async (request, reply) => {
        const appId = process.env.DOOPUSH_APP_ID?.trim();
        const appSecret = process.env.DOOPUSH_APP_SECRET?.trim();
        const baseURL = (process.env.DOOPUSH_BASE_URL?.trim() || 'https://doopush.com/api/v1').replace(/\/+$/, '');
        if (!appId || !appSecret) {
            return reply.code(503).send({ error: 'DooPush is not configured' });
        }

        const ownedTokens = await db.accountPushToken.findMany({
            where: {
                accountId: request.userId,
                provider: 'doopush'
            },
            orderBy: { updatedAt: 'desc' },
            take: MAX_RELAY_DEVICE_COUNT + 1,
            select: { token: true }
        });
        if (ownedTokens.length > MAX_RELAY_DEVICE_COUNT) {
            return reply.code(409).send({ error: 'Too many push devices' });
        }

        const deviceCount = ownedTokens.length;
        let relayStart;
        try {
            relayStart = await beginPushRelay(
                request.userId,
                request.body.idempotencyKey,
                deviceCount,
            );
        } catch {
            return reply.code(503).send({ error: 'Push relay unavailable' });
        }
        if (relayStart.status === 'succeeded') {
            return reply.send({
                accepted: true,
                duplicate: true,
                deviceCount: relayStart.deviceCount
            });
        }
        if (relayStart.status === 'processing') {
            return reply.code(202).send({
                accepted: false,
                duplicate: true,
                state: 'processing',
                deviceCount: relayStart.deviceCount
            });
        }
        if (relayStart.status === 'rate-limited') {
            reply.header('Retry-After', relayStart.retryAfterSeconds);
            return reply.code(429).send({
                error: 'Push rate limit exceeded',
                retryAfterSeconds: relayStart.retryAfterSeconds
            });
        }
        const claimId = relayStart.claimId;
        if (!claimId) {
            return reply.code(503).send({ error: 'Push relay unavailable' });
        }
        if (deviceCount === 0) {
            await completePushRelay(
                request.userId,
                request.body.idempotencyKey,
                claimId,
                0,
            ).catch(() => undefined);
            return reply.send({ accepted: true, duplicate: false, deviceCount: 0 });
        }

        try {
            const response = await fetch(
                `${baseURL}/apps/${encodeURIComponent(appId)}/push/batch`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${appSecret}`
                    },
                    signal: AbortSignal.timeout(15_000),
                    body: JSON.stringify({
                        title: request.body.title,
                        content: request.body.body,
                        badge: request.body.badge,
                        device_ids: ownedTokens.map(({ token }) => token),
                        payload: {
                            action: 'open_page',
                            data: JSON.stringify(request.body.data ?? {}),
                            oppo: {
                                category: OPPO_PUSH_CATEGORY,
                            },
                        }
                    })
                }
            );
            if (!response.ok) {
                if (isDefinitelyRejectedStatus(response.status)) {
                    await failPushRelay(
                        request.userId,
                        request.body.idempotencyKey,
                        claimId,
                    ).catch(() => undefined);
                }
                return reply.code(502).send({ error: 'Failed to send push notification' });
            }
            const batchResult = dooPushBatchResponseSchema.parse(await response.json());
            const acceptedDeviceCount = batchResult.data.length;
            if (acceptedDeviceCount > deviceCount) {
                throw new Error('DooPush accepted more devices than requested');
            }
            await completePushRelay(
                request.userId,
                request.body.idempotencyKey,
                claimId,
                acceptedDeviceCount,
            ).catch(() => undefined);
            return reply.send({ accepted: true, duplicate: false, deviceCount: acceptedDeviceCount });
        } catch (error) {
            if (isDefinitelyNotSent(error)) {
                await failPushRelay(
                    request.userId,
                    request.body.idempotencyKey,
                    claimId,
                ).catch(() => undefined);
            }
            // Keep the claim because a timeout may happen after DooPush accepted
            // the request. A retry with the same key must not duplicate delivery.
            return reply.code(502).send({ error: 'Failed to send push notification' });
        }
    });

    // Push Token Registration API
    app.post('/v1/push-tokens', {
        schema: {
            body: z.object({
                token: z.string(),
                provider: z.enum(['expo', 'doopush']).optional(),
                installationId: z.string().uuid().optional()
            }),
            response: {
                200: z.object({
                    success: z.literal(true)
                }),
                500: z.object({
                    error: z.literal('Failed to register push token')
                })
            }
        },
        preHandler: app.authenticate
    }, async (request, reply) => {
        const userId = request.userId;
        const { token } = request.body;
        const provider = request.body.provider ?? inferPushTokenProvider(token);
        const installationId = request.body.installationId ?? null;

        try {
            await db.accountPushToken.upsert({
                where: {
                    token
                },
                update: {
                    accountId: userId,
                    provider,
                    installationId,
                    updatedAt: new Date()
                },
                create: {
                    accountId: userId,
                    token: token,
                    provider,
                    installationId
                }
            });

            return reply.send({ success: true });
        } catch (error) {
            return reply.code(500).send({ error: 'Failed to register push token' });
        }
    });

    // Delete Push Token API
    app.delete('/v1/push-tokens/:token', {
        schema: {
            params: z.object({
                token: z.string()
            }),
            response: {
                200: z.object({
                    success: z.literal(true)
                }),
                500: z.object({
                    error: z.literal('Failed to delete push token')
                })
            }
        },
        preHandler: app.authenticate
    }, async (request, reply) => {
        const userId = request.userId;
        const { token } = request.params;

        try {
            await db.accountPushToken.deleteMany({
                where: {
                    accountId: userId,
                    token: token
                }
            });

            return reply.send({ success: true });
        } catch (error) {
            return reply.code(500).send({ error: 'Failed to delete push token' });
        }
    });

    // Get Push Tokens API
    app.get('/v1/push-tokens', {
        preHandler: app.authenticate
    }, async (request, reply) => {
        const userId = request.userId;

        try {
            const storedTokens = await db.accountPushToken.findMany({
                where: {
                    accountId: userId
                },
                orderBy: {
                    createdAt: 'desc'
                }
            });
            const dooPushRelayConfigured = Boolean(
                process.env.DOOPUSH_APP_ID?.trim()
                && process.env.DOOPUSH_APP_SECRET?.trim(),
            );
            const tokens = selectPushTokensForClient(
                storedTokens,
                dooPushRelayConfigured
                && supportsDooPushRelay(request.headers['x-happy-push-capabilities']),
            );

            return reply.send({
                tokens: tokens.map(t => ({
                    id: t.id,
                    token: t.token,
                    provider: t.provider,
                    createdAt: t.createdAt.getTime(),
                    updatedAt: t.updatedAt.getTime()
                }))
            });
        } catch (error) {
            return reply.code(500).send({ error: 'Failed to get push tokens' });
        }
    });

    // Increment badge count and return new value (called by CLI before sending push)
    app.post('/v1/badge/increment', {
        schema: {
            response: {
                200: z.object({
                    badgeCount: z.number()
                })
            }
        },
        preHandler: app.authenticate
    }, async (request, reply) => {
        const userId = request.userId;
        const account = await db.account.update({
            where: { id: userId },
            data: { badgeCount: { increment: 1 } },
            select: { badgeCount: true }
        });
        return reply.send({ badgeCount: account.badgeCount });
    });

    // Reset badge count to zero (called by App when user opens or backgrounds the app)
    app.post('/v1/badge/reset', {
        schema: {
            response: {
                200: z.object({
                    success: z.literal(true)
                })
            }
        },
        preHandler: app.authenticate
    }, async (request, reply) => {
        const userId = request.userId;
        await db.account.update({
            where: { id: userId },
            data: { badgeCount: 0 }
        });
        return reply.send({ success: true });
    });
}
