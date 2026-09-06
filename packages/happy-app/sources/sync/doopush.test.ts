import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    configure: vi.fn(),
    setExpoNotificationRelayEnabled: vi.fn(),
    addMessageListener: vi.fn(),
    getDeviceToken: vi.fn(),
    getDeviceId: vi.fn(),
    getDeviceInfo: vi.fn(),
    register: vi.fn(),
    registerWithToken: vi.fn(),
    values: new Map<string, string>(),
    runtimeConfig: {
        appId: 'app-1' as string | undefined,
        appKey: 'dp_ak_test' as string | undefined,
        baseURL: 'https://doopush.com/api/v1',
        androidVendors: ['fcm'],
    },
}));

vi.mock('expo-constants', () => ({
    default: {
        expoConfig: {
            extra: {
                doopush: mocks.runtimeConfig,
            },
        },
        platform: { android: {} },
    },
}));

vi.mock('expo-device', () => ({
    osName: 'Android',
    brand: 'Google',
    manufacturer: 'Google',
    modelName: 'Pixel',
}));

vi.mock('expo-notifications', () => ({
    scheduleNotificationAsync: vi.fn(),
}));

vi.mock('react-native', () => ({
    AppState: { currentState: 'active' },
}));

vi.mock('react-native-mmkv', () => ({
    MMKV: class {
        getString(key: string) {
            return mocks.values.get(key);
        }

        set(key: string, value: string) {
            mocks.values.set(key, value);
        }
    },
}));

vi.mock('doopush-react-native-sdk', () => ({
    DooPush: {
        configure: mocks.configure,
        setExpoNotificationRelayEnabled: mocks.setExpoNotificationRelayEnabled,
        addMessageListener: mocks.addMessageListener,
        getDeviceToken: mocks.getDeviceToken,
        getDeviceId: mocks.getDeviceId,
        getDeviceInfo: mocks.getDeviceInfo,
        register: mocks.register,
        registerWithToken: mocks.registerWithToken,
    },
}));

import { registerDooPushIfSupported } from './doopush';
import {
    invalidateDooPushRegistration,
    markDooPushRegistrationCurrent,
} from './doopushRegistrationState';

