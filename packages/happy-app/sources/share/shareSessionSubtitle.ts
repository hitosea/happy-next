import type { Machine, Session } from '@/sync/storageTypes';
import { agentDisplayName } from '@/utils/agentChoice';

/** Each machine's name by its id, for shareSessionSubtitle. */
export function machineNames(machines: Machine[]): Map<string, string> {
    return new Map(machines.map((machine) => [
        machine.id,
        machine.metadata?.displayName || machine.metadata?.host || '',
    ]));
}

/**
 * The line under a session where shared content is sent (the share-target page and the iOS share
 * extension's sheet): its project, AI and machine.
 */
export function shareSessionSubtitle(session: Session, machines: Map<string, string>): string {
    const project = (session.metadata?.path ?? '').split(/[\\/]/).filter(Boolean).pop() ?? '';
    const machine = machines.get(session.metadata?.machineId ?? '');
    return [project, agentDisplayName(session.metadata?.flavor, session.metadata?.qoderBuild), machine].filter(Boolean).join(' · ');
}
