import { beforeEach, describe, expect, it, vi } from 'vitest';

const { evalMock } = vi.hoisted(() => ({
    evalMock: vi.fn(),
}));

vi.mock('@/storage/redis', () => ({
    redis: { eval: evalMock },
}));

import {
    beginPushRelay,
    completePushRelay,
    failPushRelay,
} from './pushRelayGuard';

describe('push relay Redis guard', () => {
    beforeEach(() => {
        evalMock.mockReset();
    });

    it('allows the first twenty logical notifications in a window', async () => {
        evalMock.mockResolvedValue(['claimed', '2', 0]);

        await expect(beginPushRelay('account-1', 'request-1', 2)).resolves.toEqual({
            status: 'claimed',
            deviceCount: 2,
            retryAfterSeconds: 0,
            claimId: expect.any(String),
        });
        expect(evalMock).toHaveBeenCalledWith(
            expect.stringContaining("redis.call('INCR', KEYS[2])"),
            2,
            'push-relay:idempotency:account-1:request-1',
            'push-relay:rate:account-1',
            60,
            20,
            2,
            600,
            expect.any(String),
        );
    });

    it('returns the remaining window after the limit', async () => {
        evalMock.mockResolvedValue(['rate-limited', 0, 37]);

        await expect(beginPushRelay('account-1', 'request-1', 2)).resolves.toEqual({
            status: 'rate-limited',
            deviceCount: 0,
            retryAfterSeconds: 37,
        });
    });

    it('reuses the original device count for successful duplicate requests', async () => {
        evalMock.mockResolvedValue(['succeeded', '3', 0]);

        await expect(beginPushRelay('account-1', 'request-1', 9)).resolves.toEqual({
            status: 'succeeded',
            deviceCount: 3,
            retryAfterSeconds: 0,
        });
    });

    it('transitions a claimed request to succeeded with compare-and-set', async () => {
        evalMock.mockResolvedValue(1);

        await expect(completePushRelay('account-1', 'request-1', 'claim-1', 2)).resolves.toBe(true);

        expect(evalMock).toHaveBeenCalledWith(
            expect.stringContaining("redis.call('HGET', KEYS[1], 'claimId') ~= ARGV[1]"),
            1,
            'push-relay:idempotency:account-1:request-1',
            'claim-1',
            'succeeded',
            600,
            '2',
        );
    });

    it('keeps failed claims but rate limits every retry attempt', async () => {
        evalMock.mockResolvedValue(1);

        await expect(failPushRelay('account-1', 'request-1', 'claim-1')).resolves.toBe(true);

        expect(evalMock).toHaveBeenCalledWith(
            expect.any(String),
            1,
            'push-relay:idempotency:account-1:request-1',
            'claim-1',
            'failed',
            600,
            '',
        );
        evalMock.mockResolvedValueOnce(['claimed', '2', 0]);
        await beginPushRelay('account-1', 'request-1', 2);
        const beginScript = evalMock.mock.calls[1][0] as string;
        expect(beginScript.indexOf("local count = redis.call('INCR', KEYS[2])"))
            .toBeLessThan(beginScript.indexOf("if status == 'failed' then"));
        expect(beginScript).toMatch(
            /if count > tonumber\(ARGV\[2\]\)[\s\S]*return \{'rate-limited'[\s\S]*if status == 'failed'/,
        );
    });
});
