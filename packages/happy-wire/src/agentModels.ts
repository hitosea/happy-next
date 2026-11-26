import * as z from 'zod';

/**
 * Models as each agent's own CLI lists them, and the model modes built from them.
 *
 * Every agent works the same way: the machine's daemon asks the agent's CLI for its models
 * (Claude Code's `initialize`, Codex app-server's `model/list`, Gemini's and Antigravity's ACP
 * session, qodercli's SDK server) and answers `agent-list-models` with one `AgentModel` list.
 * Nothing here knows any model: names and descriptions are the CLI's, and a mode is checked
 * against the list the machine gave, by the machine's CLI, or only for its format.
 */

export const AgentFlavorSchema = z.enum(['claude', 'codex', 'gemini', 'antigravity', 'deepseek', 'qoder']);
export type AgentFlavor = z.infer<typeof AgentFlavorSchema>;

/** Agents whose models a machine lists; Qoder CN is Qoder signed in to its own account. */
export const MODEL_LISTING_AGENTS = ['claude', 'codex', 'gemini', 'antigravity', 'deepseek', 'qoder', 'qodercn'] as const;
export type ModelListingAgent = typeof MODEL_LISTING_AGENTS[number];

export function isModelListingAgent(agent: string | null | undefined): agent is ModelListingAgent {
    return (MODEL_LISTING_AGENTS as readonly string[]).includes(agent ?? '');
}

export const AgentModelEffortSchema = z.object({
    code: z.string().min(1),
    /** The CLI's label for it, when it gives one. */
    value: z.string().optional(),
});

export const AgentModelSchema = z.object({
    /** Model id passed to the CLI, e.g. `claude-opus-5-5`, `gpt-6-sol`, `performance`. */
    code: z.string().min(1),
    /** The CLI's name for it, e.g. `Opus 5.5`. */
    value: z.string().min(1),
    description: z.string().nullish(),
    /** Reasoning efforts the model takes, as the CLI lists them; absent when it has none. */
    efforts: z.array(AgentModelEffortSchema).optional(),
    /** The effort the CLI picks when the model is selected. */
    defaultEffort: z.string().optional(),
    /** Context windows in tokens the model can run with, smallest first. */
    contextWindows: z.array(z.number().int().positive()).optional(),
    /** The context window the CLI picks when none is set. */
    defaultContextWindow: z.number().int().positive().optional(),
    /** Any size in this range can be typed in besides `contextWindows` (Claude Code's auto-compact window). */
    contextWindowRange: z.object({ min: z.number().int().positive(), max: z.number().int().positive() }).optional(),
});
export type AgentModel = z.infer<typeof AgentModelSchema>;
export type AgentModelEffort = z.infer<typeof AgentModelEffortSchema>;

export const AgentModelListSchema = z.array(AgentModelSchema);

export const MODEL_MODE_DEFAULT = 'default' as const;

/**
 * A mode is `default` (the CLI's own choice) or a model code, optionally with `:effort` and then
 * `@contextWindow` in tokens: `gpt-6-sol:high`, `claude-opus-5-5:medium@400000`, `performance`.
 * Codex modes may end with `-fast` (see `splitFastModeSuffix`).
 */
export type ModelMode = string;

const EFFORT_SEPARATOR = ':';
const CONTEXT_WINDOW_SEPARATOR = '@';

/** Every effort an agent names, strongest first, as pickers list them. */
export const REASONING_EFFORTS = ['ultra', 'max', 'xhigh', 'high', 'medium', 'low', 'minimal', 'none', 'off'] as const;

/** Efforts strongest first; ones not in `REASONING_EFFORTS` keep their order after them. */
export function sortEffortsStrongestFirst<T extends { code: string }>(efforts: readonly T[]): T[] {
    const rank = (code: string) => {
        const index = (REASONING_EFFORTS as readonly string[]).indexOf(code);
        return index === -1 ? REASONING_EFFORTS.length : index;
    };
    return [...efforts].sort((a, b) => rank(a.code) - rank(b.code));
}

/** Trailing marker that asks for Codex fast mode on a mode (`gpt-6-sol:high-fast`). */
export const FAST_MODE_SUFFIX = '-fast' as const;

