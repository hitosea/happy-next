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

/**
 * Qoder and Antigravity models are per account, so the server, which takes them from the
 * model catalog, only knows `default`. Ask each online machine with Qoder, Qoder CN or
 * Antigravity for the models that account offers and put them in its `modelModes.<provider>`;
 * a machine whose daemon does not answer keeps what the server sent.
 */
export async function fillQoderModelModes<T extends ContextMachine>(machines: T[], call: MachineRpcCall): Promise<T[]> {
    return Promise.all(machines.map(async (machine) => {
        const { machineId, providers } = machine;
        if (typeof machineId !== 'string' || machine.online !== true || !Array.isArray(providers)) {
            return machine;
        }
        const listedProviders = (Object.keys(MODEL_LISTING_RPCS) as (keyof typeof MODEL_LISTING_RPCS)[]).filter((provider) => providers.includes(provider));
        const listed = await Promise.all(listedProviders.map(async (provider) => [provider, await loadQoderModelModes(machineId, provider, call)] as const));
        const filled = Object.fromEntries(listed.filter(([, modes]) => modes));
        return Object.keys(filled).length ? { ...machine, modelModes: { ...machine.modelModes, ...filled } } : machine;
    }));
}
