import { MMKV } from 'react-native-mmkv';
import {
    applyCliModels,
    BUNDLED_MODEL_CATALOG,
    CLI_LISTED_AGENTS,
    CliModelSchema,
    mergeCliModels,
    setModelCatalog,
    type CliListedAgent,
    type CliModel,
} from 'happy-wire';

/**
 * Claude, Codex and Gemini models as each machine's CLIs list them.
 *
 * Every machine answers `agent-list-models` from its installed CLIs; the lists are kept per
 * machine (and saved, so they apply at once after a restart). The active model catalog offers
 * every model any machine lists, so a session's mode resolves whichever machine it runs on;
 * pickers then show only what the selected machine offers (see useCliModels). Until a machine
 * has answered, the catalog bundled in happy-wire stands in.
 */

// Separate MMKV instance so the lists survive logouts
const storage = new MMKV({ id: 'cli-models' });
const STORAGE_KEY = 'byMachine';

type MachineLists = Partial<Record<CliListedAgent, CliModel[]>>;

let byMachine: Record<string, MachineLists> | null = null;

function lists(): Record<string, MachineLists> {
    byMachine ??= readStored();
    return byMachine;
}

function readStored(): Record<string, MachineLists> {
    try {
        const raw = JSON.parse(storage.getString(STORAGE_KEY) ?? '{}') as Record<string, Record<string, unknown>>;
        const result: Record<string, MachineLists> = {};
        for (const [machineId, agents] of Object.entries(raw)) {
            result[machineId] = {};
            for (const agent of CLI_LISTED_AGENTS) {
                const models = CliModelSchema.array().safeParse(agents?.[agent]);
                if (models.success) result[machineId][agent] = models.data;
            }
        }
        return result;
    } catch {
        return {};
    }
}

function applyLists() {
    const machines = Object.values(lists());
    setModelCatalog(applyCliModels(BUNDLED_MODEL_CATALOG, Object.fromEntries(CLI_LISTED_AGENTS.map((agent) => [
        agent,
        mergeCliModels(machines.flatMap((machine) => (machine[agent] ? [machine[agent]] : []))),
    ]))));
}

/** Apply the saved lists to the model catalog. Call once at startup. */
export function startCliModelSync() {
    applyLists();
}

/** The models `machineId`'s CLI for `agent` offers, as it last answered; undefined before it has. */
export function getMachineCliModels(machineId: string, agent: CliListedAgent): CliModel[] | undefined {
    return lists()[machineId]?.[agent];
}

/** Keep what a machine answered for one agent and apply it to the catalog. */
export function recordMachineCliModels(machineId: string, agent: CliListedAgent, models: CliModel[]) {
    const all = lists();
    if (JSON.stringify(all[machineId]?.[agent]) === JSON.stringify(models)) return;
    all[machineId] = { ...all[machineId], [agent]: models };
    storage.set(STORAGE_KEY, JSON.stringify(all));
    applyLists();
}
