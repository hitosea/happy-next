import fastify from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Fastify } from "../types";

type ShareRow = { id: string; sessionId: string; sharedWithUserId: string };

const mocks = vi.hoisted(() => {
    const state = {
        userId: 'owner',
        canManage: true,
        session: {
            id: 's1', accountId: 'owner', seq: 1,
            metadata: 'encrypted', metadataVersion: 1,
            agentState: null, agentStateVersion: 0, dataEncryptionKey: null,
            active: true, lastActiveAt: new Date(1000),
            createdAt: new Date(1000), updatedAt: new Date(1000),
        },
        shares: [] as ShareRow[],
        publicShare: null as { id: string } | null,
    };
    const findShare = (args: any) => state.shares.find(share => {
        const where = args.where;
        const recipient = where.sessionId_sharedWithUserId;
        return recipient
            ? share.sessionId === recipient.sessionId && share.sharedWithUserId === recipient.sharedWithUserId
            : share.id === where.id && share.sessionId === where.sessionId;
    }) ?? null;
    const db = {
        session: {
            findUnique: vi.fn(async (args: any) => args.where.id === state.session.id ? state.session : null),
            findMany: vi.fn(async (args: any) => {
                const row = state.session;
                if (args.where.accountId !== row.accountId) return [];
                if (args.where.updatedAt?.gt && row.updatedAt <= args.where.updatedAt.gt) return [];
                return [{
                    ...row,
                    _count: { shares: state.shares.filter(share => share.sessionId === row.id).length },
                    publicShare: state.publicShare,
                }];
            }),
            // Prisma leaves @updatedAt unchanged for an empty update.
            update: vi.fn(async (args: any) => {
                Object.assign(state.session, args.data);
                return state.session;
            }),
        },
        sessionShare: {
            findUnique: vi.fn(async (args: any) => findShare(args)),
            delete: vi.fn(async (args: any) => {
                const share = findShare(args);
                state.shares = state.shares.filter(row => row !== share);
                return share;
            }),
        },
        sessionDeletion: { findMany: vi.fn(async () => []) },
        $transaction: vi.fn(async (run: (tx: unknown) => unknown) => run(db)),
    };
    return { state, db, emitUpdate: vi.fn() };
});

vi.mock("@/storage/db", () => ({ db: mocks.db }));
vi.mock("@/storage/files", () => ({ getPublicUrl: (path: string) => path }));
vi.mock("@/app/share/accessControl", () => ({
    canManageSharing: vi.fn(async () => mocks.state.canManage),
    areFriends: vi.fn(async () => true),
    canViewSession: vi.fn(async () => true),
}));
vi.mock("@/app/events/eventRouter", () => ({
    eventRouter: { emitUpdate: mocks.emitUpdate },
    buildNewSessionUpdate: vi.fn(),
    buildSessionSharedUpdate: vi.fn(),
    buildSessionShareUpdatedUpdate: vi.fn(),
    buildSessionShareRevokedUpdate: (shareId: string, sessionId: string, seq: number, id: string) => ({
        id, seq, body: { t: 'session-share-revoked', sessionId, shareId }, createdAt: Date.now(),
    }),
    buildUpdateSessionUpdate: (sessionId: string, seq: number, id: string) => ({
        id, seq, body: { t: 'update-session', id: sessionId }, createdAt: Date.now(),
    }),
}));
vi.mock("@/storage/seq", () => ({ allocateUserSeq: vi.fn(async () => 1) }));
vi.mock("@/utils/randomKeyNaked", () => ({ randomKeyNaked: () => 'update-id' }));
vi.mock("@/utils/log", () => ({ log: () => {} }));
vi.mock("@/app/session/sessionDelete", () => ({ sessionDelete: vi.fn() }));
vi.mock("@/app/api/socket/rpcRegistry", () => ({ invokeUserRpc: vi.fn() }));

import { shareRoutes } from "./shareRoutes";
import { sessionRoutes } from "./sessionRoutes";

