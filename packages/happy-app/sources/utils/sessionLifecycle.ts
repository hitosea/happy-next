import type { Session } from '@/sync/storageTypes';

export function canForkSession(session: Session | undefined): boolean {
    return !!session && session.metadata?.lifecycleState !== 'archived';
}

/**
 * True when the session can be forked at all: Claude, Codex and Qoder each persist a
 * native id to fork from, and Gemini is forked through its own session log rather than
 * an id. Drives both the UI affordance and the "duplicate this session" guards.
 */
export function hasForkableNativeId(session: Session | undefined): boolean {
    const metadata = session?.metadata;
    return Boolean(
        metadata?.claudeSessionId
        || metadata?.codexSessionId
        || metadata?.qoderSessionId
        || metadata?.flavor === 'gemini',
    );
}

export function canEditSession(session: Session): boolean {
    // Heartbeat expiry also clears active; only an explicit archive is read-only.
    return session.accessLevel !== 'view' && session.metadata?.lifecycleState !== 'archived';
}

export function canArchiveSession(session: Session, isConnected: boolean): boolean {
    if (session.accessLevel) return false;
    // Native archive can fail after the session process has already stopped.
    return isConnected || (!session.active && session.metadata?.flavor === 'codex' && !!session.metadata.machineId);
}
