import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'

const { mockGet, mockPost, mockDebug } = vi.hoisted(() => ({
    mockGet: vi.fn(),
    mockPost: vi.fn(),
    mockDebug: vi.fn(),
}))

vi.mock('axios', () => ({
    default: {
        get: mockGet,
        post: mockPost,
        isAxiosError: (error: unknown) => Boolean(
            error && typeof error === 'object' && 'isAxiosError' in error
        ),
    },
}))

vi.mock('@/ui/logger', () => ({
    logger: {
        debug: mockDebug,
    },
}))

import { partitionPushTokens, PushNotificationClient } from './pushNotifications'

describe('partitionPushTokens', () => {
    it('uses provider metadata and falls back to legacy token detection', () => {
        const result = partitionPushTokens([
            { id: '1', token: 'raw-token', provider: 'expo', createdAt: 1, updatedAt: 1 },
            { id: '2', token: 'ExpoPushToken[value]', provider: 'doopush', createdAt: 1, updatedAt: 1 },
            { id: '3', token: 'ExponentPushToken[legacy]', createdAt: 1, updatedAt: 1 },
            { id: '4', token: 'legacy-native-token', createdAt: 1, updatedAt: 1 },
        ])

        expect(result.expoTokens.map(({ id }) => id)).toEqual(['1', '3'])
        expect(result.dooPushTokens.map(({ id }) => id)).toEqual(['2', '4'])
    })
})

