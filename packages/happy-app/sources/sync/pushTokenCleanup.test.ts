import { beforeEach, describe, expect, it, vi } from 'vitest';

const values = new Map<string, string>();

vi.mock('react-native-mmkv', () => ({
    MMKV: class {
        getString(key: string) {
            return values.get(key);
        }

        set(key: string, value: string) {
            values.set(key, value);
        }

        delete(key: string) {
            values.delete(key);
        }
    },
}));

import { cleanupSupersededPushTokens } from './pushTokenCleanup';

describe('push token cleanup', () => {
    beforeEach(() => values.clear());

    it('retries a failed deletion on the next activation', async () => {
        const deleteToken = vi.fn()
            .mockRejectedValueOnce(new Error('offline'))
            .mockResolvedValue(undefined);

        const firstAttempt = await cleanupSupersededPushTokens({
            scope: 'server|account',
            currentToken: 'new-token',
            replacedTokens: ['old-token'],
            deleteToken,
        });
        expect(firstAttempt).toEqual([
            expect.objectContaining({ token: 'old-token', status: 'failed' }),
        ]);

        const retry = await cleanupSupersededPushTokens({
            scope: 'server|account',
            currentToken: 'new-token',
            replacedTokens: [],
            deleteToken,
        });
        expect(retry).toEqual([{ token: 'old-token', status: 'removed' }]);
        expect(deleteToken).toHaveBeenCalledTimes(2);

        await cleanupSupersededPushTokens({
            scope: 'server|account',
            currentToken: 'new-token',
            replacedTokens: [],
            deleteToken,
        });
        expect(deleteToken).toHaveBeenCalledTimes(2);
    });

    it('keeps pending cleanup isolated by server and account', async () => {
        const deleteToken = vi.fn().mockRejectedValue(new Error('offline'));
        await cleanupSupersededPushTokens({
            scope: 'server-a|account-a',
            currentToken: 'new-token',
            replacedTokens: ['old-token'],
            deleteToken,
        });

        deleteToken.mockClear();
        await cleanupSupersededPushTokens({
            scope: 'server-b|account-a',
            currentToken: 'new-token',
            replacedTokens: [],
            deleteToken,
        });
        expect(deleteToken).not.toHaveBeenCalled();
    });

    it('never deletes the current token', async () => {
        const deleteToken = vi.fn().mockResolvedValue(undefined);
        await cleanupSupersededPushTokens({
            scope: 'server|account',
            currentToken: 'current-token',
            replacedTokens: ['current-token'],
            deleteToken,
        });
        expect(deleteToken).not.toHaveBeenCalled();
    });
});
