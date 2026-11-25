import { useEffect, useMemo, useState } from 'react';
import type { AgentModel } from 'happy-wire';
import { machineListAgentModels, machineQoderModelDescriptions, type QoderModelDescriptions } from '@/sync/ops';
import { loadAgentModelsByMachine, saveAgentModels } from '@/sync/persistence';
import { useLatestSessionModels } from '@/sync/storage';
import { getCurrentLanguage } from '@/text';
import type { AgentChoice } from '@/utils/agentChoice';

/** A model for the picker; `detail` is Qoder's own description, when known. */
export type PickerModel = AgentModel & { detail?: string };

/**
 * The models to show, and whether they are the machine's own list as its CLI gave it this launch
 * (`complete`): only then may a saved choice the list lacks be judged gone.
 */
export type AgentModelsState = { models: PickerModel[] | undefined; complete: boolean };

// Models belong to an agent's CLI and account on a machine (Qoder and Qoder CN have their own), so one
// lookup per machine and agent serves every screen. Each list is also saved, so after a reload the last
// one shows while the machine is asked again.
let savedModels: Map<string, AgentModel[]> | null = null;
const answered = new Set<string>();
const asking = new Set<string>();
function knownModels(key: string): AgentModel[] | undefined {
    savedModels ??= new Map(Object.entries(loadAgentModelsByMachine()));
    return savedModels.get(key);
}

const descriptionsByMachine = new Map<string, QoderModelDescriptions>();
const descriptionsAsked = new Set<string>();

/**
 * Models `agent` offers on `machineId`, with their efforts and context windows, the same way for
 * every agent: the machine's daemon keeps the list its CLI gave and refreshes it, and is asked once
 * per launch when the agent is picked (again on the next pick if that failed). Until it answers, the
 * list it gave last time is used; failing that, the models the most recently updated session of the
 * agent reported (only Qoder's and Antigravity's sessions report them).
 *
 * Qoder describes models with tags only; its sentences come from its text bundle: the copy qodercli
 * cached shows first, then the current bundle replaces it once downloaded.
 */
export function useAgentModels(machineId: string | null | undefined, agent: AgentChoice | null | undefined): AgentModelsState {
    const latestSessionModels = useLatestSessionModels(agent ?? null);
    const key = machineId && agent ? `${machineId}:${agent}` : null;
    const [machineModels, setMachineModels] = useState(() => (key ? knownModels(key) : undefined));
    const [complete, setComplete] = useState(() => !!key && answered.has(key));
    const isQoder = agent === 'qoder' || agent === 'qodercn';
    const [descriptions, setDescriptions] = useState(() => (key ? descriptionsByMachine.get(key) : undefined));

    useEffect(() => {
        setMachineModels(key ? knownModels(key) : undefined);
        setComplete(!!key && answered.has(key));
        if (!machineId || !agent || !key || answered.has(key) || asking.has(key)) return;
        asking.add(key);
        let cancelled = false;
        machineListAgentModels(machineId, agent).then((result) => {
            asking.delete(key);
            if (!result.success || !result.models?.length) return;
            answered.add(key);
            savedModels?.set(key, result.models);
            saveAgentModels(key, result.models);
            if (cancelled) return;
            setMachineModels(result.models);
            setComplete(true);
        });
        return () => {
            cancelled = true;
        };
    }, [machineId, agent, key]);

    useEffect(() => {
        setDescriptions(key ? descriptionsByMachine.get(key) : undefined);
        if (!isQoder || !machineId || !key || descriptionsAsked.has(key)) return;
        descriptionsAsked.add(key);
        const build = agent === 'qodercn' ? 'cn' : 'intl';
        let cancelled = false;
        let latestArrived = false;
        const show = (next: QoderModelDescriptions | null) => {
            if (!next) return;
            descriptionsByMachine.set(key, next);
            if (!cancelled) setDescriptions(next);
        };
        machineQoderModelDescriptions(machineId, build, 'cache').then((cached) => {
            if (!latestArrived) show(cached);
        });
        machineQoderModelDescriptions(machineId, build, 'latest').then((latest) => {
            latestArrived = !!latest;
            show(latest);
            // A failed download is asked again next time this Qoder is picked.
            if (!latest) descriptionsAsked.delete(key);
        });
        return () => {
            cancelled = true;
        };
    }, [machineId, agent, key, isQoder]);

    const models: AgentModel[] | undefined = machineModels ?? latestSessionModels;
    const described = useMemo(() => {
        if (!descriptions) return models;
        const texts = getCurrentLanguage().startsWith('zh') ? descriptions.zh : descriptions.en;
        return models?.map((model) => ({ ...model, detail: texts[model.code] ?? descriptions.en[model.code] }));
    }, [models, descriptions]);
    return { models: described, complete };
}
