import catalogJson from './modelCatalog.json';
import { ModelCatalogSchema, type AgentFlavor, type ModelCatalog, type ModelCatalogEntry } from './modelCatalogSchema';

export const MODEL_MODE_DEFAULT = 'default' as const;

/** Trailing marker that asks for Codex fast mode, on a model id or a model mode (`gpt-5.5-high-fast`). */
export const FAST_MODE_SUFFIX = '-fast' as const;

/** Split the `-fast` marker off a model id or mode; `fast` says whether it was there. */
export function splitFastModeSuffix(value: string): { mode: string; fast: boolean } {
    return value.endsWith(FAST_MODE_SUFFIX)
        ? { mode: value.slice(0, -FAST_MODE_SUFFIX.length), fast: true }
        : { mode: value, fast: false };
}

export type CodexReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra';
export type ClaudeReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/**
 * Model ids and modes come from the catalog, so they are plain strings checked
 * at runtime (`isModelMode`, `isModelModeForAgent`) rather than literal unions.
 * A mode is `default`, a bare model id (`claude-opus-5`, `gemini-3.8-flash`) or
 * a model id with an effort suffix (`claude-opus-5-high`, `gpt-5.5-medium`).
 */
export type ModelMode = string;
/** A Claude model id, optionally with the `[1m]` context suffix, or `default`. */
export type ClaudeModelFamily = string;
/** A Codex model id, or `default`. */
export type CodexModelFamily = string;

export type ModelOption = { value: string; label: string; shortLabel: string; description: string };

const EXTENDED_CONTEXT_WINDOW = 1_000_000;

const DEFAULT_MODEL_OPTION: ModelOption = {
    value: MODEL_MODE_DEFAULT,
    label: 'Use CLI configured model',
    shortLabel: 'CLI',
    description: 'Use profile/CLI defaults',
};

const REASONING_EFFORT_LABELS: Record<string, string> = {
    low: 'Low',
    medium: 'Medium',
    high: 'High',
    max: 'Max',
    xhigh: 'XHigh',
    ultra: 'Ultra',
    none: 'None',
};

function toModelOption(model: ModelCatalogEntry): ModelOption {
    return {
        value: model.id,
        label: model.label,
        shortLabel: model.shortLabel ?? model.label,
        description: model.description ?? '',
    };
}

/** Catalog efforts are strongest-first for pickers; mode lists run weakest-first. */
function effortsAscending(model: ModelCatalogEntry) {
    return [...model.efforts].reverse();
}

