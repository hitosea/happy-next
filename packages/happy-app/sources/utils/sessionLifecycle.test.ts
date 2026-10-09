import { describe, expect, it } from 'vitest';
import { MetadataSchema, type Session } from '@/sync/storageTypes';
import { canArchiveSession, canEditSession, canForkSession } from './sessionLifecycle';

function session(flavor: string, lifecycleState?: string): Session {
    return {
        active: true,
        metadata: MetadataSchema.parse({ path: '/project', host: 'host', machineId: 'm1', flavor, lifecycleState }),
    } as Session;
}

describe('session lifecycle permissions', () => {
    it.each(['claude', 'codex', 'gemini'])('allows offline %s forks but rejects explicit archives', flavor => {
        for (const active of [true, false]) {
            for (const state of [undefined, 'running']) {
                expect(canForkSession({ ...session(flavor, state), active })).toBe(true);
            }
            expect(canForkSession({ ...session(flavor, 'archived'), active })).toBe(false);
        }
    });

    it('checks the latest lifecycle at confirmation and rejects a removed session', () => {
        const current = session('codex');
        expect(canForkSession(current)).toBe(true);
        current.metadata!.lifecycleState = 'archived';
        expect(canForkSession(current)).toBe(false);
        expect(canForkSession(undefined)).toBe(false);
    });
    it.each(['claude', 'codex', 'gemini'])('keeps offline %s input and queue management available', flavor => {
        const current = session(flavor, 'running');
        expect(canEditSession(current)).toBe(true);
        current.active = false;
        expect(canEditSession(current)).toBe(true);
        current.metadata = MetadataSchema.parse({ ...current.metadata, lifecycleState: 'archived' });
        expect(canEditSession(current)).toBe(false);
        current.metadata = MetadataSchema.parse({ ...current.metadata, lifecycleState: 'running' });
        expect(canEditSession(current)).toBe(true);
        current.active = true;
        expect(canEditSession(current)).toBe(true);
    });

    it('preserves lifecycle fields when parsing metadata', () => {
        const lifecycle = { lifecycleState: 'archived', lifecycleStateSince: 123, archivedBy: 'cli', archiveReason: 'User terminated' };
        expect(MetadataSchema.parse({ path: '/project', host: 'host', ...lifecycle })).toMatchObject(lifecycle);
    });

    it('does not infer archival for legacy or missing metadata', () => {
        const current = session('codex');
        current.active = false;
        expect(canEditSession(current)).toBe(true);
        current.metadata = null;
        expect(canEditSession(current)).toBe(true);
    });

    it('keeps explicit archives read-only even before the activity update arrives', () => {
        expect(canEditSession(session('codex', 'archived'))).toBe(false);
    });

    it.each([true, false])('respects view-only access when active is %s', active => {
        expect(canEditSession({ ...session('claude', 'running'), active, accessLevel: 'view' })).toBe(false);
    });

    it('offers native archive for stopped Codex sessions until explicitly archived', () => {
        const current = session('codex');
        current.active = false;
        expect(canArchiveSession(current, false)).toBe(true);
        expect(canArchiveSession({ ...current, accessLevel: 'admin' }, false)).toBe(false);
        current.metadata = { ...current.metadata!, machineId: undefined };
        expect(canArchiveSession(current, false)).toBe(false);
    });

    it.each(['claude', 'codex', 'gemini'])('does not offer archive again for archived %s sessions', flavor => {
        for (const active of [true, false]) {
            for (const isConnected of [true, false]) {
                expect(canArchiveSession({ ...session(flavor, 'archived'), active }, isConnected)).toBe(false);
            }
        }
    });

    it.each(['claude', 'gemini'])('does not add offline archive actions for %s', flavor => {
        const current = session(flavor);
        expect(canArchiveSession(current, true)).toBe(true);
        current.active = false;
        expect(canArchiveSession(current, false)).toBe(false);
    });
});
