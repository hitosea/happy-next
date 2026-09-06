import { beforeEach, describe, expect, it, vi } from 'vitest';

const { values, randomUUID } = vi.hoisted(() => ({
    values: new Map<string, string>(),
    randomUUID: vi.fn(),
}));

vi.mock('expo-crypto', () => ({ randomUUID }));
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

import { getPushInstallationId } from './pushInstallationId';

describe('getPushInstallationId', () => {
    beforeEach(() => {
        values.clear();
        randomUUID.mockReset().mockReturnValue('11111111-1111-4111-8111-111111111111');
    });

    it('creates and reuses a stable installation id', () => {
        expect(getPushInstallationId()).toBe('11111111-1111-4111-8111-111111111111');
        expect(getPushInstallationId()).toBe('11111111-1111-4111-8111-111111111111');
        expect(randomUUID).toHaveBeenCalledOnce();
    });
});
