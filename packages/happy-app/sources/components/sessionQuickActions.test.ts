import { describe, expect, it } from 'vitest';
import { Session } from '@/sync/storageTypes';
import { getSessionQuickActionKinds, getSessionQuickActionSections } from './sessionQuickActions';

function session(overrides: Partial<Session> = {}): Session {
    return {
        id: 'session-1',
        seq: 1,
        createdAt: 1,
        updatedAt: 1,
        active: true,
        metadataVersion: 1,
        metadata: {
            machineId: 'machine-1',
            path: '/project',
            claudeSessionId: 'claude-1',
        },
        ...overrides,
    } as Session;
}

describe('getSessionQuickActionKinds', () => {
    it('includes owner actions for a connected session', () => {
        expect(getSessionQuickActionKinds({
            session: session(),
            isConnected: true,
            isLocalMachine: false,
        })).toEqual([
            'details',
            'renameSession',
            'toggleRead',
            'newSession',
            'terminal',
            'forkSession',
            'archiveSession',
        ]);
    });

    it('offers a terminal only where the session names a machine', () => {
        // The terminal runs on that machine, so without one there is nothing to open it on.
        const withoutMachine = session();
        delete (withoutMachine.metadata as { machineId?: string }).machineId;
        expect(getSessionQuickActionKinds({
            session: withoutMachine,
            isConnected: true,
            isLocalMachine: false,
        })).not.toContain('terminal');
    });

    it('offers no terminal to a shared session', () => {
        // Same reason as `newSession`: the machine is the owner's, and a terminal there is a
        // shell with their environment in it.
        expect(getSessionQuickActionKinds({
            session: session({ accessLevel: 'view' }),
            isConnected: true,
            isLocalMachine: false,
        })).not.toContain('terminal');
    });

    it('offers the folder of a session running on this computer', () => {
        expect(getSessionQuickActionKinds({
            session: session(),
            isConnected: true,
            isLocalMachine: true,
        })).toContain('revealInFileManager');
    });

    it('hides the folder of a session running on another computer', () => {
        // The path is on someone else's disk; there is nothing here to show.
        expect(getSessionQuickActionKinds({
            session: session(),
            isConnected: true,
            isLocalMachine: false,
        })).not.toContain('revealInFileManager');
    });

    it('hides the folder of a session that never reported one', () => {
        const current = session();
        current.metadata = { ...current.metadata!, path: '' };
        expect(getSessionQuickActionKinds({
            session: current,
            isConnected: true,
            isLocalMachine: true,
        })).not.toContain('revealInFileManager');
    });

    it('offers delete instead of archive for an inactive disconnected session', () => {
        expect(getSessionQuickActionKinds({
            session: session({ active: false }),
            isConnected: false,
            isLocalMachine: false,
        })).toContain('deleteSession');
    });

    it('limits shared sessions to shared-session actions', () => {
        // No `newSession`: a shared session lives on the owner's machine and directory, so it
        // cannot host a session of mine.
        expect(getSessionQuickActionKinds({
            session: session({ accessLevel: 'view' }),
            isConnected: true,
            isLocalMachine: false,
        })).toEqual(['details', 'toggleRead', 'leaveSharedSession']);
    });

    it('offers native archive for stopped Codex sessions until explicitly archived', () => {
        const current = session();
        current.metadata = { ...current.metadata!, flavor: 'codex', codexSessionId: 'native-1' };
        expect(getSessionQuickActionKinds({ session: current, isConnected: true, isLocalMachine: false })).toContain('archiveSession');
        current.active = false;
        expect(getSessionQuickActionKinds({ session: current, isConnected: false, isLocalMachine: false })).toContain('archiveSession');
        current.metadata.lifecycleState = 'archived';
        const actions = getSessionQuickActionKinds({ session: current, isConnected: false, isLocalMachine: false });
        expect(actions).not.toContain('archiveSession');
        expect(actions).toContain('deleteSession');
    });

    it.each(['claude', 'codex', 'gemini'])('hides archive for archived %s sessions shared by me even with stale activity', flavor => {
        const current = session({ isShared: true });
        current.metadata = { ...current.metadata!, flavor, lifecycleState: 'archived' };
        for (const active of [true, false]) {
            for (const isConnected of [true, false]) {
                expect(getSessionQuickActionKinds({
                    session: { ...current, active },
                    isConnected,
                    isLocalMachine: false,
                })).not.toContain('archiveSession');
            }
        }
    });

    it.each(['view', 'edit', 'admin'] as const)('does not offer native retry to shared %s users', accessLevel => {
        const current = session({ active: false, accessLevel });
        current.metadata = { ...current.metadata!, flavor: 'codex' };
        expect(getSessionQuickActionKinds({ session: current, isConnected: false, isLocalMachine: false })).not.toContain('archiveSession');
    });
});

describe('getSessionQuickActionSections', () => {
    it('splits a full owner menu into its three sections', () => {
        expect(getSessionQuickActionSections([
            'details',
            'renameSession',
            'toggleRead',
            'newSession',
            'terminal',
            'revealInFileManager',
            'forkSession',
            'archiveSession',
        ])).toEqual([
            ['details', 'renameSession', 'toggleRead'],
            ['newSession', 'terminal', 'revealInFileManager', 'forkSession'],
            ['archiveSession'],
        ]);
    });

    it('keeps the order the kinds arrive in', () => {
        expect(getSessionQuickActionSections(['toggleRead', 'details']))
            .toEqual([['toggleRead', 'details']]);
    });

    it('drops the sections the session fills nothing into', () => {
        expect(getSessionQuickActionSections(['details', 'toggleRead', 'leaveSharedSession']))
            .toEqual([
                ['details', 'toggleRead'],
                ['leaveSharedSession'],
            ]);
    });
});