/** Split the `-fast` marker off a model id or mode; `fast` says whether it was there. */
export function splitFastModeSuffix(value: string): { mode: string; fast: boolean } {
    return value.endsWith(FAST_MODE_SUFFIX)
        ? { mode: value.slice(0, -FAST_MODE_SUFFIX.length), fast: true }
        : { mode: value, fast: false };
}

export function buildModelMode(model: string, effort?: string | null, contextWindow?: number | null): ModelMode {
    if (model === MODEL_MODE_DEFAULT) return MODEL_MODE_DEFAULT;
    const withEffort = effort ? `${model}${EFFORT_SEPARATOR}${effort}` : model;
    return contextWindow ? `${withEffort}${CONTEXT_WINDOW_SEPARATOR}${contextWindow}` : withEffort;
}

export type ModelSelection = {
    model: string | null;
    reasoningEffort: string | null;
    /** Context window in tokens, when the mode names one. */
    contextWindow?: number | null;
};

// Claude and Codex modes were once `model-effort` (`claude-opus-5-high@400000`, `gpt-5.4-high`).
// Legacy `model-effort` ids predate DeepSeek's 'off', so a model id ending in '-off' is not split.
const LEGACY_EFFORTS = REASONING_EFFORTS.filter((effort) => effort !== 'off');
const LEGACY_EFFORT_SUFFIX = new RegExp(`^(.+)-(${LEGACY_EFFORTS.join('|')})$`);
const LEGACY_EFFORT_FLAVORS = new Set(['claude', 'codex']);

/**
 * The model, effort and context window a mode names; `default` names none. Without a flavor (labels
 * for any session) and for Claude and Codex, a mode in the old `model-effort` form is read too.
 */
export function parseModelMode(modelMode: ModelMode, flavor?: string | null): ModelSelection & { contextWindow: number | null } {
    const [base, windowText] = modelMode.split(CONTEXT_WINDOW_SEPARATOR);
    const tokens = Number(windowText);
    const contextWindow = Number.isSafeInteger(tokens) && tokens > 0 ? tokens : null;
    if (!base || base === MODEL_MODE_DEFAULT) return { model: null, reasoningEffort: null, contextWindow: null };
    const [model, effort] = base.split(EFFORT_SEPARATOR);
    const legacy = effort === undefined && (!flavor || LEGACY_EFFORT_FLAVORS.has(flavor)) ? base.match(LEGACY_EFFORT_SUFFIX) : null;
    return legacy
        ? { model: legacy[1], reasoningEffort: legacy[2], contextWindow }
        : { model, reasoningEffort: effort || null, contextWindow };
}

/** The model, effort and context window a session with this mode runs with; `default` names none. */
export function resolveModelSelectionForFlavor(flavor: string | null | undefined, modelMode: string): ModelSelection {
    const { model, reasoningEffort, contextWindow } = parseModelMode(modelMode, flavor);
    return contextWindow ? { model, reasoningEffort, contextWindow } : { model, reasoningEffort };
}

/** The model and effort a mode names, for labels. */
export function resolveLocalModelDisplay(modelMode: string | null | undefined): ModelSelection {
    const { model, reasoningEffort } = parseModelMode(modelMode || MODEL_MODE_DEFAULT);
    return { model, reasoningEffort };
}

/** Whether a mode is well formed: `default`, or `model[:effort][@contextWindow]` without spaces. */
export function isModelModeFormat(mode: string): boolean {
    return /^[^\s:@]+(?::[^\s:@]+)?(?:@[1-9]\d*)?$/.test(mode);
}

// Claude Code lists some models by dated id (`claude-haiku-4-5-20251001`); modes may name them undated.
const withoutDate = (model: string) => model.replace(/-\d{8}$/, '');

/** The listed model a code names, dated or not. */
export function findAgentModel(models: readonly AgentModel[] | null | undefined, code: string | null | undefined): AgentModel | undefined {
    if (!models || !code) return undefined;
    return models.find((model) => model.code === code) ?? models.find((model) => withoutDate(model.code) === withoutDate(code));
}

