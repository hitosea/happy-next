import { describe, expect, it } from 'vitest';
import {
    DOOPUSH_RELAY_CAPABILITY,
    selectPushTokensForClient,
    supportsDooPushRelay,
} from './pushTokenSelection';

const tokens = [
    { token: 'expo-a', provider: 'expo', installationId: 'installation-a' },
    { token: 'doopush-a', provider: 'doopush', installationId: 'installation-a' },
    { token: 'expo-b', provider: 'expo', installationId: 'installation-b' },
    { token: 'legacy-expo', provider: 'expo', installationId: null },
];

describe('push token client selection', () => {
    it('returns only Expo-compatible tokens to legacy CLIs', () => {
        expect(selectPushTokensForClient(tokens, false).map(({ token }) => token)).toEqual([
            'expo-a',
            'expo-b',
            'legacy-expo',
        ]);
    });

    it('prefers DooPush per installation for capable CLIs', () => {
        expect(selectPushTokensForClient(tokens, true).map(({ token }) => token)).toEqual([
            'doopush-a',
            'expo-b',
            'legacy-expo',
        ]);
    });

    it('parses a comma-separated capability header', () => {
        expect(supportsDooPushRelay(`other, ${DOOPUSH_RELAY_CAPABILITY}`)).toBe(true);
        expect(supportsDooPushRelay(undefined)).toBe(false);
    });
});
