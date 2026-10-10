import * as React from 'react';

// Sessions being copied or resumed right now. Forking runs on the machine and takes a while, so
// the row has to show it; a module-level set rather than the menu's own state, because the menu
// is unmounted whenever the list regroups and the row must keep saying so until it is done.
const forking = new Set<string>();
const listeners = new Set<() => void>();

function emit() {
    listeners.forEach(listener => listener());
}

function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

/** Marks `sessionId` as being forked. False when it already is, so a second fork must not start. */
export function beginSessionFork(sessionId: string): boolean {
    if (forking.has(sessionId)) return false;
    forking.add(sessionId);
    emit();
    return true;
}

export function endSessionFork(sessionId: string) {
    if (forking.delete(sessionId)) emit();
}

export function useSessionForking(sessionId: string): boolean {
    return React.useSyncExternalStore(
        subscribe,
        () => forking.has(sessionId),
        () => false,
    );
}