/** Lookup tables derived from one catalog; rebuilt whenever the catalog is replaced. */
function buildCatalogIndex(catalog: ModelCatalog) {
    const activeModels = (agent: AgentFlavor) =>
        catalog.models.filter((model) => model.agent === agent && model.status === 'active');

    /**
     * Claude families as wire values: each active model, followed by its `[1m]`
     * variant when 1M is an opt-in or the suffix is still accepted for old sessions.
     */
    const claudeFamilyModels = new Map<string, ModelCatalogEntry>();
    for (const model of activeModels('claude')) {
        claudeFamilyModels.set(model.id, model);
        if (model.context1m === 'optin' || model.accepts1mSuffix) claudeFamilyModels.set(`${model.id}[1m]`, model);
    }

    const claudeModeToSelection = new Map<string, { family: ClaudeModelFamily; effort: ClaudeReasoningEffort }>();
    for (const [family, model] of claudeFamilyModels) {
        for (const effort of effortsAscending(model)) {
            claudeModeToSelection.set(`${family}-${effort}`, { family, effort: effort as ClaudeReasoningEffort });
        }
    }

    const codexModeToSelection = new Map<string, { family: CodexModelFamily; effort: CodexReasoningEffort }>();
    for (const model of activeModels('codex')) {
        for (const effort of effortsAscending(model)) {
            codexModeToSelection.set(`${model.id}-${effort}`, { family: model.id, effort });
        }
    }

    /**
     * Composite modes of retired Codex models. `isModelMode` no longer accepts them,
     * but a session saved while they were current still carries a mode like
     * `gpt-5.4-high`. Without this map the resolver would hand that string to the
     * CLI verbatim as a model name; with it the session keeps running on the model
     * and effort it was created with.
     */
    const retiredCodexModes = new Map<string, { model: string; reasoningEffort: CodexReasoningEffort }>();
    for (const model of catalog.models) {
        if (model.agent !== 'codex' || model.status !== 'retired') continue;
        for (const effort of effortsAscending(model)) {
            retiredCodexModes.set(`${model.id}-${effort}`, { model: model.id, reasoningEffort: effort });
        }
    }

    const modesByAgent: Record<AgentFlavor, readonly ModelMode[]> = {
        claude: [MODEL_MODE_DEFAULT, ...claudeFamilyModels.keys(), ...claudeModeToSelection.keys()],
        codex: [MODEL_MODE_DEFAULT, ...codexModeToSelection.keys()],
        gemini: [MODEL_MODE_DEFAULT, ...activeModels('gemini').map((model) => model.id)],
        // Qoder models are per-account and come from the ACP session at runtime, not the catalog.
        qoder: [MODEL_MODE_DEFAULT, ...activeModels('qoder').map((model) => model.id)],
    };

    // Claude options are base families only — the 1M context opt-in is a separate
    // toggle in the UI, combined back into the `family[1m]` wire value via claudeFamilyWith1M.
    const familyOptions: Record<AgentFlavor, readonly ModelOption[]> = {
        claude: [DEFAULT_MODEL_OPTION, ...activeModels('claude').map(toModelOption)],
        codex: [DEFAULT_MODEL_OPTION, ...activeModels('codex').map(toModelOption)],
        gemini: [DEFAULT_MODEL_OPTION, ...activeModels('gemini').map(toModelOption)],
        qoder: [DEFAULT_MODEL_OPTION, ...activeModels('qoder').map(toModelOption)],
    };

    const codexModeOptions: readonly { value: ModelMode; label: string; description: string }[] = [
        { value: MODEL_MODE_DEFAULT, label: 'Default', description: 'Use CLI default model' },
        ...activeModels('codex').flatMap((model) => effortsAscending(model).map((effort) => ({
            value: `${model.id}-${effort}`,
            label: `${model.label} (${REASONING_EFFORT_LABELS[effort]})`,
            description: model.effortDescriptions?.[effort] ?? catalog.effortDescriptions[effort],
        }))),
    ];

    /** Context window per model id, plus 1M for each Claude `[1m]` family. */
    const contextWindows = new Map<string, number>(catalog.models.map((model) => [model.id, model.contextWindow]));
    for (const family of claudeFamilyModels.keys()) {
        if (family.endsWith('[1m]')) contextWindows.set(family, EXTENDED_CONTEXT_WINDOW);
    }

    return {
        catalog,
        modelsById: new Map(catalog.models.map((model) => [model.id, model])),
        claudeFamilyModels,
        claudeModeToSelection,
        codexModeToSelection,
        retiredCodexModes,
        modesByAgent,
        modeSet: new Set<ModelMode>(Object.values(modesByAgent).flat()),
        modeSetByAgent: {
            claude: new Set(modesByAgent.claude),
            codex: new Set(modesByAgent.codex),
            gemini: new Set(modesByAgent.gemini),
            qoder: new Set(modesByAgent.qoder),
        } satisfies Record<AgentFlavor, Set<ModelMode>>,
        familyOptions,
        codexModeOptions,
        contextWindows,
    };
}

/** The catalog shipped with this build — the fallback until a newer one is fetched. */
export const BUNDLED_MODEL_CATALOG: ModelCatalog = ModelCatalogSchema.parse(catalogJson);

let index = buildCatalogIndex(BUNDLED_MODEL_CATALOG);
const catalogListeners = new Set<() => void>();

/** The active catalog: the bundled one, or the latest set with setModelCatalog. */
export function getModelCatalog(): ModelCatalog {
    return index.catalog;
}

/**
 * Replace the active catalog, e.g. with one fetched from the server. Every
 * lookup in this module reads the new catalog from then on. Listeners are only
 * notified when the content actually changed.
 */
export function setModelCatalog(catalog: ModelCatalog): void {
    if (JSON.stringify(catalog) === JSON.stringify(index.catalog)) return;
    index = buildCatalogIndex(catalog);
    catalogListeners.forEach((listener) => listener());
}

export function onModelCatalogChanged(listener: () => void): () => void {
    catalogListeners.add(listener);
    return () => catalogListeners.delete(listener);
}

/** Validate an untrusted catalog payload (server response, cache file); null when invalid. */
export function parseModelCatalog(data: unknown): ModelCatalog | null {
    const result = ModelCatalogSchema.safeParse(data);
    return result.success ? result.data : null;
}

