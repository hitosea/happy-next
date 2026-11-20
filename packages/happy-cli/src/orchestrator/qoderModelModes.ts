import { MODEL_MODE_DEFAULT, buildQoderModelMode } from 'happy-wire';
import { QODER_PROVIDER_BUILDS, type QoderProvider } from './common';

// The daemon keeps the list and spends at most 15s asking qodercli for a new one
const QODER_MODELS_TIMEOUT_MS = 20_000;

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

async function loadQoderModelModes(machineId: string, provider: QoderProvider, call: MachineRpcCall): Promise<string[] | null> {
    try {
        return qoderModelModesFromListing(await call(`${machineId}:qoder-list-models`, { build: QODER_PROVIDER_BUILDS[provider] }, QODER_MODELS_TIMEOUT_MS));
    } catch {
        return null;
    }
}

/**
 * Qoder models are per account, so the server, which takes them from the model
 * catalog, only knows `default`. Ask each online machine with Qoder or Qoder CN for
 * the models that build's account offers and put them in its `modelModes.qoder` /
 * `modelModes.qodercn`; a machine whose daemon does not answer keeps what the server sent.
 */
export async function fillQoderModelModes<T extends ContextMachine>(machines: T[], call: MachineRpcCall): Promise<T[]> {
    return Promise.all(machines.map(async (machine) => {
        const { machineId, providers } = machine;
        if (typeof machineId !== 'string' || machine.online !== true || !Array.isArray(providers)) {
            return machine;
        }
        const qoderProviders = (Object.keys(QODER_PROVIDER_BUILDS) as QoderProvider[]).filter((provider) => providers.includes(provider));
        const listed = await Promise.all(qoderProviders.map(async (provider) => [provider, await loadQoderModelModes(machineId, provider, call)] as const));
        const filled = Object.fromEntries(listed.filter(([, modes]) => modes));
        return Object.keys(filled).length ? { ...machine, modelModes: { ...machine.modelModes, ...filled } } : machine;
    }));
}
