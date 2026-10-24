import type { Session } from '@/sync/storageTypes';

/**
 * Whether the session can be forked (or resumed) on its machine: it needs the agent's own session ID,
 * and a shared session points at the owner's machine, which the viewer cannot fork on. Archiving does
 * not matter — Claude, Gemini and Qoder history stays in place, and the CLI unarchives native Codex
 * history only for the fork (`borrowArchived`) and archives it again.
 */
export function canForkSession(session: Session | undefined): boolean {
    const metadata = session?.metadata;
    return !!session && !session.accessLevel && !!metadata?.machineId && !!metadata.path && !!(
        metadata.claudeSessionId || metadata.flavor === 'gemini' || metadata.codexSessionId || metadata.qoderSessionId
    );
}

export function canEditSession(session: Session): boolean {
    // Heartbeat expiry also clears active; only an explicit archive is read-only.
    return session.accessLevel !== 'view' && session.metadata?.lifecycleState !== 'archived';
}

export function canArchiveSession(session: Session, isConnected: boolean): boolean {
    if (session.accessLevel) return false;
    if (session.metadata?.lifecycleState === 'archived') return false;
    // A stopped session archives without its process: sessionArchive then only marks it archived.
    return isConnected || !session.active;
}

// Older disconnected sessions are leftovers from crashes before anyone looked, not ones to resume.
export const DISCONNECTED_SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * A session that went offline without being ended — its machine dropped, rebooted or the process
 * was killed. Only an archive (Ctrl-C in the CLI, or archive in the app) ends a session, so it keeps
 * its place on its machine, shown offline, until the user resumes or archives it.
 */
export function isSessionDisconnected(session: Session, now: number = Date.now()): boolean {
    return !session.active
        && session.metadata?.lifecycleState !== 'archived'
        && !!session.metadata?.machineId
        && now - session.activeAt <= DISCONNECTED_SESSION_MAX_AGE_MS;
}