export function isModelMode(value: string): value is ModelMode {
    return index.modeSet.has(value);
}

export function isModelModeForAgent(agent: AgentFlavor, mode: string): mode is ModelMode {
    return (index.modeSetByAgent[agent] ?? index.modeSetByAgent.codex).has(mode);
}

/** Every mode the agent accepts, `default` first. */
export function getValidModelModesForAgent(agent: AgentFlavor): readonly ModelMode[] {
    return index.modesByAgent[agent] ?? index.modesByAgent.codex;
}

/** Picker options for the agent's models (Claude: base families; Codex: families without effort), `default` first. */
export function getModelFamilyOptions(agent: AgentFlavor): readonly ModelOption[] {
    return index.familyOptions[agent];
}

/** One Codex option per model and effort, `default` first. */
export function getCodexModelOptions(): readonly { value: ModelMode; label: string; description: string }[] {
    return index.codexModeOptions;
}

/** Resolve a retired composite mode to the model and effort it names, or null. */
function parseRetiredCodexMode(mode: string): { model: string; reasoningEffort: CodexReasoningEffort } | null {
    return index.retiredCodexModes.get(mode) ?? null;
}

export function parseClaudeModelMode(mode: ModelMode): { family: ClaudeModelFamily; effort: ClaudeReasoningEffort | null } {
    const entry = index.claudeModeToSelection.get(mode);
    if (entry) return entry;
    if (mode === MODEL_MODE_DEFAULT) return { family: MODEL_MODE_DEFAULT, effort: null };
    return { family: mode, effort: null };
}

export function getClaudeReasoningOptions(family: ClaudeModelFamily): readonly ClaudeReasoningEffort[] {
    const model = index.claudeFamilyModels.get(family);
    if (model) return model.efforts as ClaudeReasoningEffort[];
    return ['high', 'medium', 'low'];
}

export function claudeSupportsFastMode(family: ClaudeModelFamily): boolean {
    return index.claudeFamilyModels.get(family)?.fastMode === true;
}

/** Strip the [1m] suffix to get the base family ("default" passes through). */
export function claudeBaseFamily(family: ClaudeModelFamily): ClaudeModelFamily {
    return family.replace('[1m]', '');
}

/** Families where 1M context is an explicit opt-in via the [1m] suffix (see claudeAlways1M). */
export function claudeHas1MOptIn(family: ClaudeModelFamily): boolean {
    return index.claudeFamilyModels.get(claudeBaseFamily(family))?.context1m === 'optin';
}

/** Families whose context window is 1M by default with no 200K tier — the [1m] suffix is a no-op. */
export function claudeAlways1M(family: ClaudeModelFamily): boolean {
    return index.claudeFamilyModels.get(claudeBaseFamily(family))?.context1m === 'always';
}

/** Combine a base family with the 1M toggle into the wire family value. */
export function claudeFamilyWith1M(family: ClaudeModelFamily, enable1M: boolean): ClaudeModelFamily {
    const base = claudeBaseFamily(family);
    if (!enable1M || !claudeHas1MOptIn(base)) return base;
    return `${base}[1m]`;
}

export function buildClaudeModelMode(
    family: ClaudeModelFamily,
    effort: ClaudeReasoningEffort,
): ModelMode {
    if (family === MODEL_MODE_DEFAULT) return MODEL_MODE_DEFAULT;
    // Models without effort control (e.g. Haiku 4.5) always use the bare model mode.
    if (index.claudeFamilyModels.get(family)?.efforts.length === 0) return family;
    return `${family}-${effort}`;
}

export function parseCodexModelMode(mode: ModelMode): { family: CodexModelFamily; effort: CodexReasoningEffort } {
    return index.codexModeToSelection.get(mode) ?? { family: MODEL_MODE_DEFAULT, effort: 'medium' };
}

export function getCodexReasoningOptions(family: CodexModelFamily): readonly CodexReasoningEffort[] {
    if (family === MODEL_MODE_DEFAULT) return ['high', 'medium', 'low'];
    const model = index.modelsById.get(family);
    if (model?.agent === 'codex' && model.status === 'active') return model.efforts;
    return ['xhigh', 'high', 'medium', 'low'];
}