describe('PushNotificationClient completion notifications', () => {
    let client: PushNotificationClient
    let send: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
        vi.useFakeTimers()
        delete process.env.HAPPY_ORCH_ONESHOT
        delete process.env.HAPPY_ORCH_EXECUTION_ID
        mockGet.mockReset()
        mockPost.mockReset()
        mockDebug.mockReset()
        client = new PushNotificationClient('token', 'http://server')
        send = vi.spyOn(client, 'sendToAllDevices').mockImplementation(() => undefined)
    })

    it('advertises DooPush relay support when fetching tokens', async () => {
        mockGet.mockResolvedValue({ data: { tokens: [] } })

        await client.fetchPushTokens()

        expect(mockGet).toHaveBeenCalledWith(
            'http://server/v1/push-tokens',
            expect.objectContaining({
                headers: expect.objectContaining({
                    'X-Happy-Push-Capabilities': 'doopush-relay-v1',
                }),
            }),
        )
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it('suppresses completion while an associated run/task is active', async () => {
        mockGet.mockResolvedValue({
            data: { ok: true, data: { activity: { run1: ['task1'] } } },
        })

        client.sendCompletionToAllDevices('Ready', 'Waiting', { sessionId: 'controller-1' })
        await vi.advanceTimersByTimeAsync(0)

        expect(mockGet).toHaveBeenCalledTimes(1)
        expect(send).not.toHaveBeenCalled()
    })

    it('uses the real sendToAllDevices entry point after all delegated work is terminal', async () => {
        mockGet
            .mockResolvedValueOnce({
                data: { ok: true, data: { activity: { run1: ['task1'] }, totalRunCount: 1 } },
            })
            .mockResolvedValueOnce({
                data: { ok: true, data: { activity: {}, totalRunCount: 1 } },
            })

        client.sendCompletionToAllDevices('Ready', 'Waiting', { sessionId: 'controller-1' })
        await vi.advanceTimersByTimeAsync(0)
        expect(send).not.toHaveBeenCalled()

        client.sendCompletionToAllDevices('Ready', 'Waiting', { sessionId: 'controller-1' })
        await vi.advanceTimersByTimeAsync(0)

        expect(send).toHaveBeenCalledWith('Ready', 'Waiting', { sessionId: 'controller-1' })
    })

    it('still sends an ordinary ready notification after delegated run history exists', async () => {
        mockGet.mockResolvedValue({
            data: { ok: true, data: { activity: {}, totalRunCount: 9 } },
        })

        client.sendCompletionToAllDevices('Ready', 'Waiting', { sessionId: 'controller-1' })
        await vi.advanceTimersByTimeAsync(0)

        expect(send).toHaveBeenCalledTimes(1)
    })

    it('does not send from a worker one-shot', async () => {
        process.env.HAPPY_ORCH_ONESHOT = '1'

        client.sendCompletionToAllDevices('Ready', 'Waiting', { sessionId: 'worker-1' })
        await vi.advanceTimersByTimeAsync(0)

        expect(mockGet).not.toHaveBeenCalled()
        expect(send).not.toHaveBeenCalled()
    })

    it('retries a transient activity lookup failure a bounded number of times', async () => {
        mockGet
            .mockRejectedValueOnce(new Error('temporary'))
            .mockResolvedValueOnce({ data: { ok: true, data: { activity: {} } } })

        client.sendCompletionToAllDevices('Ready', 'Waiting', { sessionId: 'controller-1' })
        await vi.advanceTimersByTimeAsync(0)
        expect(mockGet).toHaveBeenCalledTimes(1)
        expect(send).not.toHaveBeenCalled()

        await vi.advanceTimersByTimeAsync(1_000)
        expect(mockGet).toHaveBeenCalledTimes(2)
        expect(send).toHaveBeenCalledTimes(1)
    })

    it('fails closed after bounded retries when activity lookup is permanently unavailable', async () => {
        mockGet.mockRejectedValue(new Error('offline'))

        client.sendCompletionToAllDevices('Ready', 'Waiting', { sessionId: 'controller-1' })
        await vi.advanceTimersByTimeAsync(0)
        await vi.advanceTimersByTimeAsync(1_000)
        await vi.advanceTimersByTimeAsync(3_000)

        expect(mockGet).toHaveBeenCalledTimes(3)
        expect(send).not.toHaveBeenCalled()
        expect((client as any).completionChecks.size).toBe(0)

        mockGet.mockResolvedValueOnce({ data: { ok: true, data: { activity: {} } } })
        client.sendCompletionToAllDevices('Ready', 'Waiting', { sessionId: 'controller-1' })
        await vi.advanceTimersByTimeAsync(0)

        expect(mockGet).toHaveBeenCalledTimes(4)
        expect(send).toHaveBeenCalledTimes(1)
    })

    it('relays one logical notification without exposing device tokens', async () => {
        mockPost.mockResolvedValueOnce({
            data: { accepted: true, duplicate: false, deviceCount: 1 },
        })

        const result = await (client as any).sendDooPushNotifications(
            'Ready',
            'Waiting',
            { sessionId: 'session-1' },
            3,
        )

        expect(mockPost).toHaveBeenCalledWith(
            'http://server/v1/push/send',
            expect.objectContaining({
                idempotencyKey: expect.any(String),
                title: 'Ready',
                body: 'Waiting',
                data: { sessionId: 'session-1' },
                badge: 3,
            }),
            expect.objectContaining({
                headers: expect.objectContaining({ Authorization: 'Bearer token' }),
            }),
        )
        expect(mockPost.mock.calls[0][1]).not.toHaveProperty('token')
        expect(result).toEqual({
            accepted: true,
            duplicate: false,
            deviceCount: 1,
            attempts: 1,
        })
    })

    it('retries transient relay failures with the same idempotency key', async () => {
        const transientError = Object.assign(new Error('temporary'), {
            isAxiosError: true,
            response: { status: 502 },
        })
        mockPost
            .mockRejectedValueOnce(transientError)
            .mockResolvedValueOnce({
                data: { accepted: true, duplicate: true, deviceCount: 2 },
            })

        const pending = (client as any).sendDooPushNotifications('Ready', 'Waiting', undefined, 2)
        await vi.advanceTimersByTimeAsync(1_000)
        const result = await pending

        expect(mockPost).toHaveBeenCalledTimes(2)
        expect(mockPost.mock.calls[0][1].idempotencyKey).toBe(
            mockPost.mock.calls[1][1].idempotencyKey,
        )
        expect(result).toEqual({
            accepted: true,
            duplicate: true,
            deviceCount: 2,
            attempts: 2,
        })
    })

    it('does not treat an in-flight idempotent request as successful', async () => {
        mockPost.mockResolvedValue({
            status: 202,
            data: {
                accepted: false,
                duplicate: true,
                state: 'processing',
                deviceCount: 2,
            },
        })

        const pending = (client as any).sendDooPushNotifications('Ready', 'Waiting', undefined, 2)
        await vi.advanceTimersByTimeAsync(1_000)
        await vi.advanceTimersByTimeAsync(3_000)
        const result = await pending

        expect(mockPost).toHaveBeenCalledTimes(3)
        expect(result).toEqual({
            accepted: false,
            duplicate: true,
            deviceCount: 2,
            attempts: 3,
            status: 202,
        })
    })

    it('does not retry permanent relay failures', async () => {
        mockPost.mockRejectedValueOnce(Object.assign(new Error('not found'), {
            isAxiosError: true,
            response: { status: 404 },
        }))

        const result = await (client as any).sendDooPushNotifications(
            'Ready',
            'Waiting',
            undefined,
            2,
        )

        expect(mockPost).toHaveBeenCalledTimes(1)
        expect(result).toEqual(expect.objectContaining({
            accepted: false,
            attempts: 1,
            status: 404,
        }))
    })

    it('does not report success when the only delivery path fails', async () => {
        send.mockRestore()
        mockGet.mockResolvedValue({
            data: {
                tokens: [
                    { id: '1', token: 'native-token', provider: 'doopush', createdAt: 1, updatedAt: 1 },
                ],
            },
        })
        mockPost
            .mockResolvedValueOnce({ data: { badgeCount: 1 } })
            .mockRejectedValueOnce(Object.assign(new Error('not found'), {
                isAxiosError: true,
                response: { status: 404 },
            }))

        client.sendToAllDevices('Ready', 'Waiting')
        await vi.advanceTimersByTimeAsync(0)

        expect(mockDebug).toHaveBeenCalledWith(
            '[PUSH] Push notifications failed: DooPush relay unavailable (HTTP 404)',
        )
        expect(mockDebug).not.toHaveBeenCalledWith('[PUSH] Push notifications sent successfully')
    })

    it.each([
        '../claude/claudeRemoteLauncher.ts',
        '../codex/runCodex.ts',
        '../gemini/runGemini.ts',
    ])('keeps the provider ready entry point on delegated-aware completion: %s', (relativePath) => {
        const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8')

        expect(source).toContain('.sendCompletionToAllDevices(')
    })
})