describe('sharing changes in the owner session list', () => {
    let app: ReturnType<typeof fastify>;

    beforeEach(async () => {
        vi.clearAllMocks();
        mocks.state.userId = 'owner';
        mocks.state.canManage = true;
        mocks.state.session.active = true;
        mocks.state.session.updatedAt = new Date(1000);
        mocks.state.shares = [{ id: 'share-1', sessionId: 's1', sharedWithUserId: 'recipient' }];
        mocks.state.publicShare = null;
        app = fastify();
        app.setValidatorCompiler(validatorCompiler);
        app.setSerializerCompiler(serializerCompiler);
        app.decorate('authenticate', async (request: any) => { request.userId = mocks.state.userId; });
        shareRoutes(app as unknown as Fastify);
        sessionRoutes(app as unknown as Fastify);
        await app.ready();
    });

    afterEach(async () => { await app.close(); });

    function expectOwnerRefresh() {
        expect(mocks.emitUpdate).toHaveBeenCalledWith(expect.objectContaining({
            userId: 'owner',
            recipientFilter: { type: 'user-scoped-only' },
            payload: expect.objectContaining({ body: { t: 'update-session', id: 's1' } }),
        }));
    }

    it('clears the last direct share through incremental sync and stays unshared after archiving', async () => {
        const initial = (await app.inject({ method: 'GET', url: '/v1/sessions' })).json();
        expect(initial.sessions[0].isShared).toBe(true);

        const removal = await app.inject({ method: 'DELETE', url: '/v1/sessions/s1/shares/share-1' });
        expect(removal.statusCode).toBe(200);
        expectOwnerRefresh();
        expect(mocks.emitUpdate).toHaveBeenCalledWith(expect.objectContaining({
            userId: 'recipient',
            payload: expect.objectContaining({ body: { t: 'session-share-revoked', sessionId: 's1', shareId: 'share-1' } }),
        }));

        const refreshed = (await app.inject({ method: 'GET', url: `/v1/sessions?since=${initial.cursor}` })).json();
        expect(refreshed.sessions).toHaveLength(1);
        expect(refreshed.sessions[0].isShared).toBe(false);
        expect(refreshed.cursor).toBeGreaterThan(initial.cursor);

        mocks.state.session.active = false;
        const archived = (await app.inject({ method: 'GET', url: '/v1/sessions' })).json();
        expect(archived.sessions[0]).toMatchObject({ active: false, isShared: false });
    });

    it.each(['another recipient', 'a public link'])('keeps the session shared when %s remains', async remaining => {
        if (remaining === 'another recipient') {
            mocks.state.shares.push({ id: 'share-2', sessionId: 's1', sharedWithUserId: 'another' });
        } else {
            mocks.state.publicShare = { id: 'public-1' };
        }
        const removal = await app.inject({ method: 'DELETE', url: '/v1/sessions/s1/shares/share-1' });
        expect(removal.statusCode).toBe(200);
        expectOwnerRefresh();
        const refreshed = (await app.inject({ method: 'GET', url: '/v1/sessions?since=1000' })).json();
        expect(refreshed.sessions).toHaveLength(1);
        expect(refreshed.sessions[0].isShared).toBe(true);
    });

    it('notifies the owner when an admin removes the last recipient', async () => {
        mocks.state.userId = 'admin';
        const removal = await app.inject({ method: 'DELETE', url: '/v1/sessions/s1/shares/share-1' });
        expect(removal.statusCode).toBe(200);
        expectOwnerRefresh();
        mocks.state.userId = 'owner';
        const refreshed = (await app.inject({ method: 'GET', url: '/v1/sessions?since=1000' })).json();
        expect(refreshed.sessions[0].isShared).toBe(false);
    });

    it('notifies the owner when the last recipient leaves', async () => {
        mocks.state.userId = 'recipient';
        const removal = await app.inject({ method: 'DELETE', url: '/v1/sessions/s1/share-self' });
        expect(removal.statusCode).toBe(200);
        expectOwnerRefresh();
        mocks.state.userId = 'owner';
        const refreshed = (await app.inject({ method: 'GET', url: '/v1/sessions?since=1000' })).json();
        expect(refreshed.sessions[0].isShared).toBe(false);
    });

    it('does not notify or touch the session after a rejected removal', async () => {
        mocks.state.canManage = false;
        expect((await app.inject({ method: 'DELETE', url: '/v1/sessions/s1/shares/share-1' })).statusCode).toBe(403);
        expect(mocks.db.session.update).not.toHaveBeenCalled();
        expect(mocks.emitUpdate).not.toHaveBeenCalled();
        expect(mocks.state.shares).toHaveLength(1);
    });

    it('does not remove a share from a different session', async () => {
        expect((await app.inject({ method: 'DELETE', url: '/v1/sessions/other/shares/share-1' })).statusCode).toBe(404);
        expect(mocks.db.session.update).not.toHaveBeenCalled();
        expect(mocks.emitUpdate).not.toHaveBeenCalled();
        expect(mocks.state.shares).toHaveLength(1);
    });
});
