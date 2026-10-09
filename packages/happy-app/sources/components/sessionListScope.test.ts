import { describe, expect, it, vi } from 'vitest';

vi.mock('@/utils/sessionUtils', () => ({
    hasUnreadCompletion: (session: { unread?: boolean }) => !!session.unread,
}));

import {
    buildSessionMachineGroups,
    filterMachineGroups,
    getMachineInitials,
    getSwitcherDot,
    getSessionScopeDot,
    resolveSessionListScope,
    UNKNOWN_MACHINE_GROUP_ID,
} from './sessionListScope';

const machine = (id: string, active: boolean, displayName?: string) => ({ id, active, metadata: displayName ? { displayName } : null }) as any;
const session = (id: string, machineId?: string, extra: Record<string, unknown> = {}) => ({
    id,
    presence: 'online',
    thinking: false,
    agentState: null,
    metadata: machineId ? { machineId } : {},
    ...extra,
}) as any;

describe('buildSessionMachineGroups', () => {
    it('lists online machines and machines with sessions, sorted, unknown last', () => {
        const groups = buildSessionMachineGroups(
            [session('s1', 'm-off'), session('s2'), session('s3', 'm-b')],
            { 'm-a': machine('m-a', true, 'beta'), 'm-b': machine('m-b', true, 'alpha'), 'm-gone': machine('m-gone', false, 'gone'), 'm-off': machine('m-off', false, 'zeta') },
            {},
        );
        expect(groups.map(g => g.id)).toEqual(['m-b', 'm-a', 'm-off', UNKNOWN_MACHINE_GROUP_ID]);
        expect(groups.find(g => g.id === 'm-off')?.online).toBe(false);
        expect(groups[groups.length - 1].sessions.map(s => s.id)).toEqual(['s2']);
    });

    it('leaves idle online machines out when hiding them, except the one being shown', () => {
        const machines = { a: machine('a', true, 'a'), b: machine('b', true, 'b'), c: machine('c', true, 'c') };
        const groups = buildSessionMachineGroups([session('s1', 'b')], machines, {}, [], { hideIdle: true, keepMachineId: 'c' });
        expect(groups.map(g => g.id)).toEqual(['b', 'c']);
    });

    it('falls back to the cached name for machines not synced yet', () => {
        const groups = buildSessionMachineGroups([session('s1', 'm-x')], {}, { 'm-x': 'cached' });
        expect(groups[0].name).toBe('cached');
    });
});

describe('getSessionScopeDot', () => {
    it('prefers attention over thinking over completed', () => {
        expect(getSessionScopeDot([session('a', 'm', { unread: true }), session('b', 'm', { thinking: true })])).toBe('thinking');
        expect(getSessionScopeDot([session('b', 'm', { thinking: true }), session('c', 'm', { agentState: { requests: { r: {} } } })])).toBe('attention');
        expect(getSessionScopeDot([session('a', 'm', { unread: true })])).toBe('completed');
        expect(getSessionScopeDot([session('a', 'm', { presence: 123, thinking: true })])).toBe('none');
    });
});

describe('getSwitcherDot', () => {
    const groups = buildSessionMachineGroups(
        [session('a1', 'a', { unread: true }), session('b1', 'b', { thinking: true }), session('x1', undefined, { agentState: { requests: { r: {} } } })],
        { a: machine('a', true, 'a'), b: machine('b', true, 'b') },
        {},
    );

    it('takes the strongest dot of the machines and sharing views', () => {
        expect(getSwitcherDot({ groups, sharedDot: 'none', sharedByMeDot: 'none' })).toBe('thinking');
        expect(getSwitcherDot({ groups, sharedDot: 'none', sharedByMeDot: 'attention' })).toBe('attention');
        expect(getSwitcherDot({ groups: [], sharedDot: 'completed', sharedByMeDot: 'none' })).toBe('completed');
        expect(getSwitcherDot({ groups: [], sharedDot: 'none', sharedByMeDot: 'none' })).toBe('none');
    });

    it('ignores sessions without a machine, which the switcher does not list', () => {
        const unknownOnly = buildSessionMachineGroups([session('x1', undefined, { thinking: true })], { a: machine('a', true, 'a') }, {});
        expect(getSwitcherDot({ groups: unknownOnly, sharedDot: 'none', sharedByMeDot: 'none' })).toBe('none');
    });
});

describe('resolveSessionListScope', () => {
    const groups = buildSessionMachineGroups([], { a: machine('a', true, 'a'), b: machine('b', true, 'b') }, {});
    const one = buildSessionMachineGroups([], { a: machine('a', true, 'a') }, {});

    it('keeps a known machine selection when switchable', () => {
        expect(resolveSessionListScope({ selected: 'b', groups, hasShared: false, hasSharedByMe: false, ready: true })).toEqual({ switchable: true, selection: 'b' });
    });

    it('falls back to all for a missing machine or a single machine', () => {
        expect(resolveSessionListScope({ selected: 'zz', groups, hasShared: false, hasSharedByMe: false, ready: true }).selection).toBe('all');
        expect(resolveSessionListScope({ selected: 'a', groups: one, hasShared: false, hasSharedByMe: false, ready: true })).toEqual({ switchable: false, selection: 'all' });
    });

    it('keeps the persisted selection until data is ready', () => {
        expect(resolveSessionListScope({ selected: 'zz', groups: [], hasShared: false, hasSharedByMe: false, ready: false }).selection).toBe('zz');
    });

    it('keeps a lone machine selection when always switchable', () => {
        expect(resolveSessionListScope({ selected: 'a', groups: one, hasShared: false, hasSharedByMe: false, ready: true, alwaysSwitchable: true })).toEqual({ switchable: true, selection: 'a' });
    });

    it('treats sharing views as switchable', () => {
        expect(resolveSessionListScope({ selected: 'shared', groups: one, hasShared: true, hasSharedByMe: false, ready: true })).toEqual({ switchable: true, selection: 'shared' });
        expect(resolveSessionListScope({ selected: 'sharedByMe', groups: one, hasShared: true, hasSharedByMe: false, ready: true }).selection).toBe('all');
    });
});

describe('helpers', () => {
    it('builds machine initials', () => {
        expect(getMachineInitials('work laptop')).toBe('WL');
        expect(getMachineInitials('mac-mini')).toBe('MM');
        expect(getMachineInitials('服务器')).toBe('服务');
        expect(getMachineInitials('')).toBe('?');
    });

    it('filters machines by name and excludes the unknown group', () => {
        const groups = buildSessionMachineGroups([session('s')], { a: machine('a', true, 'Office'), b: machine('b', true, 'Home') }, {});
        expect(filterMachineGroups(groups, '').map(g => g.id)).toEqual(['b', 'a']);
        expect(filterMachineGroups(groups, 'off').map(g => g.id)).toEqual(['a']);
        expect(filterMachineGroups(groups, 'nope')).toEqual([]);
    });
});
