// The session list's machine / sharing scope, shared by the list itself, the sidebar machine rail
// and the phone header's machine switcher. The selection is a persisted local setting, so every
// consumer reads and writes the same value and stays in step without prop drilling.
import * as React from 'react';
import { useShallow } from 'zustand/react/shallow';
import { storage, useLocalSettingMutable, useSetting, type SessionListViewItem } from '@/sync/storage';
import type { Session } from '@/sync/storageTypes';
import { useIsTablet } from '@/utils/responsive';
import { useVisibleSessionListViewData, useSharedSessionListViewData, useSharedByMeSessionListViewData } from '@/hooks/useVisibleSessionListViewData';
import {
    buildSessionMachineGroups,
    getSessionScopeDot,
    resolveSessionListScope,
    type SessionListSelection,
    type SessionMachineGroup,
    type SessionScopeDot,
} from '@/components/sessionListScope';

export function collectListSessions(items: SessionListViewItem[] | null): Session[] {
    const sessions: Session[] = [];
    if (!items) return sessions;
    for (const item of items) {
        if (item.type === 'active-sessions') sessions.push(...item.sessions);
        else if (item.type === 'session') sessions.push(item.session);
    }
    return sessions;
}

export type SessionListScope = {
    ready: boolean;
    data: SessionListViewItem[] | null;
    sharedData: SessionListViewItem[] | null;
    sharedByMeData: SessionListViewItem[] | null;
    // Active sessions of my own, across every machine.
    activeSessions: Session[];
    groups: SessionMachineGroup[];
    sharedSessions: Session[];
    sharedByMeSessions: Session[];
    hasShared: boolean;
    hasSharedByMe: boolean;
    sharedDot: SessionScopeDot;
    sharedByMeDot: SessionScopeDot;
    switchable: boolean;
    selection: SessionListSelection;
    setSelection: (selection: SessionListSelection) => void;
};

export function useSessionListScope(): SessionListScope {
    const data = useVisibleSessionListViewData();
    const sharedData = useSharedSessionListViewData();
    const sharedByMeData = useSharedByMeSessionListViewData();
    // Every synced machine, offline ones included — useAllMachines() only returns the online ones.
    const machines = storage(useShallow((state) => state.machines));
    const [nameCache] = useLocalSettingMutable('machineNameCache');
    const machineOrder = useSetting('machineOrder');
    const hideIdleMachines = useSetting('hideIdleMachines');
    const [persisted, setPersisted] = useLocalSettingMutable('sessionListSelectedTab');

    const activeSessions = React.useMemo(() => {
        const item = data?.find(i => i.type === 'active-sessions');
        return item && item.type === 'active-sessions' ? item.sessions : [];
    }, [data]);
    const groups = React.useMemo(
        () => buildSessionMachineGroups(activeSessions, machines, nameCache, machineOrder, {
            hideIdle: hideIdleMachines,
            keepMachineId: persisted,
        }),
        [activeSessions, machines, nameCache, machineOrder, hideIdleMachines, persisted],
    );
    const sharedSessions = React.useMemo(() => collectListSessions(sharedData), [sharedData]);
    const sharedByMeSessions = React.useMemo(() => collectListSessions(sharedByMeData), [sharedByMeData]);
    const hasShared = sharedSessions.length > 0;
    const hasSharedByMe = sharedByMeSessions.length > 0;
    const ready = data !== null;
    // The sidebar layout always shows the machine rail; the phone only offers switching when there is a choice.
    const isTablet = useIsTablet();

    const { switchable, selection } = resolveSessionListScope({
        selected: persisted,
        groups,
        hasShared,
        hasSharedByMe,
        ready,
        alwaysSwitchable: isTablet,
    });

    const setSelection = React.useCallback((next: SessionListSelection) => {
        setPersisted(next);
    }, [setPersisted]);

    const sharedDot = React.useMemo(() => getSessionScopeDot(sharedSessions), [sharedSessions]);
    const sharedByMeDot = React.useMemo(() => getSessionScopeDot(sharedByMeSessions), [sharedByMeSessions]);

    return {
        ready,
        data,
        sharedData,
        sharedByMeData,
        activeSessions,
        groups,
        sharedSessions,
        sharedByMeSessions,
        hasShared,
        hasSharedByMe,
        sharedDot,
        sharedByMeDot,
        switchable,
        selection,
        setSelection,
    };
}
