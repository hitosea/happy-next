import type { SessionListViewItem } from '@/sync/storage';
import type { Session } from '@/sync/storageTypes';

/**
 * Pulls the pinned sessions out of a list, so the list shows them once: in its pinned section,
 * newest pin first, and no longer in their project or machine. The rest keep their order.
 */
export function splitPinnedSessions(
    sessions: readonly Session[],
    pins: Record<string, number>,
): { pinned: Session[]; rest: Session[] } {
    const pinned: Session[] = [];
    const rest: Session[] = [];
    for (const session of sessions) {
        (pins[session.id] !== undefined ? pinned : rest).push(session);
    }
    return { pinned: sortPinnedSessions(pinned, pins), rest };
}

export function sortPinnedSessions(sessions: Session[], pins: Record<string, number>): Session[] {
    return sessions.sort((a, b) => (pins[b.id] ?? 0) - (pins[a.id] ?? 0));
}

/**
 * The same for a list grouped by date, as the sharing views are: pinned sessions leave their
 * active block or date group, and a date left with no sessions loses its header.
 */
export function splitPinnedListItems(
    items: readonly SessionListViewItem[],
    pins: Record<string, number>,
): { pinned: Session[]; rest: SessionListViewItem[] } {
    const pinned: Session[] = [];
    const rest: SessionListViewItem[] = [];
    let pendingHeader: SessionListViewItem | null = null;
    for (const item of items) {
        if (item.type === 'header') {
            pendingHeader = item;
            continue;
        }
        if (item.type === 'active-sessions') {
            const split = splitPinnedSessions(item.sessions, pins);
            pinned.push(...split.pinned);
            if (split.rest.length > 0) rest.push({ ...item, sessions: split.rest });
            continue;
        }
        if (item.type === 'session' && pins[item.session.id] !== undefined) {
            pinned.push(item.session);
            continue;
        }
        if (pendingHeader) rest.push(pendingHeader);
        pendingHeader = null;
        rest.push(item);
    }
    return { pinned: sortPinnedSessions(pinned, pins), rest };
}
