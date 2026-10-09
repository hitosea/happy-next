import type { Session } from '@/sync/storageTypes';

export function canForkSession(session: Session | undefined): boolean {
    return !!session && session.metadata?.lifecycleState !== 'archived';
}

export function canEditSession(session: Session): boolean {
    // Heartbeat expiry also clears active; only an explicit archive is read-only.
    return session.accessLevel !== 'view' && session.metadata?.lifecycleState !== 'archived';
}

export function canArchiveSession(session: Session, isConnected: boolean): boolean {
    if (session.accessLevel) return false;
    if (session.metadata?.lifecycleState === 'archived') return false;
    // Native archive can fail after the session process has already stopped.
    return isConnected || (!session.active && session.metadata?.flavor === 'codex' && !!session.metadata.machineId);
}
