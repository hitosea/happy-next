import { CLI_LISTED_AGENTS, CliModelSchema, MODEL_MODE_DEFAULT, buildQoderModelMode, cliModelModes, type CliListedAgent } from 'happy-wire';
import { QODER_PROVIDER_BUILDS, type QoderProvider } from './common';

// The daemon keeps the list and spends at most 15s asking qodercli for a new one
const QODER_MODELS_TIMEOUT_MS = 20_000;
// A cached CLI list answers at once; a new one can take a while (Codex may come through npx)
const CLI_MODELS_TIMEOUT_MS = 30_000;

/** Calls an RPC method another machine's daemon registered, e.g. `<machineId>:qoder-list-models`. */
export type MachineRpcCall = (method: string, params: Record<string, unknown>, timeoutMs: number) => Promise<unknown>;

type QoderModelsResponse = {
    success?: boolean;
    models?: Array<{ code?: unknown; efforts?: Array<{ code?: unknown }> }>;
};

type ContextMachine = {
    machineId?: unknown;
    online?: unknown;
    providers?: unknown;
    modelModes?: Record<string, unknown>;
};

/** `default`, then every model code the listing has and each `code:effort`. */
export function qoderModelModesFromListing(response: unknown): string[] | null {
    const listing = response as QoderModelsResponse | null;
    if (!listing?.success || !Array.isArray(listing.models)) {
        return null;
    }
    const modes: string[] = [MODEL_MODE_DEFAULT];
    for (const model of listing.models) {
        if (typeof model?.code !== 'string' || !model.code) continue;
        modes.push(buildQoderModelMode(model.code, null));
        for (const effort of Array.isArray(model.efforts) ? model.efforts : []) {
            if (typeof effort?.code === 'string' && effort.code) {
                modes.push(buildQoderModelMode(model.code, effort.code));
            }
        }
    }
    return modes;
}

// The RPC each provider whose models are per account lists them with; both answer
// `{ success, models: [{ code, efforts: [{ code }] }] }`.
const MODEL_LISTING_RPCS: Record<QoderProvider | 'antigravity', { method: string; params: Record<string, unknown> }> = {
    qoder: { method: 'qoder-list-models', params: { build: QODER_PROVIDER_BUILDS.qoder } },
    qodercn: { method: 'qoder-list-models', params: { build: QODER_PROVIDER_BUILDS.qodercn } },
    antigravity: { method: 'antigravity-list-models', params: {} },
};

async function loadQoderModelModes(machineId: string, provider: keyof typeof MODEL_LISTING_RPCS, call: MachineRpcCall): Promise<string[] | null> {
    const { method, params } = MODEL_LISTING_RPCS[provider];
    try {
        return qoderModelModesFromListing(await call(`${machineId}:${method}`, params, QODER_MODELS_TIMEOUT_MS));
    } catch {
        return null;
    }
}

/** Modes for the models a machine's Claude, Codex or Gemini CLI lists (`agent-list-models`), or null. */
async function loadCliModelModes(machineId: string, agent: CliListedAgent, call: MachineRpcCall): Promise<string[] | null> {
    try {
        const response = await call(`${machineId}:agent-list-models`, { agent }, CLI_MODELS_TIMEOUT_MS) as { success?: boolean; models?: unknown } | null;
        const models = CliModelSchema.array().safeParse(response?.models);
        return response?.success && models.success && models.data.length > 0 ? cliModelModes(agent, models.data) : null;
    } catch {
        return null;
    }
}

const LISTERS: Record<keyof typeof MODEL_LISTING_RPCS | CliListedAgent, (machineId: string, call: MachineRpcCall) => Promise<string[] | null>> = {
    qoder: (machineId, call) => loadQoderModelModes(machineId, 'qoder', call),
    qodercn: (machineId, call) => loadQoderModelModes(machineId, 'qodercn', call),
    antigravity: (machineId, call) => loadQoderModelModes(machineId, 'antigravity', call),
    ...Object.fromEntries(CLI_LISTED_AGENTS.map((agent) => [agent, (machineId: string, call: MachineRpcCall) => loadCliModelModes(machineId, agent, call)])) as Record<CliListedAgent, (machineId: string, call: MachineRpcCall) => Promise<string[] | null>>,
};

/**
 * The server only knows the models in its bundled catalog, while what a machine offers comes
 * from its own CLIs and accounts. Ask each online machine for the models of every provider it
 * has (Claude, Codex and Gemini as their CLIs list them; Qoder, Qoder CN and Antigravity per
 * account) and put them in its `modelModes.<provider>`; a provider whose daemon does not answer
 * (an older CLI, or a listing that failed) keeps what the server sent.
 */
export async function fillMachineModelModes<T extends ContextMachine>(machines: T[], call: MachineRpcCall): Promise<T[]> {
    return Promise.all(machines.map(async (machine) => {
        const { machineId, providers } = machine;
        if (typeof machineId !== 'string' || machine.online !== true || !Array.isArray(providers)) {
            return machine;
        }
        const listedProviders = (Object.keys(LISTERS) as (keyof typeof LISTERS)[]).filter((provider) => providers.includes(provider));
        const listed = await Promise.all(listedProviders.map(async (provider) => [provider, await LISTERS[provider](machineId, call)] as const));
        const filled = Object.fromEntries(listed.filter(([, modes]) => modes));
        return Object.keys(filled).length ? { ...machine, modelModes: { ...machine.modelModes, ...filled } } : machine;
    }));
}