describe('registerDooPushIfSupported', () => {
    beforeEach(() => {
        mocks.values.clear();
        mocks.configure.mockReset();
        mocks.setExpoNotificationRelayEnabled.mockReset();
        mocks.addMessageListener.mockReset();
        mocks.addMessageListener.mockReturnValue({ remove: vi.fn() });
        mocks.getDeviceToken.mockReset();
        mocks.getDeviceId.mockReset();
        mocks.getDeviceInfo.mockReset();
        mocks.register.mockReset();
        mocks.registerWithToken.mockReset().mockResolvedValue({ deviceId: 'device-new' });
        mocks.runtimeConfig.appId = 'app-1';
        mocks.runtimeConfig.appKey = 'dp_ak_test';
    });

    it('keeps the Expo-only path when DooPush credentials are absent', async () => {
        mocks.runtimeConfig.appId = undefined;
        mocks.runtimeConfig.appKey = undefined;

        await expect(registerDooPushIfSupported()).resolves.toBeNull();
        expect(mocks.configure).not.toHaveBeenCalled();
        expect(mocks.register).not.toHaveBeenCalled();
        expect(mocks.registerWithToken).not.toHaveBeenCalled();
    });

    it('reconfirms a cached registration with DooPush', async () => {
        markDooPushRegistrationCurrent({
            scope: 'https://doopush.com/api/v1|app-1',
            token: 'token-old',
            deviceId: 'device-old',
            vendor: 'fcm',
        });
        mocks.getDeviceToken.mockResolvedValue('token-old');
        mocks.getDeviceId.mockResolvedValue('device-old');
        mocks.getDeviceInfo.mockResolvedValue({ channel: 'fcm' });
        mocks.registerWithToken.mockResolvedValue({ deviceId: 'device-restored' });

        await expect(registerDooPushIfSupported()).resolves.toEqual({
            token: 'token-old',
            deviceId: 'device-restored',
            vendor: 'fcm',
        });
        expect(mocks.registerWithToken).toHaveBeenCalledWith('token-old', 'fcm');
        expect(mocks.register).not.toHaveBeenCalled();
        expect(mocks.configure).toHaveBeenCalledWith({
            appId: 'app-1',
            appKey: 'dp_ak_test',
            baseURL: 'https://doopush.com/api/v1',
        });
        expect(mocks.setExpoNotificationRelayEnabled).toHaveBeenCalledWith(false);
        expect(mocks.addMessageListener).toHaveBeenCalledOnce();
    });

    it('coalesces concurrent registration checks', async () => {
        markDooPushRegistrationCurrent({
            scope: 'https://doopush.com/api/v1|app-1',
            token: 'token-old',
            deviceId: 'device-old',
            vendor: 'fcm',
        });
        mocks.getDeviceToken.mockResolvedValue('token-old');
        mocks.getDeviceId.mockResolvedValue('device-old');
        mocks.getDeviceInfo.mockResolvedValue({ channel: 'fcm' });

        let resolveRegistration!: (value: { deviceId: string }) => void;
        mocks.registerWithToken.mockReturnValue(new Promise((resolve) => {
            resolveRegistration = resolve;
        }));

        const first = registerDooPushIfSupported();
        const second = registerDooPushIfSupported();
        await vi.waitFor(() => expect(mocks.registerWithToken).toHaveBeenCalledOnce());
        resolveRegistration({ deviceId: 'device-old' });

        await expect(Promise.all([first, second])).resolves.toEqual([
            { token: 'token-old', deviceId: 'device-old', vendor: 'fcm' },
            { token: 'token-old', deviceId: 'device-old', vendor: 'fcm' },
        ]);
        expect(mocks.registerWithToken).toHaveBeenCalledOnce();
    });

    it('sets up foreground delivery and returns the previously synchronized token after refresh', async () => {
        markDooPushRegistrationCurrent({
            scope: 'https://doopush.com/api/v1|app-1',
            token: 'token-old',
            deviceId: 'device-old',
            vendor: 'fcm',
        });
        mocks.getDeviceToken.mockResolvedValue('token-new');
        mocks.getDeviceId.mockResolvedValue('device-new');
        mocks.getDeviceInfo.mockResolvedValue({ channel: 'fcm' });
        mocks.register.mockResolvedValue({
            token: 'token-new',
            deviceId: 'device-new',
            vendor: 'fcm',
        });
        await expect(registerDooPushIfSupported()).resolves.toEqual({
            token: 'token-new',
            deviceId: 'device-new',
            vendor: 'fcm',
            replacedTokens: ['token-old'],
        });
    });

    it('returns replaced tokens again until server cleanup is acknowledged', async () => {
        markDooPushRegistrationCurrent({
            scope: 'https://doopush.com/api/v1|app-1',
            token: 'token-old',
            deviceId: 'device-old',
            vendor: 'fcm',
        });
        mocks.getDeviceToken.mockResolvedValue('token-new');
        mocks.getDeviceId.mockResolvedValue('device-new');
        mocks.getDeviceInfo.mockResolvedValue({ channel: 'fcm' });
        mocks.register.mockResolvedValue({
            token: 'token-new',
            deviceId: 'device-new',
            vendor: 'fcm',
        });

        await expect(registerDooPushIfSupported()).resolves.toMatchObject({
            token: 'token-new',
            replacedTokens: ['token-old'],
        });
        await expect(registerDooPushIfSupported()).resolves.toMatchObject({
            token: 'token-new',
            replacedTokens: ['token-old'],
        });
        expect(mocks.register).toHaveBeenCalledOnce();
        expect(mocks.registerWithToken).toHaveBeenCalledOnce();
    });

    it('registers natively again after the cached token was unregistered', async () => {
        markDooPushRegistrationCurrent({
            scope: 'https://doopush.com/api/v1|app-1',
            token: 'token-old',
            deviceId: 'device-old',
            vendor: 'fcm',
        });
        invalidateDooPushRegistration();
        mocks.getDeviceToken.mockResolvedValue('token-old');
        mocks.getDeviceId.mockResolvedValue('device-old');
        mocks.getDeviceInfo.mockResolvedValue({ channel: 'fcm' });
        mocks.register.mockResolvedValue({
            token: 'token-new',
            deviceId: 'device-new',
            vendor: 'fcm',
        });

        await expect(registerDooPushIfSupported()).resolves.toMatchObject({
            token: 'token-new',
            replacedTokens: ['token-old'],
        });
        expect(mocks.register).toHaveBeenCalledOnce();
        expect(mocks.registerWithToken).not.toHaveBeenCalled();
    });

    it('preserves a replaced native token when no local snapshot exists', async () => {
        mocks.getDeviceToken.mockResolvedValue('native-token-old');
        mocks.getDeviceId.mockResolvedValue('device-old');
        mocks.getDeviceInfo.mockResolvedValue({ channel: 'fcm' });
        mocks.register.mockResolvedValue({
            token: 'native-token-new',
            deviceId: 'device-new',
            vendor: 'fcm',
        });

        await expect(registerDooPushIfSupported()).resolves.toMatchObject({
            token: 'native-token-new',
            replacedTokens: ['native-token-old'],
        });
    });
});
