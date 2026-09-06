import { describe, expect, it } from 'vitest';
import { getSupersededPushTokens } from './pushTokenMigration';

describe('getSupersededPushTokens', () => {
    it('removes the current token and empty candidates', () => {
        expect(getSupersededPushTokens('current', ['old', 'current', null, undefined, ''])).toEqual(['old']);
    });

    it('deduplicates tokens while preserving their order', () => {
        expect(getSupersededPushTokens('current', ['expo', 'vendor', 'expo'])).toEqual(['expo', 'vendor']);
    });
});
