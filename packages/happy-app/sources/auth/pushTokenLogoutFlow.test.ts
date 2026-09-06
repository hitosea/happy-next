import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    stopPushTokenRegistration: vi.fn(),
    unregisterCurrentPushToken: vi.fn(),
}));

vi.mock('@/sync/sync', () => ({
    stopPushTokenRegistration: mocks.stopPushTokenRegistration,
}));
vi.mock('@/sync/pushTokenLogout', () => ({
    unregisterCurrentPushToken: mocks.unregisterCurrentPushToken,
}));

import { preparePushTokensForLogout } from './pushTokenLogoutFlow';

describe('preparePushTokensForLogout', () => {
    beforeEach(() => {
        mocks.stopPushTokenRegistration.mockReset().mockResolvedValue(undefined);
        mocks.unregisterCurrentPushToken.mockReset().mockResolvedValue(undefined);
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('does not reject when remote token cleanup fails', async () => {
        const error = new Error('offline');
        mocks.unregisterCurrentPushToken.mockRejectedValue(error);

        await expect(preparePushTokensForLogout({ token: 'token', secret: 'secret' }))
            .resolves.toBeUndefined();

        expect(console.warn).toHaveBeenCalledWith(
            'Failed to unregister push tokens during logout',
            error,
        );
    });
});
