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
    },
}));

import {
    acknowledgeReplacedDooPushRegistrationTokens,
    getDooPushRegistrationScope,
    getReplacedDooPushRegistrationTokens,
    getStoredDooPushRegistrationToken,
    invalidateDooPushRegistration,
    isDooPushRegistrationCurrent,
    markDooPushRegistrationCurrent,
} from './doopushRegistrationState';

const registration = {
    scope: 'https://doopush.com/api/v1|app-1',
    token: 'token-1',
    deviceId: 'device-1',
    vendor: 'fcm' as const,
};

describe('DooPush registration state', () => {
    beforeEach(() => values.clear());

    it('normalizes the default and trailing-slash base URLs', () => {
        expect(getDooPushRegistrationScope(' app-1 ')).toBe(registration.scope);
        expect(getDooPushRegistrationScope('app-1', 'https://doopush.com/api/v1///')).toBe(registration.scope);
    });

    it('reuses only the exact registration synchronized with DooPush', () => {
        expect(isDooPushRegistrationCurrent(registration)).toBe(false);
        markDooPushRegistrationCurrent(registration);
        expect(isDooPushRegistrationCurrent(registration)).toBe(true);
    });

    it('keeps the token for cleanup but prevents reuse after native unregistration', () => {
        markDooPushRegistrationCurrent(registration);

        invalidateDooPushRegistration();

        expect(getStoredDooPushRegistrationToken()).toBe(registration.token);
        expect(isDooPushRegistrationCurrent(registration)).toBe(false);
    });

    it('becomes reusable again after a fresh native registration', () => {
        markDooPushRegistrationCurrent(registration);
        invalidateDooPushRegistration();

        markDooPushRegistrationCurrent(registration);

        expect(isDooPushRegistrationCurrent(registration)).toBe(true);
    });

    it.each([
        ['scope', 'https://self-hosted.example/api/v1|app-1'],
        ['token', 'token-2'],
        ['deviceId', 'device-2'],
        ['vendor', 'honor'],
    ] as const)('invalidates the cache when %s changes', (field, value) => {
        markDooPushRegistrationCurrent(registration);
        expect(isDooPushRegistrationCurrent({ ...registration, [field]: value })).toBe(false);
    });

    it('recovers from malformed persisted state', () => {
        values.set('last-synced-registration', '{invalid');
        expect(isDooPushRegistrationCurrent(registration)).toBe(false);
    });

    it('keeps replaced tokens pending until cleanup acknowledges them', () => {
        markDooPushRegistrationCurrent(registration);
        markDooPushRegistrationCurrent({ ...registration, token: 'token-2' });

        expect(getReplacedDooPushRegistrationTokens('token-2')).toEqual(['token-1']);

        acknowledgeReplacedDooPushRegistrationTokens('token-2', ['token-1']);
        expect(getReplacedDooPushRegistrationTokens('token-2')).toEqual([]);
    });

    it('preserves pending cleanup across consecutive token rotations', () => {
        markDooPushRegistrationCurrent(registration);
        markDooPushRegistrationCurrent({ ...registration, token: 'token-2' });
        markDooPushRegistrationCurrent({ ...registration, token: 'token-3' });

        expect(getReplacedDooPushRegistrationTokens('token-3')).toEqual(['token-1', 'token-2']);
    });
});