export function buildCodexModelMode(
    family: CodexModelFamily,
    effort: CodexReasoningEffort,
): ModelMode {
    if (family === MODEL_MODE_DEFAULT) return MODEL_MODE_DEFAULT;
    return `${family}-${effort}`;
}

/** Qoder modes are a model code the account lists, optionally with `:effort` (`performance:high`). */
const QODER_EFFORT_SEPARATOR = ':';

export function buildQoderModelMode(model: string, effort: string | null | undefined): ModelMode {
    return effort ? `${model}${QODER_EFFORT_SEPARATOR}${effort}` : model;
}

export function parseQoderModelMode(mode: ModelMode): { model: string; effort: string | null } {
    const [model, effort] = mode.split(QODER_EFFORT_SEPARATOR);
    return { model, effort: effort || null };
}

function modelDisplayName(model: string): string | undefined {
    return index.modelsById.get(model)?.displayName;
}

export type ModelSelection = {
    model: string | null;
    reasoningEffort: string | null;
};

export function resolveModelSelectionForFlavor(flavor: string | null | undefined, modelMode: string): ModelSelection {
    if (modelMode === MODEL_MODE_DEFAULT) return { model: null, reasoningEffort: null };
    if (flavor === 'qoder') {
        const { model, effort } = parseQoderModelMode(modelMode);
        return { model, reasoningEffort: effort };
    }
    if (!isModelMode(modelMode)) {
        const retired = flavor === 'codex' ? parseRetiredCodexMode(modelMode) : null;
        return retired ?? { model: modelMode, reasoningEffort: null };
    }
    if (flavor === 'codex') {
        const parsed = parseCodexModelMode(modelMode);
        if (parsed.family === MODEL_MODE_DEFAULT) return { model: modelMode, reasoningEffort: null };
        return { model: parsed.family, reasoningEffort: parsed.effort };
    }
    if (flavor === 'claude') {
        const parsed = parseClaudeModelMode(modelMode);
        if (parsed.family === MODEL_MODE_DEFAULT) return { model: modelMode, reasoningEffort: null };
        return { model: parsed.family, reasoningEffort: parsed.effort };
    }
    if (flavor === 'gemini') return { model: modelMode, reasoningEffort: null };
    return { model: null, reasoningEffort: null };
}

export function resolveLocalModelDisplay(modelMode: string | null | undefined): ModelSelection {
    if (!modelMode || modelMode === MODEL_MODE_DEFAULT) return { model: null, reasoningEffort: null };
    if (!isModelMode(modelMode)) {
        // Anything else outside the catalog is a Qoder account model, with or without an effort.
        const qoder = parseQoderModelMode(modelMode);
        return parseRetiredCodexMode(modelMode) ?? { model: qoder.model, reasoningEffort: qoder.effort };
    }

    const parsedCodex = parseCodexModelMode(modelMode);
    if (parsedCodex.family !== MODEL_MODE_DEFAULT) {
        return { model: parsedCodex.family, reasoningEffort: parsedCodex.effort };
    }

    const parsedClaude = index.claudeModeToSelection.get(modelMode);
    if (parsedClaude) {
        return { model: parsedClaude.family, reasoningEffort: parsedClaude.effort };
    }

    return { model: modelMode, reasoningEffort: null };
}

/** Strip date suffix (YYYYMMDD / YYYY-MM-DD) and -fast suffix to get the canonical model key. */
function normalizeModelId(model: string): string {
    return model.replace(/-\d{8}$/, '').replace(/-\d{4}-\d{2}-\d{2}$/, '').replace(/-fast$/, '');
}

export function formatModelNameLabel(model: string | null | undefined): string | null {
    if (!model) return null;
    const label = modelDisplayName(model);
    if (label) return label;
    if (isModelMode(model)) {
        const codexParsed = parseCodexModelMode(model);
        if (codexParsed.family !== MODEL_MODE_DEFAULT) {
            return modelDisplayName(codexParsed.family) ?? codexParsed.family;
        }
    }
    const stripped = normalizeModelId(model);
    if (stripped !== model) return modelDisplayName(stripped) ?? model;
    return model;
}

export function formatReasoningEffortLabel(effort: string | null | undefined): string | null {
    if (!effort) return null;
    return REASONING_EFFORT_LABELS[effort] ?? effort;
}

export const FAST_MODE_ICON_COLOR = '#F5A623';

export function isModelFast(model: string | null | undefined): boolean {
    return typeof model === 'string' && /-fast(?:-\d{8}|-\d{4}-\d{2}-\d{2})?$/.test(model);
}

