import { AgentModelListSchema, MODEL_LISTING_AGENTS, listModelModes } from 'happy-wire';

// A cached list answers at once; a new one can take a while (Codex may come through npx)
const MODELS_TIMEOUT_MS = 30_000;

/** Calls an RPC method another machine's daemon registered, e.g. `<machineId>:agent-list-models`. */
export type MachineRpcCall = (method: string, params: Record<string, unknown>, timeoutMs: number) => Promise<unknown>;

type ContextMachine = {
    machineId?: unknown;
    online?: unknown;
    providers?: unknown;
    modelModes?: Record<string, unknown>;
};

/** `default`, then every model the listing has and each `model:effort`; null when it has none. */
export function modelModesFromListing(response: unknown): string[] | null {
    const listing = response as { success?: boolean; models?: unknown } | null;
    const models = AgentModelListSchema.safeParse(listing?.models);
    return listing?.success && models.success && models.data.length > 0 ? listModelModes(models.data) : null;
}

/**
 * The server knows no models: what a machine offers comes from its own CLIs and accounts. Ask each
 * online machine for the models of every provider it has (`agent-list-models`, the same for all) and
 * put them in its `modelModes.<provider>`; a provider whose daemon does not answer (an older CLI, or
 * a listing that failed) keeps what the server sent.
 */
export async function fillMachineModelModes<T extends ContextMachine>(machines: T[], call: MachineRpcCall): Promise<T[]> {
    return Promise.all(machines.map(async (machine) => {
        const { machineId, providers } = machine;
        if (typeof machineId !== 'string' || machine.online !== true || !Array.isArray(providers)) {
            return machine;
        }
        const listed = await Promise.all(MODEL_LISTING_AGENTS.filter((agent) => providers.includes(agent)).map(async (agent) => {
            const modes = await call(`${machineId}:agent-list-models`, { agent }, MODELS_TIMEOUT_MS).then(modelModesFromListing, () => null);
            return [agent, modes] as const;
        }));
        const filled = Object.fromEntries(listed.filter(([, modes]) => modes));
        return Object.keys(filled).length ? { ...machine, modelModes: { ...machine.modelModes, ...filled } } : machine;
    }));
}
