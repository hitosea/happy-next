import { beforeEach, describe, expect, it, vi } from 'vitest';

const values = new Map<string, boolean | string>();

vi.mock('react-native-mmkv', () => ({
    MMKV: class {
        getBoolean(key: string) {
            const value = values.get(key);
            return typeof value === 'boolean' ? value : undefined;
        }

        getString(key: string) {
            const value = values.get(key);
            return typeof value === 'string' ? value : undefined;
        }

        set(key: string, value: boolean | string) {
            values.set(key, value);
        }

        delete(key: string) {
            values.delete(key);
        }
    },
}));

import {
    clearStoredExpoFallbackToken,
    getStoredExpoFallbackToken,
    markExpoFallbackRegistered,
} from './expoPushMigrationState';

describe('Expo push fallback migration state', () => {
    beforeEach(() => values.clear());

    it('stores the Expo fallback token', () => {
        markExpoFallbackRegistered('expo-token');
        expect(getStoredExpoFallbackToken()).toBe('expo-token');
    });

    it('only clears the matching fallback token', () => {
        markExpoFallbackRegistered('new-token');
        clearStoredExpoFallbackToken('old-token');
        expect(getStoredExpoFallbackToken()).toBe('new-token');

        clearStoredExpoFallbackToken('new-token');
        expect(getStoredExpoFallbackToken()).toBeNull();
    });
});
