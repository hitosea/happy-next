import { useEffect, useMemo, useState } from 'react';
import { isCliListedAgent, type CliModel } from 'happy-wire';
import { getMachineCliModels, recordMachineCliModels } from '@/sync/cliModelSync';
import { machineListAgentModels } from '@/sync/ops';

// One ask per machine and agent per launch; the machine's daemon keeps the list and asks its CLI again when the CLI changes.
const asked = new Set<string>();

/**
 * Ids of the models `machineId`'s CLI for `agent` (Claude, Codex or Gemini) offers, for the
 * pickers to show only those. The machine is asked once per launch when the agent is selected;
 * until it answers, its saved list is used. Undefined while nothing is known (or for other
 * agents): pickers then show the whole catalog.
 */
export function useCliModelIds(machineId: string | null | undefined, agent: string | null | undefined): ReadonlySet<string> | undefined {
    const listed = isCliListedAgent(agent) ? agent : null;
    const [models, setModels] = useState<CliModel[] | undefined>(() => (machineId && listed ? getMachineCliModels(machineId, listed) : undefined));

    useEffect(() => {
        setModels(machineId && listed ? getMachineCliModels(machineId, listed) : undefined);
        if (!machineId || !listed) return;
        const key = `${machineId}:${listed}`;
        if (asked.has(key)) return;
        asked.add(key);
        let cancelled = false;
        machineListAgentModels(machineId, listed).then((result) => {
            // An older CLI has no such RPC, or the CLI could not be asked: keep what is known, ask again next launch.
            if (!result.success || !result.models?.length) {
                asked.delete(key);
                return;
            }
            recordMachineCliModels(machineId, listed, result.models);
            if (!cancelled) setModels(result.models);
        });
        return () => {
            cancelled = true;
        };
    }, [machineId, listed]);

    // The catalog matches Claude Code's dated ids to undated entries (`claude-haiku-4-5-20251001`), so offer both.
    return useMemo(() => models && new Set(models.flatMap((model) => [model.id, model.id.replace(/-\d{8}$/, '')])), [models]);
}