export function formatModelDisplay(model: string | null | undefined, reasoningEffort: string | null | undefined): string | null {
    const is1m = typeof model === 'string' && model.includes('[1m]');
    const stripped = is1m ? model!.replace(/\[1m\]/g, '') : model;
    const modelLabel = formatModelNameLabel(stripped);
    if (!modelLabel) return null;
    const effortLabel = formatReasoningEffortLabel(reasoningEffort);
    // Always-1M families have no 200K tier — the "1M" chip distinguishes nothing and
    // would make equivalent CLI/local model strings render as a false mismatch.
    const show1m = is1m && !claudeAlways1M(stripped!);
    const parts = [show1m ? '1M' : '', effortLabel ?? ''].filter(Boolean);
    return parts.length > 0 ? `${modelLabel} (${parts.join(', ')})` : modelLabel;
}

// ─── Context Window Sizes ──────────────────────────────────────

const DEFAULT_CONTEXT_WINDOW = 200_000;
const AGENT_DEFAULT_CONTEXT_WINDOWS: Record<AgentFlavor, number> = {
    claude: 200_000,
    codex: 272_000,
    gemini: 1_000_000,
    qoder: 200_000,
};

/**
 * Get the max context window size for a given model mode and agent flavor.
 * Falls back to agent default, then global default.
 */
function findContextWindow(model: string): number | undefined {
    const exact = index.contextWindows.get(model);
    if (exact) return exact;
    const stripped = normalizeModelId(model);
    if (stripped !== model) return index.contextWindows.get(stripped);
    return undefined;
}

export function getMaxContextSize(
    modelMode: string | null | undefined,
    agentFlavor: AgentFlavor | string | null | undefined,
    actualModel?: string | null,
    actualContextSize?: number | null,
): number {
    const window = computeMaxContextSize(modelMode, agentFlavor, actualModel);
    // Defensive fallback: a window can't hold more tokens than its size. If the
    // session's actual usage already exceeds the computed window, the session is
    // really on the extended (1M) window — surface that so the usage bar doesn't
    // overflow (e.g. a 1M session whose modelMode is "default" and whose reported
    // model lacks the [1m] suffix, with no CLI-reported contextWindowSize).
    if (actualContextSize && actualContextSize > window) {
        return EXTENDED_CONTEXT_WINDOW;
    }
    return window;
}

function computeMaxContextSize(modelMode: string | null | undefined, agentFlavor: AgentFlavor | string | null | undefined, actualModel?: string | null): number {
    // When modelMode is "default" (CLI configured), use the actual model reported by CLI if available
    if ((!modelMode || modelMode === MODEL_MODE_DEFAULT) && actualModel) {
        const found = findContextWindow(actualModel);
        if (found) return found;
    }

    // Try exact model mode match (for composite codex modes, extract family)
    if (modelMode && modelMode !== MODEL_MODE_DEFAULT) {
        const exact = index.contextWindows.get(modelMode);
        if (exact) return exact;

        // Strip -fast suffix for lookups
        const stripped = modelMode.replace(/-fast$/, '');
        const strippedWindow = stripped !== modelMode ? index.contextWindows.get(stripped) : undefined;
        if (strippedWindow) return strippedWindow;

        // For codex composite modes like "gpt-5.6-sol-high", extract family
        if (isModelMode(modelMode)) {
            const parsed = parseCodexModelMode(modelMode);
            const window = parsed.family !== MODEL_MODE_DEFAULT ? index.contextWindows.get(parsed.family) : undefined;
            if (window) return window;
        }

        // For claude composite modes like "claude-opus-4-6-high", extract family
        const claudeMode = isModelMode(modelMode) ? modelMode : (isModelMode(stripped) ? stripped : null);
        if (claudeMode) {
            const parsedClaude = parseClaudeModelMode(claudeMode);
            const window = parsedClaude.family !== MODEL_MODE_DEFAULT ? index.contextWindows.get(parsedClaude.family) : undefined;
            if (window) return window;
        }
    }
    // Fall back to agent default
    if (agentFlavor && agentFlavor in AGENT_DEFAULT_CONTEXT_WINDOWS) {
        return AGENT_DEFAULT_CONTEXT_WINDOWS[agentFlavor as AgentFlavor];
    }
    return DEFAULT_CONTEXT_WINDOW;
}
