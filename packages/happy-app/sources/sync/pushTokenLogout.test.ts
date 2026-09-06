import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    deletePushToken: vi.fn(),
    getStoredDooPushRegistrationToken: vi.fn(),
    invalidateDooPushRegistration: vi.fn(),
    getStoredExpoFallbackToken: vi.fn(),
    clearStoredExpoFallbackToken: vi.fn(),
    getPermissionsAsync: vi.fn(),
    getExpoPushTokenAsync: vi.fn(),
    unregisterForNotificationsAsync: vi.fn(),
}));

vi.mock('expo-constants', () => ({
    default: {
        expoConfig: { extra: { eas: { projectId: 'project-1' } } },
    },
}));
vi.mock('expo-notifications', () => ({
    getPermissionsAsync: mocks.getPermissionsAsync,
    getExpoPushTokenAsync: mocks.getExpoPushTokenAsync,
    unregisterForNotificationsAsync: mocks.unregisterForNotificationsAsync,
}));
vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('./apiPush', () => ({ deletePushToken: mocks.deletePushToken }));
vi.mock('./doopushRegistrationState', () => ({
    getStoredDooPushRegistrationToken: mocks.getStoredDooPushRegistrationToken,
    invalidateDooPushRegistration: mocks.invalidateDooPushRegistration,
}));
vi.mock('./expoPushMigrationState', () => ({
    getStoredExpoFallbackToken: mocks.getStoredExpoFallbackToken,
    clearStoredExpoFallbackToken: mocks.clearStoredExpoFallbackToken,
}));

import { unregisterCurrentPushToken } from './pushTokenLogout';

describe('unregisterCurrentPushToken', () => {
    beforeEach(() => {
        mocks.deletePushToken.mockReset().mockResolvedValue(undefined);
        mocks.getStoredDooPushRegistrationToken.mockReset().mockReturnValue('doopush-token');
        mocks.invalidateDooPushRegistration.mockReset();
        mocks.getStoredExpoFallbackToken.mockReset().mockReturnValue('expo-token');
        mocks.clearStoredExpoFallbackToken.mockReset();
        mocks.getPermissionsAsync.mockReset().mockResolvedValue({ status: 'granted' });
        mocks.getExpoPushTokenAsync.mockReset().mockResolvedValue({ data: 'expo-token' });
        mocks.unregisterForNotificationsAsync.mockReset().mockResolvedValue(undefined);
    });

    it('removes both provider tokens for only the current installation', async () => {
        const credentials = { token: 'auth-token', secret: 'secret' };
        await unregisterCurrentPushToken(credentials, 100);

        expect(mocks.getExpoPushTokenAsync).not.toHaveBeenCalled();
        expect(mocks.deletePushToken).toHaveBeenCalledTimes(2);
        expect(mocks.deletePushToken).toHaveBeenCalledWith(
            credentials,
            'doopush-token',
            expect.any(AbortSignal),
        );
        expect(mocks.deletePushToken).toHaveBeenCalledWith(
            credentials,
            'expo-token',
            expect.any(AbortSignal),
        );
        expect(mocks.unregisterForNotificationsAsync).toHaveBeenCalledOnce();
        expect(mocks.invalidateDooPushRegistration).toHaveBeenCalledOnce();
        expect(mocks.clearStoredExpoFallbackToken).toHaveBeenCalledWith('expo-token');
    });

    it('waits for server cleanup before unregistering the device locally', async () => {
        mocks.getStoredExpoFallbackToken.mockReturnValue(null);
        let resolveToken: ((value: { data: string }) => void) | undefined;
        mocks.getExpoPushTokenAsync.mockReturnValue(new Promise((resolve) => {
            resolveToken = resolve;
        }));

        const unregistering = unregisterCurrentPushToken(
            { token: 'auth-token', secret: 'secret' },
            100,
        );

        await vi.waitFor(() => expect(mocks.getExpoPushTokenAsync).toHaveBeenCalledOnce());
        expect(mocks.unregisterForNotificationsAsync).not.toHaveBeenCalled();

        resolveToken?.({ data: 'expo-token' });
        await unregistering;

        expect(mocks.deletePushToken.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.unregisterForNotificationsAsync.mock.invocationCallOrder[0],
        );
    });

    it('rejects while still unregistering locally when server cleanup fails', async () => {
        mocks.deletePushToken.mockRejectedValue(new Error('server unavailable'));

        await expect(
            unregisterCurrentPushToken({ token: 'auth-token', secret: 'secret' }, 100),
        ).rejects.toThrow('server unavailable');

        expect(mocks.unregisterForNotificationsAsync).toHaveBeenCalledOnce();
        expect(mocks.invalidateDooPushRegistration).toHaveBeenCalledOnce();
        expect(mocks.clearStoredExpoFallbackToken).toHaveBeenCalledWith('expo-token');
    });

    it('rejects on timeout when Expo token lookup stalls', async () => {
        mocks.getStoredExpoFallbackToken.mockReturnValue(null);
        mocks.getExpoPushTokenAsync.mockReturnValue(new Promise(() => {}));

        await expect(
            unregisterCurrentPushToken({ token: 'auth-token', secret: 'secret' }, 1),
        ).rejects.toThrow('Timed out');

        expect(mocks.deletePushToken).toHaveBeenCalledOnce();
        expect(mocks.deletePushToken.mock.calls[0][1]).toBe('doopush-token');
        expect(mocks.unregisterForNotificationsAsync).toHaveBeenCalledOnce();
        expect(mocks.invalidateDooPushRegistration).toHaveBeenCalledOnce();
    });

    it('does not request an Expo token when notification permission was never granted', async () => {
        mocks.getStoredExpoFallbackToken.mockReturnValue(null);
        mocks.getPermissionsAsync.mockResolvedValue({ status: 'denied' });

        await unregisterCurrentPushToken({ token: 'auth-token', secret: 'secret' }, 100);

        expect(mocks.getExpoPushTokenAsync).not.toHaveBeenCalled();
        expect(mocks.deletePushToken).toHaveBeenCalledOnce();
    });

    it('keeps the DooPush snapshot current when native unregistration fails', async () => {
        mocks.unregisterForNotificationsAsync.mockRejectedValue(new Error('native failure'));

        await unregisterCurrentPushToken({ token: 'auth-token', secret: 'secret' }, 100);

        expect(mocks.invalidateDooPushRegistration).not.toHaveBeenCalled();
    });
});
