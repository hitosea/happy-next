import { describe, expect, it } from 'vitest';
import type { Session } from '@/sync/storageTypes';
import type { SessionListViewItem } from '@/sync/storage';
import { splitPinnedListItems, splitPinnedSessions } from './pinnedSessions';

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

describe('splitPinnedListItems', () => {
    const items: SessionListViewItem[] = [
        { type: 'active-sessions', sessions: [session('a'), session('b')] },
        { type: 'header', title: 'Today' },
        { type: 'session', session: session('c') },
        { type: 'header', title: 'Yesterday' },
        { type: 'session', session: session('d') },
        { type: 'session', session: session('e') },
    ];
    const ids = (list: SessionListViewItem[]) => list.map(item =>
        item.type === 'header' ? item.title
            : item.type === 'session' ? item.session.id
                : item.type === 'active-sessions' ? item.sessions.map(s => s.id).join('+')
                    : item.type);

    it('takes pinned sessions out of the active block and the date groups, offline ones too', () => {
        const { pinned, rest } = splitPinnedListItems(items, { b: 10, c: 30, d: 20 });

        expect(pinned.map(s => s.id)).toEqual(['c', 'd', 'b']);
        expect(ids(rest)).toEqual(['a', 'Yesterday', 'e']);
    });

    it('drops the active block once all of it is pinned', () => {
        const { rest } = splitPinnedListItems(items, { a: 1, b: 2 });

        expect(ids(rest)).toEqual(['Today', 'c', 'Yesterday', 'd', 'e']);
    });
});
