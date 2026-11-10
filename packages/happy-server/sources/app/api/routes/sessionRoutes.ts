import { isSessionThinking } from "@/app/presence/sessionTurnRuntime";
import { eventRouter, buildNewSessionUpdate } from "@/app/events/eventRouter";
import { type Fastify } from "../types";
import { db } from "@/storage/db";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { log } from "@/utils/log";
import { randomKeyNaked } from "@/utils/randomKeyNaked";
import { allocateUserSeq } from "@/storage/seq";
import { sessionDelete } from "@/app/session/sessionDelete";
import { invokeUserRpc } from "@/app/api/socket/rpcRegistry";
import { canViewSession } from "@/app/share/accessControl";
import { emitSessionCapabilitiesUpdate, updateSessionCapabilitiesAtomic } from "@/app/session/sessionCapabilities";

type SessionListRow = {
    id: string;
    seq: number;
    createdAt: Date;
    updatedAt: Date;
    metadata: string;
    metadataVersion: number;
    agentState: string | null;
    agentStateVersion: number;
    dataEncryptionKey: Uint8Array | null;
    active: boolean;
    lastActiveAt: Date;
    lastMessageAt: Date | null;
    _count: { shares: number };
    publicShare: { id: string } | null;
};

function serializeSessionRow(v: SessionListRow) {
    return {
        id: v.id,
        seq: v.seq,
        createdAt: v.createdAt.getTime(),
        updatedAt: v.updatedAt.getTime(),
        active: v.active,
        activeAt: v.lastActiveAt.getTime(),
        lastMessageAt: v.lastMessageAt?.getTime() ?? null,
        metadata: v.metadata,
        metadataVersion: v.metadataVersion,
        agentState: v.agentState,
        agentStateVersion: v.agentStateVersion,
        dataEncryptionKey: v.dataEncryptionKey ? Buffer.from(v.dataEncryptionKey).toString('base64') : null,
        lastMessage: null,
        isShared: (v._count.shares > 0) || (v.publicShare !== null)
    };
}

const sessionListSelect = {
    id: true,
    seq: true,
    createdAt: true,
    updatedAt: true,
    metadata: true,
    metadataVersion: true,
    agentState: true,
    agentStateVersion: true,
    dataEncryptionKey: true,
    active: true,
    lastActiveAt: true,
    lastMessageAt: true,
    _count: { select: { shares: true } },
    publicShare: { select: { id: true } },
} satisfies Prisma.SessionSelect;

