import { useEffect, useMemo, useState } from 'react';
import { machineListQoderModels, machineQoderModelDescriptions, type QoderModel, type QoderModelDescriptions } from '@/sync/ops';
import { useLatestQoderModels } from '@/sync/storage';
import { getCurrentLanguage } from '@/text';

/** A Qoder model for the picker; `detail` is Qoder's own description, when known. */
export type QoderPickerModel = QoderModel & { detail?: string };

// Models and texts belong to the machine's Qoder install, so one lookup per machine serves every screen.
const modelsByMachine = new Map<string, QoderModel[]>();
const descriptionsByMachine = new Map<string, QoderModelDescriptions>();
const latestDescriptionsAsked = new Set<string>();

/**
 * Models a Qoder session on `machineId` can use, with their efforts and descriptions.
 *
 * Qoder lists models (and each model's efforts) per account and only over ACP, so
 * they are asked from the machine (a throwaway ACP session that qodercli does not
 * save) once Qoder is selected. Until that answer arrives, or if the machine can't
 * answer, the models the most recently updated Qoder session reported are used.
 *
 * ACP describes models with tags only. Qoder's sentences come from its text bundle:
 * the copy qodercli cached shows first, then the current bundle replaces it once
 * downloaded. Without either, models keep their tags.
 */
export function useQoderModels(machineId: string | null | undefined, directory: string, enabled: boolean): QoderPickerModel[] | undefined {
    const latestSessionModels = useLatestQoderModels();
    const [machineModels, setMachineModels] = useState(() => (machineId ? modelsByMachine.get(machineId) : undefined));
    const [descriptions, setDescriptions] = useState(() => (machineId ? descriptionsByMachine.get(machineId) : undefined));

    useEffect(() => {
        setMachineModels(machineId ? modelsByMachine.get(machineId) : undefined);
        if (!enabled || !machineId || !directory || modelsByMachine.has(machineId)) return;

        let cancelled = false;
        machineListQoderModels(machineId, directory).then((result) => {
            if (!result.success || !result.models?.length) return;
            modelsByMachine.set(machineId, result.models);
            if (!cancelled) setMachineModels(result.models);
        });
        return () => {
            cancelled = true;
        };
    }, [machineId, directory, enabled]);

    useEffect(() => {
        setDescriptions(machineId ? descriptionsByMachine.get(machineId) : undefined);
        if (!enabled || !machineId || latestDescriptionsAsked.has(machineId)) return;
        latestDescriptionsAsked.add(machineId);

        let cancelled = false;
        let latestArrived = false;
        const show = (next: QoderModelDescriptions | null) => {
            if (!next) return;
            descriptionsByMachine.set(machineId, next);
            if (!cancelled) setDescriptions(next);
        };
        machineQoderModelDescriptions(machineId, 'cache').then((cached) => {
            if (!latestArrived) show(cached);
        });
        machineQoderModelDescriptions(machineId, 'latest').then((latest) => {
            latestArrived = !!latest;
            show(latest);
            // A failed download is asked again next time Qoder is picked.
            if (!latest) latestDescriptionsAsked.delete(machineId);
        });
        return () => {
            cancelled = true;
        };
    }, [machineId, enabled]);

    const models = machineModels ?? latestSessionModels;
    return useMemo(() => {
        if (!descriptions) return models;
        const texts = getCurrentLanguage().startsWith('zh') ? descriptions.zh : descriptions.en;
        return models?.map((model) => ({ ...model, detail: texts[model.code] ?? descriptions.en[model.code] }));
    }, [models, descriptions]);
}
