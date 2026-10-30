import * as React from 'react';
import { useAllMachines, useLocalSettingMutable } from '@/sync/storage';
import { Machine, Session } from '@/sync/storageTypes';
import { t } from '@/text';
import { projectLabels } from '@/utils/projectLabels';
import { compareSessionsByLastMessage } from '@/utils/sessionLastMessageAt';
import { SessionProjectLabel, useSessionProjectLabels } from './useSessionProjectLabel';

export type SessionProjectMachineGroup = {
    machine: Machine | null;
    machineName: string;
    sessions: Session[];
};

export type SessionProjectGroup = {
    path: string;
    collapseKey: string;
    label: SessionProjectLabel;
    machines: Map<string, SessionProjectMachineGroup>;
    sessions: Session[];
};

// A project on a single machine folds on its own: the same path on another machine is another
// project. One that spans machines (the phone's merged list) folds by its path alone. Its
// disconnected sessions sit in a block of their own, which folds apart from the live one.
export function getSessionProjectCollapseKey(projectPath: string, machineId?: string, disconnected = false): string {
    const path = `path:${encodeURIComponent(projectPath)}`;
    const key = machineId ? `machine:${encodeURIComponent(machineId)}:${path}` : path;
    return disconnected ? `disconnected:${key}` : key;
}

// By machine (the phone's "All machines" view), the same path on two machines is two projects.
export function useSessionProjectGroups(
    sessions: Session[],
    { byMachine = false, disconnected = false }: { byMachine?: boolean; disconnected?: boolean } = {},
): SessionProjectGroup[] {
    const machines = useAllMachines();
    const machinesMap = React.useMemo(() => {
        const map: Record<string, Machine> = {};
        for (const machine of machines) map[machine.id] = machine;
        return map;
    }, [machines]);
    const projectLabel = useSessionProjectLabels(sessions, { byMachine });

    return React.useMemo(() => {
        const groups = new Map<string, SessionProjectGroup>();
        const unknownText = t('status.unknown');

        for (const session of sessions) {
            const projectPath = session.metadata?.path || '';
            const machineId = session.metadata?.machineId || unknownText;
            const machine = machineId !== unknownText ? machinesMap[machineId] : null;
            const machineName = machine?.metadata?.displayName
                || machine?.metadata?.host
                || (machineId !== unknownText ? machineId : `<${unknownText}>`);

            const groupKey = byMachine ? `${projectPath}\0${machineId}` : projectPath;
            let projectGroup = groups.get(groupKey);
            if (!projectGroup) {
                projectGroup = {
                    path: projectPath,
                    collapseKey: getSessionProjectCollapseKey(projectPath, undefined, disconnected),
                    label: projectLabel(session),
                    machines: new Map(),
                    sessions: [],
                };
                groups.set(groupKey, projectGroup);
            }

            let machineGroup = projectGroup.machines.get(machineId);
            if (!machineGroup) {
                machineGroup = { machine, machineName, sessions: [] };
                projectGroup.machines.set(machineId, machineGroup);
            }

            machineGroup.sessions.push(session);
            projectGroup.sessions.push(session);
        }

        for (const projectGroup of groups.values()) {
            const machineIds = Array.from(projectGroup.machines.keys());
            if (machineIds.length === 1 && machineIds[0] !== unknownText) {
                projectGroup.collapseKey = getSessionProjectCollapseKey(projectGroup.path, machineIds[0], disconnected);
            }
            for (const machineGroup of projectGroup.machines.values()) {
                machineGroup.sessions.sort(compareSessionsByLastMessage);
            }
            projectGroup.sessions.sort(compareSessionsByLastMessage);
        }

        // By name, whether full paths are shown or not, so switching between them leaves the order be.
        // By machine, the same project on several machines sits together, its machines by name.
        const names = projectLabels(Array.from(groups.values(), group => group.path));
        const machineName = (group: SessionProjectGroup) => group.machines.values().next().value?.machineName ?? '';
        return Array.from(groups.values()).sort((a, b) => names.get(a.path)!.name
            .localeCompare(names.get(b.path)!.name, undefined, { sensitivity: 'base' }) || a.path.localeCompare(b.path)
            || machineName(a).localeCompare(machineName(b)));
    }, [sessions, machinesMap, projectLabel, byMachine, disconnected]);
}

export function useCollapsedSessionProjectGroups(
    projectGroups: SessionProjectGroup[],
    selectedSessionId?: string,
) {
    const [collapsedGroups, setCollapsedGroups] = useLocalSettingMutable('collapsedSessionProjectGroups');
    const selectedGroupPath = React.useMemo(() => {
        if (!selectedSessionId) return null;
        return projectGroups.find(group => group.sessions.some(session => session.id === selectedSessionId))?.collapseKey ?? null;
    }, [projectGroups, selectedSessionId]);
    const lastRevealedSessionIdRef = React.useRef<string | null>(null);

    React.useEffect(() => {
        if (!selectedSessionId || selectedGroupPath === null || lastRevealedSessionIdRef.current === selectedSessionId) {
            return;
        }
        lastRevealedSessionIdRef.current = selectedSessionId;
        if (!collapsedGroups[selectedGroupPath]) return;

        const next = { ...collapsedGroups };
        delete next[selectedGroupPath];
        setCollapsedGroups(next);
    }, [collapsedGroups, selectedGroupPath, selectedSessionId, setCollapsedGroups]);

    const toggleGroup = React.useCallback((collapseKey: string) => {
        const next = { ...collapsedGroups };
        if (next[collapseKey]) delete next[collapseKey];
        else next[collapseKey] = true;
        setCollapsedGroups(next);
    }, [collapsedGroups, setCollapsedGroups]);

    return { collapsedGroups, toggleGroup };
}
