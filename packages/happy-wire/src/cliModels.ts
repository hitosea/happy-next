import * as z from 'zod';
import { AGENT_DEFAULT_CONTEXT_WINDOWS } from './modelCatalog';
import { ReasoningEffortSchema, type ModelCatalog, type ModelCatalogEntry, type ReasoningEffort } from './modelCatalogSchema';

/**
 * Models the agent CLIs installed on a machine offer, as their own CLIs list them:
 * Claude Code's `initialize` answer, Codex app-server's `model/list` and Gemini CLI's
 * ACP session. They decide which Claude, Codex and Gemini models the pickers show;
 * the bundled catalog only adds what the CLIs don't say (translated descriptions,
 * context windows) and stands in until a machine has answered.
 */
export const CLI_LISTED_AGENTS = ['claude', 'codex', 'gemini'] as const;
export type CliListedAgent = typeof CLI_LISTED_AGENTS[number];

export function isCliListedAgent(agent: string | null | undefined): agent is CliListedAgent {
    return (CLI_LISTED_AGENTS as readonly string[]).includes(agent ?? '');
}

export const CliModelSchema = z.object({
    /** Model id passed to the CLI, e.g. `claude-opus-5-5`, `gpt-6-sol`, `gemini-3.8-flash`. */
    id: z.string().min(1),
    /** The CLI's own name for it, e.g. `Opus 5.5`. */
    label: z.string().min(1),
    description: z.string().optional(),
    /** Reasoning efforts the model takes, in any order; unknown ones are dropped. */
    efforts: z.array(z.string()),
    /** Claude fast mode. */
    fastMode: z.boolean().optional(),
    contextWindow: z.number().int().positive().optional(),
});
export type CliModel = z.infer<typeof CliModelSchema>;

/** What a machine's daemon answers for one agent: its CLI version and the models it lists. */
export const CliModelListSchema = z.object({
    agent: z.enum(CLI_LISTED_AGENTS),
    version: z.string().nullable(),
    models: z.array(CliModelSchema),
});
export type CliModelList = z.infer<typeof CliModelListSchema>;

const EFFORTS_STRONGEST_FIRST: readonly ReasoningEffort[] = ['ultra', 'max', 'xhigh', 'high', 'medium', 'low'];

function catalogEfforts(agent: CliListedAgent, efforts: readonly string[]): ReasoningEffort[] {
    if (agent === 'gemini') return [];
    return EFFORTS_STRONGEST_FIRST.filter((effort) =>
        efforts.includes(effort) && ReasoningEffortSchema.safeParse(effort).success && !(agent === 'claude' && effort === 'ultra'));
}

function displayNameFor(agent: CliListedAgent, label: string): string {
    return agent === 'claude' && !/^claude\b/i.test(label) ? `Claude ${label}` : label;
}

/**
 * Catalog entries for the models one agent's CLI listed, in the CLI's order. A model the
 * bundled catalog knows keeps its labels, translated descriptions and context window; the
 * CLI decides that it is offered, its efforts and (Claude) fast mode.
 */
export function cliModelsToEntries(agent: CliListedAgent, models: readonly CliModel[], base: ModelCatalog): ModelCatalogEntry[] {
    const known = new Map(base.models.filter((model) => model.agent === agent).map((model) => [model.id, model]));
    const seen = new Set<string>();
    const entries: ModelCatalogEntry[] = [];
    for (const listed of models) {
        // Claude Code lists some models by dated id (`claude-haiku-4-5-20251001`); the catalog knows them undated.
        const undated = listed.id.replace(/-\d{8}$/, '');
        const model = !known.has(listed.id) && known.has(undated) ? { ...listed, id: undated } : listed;
        if (seen.has(model.id)) continue;
        seen.add(model.id);
        const bundled = known.get(model.id);
        const efforts = catalogEfforts(agent, model.efforts);
        const fastMode = agent === 'claude' && model.fastMode ? true : undefined;
        entries.push(bundled
            ? { ...bundled, status: 'active', efforts, fastMode, description: bundled.description ?? model.description ?? '' }
            : {
                id: model.id,
                agent,
                status: 'active',
                label: model.label,
                displayName: displayNameFor(agent, model.label),
                description: model.description ?? '',
                efforts,
                contextWindow: model.contextWindow ?? AGENT_DEFAULT_CONTEXT_WINDOWS[agent],
                fastMode,
            });
    }
    return entries;
}

/** One list from several machines' lists for the same agent: every model any of them offers, first answer first. */
export function mergeCliModels(lists: readonly (readonly CliModel[])[]): CliModel[] {
    const byId = new Map<string, CliModel>();
    for (const list of lists) {
        for (const model of list) {
            const existing = byId.get(model.id);
            byId.set(model.id, existing
                ? { ...existing, efforts: [...new Set([...existing.efforts, ...model.efforts])], fastMode: existing.fastMode || model.fastMode }
                : model);
        }
    }
    return [...byId.values()];
}

/**
 * `base` with each listed agent's models replaced by what its CLI offers. Models the CLI no
 * longer lists stay as `retired`, so sessions created on them still resolve their modes and
 * labels. An agent without a list, or with an empty one, keeps the base models.
 */
export function applyCliModels(base: ModelCatalog, lists: Partial<Record<CliListedAgent, readonly CliModel[]>>): ModelCatalog {
    let models = base.models;
    for (const agent of CLI_LISTED_AGENTS) {
        const listed = lists[agent];
        if (!listed || listed.length === 0) continue;
        const entries = cliModelsToEntries(agent, listed, base);
        const offered = new Set(entries.map((entry) => entry.id));
        const unlisted = models
            .filter((model) => model.agent === agent && !offered.has(model.id))
            .map((model): ModelCatalogEntry => ({ ...model, status: 'retired' }));
        models = [...models.filter((model) => model.agent !== agent), ...entries, ...unlisted];
    }
    return models === base.models ? base : { ...base, models };
}

/**
 * Every mode an agent accepts for the models its CLI listed, `default` first, as
 * `getValidModelModesForAgent` gives them for the active catalog: Claude takes a bare model or
 * `model-effort`, Codex only `model-effort` (bare when the model has no efforts), Gemini bare models.
 */
export function cliModelModes(agent: CliListedAgent, models: readonly CliModel[]): string[] {
    const modes = ['default'];
    for (const model of models) {
        const efforts = [...catalogEfforts(agent, model.efforts)].reverse();
        if (agent !== 'codex' || efforts.length === 0) modes.push(model.id);
        modes.push(...efforts.map((effort) => `${model.id}-${effort}`));
    }
    return modes;
}