/** Whether `mode` names a model in `models` and an effort that model takes; `default` always is. */
export function isModelModeOffered(mode: string, models: readonly AgentModel[], flavor?: string | null): boolean {
    const { model, reasoningEffort } = parseModelMode(mode, flavor);
    if (!model) return true;
    const listed = findAgentModel(models, model);
    return !!listed && (!reasoningEffort || !!listed.efforts?.some((effort) => effort.code === reasoningEffort));
}

/** `default`, then every model and each `model:effort` it takes. */
export function listModelModes(models: readonly AgentModel[]): string[] {
    return [MODEL_MODE_DEFAULT, ...models.flatMap((model) => [
        model.code,
        ...(model.efforts ?? []).map((effort) => buildModelMode(model.code, effort.code)),
    ])];
}

/**
 * Claude Code's auto-compact window runs from 100K up to 1M for every model but Haiku 4.5, which
 * stays at 200K; 200K (the default) and 1M are offered with one tap. Null when there is nothing to pick.
 */
export function getClaudeContextWindowOptions(model: string): { presets: number[]; min: number; max: number } | null {
    if (model === MODEL_MODE_DEFAULT || /haiku-4-5/.test(model)) return null;
    return { presets: [200_000, 1_000_000], min: 100_000, max: 1_000_000 };
}

// ─── Labels ────────────────────────────────────────────────────

const REASONING_EFFORT_LABELS: Record<string, string> = {
    minimal: 'Minimal',
    low: 'Low',
    medium: 'Medium',
    high: 'High',
    max: 'Max',
    xhigh: 'XHigh',
    ultra: 'Ultra',
    none: 'None',
    off: 'Off',
};

/**
 * The name a model id shows with: the listed model's name when `models` has it, else the id
 * without the suffixes Claude Code and Codex add (a date, `-fast`, `[1m]`).
 */
export function formatModelNameLabel(model: string | null | undefined, models?: readonly AgentModel[] | null): string | null {
    if (!model) return null;
    const bare = model.replace('[1m]', '').replace(/-\d{4}-\d{2}-\d{2}$/, '').replace(/-fast$/, '');
    return findAgentModel(models, bare)?.value ?? bare;
}

export function formatReasoningEffortLabel(effort: string | null | undefined): string | null {
    if (!effort) return null;
    return REASONING_EFFORT_LABELS[effort] ?? effort;
}

export const FAST_MODE_ICON_COLOR = '#F5A623';

export function isModelFast(model: string | null | undefined): boolean {
    return typeof model === 'string' && /-fast(?:-\d{8}|-\d{4}-\d{2}-\d{2})?$/.test(model);
}

export function formatModelDisplay(model: string | null | undefined, reasoningEffort: string | null | undefined, models?: readonly AgentModel[] | null): string | null {
    const modelLabel = formatModelNameLabel(model, models);
    if (!modelLabel) return null;
    const effortLabel = formatReasoningEffortLabel(reasoningEffort);
    return effortLabel ? `${modelLabel} (${effortLabel})` : modelLabel;
}

// ─── Context Window Sizes ──────────────────────────────────────

const DEFAULT_CONTEXT_WINDOW = 200_000;
const EXTENDED_CONTEXT_WINDOW = 1_000_000;

/** The window a session shows usage against until its CLI reports one. */
export const AGENT_DEFAULT_CONTEXT_WINDOWS: Record<AgentFlavor, number> = {
    claude: 200_000,
    codex: 272_000,
    gemini: 1_000_000,
    qoder: 200_000,
    antigravity: 1_048_576,
    deepseek: 1_000_000,
};

/**
 * The context window to show usage against: the one the mode picked, else the agent's default.
 * A session already holding more tokens than that runs on the extended (1M) window.
 */
export function getMaxContextSize(
    modelMode: string | null | undefined,
    agentFlavor: AgentFlavor | string | null | undefined,
    actualContextSize?: number | null,
): number {
    const window = parseModelMode(modelMode || MODEL_MODE_DEFAULT, agentFlavor).contextWindow
        ?? AGENT_DEFAULT_CONTEXT_WINDOWS[agentFlavor as AgentFlavor]
        ?? DEFAULT_CONTEXT_WINDOW;
    return actualContextSize && actualContextSize > window ? EXTENDED_CONTEXT_WINDOW : window;
}
