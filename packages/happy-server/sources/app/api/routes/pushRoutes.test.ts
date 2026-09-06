import fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Fastify } from '../types';

const {
    findMany,
    upsert,
    deleteMany,
    beginPushRelay,
    completePushRelay,
    failPushRelay,
    fetchMock,
} = vi.hoisted(() => ({
    findMany: vi.fn(),
    upsert: vi.fn(),
    deleteMany: vi.fn(),
    beginPushRelay: vi.fn(),
    completePushRelay: vi.fn(),
    failPushRelay: vi.fn(),
    fetchMock: vi.fn(),
}));

vi.mock('@/storage/db', () => ({
    db: { accountPushToken: { findMany, upsert, deleteMany } },
}));
vi.mock('./pushRelayGuard', () => ({
    beginPushRelay,
    completePushRelay,
    failPushRelay,
}));

import { pushRoutes } from './pushRoutes';

const requestBody = {
    idempotencyKey: 'c56a4180-65aa-42ec-a945-5fd21dec0538',
    title: 'Ready',
    body: 'Waiting',
    badge: 3,
    data: { sessionId: 'session-1' },
};

describe('POST /v1/push/send', () => {
    let app: ReturnType<typeof fastify>;

    beforeEach(async () => {
        process.env.DOOPUSH_APP_ID = 'app-1';
        process.env.DOOPUSH_APP_SECRET = 'dp_as_test';
        process.env.DOOPUSH_BASE_URL = 'https://push.example/api/v1/';
        findMany.mockReset();
        upsert.mockReset().mockResolvedValue({});
        deleteMany.mockReset().mockResolvedValue({ count: 1 });
        beginPushRelay.mockReset();
        completePushRelay.mockReset();
        failPushRelay.mockReset();
        fetchMock.mockReset();
        findMany.mockResolvedValue([{ token: 'device-1' }, { token: 'device-2' }]);
        beginPushRelay.mockResolvedValue({
            status: 'claimed',
            deviceCount: 2,
            retryAfterSeconds: 0,
            claimId: 'claim-1',
        });
        completePushRelay.mockResolvedValue(true);
        failPushRelay.mockResolvedValue(true);
        fetchMock.mockResolvedValue({
            ok: true,
            json: vi.fn().mockResolvedValue({
                code: 200,
                message: 'success',
                data: [{ id: 1 }, { id: 2 }],
            }),
        });
        vi.stubGlobal('fetch', fetchMock);

        app = fastify();
        app.setValidatorCompiler(validatorCompiler);
        app.setSerializerCompiler(serializerCompiler);
        app.decorate('authenticate', async (request: any) => {
            request.userId = 'account-1';
        });
        pushRoutes(app as unknown as Fastify);
        await app.ready();
    });

    afterEach(async () => {
        await app.close();
        vi.unstubAllGlobals();
    });

    it('loads account tokens and sends one batch request', async () => {
        const response = await app.inject({
            method: 'POST',
            url: '/v1/push/send',
            payload: requestBody,
        });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ accepted: true, duplicate: false, deviceCount: 2 });
        expect(completePushRelay).toHaveBeenCalledWith(
            'account-1',
            requestBody.idempotencyKey,
            'claim-1',
            2,
        );
        expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { accountId: 'account-1', provider: 'doopush' },
            take: 101,
        }));
        expect(fetchMock).toHaveBeenCalledWith(
            'https://push.example/api/v1/apps/app-1/push/batch',
            expect.objectContaining({
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer dp_as_test',
                },
                body: expect.any(String),
            }),
        );
        const upstreamBody = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(upstreamBody).toEqual(expect.objectContaining({
            device_ids: ['device-1', 'device-2'],
            title: 'Ready',
            content: 'Waiting',
            payload: {
                action: 'open_page',
                data: JSON.stringify(requestBody.data),
                oppo: {
                    category: 'TODO',
                },
            },
        }));
    });

    it('reports and caches only devices accepted by DooPush', async () => {
        fetchMock.mockResolvedValue({
            ok: true,
            json: vi.fn().mockResolvedValue({
                code: 200,
                message: 'success',
                data: [{ id: 1 }],
            }),
        });

        const response = await app.inject({
            method: 'POST',
            url: '/v1/push/send',
            payload: requestBody,
        });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ accepted: true, duplicate: false, deviceCount: 1 });
        expect(completePushRelay).toHaveBeenCalledWith(
            'account-1',
            requestBody.idempotencyKey,
            'claim-1',
            1,
        );
    });

    it('does not claim success for an invalid DooPush response', async () => {
        fetchMock.mockResolvedValue({
            ok: true,
            json: vi.fn().mockResolvedValue({ code: 200, message: 'success' }),
        });

        const response = await app.inject({
            method: 'POST',
            url: '/v1/push/send',
            payload: requestBody,
        });

        expect(response.statusCode).toBe(502);
        expect(completePushRelay).not.toHaveBeenCalled();
        expect(failPushRelay).not.toHaveBeenCalled();
    });

    it('returns a cached result without sending a duplicate batch', async () => {
        beginPushRelay.mockResolvedValue({
            status: 'succeeded',
            deviceCount: 2,
            retryAfterSeconds: 0,
        });

        const response = await app.inject({
            method: 'POST',
            url: '/v1/push/send',
            payload: requestBody,
        });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ accepted: true, duplicate: true, deviceCount: 2 });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('reports an in-flight duplicate without claiming success', async () => {
        beginPushRelay.mockResolvedValue({
            status: 'processing',
            deviceCount: 2,
            retryAfterSeconds: 0,
        });

        const response = await app.inject({
            method: 'POST',
            url: '/v1/push/send',
            payload: requestBody,
        });

        expect(response.statusCode).toBe(202);
        expect(response.json()).toEqual({
            accepted: false,
            duplicate: true,
            state: 'processing',
            deviceCount: 2,
        });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rate limits new logical notifications without creating a failed state', async () => {
        beginPushRelay.mockResolvedValue({
            status: 'rate-limited',
            deviceCount: 0,
            retryAfterSeconds: 42,
        });

        const response = await app.inject({
            method: 'POST',
            url: '/v1/push/send',
            payload: requestBody,
        });

        expect(response.statusCode).toBe(429);
        expect(response.headers['retry-after']).toBe('42');
        expect(failPushRelay).not.toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('fails closed when the Redis guard is unavailable', async () => {
        beginPushRelay.mockRejectedValue(new Error('redis unavailable'));

        const response = await app.inject({
            method: 'POST',
            url: '/v1/push/send',
            payload: requestBody,
        });

        expect(response.statusCode).toBe(503);
        expect(response.json()).toEqual({ error: 'Push relay unavailable' });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('marks the claim failed when DooPush explicitly rejects the batch', async () => {
        fetchMock.mockResolvedValue({ ok: false, status: 400 });

        const response = await app.inject({
            method: 'POST',
            url: '/v1/push/send',
            payload: requestBody,
        });

        expect(response.statusCode).toBe(502);
        expect(failPushRelay).toHaveBeenCalledWith(
            'account-1',
            requestBody.idempotencyKey,
            'claim-1',
        );
    });

    it('keeps the claim when DooPush returns an ambiguous server error', async () => {
        fetchMock.mockResolvedValue({ ok: false, status: 503 });

        const response = await app.inject({
            method: 'POST',
            url: '/v1/push/send',
            payload: requestBody,
        });

        expect(response.statusCode).toBe(502);
        expect(failPushRelay).not.toHaveBeenCalled();
        expect(completePushRelay).not.toHaveBeenCalled();
    });

    it('marks a definitely unsent connection failure as retryable', async () => {
        fetchMock.mockRejectedValue(Object.assign(new TypeError('fetch failed'), {
            cause: { code: 'ECONNREFUSED' },
        }));

        const response = await app.inject({
            method: 'POST',
            url: '/v1/push/send',
            payload: requestBody,
        });

        expect(response.statusCode).toBe(502);
        expect(failPushRelay).toHaveBeenCalledWith(
            'account-1',
            requestBody.idempotencyKey,
            'claim-1',
        );
    });

    it('keeps an ambiguous timeout in processing state', async () => {
        fetchMock.mockRejectedValue(new DOMException('timed out', 'TimeoutError'));

        const response = await app.inject({
            method: 'POST',
            url: '/v1/push/send',
            payload: requestBody,
        });

        expect(response.statusCode).toBe(502);
        expect(failPushRelay).not.toHaveBeenCalled();
        expect(completePushRelay).not.toHaveBeenCalled();
    });

    it('rejects request bodies above the route limit', async () => {
        const response = await app.inject({
            method: 'POST',
            url: '/v1/push/send',
            payload: { ...requestBody, data: { value: 'x'.repeat(17 * 1024) } },
        });

        expect(response.statusCode).toBe(413);
        expect(findMany).not.toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('transfers an existing device token to the authenticated account', async () => {
        const response = await app.inject({
            method: 'POST',
            url: '/v1/push-tokens',
            payload: { token: 'shared-device-token', provider: 'doopush' },
        });

        expect(response.statusCode).toBe(200);
        expect(upsert).toHaveBeenCalledWith({
            where: { token: 'shared-device-token' },
            update: {
                accountId: 'account-1',
                provider: 'doopush',
                installationId: null,
                updatedAt: expect.any(Date),
            },
            create: {
                accountId: 'account-1',
                token: 'shared-device-token',
                provider: 'doopush',
                installationId: null,
            },
        });
    });

    it('stores the installation id used to correlate provider tokens', async () => {
        const installationId = '11111111-1111-4111-8111-111111111111';
        const response = await app.inject({
            method: 'POST',
            url: '/v1/push-tokens',
            payload: {
                token: 'installed-device-token',
                provider: 'expo',
                installationId,
            },
        });

        expect(response.statusCode).toBe(200);
        expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
            update: expect.objectContaining({ installationId }),
            create: expect.objectContaining({ installationId }),
        }));
    });

    it('returns only Expo tokens to a legacy CLI', async () => {
        const now = new Date();
        findMany.mockResolvedValue([
            {
                id: 'expo-id',
                token: 'expo-token',
                provider: 'expo',
                installationId: 'installation-1',
                createdAt: now,
                updatedAt: now,
            },
            {
                id: 'doopush-id',
                token: 'doopush-token',
                provider: 'doopush',
                installationId: 'installation-1',
                createdAt: now,
                updatedAt: now,
            },
        ]);

        const response = await app.inject({ method: 'GET', url: '/v1/push-tokens' });

        expect(response.statusCode).toBe(200);
        expect(response.json().tokens.map(({ token }: { token: string }) => token))
            .toEqual(['expo-token']);
    });

    it('returns the preferred token per installation to a capable CLI', async () => {
        const now = new Date();
        findMany.mockResolvedValue([
            {
                id: 'expo-a-id',
                token: 'expo-a',
                provider: 'expo',
                installationId: 'installation-a',
                createdAt: now,
                updatedAt: now,
            },
            {
                id: 'doopush-a-id',
                token: 'doopush-a',
                provider: 'doopush',
                installationId: 'installation-a',
                createdAt: now,
                updatedAt: now,
            },
            {
                id: 'expo-b-id',
                token: 'expo-b',
                provider: 'expo',
                installationId: 'installation-b',
                createdAt: now,
                updatedAt: now,
            },
        ]);

        const response = await app.inject({
            method: 'GET',
            url: '/v1/push-tokens',
            headers: { 'x-happy-push-capabilities': 'doopush-relay-v1' },
        });

        expect(response.statusCode).toBe(200);
        expect(response.json().tokens.map(({ token }: { token: string }) => token))
            .toEqual(['doopush-a', 'expo-b']);
    });

    it('keeps Expo compatibility tokens when the DooPush relay is not configured', async () => {
        delete process.env.DOOPUSH_APP_SECRET;
        const now = new Date();
        findMany.mockResolvedValue([
            {
                id: 'expo-id',
                token: 'expo-token',
                provider: 'expo',
                installationId: 'installation-1',
                createdAt: now,
                updatedAt: now,
            },
            {
                id: 'doopush-id',
                token: 'doopush-token',
                provider: 'doopush',
                installationId: 'installation-1',
                createdAt: now,
                updatedAt: now,
            },
        ]);

        const response = await app.inject({
            method: 'GET',
            url: '/v1/push-tokens',
            headers: { 'x-happy-push-capabilities': 'doopush-relay-v1' },
        });

        expect(response.statusCode).toBe(200);
        expect(response.json().tokens.map(({ token }: { token: string }) => token))
            .toEqual(['expo-token']);
    });

    it('scopes unregistering to the authenticated account', async () => {
        const response = await app.inject({
            method: 'DELETE',
            url: '/v1/push-tokens/shared-device-token',
        });

        expect(response.statusCode).toBe(200);
        expect(deleteMany).toHaveBeenCalledWith({
            where: {
                accountId: 'account-1',
                token: 'shared-device-token',
            },
        });
    });

    it('does not expose account-wide provider deletion', async () => {
        const response = await app.inject({
            method: 'DELETE',
            url: '/v1/push-tokens?provider=expo',
        });

        expect(response.statusCode).toBe(404);
        expect(deleteMany).not.toHaveBeenCalled();
    });

});
