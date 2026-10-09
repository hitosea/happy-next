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
