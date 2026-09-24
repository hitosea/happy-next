import { Session } from '@/sync/storageTypes';
import { canArchiveSession, hasForkableNativeId } from '@/utils/sessionLifecycle';

export type SessionQuickActionKind =
    | 'details'
    | 'renameSession'
    | 'toggleRead'
    | 'newSession'
    | 'terminal'
    | 'revealInFileManager'
    | 'forkSession'
    | 'leaveSharedSession'
    | 'archiveSession'
    | 'deleteSession';

/**
 * Which section of the menu each action sits in. Membership is all this decides — the order
 * within a section is the order `getSessionQuickActionKinds` returns, and a section the session
 * fills nothing into is not drawn at all.
 *
 * The long tail this menu used to carry — delegation history, sharing, the machine behind the
 * session — reads better on the session's own screen, which lists them with a subtitle each.
 */
const SESSION_QUICK_ACTION_SECTION: Record<SessionQuickActionKind, number> = {
    // The session itself.
    details: 0,
    renameSession: 0,
    toggleRead: 0,
    // Where it runs — the machine and the directory behind it.
    newSession: 1,
    terminal: 1,
    revealInFileManager: 1,
    forkSession: 1,
    // Leaving it behind.
    leaveSharedSession: 2,
    archiveSession: 2,
    deleteSession: 2,
};

const SECTION_COUNT = 3;

export function getSessionQuickActionKinds({
    session,
    isConnected,
    isLocalMachine,
}: {
    session: Session;
    isConnected: boolean;
    /** Whether the session runs on the computer this client is on. See `useLocalMachineIds`. */
    isLocalMachine: boolean;
}): SessionQuickActionKind[] {
    const isOwner = !session.accessLevel;
    const isForkable = !!session.metadata?.machineId
        && !!session.metadata?.path
        && hasForkableNativeId(session);

    const actions: SessionQuickActionKind[] = ['details'];
    // Only the owner can write session metadata; shared users get a read-only title.
    if (isOwner) actions.push('renameSession');
    // Pushed even where it cannot act: unlike the actions below, which are hidden when they do
    // not apply, the item is disabled instead so the capability stays discoverable on a session
    // that has simply never finished a task. See `markSessionUnread` for why that matters.
    actions.push('toggleRead');
    // Starting a session in this directory spawns it on the session's machine, which a session
    // shared with me does not grant — it points at the owner's machine and directory.
    if (isOwner) actions.push('newSession');
    // A terminal is a door into that machine, so it needs the same ownership the line above
    // does. It has no path condition: a shell with no particular directory is still useful, and
    // the daemon falls back to the machine's home.
    if (isOwner && session.metadata?.machineId) actions.push('terminal');
    // A path on another computer is not on this disk, so there is nothing to show.
    if (isLocalMachine && session.metadata?.path) actions.push('revealInFileManager');
    if (isOwner && isForkable) actions.push('forkSession');
    if (!isOwner) actions.push('leaveSharedSession');
    if (canArchiveSession(session, isConnected)) actions.push('archiveSession');
    if (isOwner && !isConnected && !session.active) actions.push('deleteSession');
    return actions;
}

/** The kinds above, split into the runs of items the menu draws dividers between. */
export function getSessionQuickActionSections(kinds: SessionQuickActionKind[]): SessionQuickActionKind[][] {
    const sections: SessionQuickActionKind[][] = Array.from({ length: SECTION_COUNT }, () => []);
    for (const kind of kinds) {
        sections[SESSION_QUICK_ACTION_SECTION[kind]].push(kind);
    }
    return sections.filter(section => section.length > 0);
}
