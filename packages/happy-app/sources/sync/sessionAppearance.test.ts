import { describe, expect, it } from 'vitest';
import {
    applySessionAppearancePatch,
    createEmptySessionAppearance,
    decodeSessionAppearanceValue,
    encodeSessionAppearanceValue,
    normalizeSessionAppearance,
} from './sessionAppearance';

describe('sessionAppearance', () => {
    it('sets, replaces, and clears a session marker', () => {
        const initial = createEmptySessionAppearance(1);
        const red = applySessionAppearancePatch(initial, { sessionId: 's1', color: 'red', updatedAt: 2 });
        const blue = applySessionAppearancePatch(red, { sessionId: 's1', color: 'blue', updatedAt: 3 });
        const cleared = applySessionAppearancePatch(blue, { sessionId: 's1', color: null, updatedAt: 4 });

        expect(red.sessions.s1?.color).toBe('red');
        expect(blue.sessions.s1).toEqual({ color: 'blue', updatedAt: 3 });
        expect(cleared.sessions.s1).toBeUndefined();
    });

    it('pins and unpins a session without touching its marker', () => {
        const red = applySessionAppearancePatch(createEmptySessionAppearance(1), { sessionId: 's1', color: 'red', updatedAt: 2 });
        const pinned = applySessionAppearancePatch(red, { sessionId: 's1', pinnedAt: 3, updatedAt: 3 });
        const recolored = applySessionAppearancePatch(pinned, { sessionId: 's1', color: 'blue', updatedAt: 4 });
        const unpinned = applySessionAppearancePatch(recolored, { sessionId: 's1', pinnedAt: null, updatedAt: 5 });

        expect(pinned.sessions.s1).toEqual({ color: 'red', pinnedAt: 3, updatedAt: 3 });
        expect(recolored.sessions.s1).toEqual({ color: 'blue', pinnedAt: 3, updatedAt: 4 });
        expect(unpinned.sessions.s1).toEqual({ color: 'blue', updatedAt: 5 });
    });

    it('drops an entry once it carries no mark', () => {
        const pinned = applySessionAppearancePatch(createEmptySessionAppearance(1), { sessionId: 's1', pinnedAt: 2, updatedAt: 2 });
        const cleared = applySessionAppearancePatch(pinned, { sessionId: 's1', pinnedAt: null, updatedAt: 3 });

        expect(pinned.sessions.s1).toEqual({ pinnedAt: 2, updatedAt: 2 });
        expect(cleared.sessions.s1).toBeUndefined();
    });

    it('keeps pin-only entries while normalizing', () => {
        const normalized = normalizeSessionAppearance({
            updatedAt: 10,
            sessions: {
                pinned: { pinnedAt: 7, updatedAt: 7 },
                both: { color: 'red', pinnedAt: 'soon', updatedAt: 6 },
            },
        });

        expect(normalized.sessions).toEqual({
            pinned: { pinnedAt: 7, updatedAt: 7 },
            both: { color: 'red', updatedAt: 6 },
        });
    });

    it('drops invalid entries while normalizing', () => {
        const normalized = normalizeSessionAppearance({
            updatedAt: 10,
            sessions: {
                valid: { color: 'purple', updatedAt: 9 },
                invalid: { color: 'pink', updatedAt: 8 },
            },
        });

        expect(normalized.sessions).toEqual({ valid: { color: 'purple', updatedAt: 9 } });
    });

    it('round-trips through base64 encoding', () => {
        const original = applySessionAppearancePatch(
            createEmptySessionAppearance(10),
            { sessionId: 'session-1', color: 'green', updatedAt: 11 },
        );

        expect(decodeSessionAppearanceValue(encodeSessionAppearanceValue(original))).toEqual(original);
    });

    it('falls back to an empty document for corrupt values', () => {
        expect(decodeSessionAppearanceValue('not-base64').sessions).toEqual({});
    });
});
