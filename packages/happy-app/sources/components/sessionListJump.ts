import type { Session } from '@/sync/storageTypes';

// Double-tapping the sessions tab steps through the sessions that want a look, most urgent first:
// a permission request, an unread completion, a running turn, running delegated tasks, a draft.
export type SessionJumpFlags = {
    unread: boolean;
    delegating: boolean;
    hasDraft: boolean;
};

export function getSessionJumpPriority(session: Session, flags: SessionJumpFlags): number | null {
    const online = session.presence === 'online';
    if (online && !!session.agentState?.requests && Object.keys(session.agentState.requests).length > 0) return 0;
    if (flags.unread) return 1;
    if (online && session.thinking === true) return 2;
    if (flags.delegating) return 3;
    if (flags.hasDraft) return 4;
    return null;
}

/**
 * The session to jump to next: the candidates (in list order) sorted by priority, then the one
 * after the last jump, wrapping around. Null when nothing wants a look.
 */
export function pickNextJumpSession(
    candidates: { id: string; priority: number }[],
    lastJumpedId: string | null,
): string | null {
    if (candidates.length === 0) return null;
    const ordered = candidates
        .map((candidate, index) => ({ ...candidate, index }))
        .sort((a, b) => a.priority - b.priority || a.index - b.index);
    const last = lastJumpedId ? ordered.findIndex(candidate => candidate.id === lastJumpedId) : -1;
    return ordered[(last + 1) % ordered.length].id;
}

type SessionListJumpListener = () => void;

const listeners = new Set<SessionListJumpListener>();

export function requestSessionListJump() {
    for (const listener of listeners) {
        listener();
    }
}

export function subscribeToSessionListJump(listener: SessionListJumpListener) {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}
