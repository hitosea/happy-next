import { describe, expect, it } from 'vitest';
import type { Session } from '@/sync/storageTypes';
import { splitPinnedSessions } from './pinnedSessions';

const session = (id: string) => ({ id }) as Session;

describe('splitPinnedSessions', () => {
    it('moves pinned sessions out, newest pin first, and keeps the rest in order', () => {
        const { pinned, rest } = splitPinnedSessions(
            [session('a'), session('b'), session('c'), session('d')],
            { b: 10, d: 20, gone: 30 },
        );

        expect(pinned.map(s => s.id)).toEqual(['d', 'b']);
        expect(rest.map(s => s.id)).toEqual(['a', 'c']);
    });

    it('leaves the list alone without pins', () => {
        const { pinned, rest } = splitPinnedSessions([session('a'), session('b')], {});

        expect(pinned).toEqual([]);
        expect(rest.map(s => s.id)).toEqual(['a', 'b']);
    });
});
