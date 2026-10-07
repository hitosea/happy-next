import type { Machine, Session } from '@/sync/storageTypes';
import { applyMachineOrder } from '@/utils/machineOrder';
import { hasUnreadCompletion } from '@/utils/sessionUtils';

// What the session list is showing: every machine, one machine (its id), or a sharing view.
export type SessionListSelection = 'all' | 'shared' | 'sharedByMe' | (string & {});

// Per-scope status dot, mirroring useSessionStatus precedence: 'attention' (needs permission,
// orange pulse) > 'thinking' (blue pulse) > 'completed' (unread completion, static blue).
export type SessionScopeDot = 'none' | 'attention' | 'thinking' | 'completed';

// Sessions that carry no machineId only appear in "All", gathered under this group.
export const UNKNOWN_MACHINE_GROUP_ID = '__unknown_machine__';

export type SessionMachineGroup = {
    id: string;
    name: string;
    online: boolean;
    // The group of sessions without a machineId — never selectable on its own.
    unknown: boolean;
    sessions: Session[];
    dot: SessionScopeDot;
};

export function getSessionScopeDot(sessions: Session[]): SessionScopeDot {
    const online = sessions.filter(s => s.presence === 'online');
    if (online.some(s => !!s.agentState?.requests && Object.keys(s.agentState.requests).length > 0)) return 'attention';
    if (online.some(s => s.thinking === true)) return 'thinking';
    if (sessions.some(hasUnreadCompletion)) return 'completed';
    return 'none';
}

const DOT_RANK: Record<SessionScopeDot, number> = { none: 0, completed: 1, thinking: 2, attention: 3 };

/**
 * The strongest dot the machine switcher shows — over its machines and sharing views, whatever is
 * selected — so the phone title carries it and nothing in the switcher goes unnoticed.
 */
export function getSwitcherDot({ groups, sharedDot, sharedByMeDot }: {
    groups: SessionMachineGroup[];
    sharedDot: SessionScopeDot;
    sharedByMeDot: SessionScopeDot;
}): SessionScopeDot {
    const dots = [...groups.filter(group => !group.unknown).map(group => group.dot), sharedDot, sharedByMeDot];
    return dots.reduce<SessionScopeDot>((best, dot) => (DOT_RANK[dot] > DOT_RANK[best] ? dot : best), 'none');
}

export function getMachineDisplayName(machine: Machine | undefined, machineId: string, nameCache: Record<string, string>): string {
    return machine?.metadata?.displayName || machine?.metadata?.host || nameCache[machineId] || machineId;
}

/**
 * One group per machine the list should offer: every online machine (so one without sessions can
 * still be picked to start one), plus any machine that still has active sessions even though it is
 * offline or no longer synced. Offline machines with nothing on them are left out — the account
 * keeps every machine it ever registered, and listing all of them would bury the live ones.
 * Sessions without a machineId go to a trailing "unknown" group.
 */
export function buildSessionMachineGroups(
    activeSessions: Session[],
    machines: Record<string, Machine>,
    nameCache: Record<string, string>,
    machineOrder: readonly string[] = [],
): SessionMachineGroup[] {
    const groups = new Map<string, SessionMachineGroup>();
    const ensure = (machineId: string) => {
        let group = groups.get(machineId);
        if (!group) {
            const machine = machines[machineId];
            group = {
                id: machineId,
                name: getMachineDisplayName(machine, machineId, nameCache),
                online: !!machine?.active,
                unknown: false,
                sessions: [],
                dot: 'none',
            };
            groups.set(machineId, group);
        }
        return group;
    };

    for (const machine of Object.values(machines)) {
        if (machine.active) ensure(machine.id);
    }

    const unknownSessions: Session[] = [];
    for (const session of activeSessions) {
        const machineId = session.metadata?.machineId;
        if (machineId) ensure(machineId).sessions.push(session);
        else unknownSessions.push(session);
    }

    // By name, unless the user put the machines in an order of their own (settings > machines).
    const result = applyMachineOrder(
        Array.from(groups.values()).sort((a, b) => a.name.localeCompare(b.name)),
        group => group.id,
        machineOrder,
    );
    if (unknownSessions.length > 0) {
        result.push({ id: UNKNOWN_MACHINE_GROUP_ID, name: '', online: false, unknown: true, sessions: unknownSessions, dot: 'none' });
    }
    for (const group of result) group.dot = getSessionScopeDot(group.sessions);
    return result;
}

export type SessionListScopeState = {
    // Whether there is anything to switch between: two or more machines, or a sharing view.
    // Drives the sidebar machine rail and the machine names in the phone title.
    switchable: boolean;
    selection: SessionListSelection;
};

/**
 * The selection the list actually shows. A persisted selection that no longer exists (machine gone,
 * sharing view emptied) falls back to "all" — but only once data is ready, so a restart does not
 * discard the persisted machine before machines and sessions arrive.
 */
export function resolveSessionListScope({ selected, groups, hasShared, hasSharedByMe, ready, alwaysSwitchable = false }: {
    selected: string | null;
    groups: SessionMachineGroup[];
    hasShared: boolean;
    hasSharedByMe: boolean;
    ready: boolean;
    // The sidebar's machine rail is always shown, so a lone machine can be picked there too.
    alwaysSwitchable?: boolean;
}): SessionListScopeState {
    const machineGroups = groups.filter(group => !group.unknown);
    const switchable = alwaysSwitchable || machineGroups.length >= 2 || hasShared || hasSharedByMe;
    const requested = selected ?? 'all';
    if (!ready) return { switchable, selection: requested };
    if (requested === 'all') return { switchable, selection: 'all' };
    if (requested === 'shared') return { switchable, selection: hasShared ? 'shared' : 'all' };
    if (requested === 'sharedByMe') return { switchable, selection: hasSharedByMe ? 'sharedByMe' : 'all' };
    const exists = machineGroups.some(group => group.id === requested);
    return { switchable, selection: switchable && exists ? requested : 'all' };
}

export function isSharingSelection(selection: SessionListSelection): selection is 'shared' | 'sharedByMe' {
    return selection === 'shared' || selection === 'sharedByMe';
}

// Two-letter badge for a machine in the rail: initials of the first two words, else its first two characters.
export function getMachineInitials(name: string): string {
    const words = name.trim().split(/[\s\-_.]+/).filter(Boolean);
    if (words.length >= 2 && /^[A-Za-z0-9]/.test(words[0]) && /^[A-Za-z0-9]/.test(words[1])) {
        return (words[0][0] + words[1][0]).toUpperCase();
    }
    return Array.from(name.trim()).slice(0, 2).join('').toUpperCase() || '?';
}

export function filterMachineGroups(groups: SessionMachineGroup[], query: string): SessionMachineGroup[] {
    const keyword = query.trim().toLowerCase();
    const machines = groups.filter(group => !group.unknown);
    if (!keyword) return machines;
    return machines.filter(group => group.name.toLowerCase().includes(keyword));
}
