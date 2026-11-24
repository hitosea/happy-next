import { useEffect, useState } from 'react';
import { machineListAntigravityModels, type QoderModel } from '@/sync/ops';
import { useLatestAntigravityModels } from '@/sync/storage';

/** The models to show, and whether the machine's list is still on its way (the shown ones are then stand-ins). */
export type AntigravityModelsState = { models: QoderModel[] | undefined; pending: boolean };

// Models belong to the Antigravity account signed in on a machine, so one lookup per machine serves every screen.
const modelsByMachine = new Map<string, QoderModel[]>();
const unansweredMachines = new Set<string>();

/**
 * Models an Antigravity session on `machineId` can use, with their thinking levels.
 *
 * agy lists models per account and only over ACP, so they are asked from the machine,
 * whose daemon keeps the list and refreshes it from agy. Until that answer arrives, or
 * if the machine can't answer, the models the most recently updated Antigravity session
 * reported are used, with `pending` set so callers don't judge a saved choice against them.
 */
export function useAntigravityModels(machineId: string | null | undefined, enabled: boolean): AntigravityModelsState {
    const latestSessionModels = useLatestAntigravityModels();
    const [machineModels, setMachineModels] = useState(() => (machineId ? modelsByMachine.get(machineId) : undefined));
    const [unanswered, setUnanswered] = useState(false);

    useEffect(() => {
        setMachineModels(machineId ? modelsByMachine.get(machineId) : undefined);
        setUnanswered(!!machineId && unansweredMachines.has(machineId));
        if (!enabled || !machineId || modelsByMachine.has(machineId)) return;

        let cancelled = false;
        machineListAntigravityModels(machineId).then((result) => {
            if (!result.success || !result.models?.length) {
                unansweredMachines.add(machineId);
                if (!cancelled) setUnanswered(true);
                return;
            }
            unansweredMachines.delete(machineId);
            modelsByMachine.set(machineId, result.models);
            if (!cancelled) setMachineModels(result.models);
        });
        return () => {
            cancelled = true;
        };
    }, [machineId, enabled]);

    const pending = enabled && !!machineId && !machineModels && !unanswered;
    return { models: machineModels ?? latestSessionModels, pending };
}