export function sessionRoutes(app: Fastify) {

    // Sessions API
    app.get('/v1/sessions', {
        preHandler: app.authenticate,
        schema: {
            querystring: z.object({
                since: z.coerce.number().int().nonnegative().optional(),
                beforeUpdatedAt: z.coerce.number().int().nonnegative().optional(),
                beforeId: z.string().optional(),
                limit: z.coerce.number().int().min(1).max(500).optional()
            }).optional()
        }
    }, async (request, reply) => {
        const userId = request.userId;
        const since = request.query?.since;
        const beforeUpdatedAt = request.query?.beforeUpdatedAt;
        const beforeId = request.query?.beforeId;
        const requestedLimit = request.query?.limit;
        const incremental = typeof since === 'number';
        const paginatingOlder = !incremental && typeof beforeUpdatedAt === 'number';

        // When incremental, order by updatedAt asc so the max(updatedAt) of
        // the response is the new cursor. Otherwise preserve legacy
        // "createdAt desc" ordering for backward compatibility. Older-page
        // requests are sorted by updatedAt desc with id as a stable tie-breaker
        // to match the recent sessions screen.
        const where: Prisma.SessionWhereInput = incremental
            ? { accountId: userId, updatedAt: { gt: new Date(since!) } }
            : { accountId: userId };

        if (paginatingOlder) {
            where.OR = beforeId
                ? [
                    { updatedAt: { lt: new Date(beforeUpdatedAt!) } },
                    { updatedAt: new Date(beforeUpdatedAt!), id: { lt: beforeId } }
                ]
                : [{ updatedAt: { lt: new Date(beforeUpdatedAt!) } }];
        }

        const take = incremental ? 500 : (requestedLimit ?? 150);
        const [sessions, deletedSessions] = await Promise.all([
            db.session.findMany({
                where,
                orderBy: incremental
                    ? { updatedAt: 'asc' }
                    : paginatingOlder
                        ? [{ updatedAt: 'desc' }, { id: 'desc' }]
                        : { createdAt: 'desc' },
                take,
                select: sessionListSelect
            }),
            incremental
                ? db.sessionDeletion.findMany({
                    where: {
                        accountId: userId,
                        deletedAt: { gt: new Date(since!) }
                    },
                    orderBy: { deletedAt: 'asc' },
                    take: 500,
                    select: {
                        sessionId: true,
                        deletedAt: true
                    }
                })
                : Promise.resolve([])
        ]);

        let cursor = since ?? 0;
        for (const session of sessions) {
            cursor = Math.max(cursor, session.updatedAt.getTime());
        }
        for (const deleted of deletedSessions) {
            cursor = Math.max(cursor, deleted.deletedAt.getTime());
        }
        if (incremental && sessions.length >= 500) {
            cursor = Math.min(cursor, sessions[sessions.length - 1].updatedAt.getTime());
        }
        if (incremental && deletedSessions.length >= 500) {
            cursor = Math.min(cursor, deletedSessions[deletedSessions.length - 1].deletedAt.getTime());
        }

        return reply.send({
            sessions: sessions.map(serializeSessionRow),
            deletedSessionIds: deletedSessions.map((v) => v.sessionId),
            cursor
        });
    });

    app.post('/v1/sessions/diff', {
        preHandler: app.authenticate,
        schema: {
            body: z.object({
                since: z.number().int().nonnegative().optional(),
                known: z.record(z.string(), z.number().int().nonnegative()).default({})
            })
        }
    }, async (request, reply) => {
        const userId = request.userId;
        const since = request.body.since;
        const known = request.body.known ?? {};
        const knownIds = Object.keys(known);

        if (knownIds.length > 2000) {
            return reply.code(413).send({ error: 'Too many known sessions', limit: 2000 });
        }

        const [knownRows, changedRows, deletedRows] = await Promise.all([
            knownIds.length > 0
                ? db.session.findMany({
                    where: {
                        accountId: userId,
                        id: { in: knownIds }
                    },
                    select: sessionListSelect
                })
                : Promise.resolve([]),
            typeof since === 'number'
                ? db.session.findMany({
                    where: {
                        accountId: userId,
                        updatedAt: { gt: new Date(since) }
                    },
                    orderBy: { updatedAt: 'asc' },
                    take: 500,
                    select: sessionListSelect
                })
                : Promise.resolve([]),
            typeof since === 'number'
                ? db.sessionDeletion.findMany({
                    where: {
                        accountId: userId,
                        deletedAt: { gt: new Date(since) }
                    },
                    orderBy: { deletedAt: 'asc' },
                    take: 500,
                    select: {
                        sessionId: true,
                        deletedAt: true
                    }
                })
                : Promise.resolve([])
        ]);

        const existingKnownIds = new Set(knownRows.map(row => row.id));
        const deletedSessionIds = new Set<string>();
        for (const id of knownIds) {
            if (!existingKnownIds.has(id)) {
                deletedSessionIds.add(id);
            }
        }
        for (const row of deletedRows) {
            deletedSessionIds.add(row.sessionId);
        }

        const sessionRows = new Map<string, SessionListRow>();
        for (const row of changedRows) {
            sessionRows.set(row.id, row);
        }
        for (const row of knownRows) {
            if (row.updatedAt.getTime() !== known[row.id]) {
                sessionRows.set(row.id, row);
            }
        }

        let cursor = since ?? 0;
        for (const row of changedRows) {
            cursor = Math.max(cursor, row.updatedAt.getTime());
        }
        for (const row of deletedRows) {
            cursor = Math.max(cursor, row.deletedAt.getTime());
        }
        if (changedRows.length >= 500) {
            cursor = Math.min(cursor, changedRows[changedRows.length - 1].updatedAt.getTime());
        }
        if (deletedRows.length >= 500) {
            cursor = Math.min(cursor, deletedRows[deletedRows.length - 1].deletedAt.getTime());
        }

        return reply.send({
            sessions: Array.from(sessionRows.values()).map(serializeSessionRow),
            deletedSessionIds: Array.from(deletedSessionIds),
            cursor
        });
    });

    // V2 Sessions API - Active sessions only
    app.get('/v2/sessions/active', {
        preHandler: app.authenticate,
        schema: {
            querystring: z.object({
                limit: z.coerce.number().int().min(1).max(500).default(150)
            }).optional()
        }
    }, async (request, reply) => {
        const userId = request.userId;
        const limit = request.query?.limit || 150;

        const sessions = await db.session.findMany({
            where: {
                accountId: userId,
                active: true,
                lastActiveAt: { gt: new Date(Date.now() - 1000 * 60 * 15) /* 15 minutes */ }
            },
            orderBy: { lastActiveAt: 'desc' },
            take: limit,
            select: {
                id: true,
                seq: true,
                createdAt: true,
                updatedAt: true,
                metadata: true,
                metadataVersion: true,
                agentState: true,
                agentStateVersion: true,
                dataEncryptionKey: true,
                active: true,
                lastActiveAt: true,
                lastMessageAt: true,
            }
        });

        return reply.send({
            sessions: sessions.map((v) => ({
                id: v.id,
                seq: v.seq,
                createdAt: v.createdAt.getTime(),
                updatedAt: v.updatedAt.getTime(),
                active: v.active,
                activeAt: v.lastActiveAt.getTime(),
                lastMessageAt: v.lastMessageAt?.getTime() ?? null,
                metadata: v.metadata,
                metadataVersion: v.metadataVersion,
                agentState: v.agentState,
                agentStateVersion: v.agentStateVersion,
                dataEncryptionKey: v.dataEncryptionKey ? Buffer.from(v.dataEncryptionKey).toString('base64') : null,
                // The watch reads sessions over HTTP and has no socket to hear the agent's turns
                thinking: isSessionThinking(v.id),
            }))
        });
    });

    // V2 Sessions API - Cursor-based pagination with change tracking
    app.get('/v2/sessions', {
        preHandler: app.authenticate,
        schema: {
            querystring: z.object({
                cursor: z.string().optional(),
                limit: z.coerce.number().int().min(1).max(200).default(50),
                changedSince: z.coerce.number().int().positive().optional()
            }).optional()
        }
    }, async (request, reply) => {
        const userId = request.userId;
        const { cursor, limit = 50, changedSince } = request.query || {};

        // Decode cursor - simple ID-based cursor
        let cursorSessionId: string | undefined;
        if (cursor) {
            if (cursor.startsWith('cursor_v1_')) {
                cursorSessionId = cursor.substring(10);
            } else {
                return reply.code(400).send({ error: 'Invalid cursor format' });
            }
        }

        // Build where clause
        const where: Prisma.SessionWhereInput = { accountId: userId };

        // Add changedSince filter (just a filter, doesn't affect pagination)
        if (changedSince) {
            where.updatedAt = {
                gt: new Date(changedSince)
            };
        }

        // Add cursor pagination - always by ID descending (most recent first)
        if (cursorSessionId) {
            where.id = {
                lt: cursorSessionId  // Get sessions with ID less than cursor (for desc order)
            };
        }

        // Always sort by ID descending for consistent pagination
        const orderBy = { id: 'desc' as const };

        const sessions = await db.session.findMany({
            where,
            orderBy,
            take: limit + 1, // Fetch one extra to determine if there are more
            select: {
                id: true,
                seq: true,
                createdAt: true,
                updatedAt: true,
                metadata: true,
                metadataVersion: true,
                agentState: true,
                agentStateVersion: true,
                dataEncryptionKey: true,
                active: true,
                lastActiveAt: true,
                lastMessageAt: true,
            }
        });

        // Check if there are more results
        const hasNext = sessions.length > limit;
        const resultSessions = hasNext ? sessions.slice(0, limit) : sessions;

        // Generate next cursor - simple ID-based cursor
        let nextCursor: string | null = null;
        if (hasNext && resultSessions.length > 0) {
            const lastSession = resultSessions[resultSessions.length - 1];
            nextCursor = `cursor_v1_${lastSession.id}`;
        }

        return reply.send({
            sessions: resultSessions.map((v) => ({
                id: v.id,
                seq: v.seq,
                createdAt: v.createdAt.getTime(),
                updatedAt: v.updatedAt.getTime(),
                active: v.active,
                activeAt: v.lastActiveAt.getTime(),
                lastMessageAt: v.lastMessageAt?.getTime() ?? null,
                metadata: v.metadata,
                metadataVersion: v.metadataVersion,
                agentState: v.agentState,
                agentStateVersion: v.agentStateVersion,
                dataEncryptionKey: v.dataEncryptionKey ? Buffer.from(v.dataEncryptionKey).toString('base64') : null,
            })),
            nextCursor,
            hasNext
        });
    });

    // Spawn a new session on a machine (proxies RPC to daemon)
    app.post('/v1/sessions/spawn', {
        schema: {
            body: z.object({
                machineId: z.string(),
                params: z.string(),  // E2E-encrypted spawn parameters
            })
        },
        preHandler: app.authenticate
    }, async (request, reply) => {
        const userId = request.userId;
        const { machineId, params } = request.body;

        // Verify machine belongs to the user
        const machine = await db.machine.findFirst({
            where: { id: machineId, accountId: userId }
        });
        if (!machine) {
            return reply.code(404).send({ ok: false, error: 'Machine not found' });
        }

        try {
            const result = await invokeUserRpc(
                userId,
                `${machineId}:spawn-happy-session`,
                params,
                30000
            );
            return reply.send({ ok: true, result });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'RPC call failed';
            const isTimeout = message.includes('timeout');
            return reply.code(isTimeout ? 504 : 502).send({
                ok: false,
                error: message
            });
        }
    });

    // Create or load session by tag
    app.post('/v1/sessions', {
        schema: {
            body: z.object({
                tag: z.string(),
                metadata: z.string(),
                agentState: z.string().nullish(),
                dataEncryptionKey: z.string().nullish()
            })
        },
        preHandler: app.authenticate
    }, async (request, reply) => {
        const userId = request.userId;
        const { tag, metadata, dataEncryptionKey } = request.body;

        const session = await db.session.findFirst({
            where: {
                accountId: userId,
                tag: tag
            }
        });
        if (session) {
            log({ module: 'session-create', sessionId: session.id, userId, tag }, `Found existing session: ${session.id} for tag ${tag}`);
            return reply.send({
                session: {
                    id: session.id,
                    seq: session.seq,
                    metadata: session.metadata,
                    metadataVersion: session.metadataVersion,
                    agentState: session.agentState,
                    agentStateVersion: session.agentStateVersion,
                    dataEncryptionKey: session.dataEncryptionKey ? Buffer.from(session.dataEncryptionKey).toString('base64') : null,
                    active: session.active,
                    activeAt: session.lastActiveAt.getTime(),
                    lastMessageAt: session.lastMessageAt?.getTime() ?? null,
                    createdAt: session.createdAt.getTime(),
                    updatedAt: session.updatedAt.getTime(),
                    lastMessage: null
                }
            });
        } else {

            // Resolve seq
            const updSeq = await allocateUserSeq(userId);

            // Create session
            log({ module: 'session-create', userId, tag }, `Creating new session for user ${userId} with tag ${tag}`);
            const session = await db.session.create({
                data: {
                    accountId: userId,
                    tag: tag,
                    metadata: metadata,
                    dataEncryptionKey: dataEncryptionKey ? new Uint8Array(Buffer.from(dataEncryptionKey, 'base64')) : undefined
                }
            });
            log({ module: 'session-create', sessionId: session.id, userId }, `Session created: ${session.id}`);

            // Emit new session update
            const updatePayload = buildNewSessionUpdate(session, updSeq, randomKeyNaked(12));
            log({
                module: 'session-create',
                userId,
                sessionId: session.id,
                updateType: 'new-session',
                updatePayload: JSON.stringify(updatePayload)
            }, `Emitting new-session update to user-scoped connections`);
            eventRouter.emitUpdate({
                userId,
                payload: updatePayload,
                recipientFilter: { type: 'user-scoped-only' }
            });

            return reply.send({
                session: {
                    id: session.id,
                    seq: session.seq,
                    metadata: session.metadata,
                    metadataVersion: session.metadataVersion,
                    agentState: session.agentState,
                    agentStateVersion: session.agentStateVersion,
                    dataEncryptionKey: session.dataEncryptionKey ? Buffer.from(session.dataEncryptionKey).toString('base64') : null,
                    active: session.active,
                    activeAt: session.lastActiveAt.getTime(),
                    lastMessageAt: session.lastMessageAt?.getTime() ?? null,
                    createdAt: session.createdAt.getTime(),
                    updatedAt: session.updatedAt.getTime(),
                    lastMessage: null
                }
            });
        }
    });


    app.get('/v1/sessions/:sessionId/capabilities', {
        preHandler: app.authenticate,
        schema: {
            params: z.object({
                sessionId: z.string(),
            })
        }
    }, async (request, reply) => {
        const userId = request.userId;
        const { sessionId } = request.params;

        if (!await canViewSession(userId, sessionId)) {
            return reply.code(404).send({ error: 'Session not found' });
        }

        const capabilities = await db.sessionCapabilities.findUnique({
            where: { sessionId },
            select: { payload: true, version: true, updatedAt: true }
        });

        return reply.send({
            capabilities: capabilities ? {
                payload: capabilities.payload,
                version: capabilities.version,
                updatedAt: capabilities.updatedAt.getTime(),
            } : null
        });
    });

    // A session's current metadata, for its own CLI to catch up on after a reconnect: an archive
    // written while it was offline reaches it no other way. Owner only, read-only.
    app.get('/v1/sessions/:sessionId/metadata', {
        preHandler: app.authenticate,
        schema: {
            params: z.object({
                sessionId: z.string(),
            })
        }
    }, async (request, reply) => {
        const userId = request.userId;
        const { sessionId } = request.params;

        const session = await db.session.findUnique({
            where: { id: sessionId, accountId: userId },
            select: { metadata: true, metadataVersion: true }
        });
        if (!session) {
            return reply.code(404).send({ error: 'Session not found' });
        }

        return reply.send({ metadata: session.metadata, metadataVersion: session.metadataVersion });
    });

    app.put('/v1/sessions/:sessionId/capabilities', {
        preHandler: app.authenticate,
        schema: {
            params: z.object({
                sessionId: z.string(),
            }),
            body: z.object({
                payload: z.string(),
                expectedVersion: z.number().int().nonnegative().optional(),
            })
        }
    }, async (request, reply) => {
        const userId = request.userId;
        const { sessionId } = request.params;
        const { payload, expectedVersion } = request.body;

        const session = await db.session.findUnique({
            where: { id: sessionId, accountId: userId },
            select: { id: true }
        });
        if (!session) {
            return reply.code(404).send({ error: 'Session not found' });
        }

        const existing = await db.sessionCapabilities.findUnique({
            where: { sessionId },
            select: { version: true, payload: true }
        });

        const versionToUpdate = expectedVersion ?? (existing?.version ?? 0);
        if (typeof expectedVersion === 'number' && (existing?.version ?? 0) !== expectedVersion) {
            return reply.code(409).send({
                result: 'version-mismatch',
                version: existing?.version ?? 0,
                payload: existing?.payload ?? null,
            });
        }

        const result = await updateSessionCapabilitiesAtomic(sessionId, payload, versionToUpdate);
        if (result.result === 'version-mismatch') {
            return reply.code(409).send(result);
        }

        await emitSessionCapabilitiesUpdate({
            ownerId: userId,
            sessionId,
            payload,
            version: result.version
        });

        const capabilities = await db.sessionCapabilities.findUniqueOrThrow({
            where: { sessionId },
            select: { payload: true, version: true, updatedAt: true }
        });

        return reply.send({
            result: 'success',
            capabilities: {
                payload: capabilities.payload,
                version: capabilities.version,
                updatedAt: capabilities.updatedAt.getTime(),
            }
        });
    });

    // @deprecated Use GET /v3/sessions/:sessionId/messages instead.
    // v3 supports after_seq (forward), before_seq (backward), and no-params (latest) modes.
    app.get('/v1/sessions/:sessionId/messages', {
        schema: {
            params: z.object({
                sessionId: z.string()
            }),
            querystring: z.object({
                before: z.coerce.number().int().optional(),
                limit: z.coerce.number().int().min(1).max(200).default(150),
            })
        },
        preHandler: app.authenticate
    }, async (request, reply) => {
        const userId = request.userId;
        const { sessionId } = request.params;
        const { before, limit } = request.query;

        // Verify session belongs to user
        const session = await db.session.findFirst({
            where: {
                id: sessionId,
                accountId: userId
            }
        });

        if (!session) {
            return reply.code(404).send({ error: 'Session not found' });
        }

        const messages = await db.sessionMessage.findMany({
            where: {
                sessionId,
                ...(before !== undefined ? { seq: { lt: before } } : {}),
            },
            orderBy: { seq: 'desc' },
            take: limit + 1,
            select: {
                id: true,
                seq: true,
                localId: true,
                content: true,
                createdAt: true,
                updatedAt: true
            }
        });

        const hasMore = messages.length > limit;
        const result = messages.slice(0, limit);

        return reply.send({
            messages: result.map((v) => ({
                id: v.id,
                seq: v.seq,
                content: v.content,
                localId: v.localId,
                createdAt: v.createdAt.getTime(),
                updatedAt: v.updatedAt.getTime()
            })),
            hasMore
        });
    });

    // Delete session
    app.delete('/v1/sessions/:sessionId', {
        schema: {
            params: z.object({
                sessionId: z.string()
            })
        },
        preHandler: app.authenticate
    }, async (request, reply) => {
        const userId = request.userId;
        const { sessionId } = request.params;

        const deleted = await sessionDelete({ uid: userId }, sessionId);

        if (!deleted) {
            return reply.code(404).send({ error: 'Session not found or not owned by user' });
        }

        return reply.send({ success: true });
    });
}
