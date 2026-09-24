export type AgentFlavor = 'claude' | 'codex' | 'gemini' | 'qoder';

/** Every agent flavor, for tables and UI lists that must not be hand-maintained per agent. */
export const AGENT_FLAVORS = ['claude', 'codex', 'gemini', 'qoder'] as const satisfies readonly AgentFlavor[];

export const MODEL_MODE_DEFAULT = 'default' as const;

export type CodexReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra';
export type CodexModelFamily =
    | typeof MODEL_MODE_DEFAULT
    | 'gpt-6-astra'
    | 'gpt-5.6-sol'
    | 'gpt-5.6-terra'
    | 'gpt-5.6-luna'
    | 'gpt-5.5';
export type ClaudeReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type ClaudeModelFamily =
    | typeof MODEL_MODE_DEFAULT
    | 'claude-fable-5-1'
    | 'claude-fable-5'
    | 'claude-fable-5[1m]'
    | 'claude-opus-5'
    | 'claude-sonnet-5'
    | 'claude-opus-4-8'
    | 'claude-opus-4-8[1m]'
    | 'claude-opus-4-7'
    | 'claude-opus-4-7[1m]'
    | 'claude-opus-4-6'
    | 'claude-opus-4-6[1m]'
    | 'claude-sonnet-4-6'
    | 'claude-sonnet-4-6[1m]'
    | 'claude-haiku-4-5';

export const MODEL_MODES = [
    MODEL_MODE_DEFAULT,
    'claude-fable-5-1',
    'claude-fable-5',
    'claude-fable-5[1m]',
    'claude-opus-5',
    'claude-sonnet-5',
    'claude-opus-4-8',
    'claude-opus-4-8[1m]',
    'claude-opus-4-7',
    'claude-opus-4-7[1m]',
    'claude-opus-4-6',
    'claude-opus-4-6[1m]',
    'claude-sonnet-4-6',
    'claude-sonnet-4-6[1m]',
    'claude-haiku-4-5',
    'claude-fable-5-1-low',
    'claude-fable-5-1-medium',
    'claude-fable-5-1-high',
    'claude-fable-5-1-xhigh',
    'claude-fable-5-1-max',
    'claude-fable-5-low',
    'claude-fable-5-medium',
    'claude-fable-5-high',
    'claude-fable-5-xhigh',
    'claude-fable-5-max',
    'claude-fable-5[1m]-low',
    'claude-fable-5[1m]-medium',
    'claude-fable-5[1m]-high',
    'claude-fable-5[1m]-xhigh',
    'claude-fable-5[1m]-max',
    'claude-opus-5-low',
    'claude-opus-5-medium',
    'claude-opus-5-high',
    'claude-opus-5-xhigh',
    'claude-opus-5-max',
    'claude-sonnet-5-low',
    'claude-sonnet-5-medium',
    'claude-sonnet-5-high',
    'claude-sonnet-5-xhigh',
    'claude-sonnet-5-max',
    'claude-opus-4-8-low',
    'claude-opus-4-8-medium',
    'claude-opus-4-8-high',
    'claude-opus-4-8-xhigh',
    'claude-opus-4-8-max',
    'claude-opus-4-8[1m]-low',
    'claude-opus-4-8[1m]-medium',
    'claude-opus-4-8[1m]-high',
    'claude-opus-4-8[1m]-xhigh',
    'claude-opus-4-8[1m]-max',
    'claude-opus-4-7-low',
    'claude-opus-4-7-medium',
    'claude-opus-4-7-high',
    'claude-opus-4-7-xhigh',
    'claude-opus-4-7-max',
    'claude-opus-4-7[1m]-low',
    'claude-opus-4-7[1m]-medium',
    'claude-opus-4-7[1m]-high',
    'claude-opus-4-7[1m]-xhigh',
    'claude-opus-4-7[1m]-max',
    'claude-opus-4-6-low',
    'claude-opus-4-6-medium',
    'claude-opus-4-6-high',
    'claude-opus-4-6-max',
    'claude-opus-4-6[1m]-low',
    'claude-opus-4-6[1m]-medium',
    'claude-opus-4-6[1m]-high',
    'claude-opus-4-6[1m]-max',
    'claude-sonnet-4-6-low',
    'claude-sonnet-4-6-medium',
    'claude-sonnet-4-6-high',
    'claude-sonnet-4-6-max',
    'claude-sonnet-4-6[1m]-low',
    'claude-sonnet-4-6[1m]-medium',
    'claude-sonnet-4-6[1m]-high',
    'claude-sonnet-4-6[1m]-max',
    'gpt-6-astra-low',
    'gpt-6-astra-medium',
    'gpt-6-astra-high',
    'gpt-6-astra-xhigh',
    'gpt-6-astra-max',
    'gpt-6-astra-ultra',
    'gpt-5.6-sol-low',
    'gpt-5.6-sol-medium',
    'gpt-5.6-sol-high',
    'gpt-5.6-sol-xhigh',
    'gpt-5.6-sol-max',
    'gpt-5.6-sol-ultra',
    'gpt-5.6-terra-low',
    'gpt-5.6-terra-medium',
    'gpt-5.6-terra-high',
    'gpt-5.6-terra-xhigh',
    'gpt-5.6-terra-max',
    'gpt-5.6-terra-ultra',
    'gpt-5.6-luna-low',
    'gpt-5.6-luna-medium',
    'gpt-5.6-luna-high',
    'gpt-5.6-luna-xhigh',
    'gpt-5.6-luna-max',
    'gpt-5.5-low',
    'gpt-5.5-medium',
    'gpt-5.5-high',
    'gpt-5.5-xhigh',
    'gemini-3.8-flash',
    'gemini-3.7-flash',
    'gemini-3.1-pro-preview',
    'gemini-3.6-flash',
    'gemini-3.5-flash',
    'gemini-3.5-flash-lite',
    'gemini-3.1-flash-lite',
    'gemini-2.5-pro',
    'gemini-2.5-flash-lite',
    // Qoder model ids, measured from a signed-in Qoder CLI's ACP `session/new`
    // configOptions (option id "model"). The opaque `value` is what `--model` and
    // `set_session_model` accept; the display name is the vendor model.
    //
    // This list is ACCOUNT- AND REGION-dependent (credit multipliers, and CN vs
    // international catalogues differ), so it is only a fallback: the authoritative list
    // arrives per session through config metadata and is merged into session metadata by
    // happy-cli's handleConfigMetadataEvent. Add tiers here only to make a picker show a
    // model before the first config update lands.
    'qoder-auto',
    'qoder-qmodel_38max',
    'qoder-qfmodel',
    'qoder-qmodel_latest',
    'qoder-qmodel',
    'qoder-q37fmodel',
    'qoder-dmodel',
    'qoder-dfmodel',
    'qoder-gmodel',
    'qoder-gfmodel',
    'qoder-gm51model',
    'qoder-kmodel_latest',
    'qoder-kmodel',
    'qoder-mmodel',
] as const;

export type ModelMode = typeof MODEL_MODES[number];

export const CLAUDE_MODEL_MODES = [
    MODEL_MODE_DEFAULT,
    'claude-fable-5-1',
    'claude-fable-5',
    'claude-fable-5[1m]',
    'claude-opus-5',
    'claude-sonnet-5',
    'claude-opus-4-8',
    'claude-opus-4-8[1m]',
    'claude-opus-4-7',
    'claude-opus-4-7[1m]',
    'claude-opus-4-6',
    'claude-opus-4-6[1m]',
    'claude-sonnet-4-6',
    'claude-sonnet-4-6[1m]',
    'claude-haiku-4-5',
    'claude-fable-5-1-low',
    'claude-fable-5-1-medium',
    'claude-fable-5-1-high',
    'claude-fable-5-1-xhigh',
    'claude-fable-5-1-max',
    'claude-fable-5-low',
    'claude-fable-5-medium',
    'claude-fable-5-high',
    'claude-fable-5-xhigh',
    'claude-fable-5-max',
    'claude-fable-5[1m]-low',
    'claude-fable-5[1m]-medium',
    'claude-fable-5[1m]-high',
    'claude-fable-5[1m]-xhigh',
    'claude-fable-5[1m]-max',
    'claude-opus-5-low',
    'claude-opus-5-medium',
    'claude-opus-5-high',
    'claude-opus-5-xhigh',
    'claude-opus-5-max',
    'claude-sonnet-5-low',
    'claude-sonnet-5-medium',
    'claude-sonnet-5-high',
    'claude-sonnet-5-xhigh',
    'claude-sonnet-5-max',
    'claude-opus-4-8-low',
    'claude-opus-4-8-medium',
    'claude-opus-4-8-high',
    'claude-opus-4-8-xhigh',
    'claude-opus-4-8-max',
    'claude-opus-4-8[1m]-low',
    'claude-opus-4-8[1m]-medium',
    'claude-opus-4-8[1m]-high',
    'claude-opus-4-8[1m]-xhigh',
    'claude-opus-4-8[1m]-max',
    'claude-opus-4-7-low',
    'claude-opus-4-7-medium',
    'claude-opus-4-7-high',
    'claude-opus-4-7-xhigh',
    'claude-opus-4-7-max',
    'claude-opus-4-7[1m]-low',
    'claude-opus-4-7[1m]-medium',
    'claude-opus-4-7[1m]-high',
    'claude-opus-4-7[1m]-xhigh',
    'claude-opus-4-7[1m]-max',
    'claude-opus-4-6-low',
    'claude-opus-4-6-medium',
    'claude-opus-4-6-high',
    'claude-opus-4-6-max',
    'claude-opus-4-6[1m]-low',
    'claude-opus-4-6[1m]-medium',
    'claude-opus-4-6[1m]-high',
    'claude-opus-4-6[1m]-max',
    'claude-sonnet-4-6-low',
    'claude-sonnet-4-6-medium',
    'claude-sonnet-4-6-high',
    'claude-sonnet-4-6-max',
    'claude-sonnet-4-6[1m]-low',
    'claude-sonnet-4-6[1m]-medium',
    'claude-sonnet-4-6[1m]-high',
    'claude-sonnet-4-6[1m]-max',
] as const satisfies readonly ModelMode[];

export const GEMINI_MODEL_MODES = [
    MODEL_MODE_DEFAULT,
    'gemini-3.8-flash',
    'gemini-3.7-flash',
    'gemini-3.1-pro-preview',
    'gemini-3.6-flash',
    'gemini-3.5-flash',
    'gemini-3.5-flash-lite',
    'gemini-3.1-flash-lite',
    'gemini-2.5-pro',
    'gemini-2.5-flash-lite',
] as const satisfies readonly ModelMode[];

export const CODEX_MODEL_MODES = [
    MODEL_MODE_DEFAULT,
    'gpt-6-astra-low',
    'gpt-6-astra-medium',
    'gpt-6-astra-high',
    'gpt-6-astra-xhigh',
    'gpt-6-astra-max',
    'gpt-6-astra-ultra',
    'gpt-5.6-sol-low',
    'gpt-5.6-sol-medium',
    'gpt-5.6-sol-high',
    'gpt-5.6-sol-xhigh',
    'gpt-5.6-sol-max',
    'gpt-5.6-sol-ultra',
    'gpt-5.6-terra-low',
    'gpt-5.6-terra-medium',
    'gpt-5.6-terra-high',
    'gpt-5.6-terra-xhigh',
    'gpt-5.6-terra-max',
    'gpt-5.6-terra-ultra',
    'gpt-5.6-luna-low',
    'gpt-5.6-luna-medium',
    'gpt-5.6-luna-high',
    'gpt-5.6-luna-xhigh',
    'gpt-5.6-luna-max',
    'gpt-5.5-low',
    'gpt-5.5-medium',
    'gpt-5.5-high',
    'gpt-5.5-xhigh',
] as const satisfies readonly ModelMode[];

export const QODER_MODEL_MODES = [
    MODEL_MODE_DEFAULT,
    'qoder-auto',
    'qoder-qmodel_38max',
    'qoder-qfmodel',
    'qoder-qmodel_latest',
    'qoder-qmodel',
    'qoder-q37fmodel',
    'qoder-dmodel',
    'qoder-dfmodel',
    'qoder-gmodel',
    'qoder-gfmodel',
    'qoder-gm51model',
    'qoder-kmodel_latest',
    'qoder-kmodel',
    'qoder-mmodel',
] as const satisfies readonly ModelMode[];

const MODEL_MODE_SET = new Set<ModelMode>(MODEL_MODES);
const CLAUDE_MODEL_MODE_SET = new Set<ModelMode>(CLAUDE_MODEL_MODES);
const GEMINI_MODEL_MODE_SET = new Set<ModelMode>(GEMINI_MODEL_MODES);
const CODEX_MODEL_MODE_SET = new Set<ModelMode>(CODEX_MODEL_MODES);
const QODER_MODEL_MODE_SET = new Set<ModelMode>(QODER_MODEL_MODES);

export function isModelMode(value: string): value is ModelMode {
    return MODEL_MODE_SET.has(value as ModelMode);
}

export function isModelModeForAgent(agent: AgentFlavor, mode: string): mode is ModelMode {
    if (!isModelMode(mode)) return false;
    if (agent === 'claude') return CLAUDE_MODEL_MODE_SET.has(mode);
    if (agent === 'gemini') return GEMINI_MODEL_MODE_SET.has(mode);
    if (agent === 'qoder') return QODER_MODEL_MODE_SET.has(mode);
    return CODEX_MODEL_MODE_SET.has(mode);
}

/**
 * The model modes each flavor accepts, keyed by provider.
 *
 * Exported as data, not only through the accessor below, because the orchestrator API
 * hands the whole table to a client so it can validate a `model` before dispatching, and
 * the server and the CLI must not each restate it.
 */
export const MODEL_MODES_BY_PROVIDER: Record<AgentFlavor, readonly ModelMode[]> = {
    claude: CLAUDE_MODEL_MODES,
    codex: CODEX_MODEL_MODES,
    gemini: GEMINI_MODEL_MODES,
    qoder: QODER_MODEL_MODES,
};

export function getValidModelModesForAgent(agent: AgentFlavor): readonly ModelMode[] {
    return MODEL_MODES_BY_PROVIDER[agent];
}

export const CLAUDE_MODEL_OPTIONS = [
    { value: MODEL_MODE_DEFAULT, label: 'Use CLI configured model', shortLabel: 'CLI', description: 'Use profile/CLI defaults' },
    { value: 'claude-fable-5-1', label: 'Fable 5.1', shortLabel: 'Fable 5.1', description: 'Most capable for long-horizon agentic work' },
    { value: 'claude-fable-5', label: 'Fable 5', shortLabel: 'Fable 5', description: 'Previous generation Fable' },
    { value: 'claude-opus-5', label: 'Opus 5', shortLabel: 'Opus 5', description: 'Best for complex agentic coding' },
    { value: 'claude-sonnet-5', label: 'Sonnet 5', shortLabel: 'Sonnet 5', description: 'Best balance of speed and intelligence' },
    { value: 'claude-opus-4-8', label: 'Opus 4.8', shortLabel: 'Opus 4.8', description: 'Previous generation Opus' },
    { value: 'claude-opus-4-7', label: 'Opus 4.7', shortLabel: 'Opus 4.7', description: 'Previous generation Opus' },
    { value: 'claude-opus-4-6', label: 'Opus 4.6', shortLabel: 'Opus 4.6', description: 'Older Opus' },
    { value: 'claude-sonnet-4-6', label: 'Sonnet 4.6', shortLabel: 'Sonnet 4.6', description: 'Balanced speed and quality' },
    { value: 'claude-haiku-4-5', label: 'Haiku 4.5', shortLabel: 'Haiku 4.5', description: 'Fastest' },
] as const;

// Base families only — the 1M context opt-in is a separate toggle in the UI,
// combined back into the `family[1m]` wire value via claudeFamilyWith1M.
export const CLAUDE_MODEL_FAMILY_OPTIONS = [
    { value: MODEL_MODE_DEFAULT, label: 'Use CLI configured model', shortLabel: 'CLI', description: 'Use profile/CLI defaults' },
    { value: 'claude-fable-5-1', label: 'Fable 5.1', shortLabel: 'Fable 5.1', description: 'Most capable for long-horizon agentic work' },
    { value: 'claude-fable-5', label: 'Fable 5', shortLabel: 'Fable 5', description: 'Previous generation Fable' },
    { value: 'claude-opus-5', label: 'Opus 5', shortLabel: 'Opus 5', description: 'Best for complex agentic coding' },
    { value: 'claude-sonnet-5', label: 'Sonnet 5', shortLabel: 'Sonnet 5', description: 'Best balance of speed and intelligence' },
    { value: 'claude-opus-4-8', label: 'Opus 4.8', shortLabel: 'Opus 4.8', description: 'Previous generation Opus' },
    { value: 'claude-opus-4-7', label: 'Opus 4.7', shortLabel: 'Opus 4.7', description: 'Previous generation Opus' },
    { value: 'claude-opus-4-6', label: 'Opus 4.6', shortLabel: 'Opus 4.6', description: 'Older Opus' },
    { value: 'claude-sonnet-4-6', label: 'Sonnet 4.6', shortLabel: 'Sonnet 4.6', description: 'Balanced speed and quality' },
    { value: 'claude-haiku-4-5', label: 'Haiku 4.5', shortLabel: 'Haiku 4.5', description: 'Fastest' },
] as const satisfies readonly { value: ClaudeModelFamily; label: string; shortLabel: string; description: string }[];

const CLAUDE_MODE_TO_SELECTION: Partial<Record<ModelMode, { family: ClaudeModelFamily; effort: ClaudeReasoningEffort }>> = {
    'claude-fable-5-1-low': { family: 'claude-fable-5-1', effort: 'low' },
    'claude-fable-5-1-medium': { family: 'claude-fable-5-1', effort: 'medium' },
    'claude-fable-5-1-high': { family: 'claude-fable-5-1', effort: 'high' },
    'claude-fable-5-1-xhigh': { family: 'claude-fable-5-1', effort: 'xhigh' },
    'claude-fable-5-1-max': { family: 'claude-fable-5-1', effort: 'max' },
    'claude-fable-5-low': { family: 'claude-fable-5', effort: 'low' },
    'claude-fable-5-medium': { family: 'claude-fable-5', effort: 'medium' },
    'claude-fable-5-high': { family: 'claude-fable-5', effort: 'high' },
    'claude-fable-5-xhigh': { family: 'claude-fable-5', effort: 'xhigh' },
    'claude-fable-5-max': { family: 'claude-fable-5', effort: 'max' },
    'claude-fable-5[1m]-low': { family: 'claude-fable-5[1m]', effort: 'low' },
    'claude-fable-5[1m]-medium': { family: 'claude-fable-5[1m]', effort: 'medium' },
    'claude-fable-5[1m]-high': { family: 'claude-fable-5[1m]', effort: 'high' },
    'claude-fable-5[1m]-xhigh': { family: 'claude-fable-5[1m]', effort: 'xhigh' },
    'claude-fable-5[1m]-max': { family: 'claude-fable-5[1m]', effort: 'max' },
    'claude-opus-5-low': { family: 'claude-opus-5', effort: 'low' },
    'claude-opus-5-medium': { family: 'claude-opus-5', effort: 'medium' },
    'claude-opus-5-high': { family: 'claude-opus-5', effort: 'high' },
    'claude-opus-5-xhigh': { family: 'claude-opus-5', effort: 'xhigh' },
    'claude-opus-5-max': { family: 'claude-opus-5', effort: 'max' },
    'claude-sonnet-5-low': { family: 'claude-sonnet-5', effort: 'low' },
    'claude-sonnet-5-medium': { family: 'claude-sonnet-5', effort: 'medium' },
    'claude-sonnet-5-high': { family: 'claude-sonnet-5', effort: 'high' },
    'claude-sonnet-5-xhigh': { family: 'claude-sonnet-5', effort: 'xhigh' },
    'claude-sonnet-5-max': { family: 'claude-sonnet-5', effort: 'max' },
    'claude-opus-4-8-low': { family: 'claude-opus-4-8', effort: 'low' },
    'claude-opus-4-8-medium': { family: 'claude-opus-4-8', effort: 'medium' },
    'claude-opus-4-8-high': { family: 'claude-opus-4-8', effort: 'high' },
    'claude-opus-4-8-xhigh': { family: 'claude-opus-4-8', effort: 'xhigh' },
    'claude-opus-4-8-max': { family: 'claude-opus-4-8', effort: 'max' },
    'claude-opus-4-8[1m]-low': { family: 'claude-opus-4-8[1m]', effort: 'low' },
    'claude-opus-4-8[1m]-medium': { family: 'claude-opus-4-8[1m]', effort: 'medium' },
    'claude-opus-4-8[1m]-high': { family: 'claude-opus-4-8[1m]', effort: 'high' },
    'claude-opus-4-8[1m]-xhigh': { family: 'claude-opus-4-8[1m]', effort: 'xhigh' },
    'claude-opus-4-8[1m]-max': { family: 'claude-opus-4-8[1m]', effort: 'max' },
    'claude-opus-4-7-low': { family: 'claude-opus-4-7', effort: 'low' },
    'claude-opus-4-7-medium': { family: 'claude-opus-4-7', effort: 'medium' },
    'claude-opus-4-7-high': { family: 'claude-opus-4-7', effort: 'high' },
    'claude-opus-4-7-xhigh': { family: 'claude-opus-4-7', effort: 'xhigh' },
    'claude-opus-4-7-max': { family: 'claude-opus-4-7', effort: 'max' },
    'claude-opus-4-7[1m]-low': { family: 'claude-opus-4-7[1m]', effort: 'low' },
    'claude-opus-4-7[1m]-medium': { family: 'claude-opus-4-7[1m]', effort: 'medium' },
    'claude-opus-4-7[1m]-high': { family: 'claude-opus-4-7[1m]', effort: 'high' },
    'claude-opus-4-7[1m]-xhigh': { family: 'claude-opus-4-7[1m]', effort: 'xhigh' },
    'claude-opus-4-7[1m]-max': { family: 'claude-opus-4-7[1m]', effort: 'max' },
    'claude-opus-4-6-low': { family: 'claude-opus-4-6', effort: 'low' },
    'claude-opus-4-6-medium': { family: 'claude-opus-4-6', effort: 'medium' },
    'claude-opus-4-6-high': { family: 'claude-opus-4-6', effort: 'high' },
    'claude-opus-4-6-max': { family: 'claude-opus-4-6', effort: 'max' },
    'claude-opus-4-6[1m]-low': { family: 'claude-opus-4-6[1m]', effort: 'low' },
    'claude-opus-4-6[1m]-medium': { family: 'claude-opus-4-6[1m]', effort: 'medium' },
    'claude-opus-4-6[1m]-high': { family: 'claude-opus-4-6[1m]', effort: 'high' },
    'claude-opus-4-6[1m]-max': { family: 'claude-opus-4-6[1m]', effort: 'max' },
    'claude-sonnet-4-6-low': { family: 'claude-sonnet-4-6', effort: 'low' },
    'claude-sonnet-4-6-medium': { family: 'claude-sonnet-4-6', effort: 'medium' },
    'claude-sonnet-4-6-high': { family: 'claude-sonnet-4-6', effort: 'high' },
    'claude-sonnet-4-6-max': { family: 'claude-sonnet-4-6', effort: 'max' },
    'claude-sonnet-4-6[1m]-low': { family: 'claude-sonnet-4-6[1m]', effort: 'low' },
    'claude-sonnet-4-6[1m]-medium': { family: 'claude-sonnet-4-6[1m]', effort: 'medium' },
    'claude-sonnet-4-6[1m]-high': { family: 'claude-sonnet-4-6[1m]', effort: 'high' },
    'claude-sonnet-4-6[1m]-max': { family: 'claude-sonnet-4-6[1m]', effort: 'max' },
};

export const GEMINI_MODEL_OPTIONS = [
    { value: MODEL_MODE_DEFAULT, label: 'Use CLI configured model', shortLabel: 'CLI', description: 'Use profile/CLI defaults' },
    { value: 'gemini-3.8-flash', label: '3.8 Flash', shortLabel: '3.8 Flash', description: 'Latest balance of speed and intelligence' },
    { value: 'gemini-3.7-flash', label: '3.7 Flash', shortLabel: '3.7 Flash', description: 'Previous generation Flash' },
    { value: 'gemini-3.6-flash', label: '3.6 Flash', shortLabel: '3.6 Flash', description: 'Previous generation Flash' },
    { value: 'gemini-3.1-pro-preview', label: '3.1 Pro (Preview)', shortLabel: '3.1 Pro', description: 'Previous generation Pro' },
    { value: 'gemini-3.5-flash', label: '3.5 Flash', shortLabel: '3.5 Flash', description: 'Fast frontier agentic and coding model' },
    { value: 'gemini-3.5-flash-lite', label: '3.5 Flash-Lite', shortLabel: '3.5 Flash-Lite', description: 'Fastest, most cost-effective 3.5 model' },
    { value: 'gemini-3.1-flash-lite', label: '3.1 Flash-Lite', shortLabel: '3.1 Flash-Lite', description: 'Lightweight, optimized for speed and cost' },
    { value: 'gemini-2.5-pro', label: '2.5 Pro', shortLabel: '2.5 Pro', description: 'Previous generation' },
    { value: 'gemini-2.5-flash-lite', label: '2.5 Flash-Lite', shortLabel: '2.5 Flash-Lite', description: 'Lightweight free-tier friendly model' },
] as const;

export const QODER_MODEL_OPTIONS = [
    { value: MODEL_MODE_DEFAULT, label: 'Use CLI configured model', shortLabel: 'CLI', description: 'Use profile/CLI defaults' },
    { value: 'qoder-auto', label: 'Auto (default)', shortLabel: 'Auto', description: 'Qoder routes each request; 0.50x credit' },
    { value: 'qoder-qmodel_38max', label: 'Qwen3.8-Max', shortLabel: 'Qwen3.8-Max', description: 'Reasoning, vision; 0.50x credit' },
    { value: 'qoder-qfmodel', label: 'Qwen3.8-Flash', shortLabel: 'Qwen3.8-Flash', description: 'Reasoning, vision; free tier (0.00x credit)' },
    { value: 'qoder-qmodel_latest', label: 'Qwen3.7-Max', shortLabel: 'Qwen3.7-Max', description: 'Reasoning, vision; 0.50x credit' },
    { value: 'qoder-qmodel', label: 'Qwen3.7-Plus', shortLabel: 'Qwen3.7-Plus', description: 'Reasoning, vision; 0.10x credit' },
    { value: 'qoder-q37fmodel', label: 'Qwen3.7-Flash', shortLabel: 'Qwen3.7-Flash', description: 'Reasoning, vision; 0.10x credit' },
    { value: 'qoder-dmodel', label: 'DeepSeek-V4-Pro', shortLabel: 'DS-V4-Pro', description: 'Reasoning, vision; 0.50x credit' },
    { value: 'qoder-dfmodel', label: 'DeepSeek-Flash', shortLabel: 'DS-Flash', description: 'Vision; 0.10x credit' },
    { value: 'qoder-gmodel', label: 'GLM-5.3', shortLabel: 'GLM-5.3', description: 'Reasoning, vision; 0.80x credit' },
    { value: 'qoder-gfmodel', label: 'GLM-5.3-Flash', shortLabel: 'GLM-5.3-Flash', description: 'Reasoning, vision; 0.10x credit' },
    { value: 'qoder-gm51model', label: 'GLM-5.2', shortLabel: 'GLM-5.2', description: 'Reasoning, vision; 0.60x credit' },
    { value: 'qoder-kmodel_latest', label: 'Kimi-K3', shortLabel: 'Kimi-K3', description: 'Vision; 1.40x credit' },
    { value: 'qoder-kmodel', label: 'Kimi-K2.8-Preview', shortLabel: 'Kimi-K2.8', description: 'Reasoning, vision; 0.80x credit' },
    { value: 'qoder-mmodel', label: 'MiniMax-M2.7', shortLabel: 'MiniMax-M2.7', description: '0.20x credit' },
] as const;

/**
 * Qoder model mode id -> value handed to `qoder --model <value>`, and the reverse.
 * Kept as an explicit table rather than `mode.slice(6)` so an unprefixed model id
 * reported by the CLI (`auto`) can still round-trip when it comes back from ACP.
 */
// Stripping the `qoder-` prefix reproduces the measured ACP/`--model` value exactly,
// so the table only documents the invariant rather than listing 14 rows.
const QODER_MODE_TO_CLI_MODEL: Partial<Record<ModelMode, string>> = Object.fromEntries(
    QODER_MODEL_MODES
        .filter(mode => mode !== MODEL_MODE_DEFAULT)
        .map(mode => [mode, mode.slice('qoder-'.length)]),
) as Partial<Record<ModelMode, string>>;

const QODER_CLI_MODEL_TO_MODE: Record<string, ModelMode> = Object.fromEntries(
    Object.entries(QODER_MODE_TO_CLI_MODEL).map(([mode, cli]) => [cli, mode as ModelMode]),
) as Record<string, ModelMode>;

export function qoderModelModeToCliModel(modelMode: string | null | undefined): string | null {
    if (!modelMode || modelMode === MODEL_MODE_DEFAULT) return null;
    const mapped = QODER_MODE_TO_CLI_MODEL[modelMode as ModelMode];
    if (mapped) return mapped;
    // Unknown qoder-* id: assume the prefix is all that separates it from the CLI value.
    return modelMode.startsWith('qoder-') ? modelMode.slice('qoder-'.length) : modelMode;
}

export function cliModelToQoderModelMode(cliModel: string | null | undefined): ModelMode | null {
    if (!cliModel) return null;
    if (isModelMode(cliModel)) return cliModel;
    return QODER_CLI_MODEL_TO_MODE[cliModel] ?? null;
}

export const CODEX_MODEL_FAMILY_OPTIONS = [
    { value: MODEL_MODE_DEFAULT, label: 'Use CLI configured model', shortLabel: 'CLI', description: 'Use profile/CLI defaults' },
    { value: 'gpt-6-astra', label: 'GPT-6-Astra', shortLabel: '6-Astra', description: 'Most capable model for complex end-to-end work' },
    { value: 'gpt-5.6-sol', label: 'GPT-5.6-Sol', shortLabel: '5.6-Sol', description: 'Latest frontier agentic coding model' },
    { value: 'gpt-5.6-terra', label: 'GPT-5.6-Terra', shortLabel: '5.6-Terra', description: 'Balanced agentic coding model for everyday work' },
    { value: 'gpt-5.6-luna', label: 'GPT-5.6-Luna', shortLabel: '5.6-Luna', description: 'Fast and affordable agentic coding model' },
    { value: 'gpt-5.5', label: 'GPT-5.5', shortLabel: '5.5', description: 'Frontier model for complex coding and research' },
] as const satisfies readonly { value: CodexModelFamily; label: string; shortLabel: string; description: string }[];

export const CODEX_MODEL_OPTIONS = [
    { value: MODEL_MODE_DEFAULT, label: 'Default', description: 'Use CLI default model' },
    { value: 'gpt-6-astra-low', label: 'GPT-6-Astra (Low)', description: 'Fast responses' },
    { value: 'gpt-6-astra-medium', label: 'GPT-6-Astra (Medium)', description: 'Balanced responses' },
    { value: 'gpt-6-astra-high', label: 'GPT-6-Astra (High)', description: 'Strong quality' },
    { value: 'gpt-6-astra-xhigh', label: 'GPT-6-Astra (XHigh)', description: 'Extra reasoning depth' },
    { value: 'gpt-6-astra-max', label: 'GPT-6-Astra (Max)', description: 'Maximum reasoning depth' },
    { value: 'gpt-6-astra-ultra', label: 'GPT-6-Astra (Ultra)', description: 'Maximum reasoning with automatic task delegation' },
    { value: 'gpt-5.6-sol-low', label: 'GPT-5.6-Sol (Low)', description: 'Fast responses' },
    { value: 'gpt-5.6-sol-medium', label: 'GPT-5.6-Sol (Medium)', description: 'Balanced responses' },
    { value: 'gpt-5.6-sol-high', label: 'GPT-5.6-Sol (High)', description: 'Strong quality' },
    { value: 'gpt-5.6-sol-xhigh', label: 'GPT-5.6-Sol (XHigh)', description: 'Extra reasoning depth' },
    { value: 'gpt-5.6-sol-max', label: 'GPT-5.6-Sol (Max)', description: 'Maximum reasoning depth' },
    { value: 'gpt-5.6-sol-ultra', label: 'GPT-5.6-Sol (Ultra)', description: 'Maximum reasoning with automatic task delegation' },
    { value: 'gpt-5.6-terra-low', label: 'GPT-5.6-Terra (Low)', description: 'Fast responses' },
    { value: 'gpt-5.6-terra-medium', label: 'GPT-5.6-Terra (Medium)', description: 'Balanced responses' },
    { value: 'gpt-5.6-terra-high', label: 'GPT-5.6-Terra (High)', description: 'Strong quality' },
    { value: 'gpt-5.6-terra-xhigh', label: 'GPT-5.6-Terra (XHigh)', description: 'Extra reasoning depth' },
    { value: 'gpt-5.6-terra-max', label: 'GPT-5.6-Terra (Max)', description: 'Maximum reasoning depth' },
    { value: 'gpt-5.6-terra-ultra', label: 'GPT-5.6-Terra (Ultra)', description: 'Maximum reasoning with automatic task delegation' },
    { value: 'gpt-5.6-luna-low', label: 'GPT-5.6-Luna (Low)', description: 'Fastest responses' },
    { value: 'gpt-5.6-luna-medium', label: 'GPT-5.6-Luna (Medium)', description: 'Balanced speed and quality' },
    { value: 'gpt-5.6-luna-high', label: 'GPT-5.6-Luna (High)', description: 'Higher quality with good speed' },
    { value: 'gpt-5.6-luna-xhigh', label: 'GPT-5.6-Luna (XHigh)', description: 'Extra reasoning depth' },
    { value: 'gpt-5.6-luna-max', label: 'GPT-5.6-Luna (Max)', description: 'Maximum reasoning depth' },
    { value: 'gpt-5.5-low', label: 'GPT-5.5 (Low)', description: 'Fast responses' },
    { value: 'gpt-5.5-medium', label: 'GPT-5.5 (Medium)', description: 'Balanced responses' },
    { value: 'gpt-5.5-high', label: 'GPT-5.5 (High)', description: 'Strong quality' },
    { value: 'gpt-5.5-xhigh', label: 'GPT-5.5 (XHigh)', description: 'Best quality' },
] as const satisfies readonly { value: ModelMode; label: string; description: string }[];

const CODEX_MODE_TO_SELECTION: Partial<Record<ModelMode, { family: CodexModelFamily; effort: CodexReasoningEffort }>> = {
    'gpt-6-astra-low': { family: 'gpt-6-astra', effort: 'low' },
    'gpt-6-astra-medium': { family: 'gpt-6-astra', effort: 'medium' },
    'gpt-6-astra-high': { family: 'gpt-6-astra', effort: 'high' },
    'gpt-6-astra-xhigh': { family: 'gpt-6-astra', effort: 'xhigh' },
    'gpt-6-astra-max': { family: 'gpt-6-astra', effort: 'max' },
    'gpt-6-astra-ultra': { family: 'gpt-6-astra', effort: 'ultra' },
    'gpt-5.6-sol-low': { family: 'gpt-5.6-sol', effort: 'low' },
    'gpt-5.6-sol-medium': { family: 'gpt-5.6-sol', effort: 'medium' },
    'gpt-5.6-sol-high': { family: 'gpt-5.6-sol', effort: 'high' },
    'gpt-5.6-sol-xhigh': { family: 'gpt-5.6-sol', effort: 'xhigh' },
    'gpt-5.6-sol-max': { family: 'gpt-5.6-sol', effort: 'max' },
    'gpt-5.6-sol-ultra': { family: 'gpt-5.6-sol', effort: 'ultra' },
    'gpt-5.6-terra-low': { family: 'gpt-5.6-terra', effort: 'low' },
    'gpt-5.6-terra-medium': { family: 'gpt-5.6-terra', effort: 'medium' },
    'gpt-5.6-terra-high': { family: 'gpt-5.6-terra', effort: 'high' },
    'gpt-5.6-terra-xhigh': { family: 'gpt-5.6-terra', effort: 'xhigh' },
    'gpt-5.6-terra-max': { family: 'gpt-5.6-terra', effort: 'max' },
    'gpt-5.6-terra-ultra': { family: 'gpt-5.6-terra', effort: 'ultra' },
    'gpt-5.6-luna-low': { family: 'gpt-5.6-luna', effort: 'low' },
    'gpt-5.6-luna-medium': { family: 'gpt-5.6-luna', effort: 'medium' },
    'gpt-5.6-luna-high': { family: 'gpt-5.6-luna', effort: 'high' },
    'gpt-5.6-luna-xhigh': { family: 'gpt-5.6-luna', effort: 'xhigh' },
    'gpt-5.6-luna-max': { family: 'gpt-5.6-luna', effort: 'max' },
    'gpt-5.5-low': { family: 'gpt-5.5', effort: 'low' },
    'gpt-5.5-medium': { family: 'gpt-5.5', effort: 'medium' },
    'gpt-5.5-high': { family: 'gpt-5.5', effort: 'high' },
    'gpt-5.5-xhigh': { family: 'gpt-5.5', effort: 'xhigh' },
};

/**
 * Codex families that have been retired from the pickers. `isModelMode` no
 * longer accepts them, but a session saved while they were current still
 * carries a composite mode like `gpt-5.4-high`. Without this map the resolver
 * would hand that string to the CLI verbatim as a model name; with it the
 * session keeps running on the model and effort it was created with.
 */
const RETIRED_CODEX_MODES: Record<string, string> = {
    'gpt-5.4-low': 'gpt-5.4',
    'gpt-5.4-medium': 'gpt-5.4',
    'gpt-5.4-high': 'gpt-5.4',
    'gpt-5.4-xhigh': 'gpt-5.4',
    'gpt-5.4-mini-low': 'gpt-5.4-mini',
    'gpt-5.4-mini-medium': 'gpt-5.4-mini',
    'gpt-5.4-mini-high': 'gpt-5.4-mini',
    'gpt-5.4-mini-xhigh': 'gpt-5.4-mini',
    'gpt-5.2-low': 'gpt-5.2',
    'gpt-5.2-medium': 'gpt-5.2',
    'gpt-5.2-high': 'gpt-5.2',
    'gpt-5.2-xhigh': 'gpt-5.2',
};

/** Resolve a retired composite mode to the model and effort it names, or null. */
function parseRetiredCodexMode(mode: string): { model: string; reasoningEffort: CodexReasoningEffort } | null {
    const model = RETIRED_CODEX_MODES[mode];
    if (!model) return null;
    return { model, reasoningEffort: mode.slice(model.length + 1) as CodexReasoningEffort };
}

export function parseClaudeModelMode(mode: ModelMode): { family: ClaudeModelFamily; effort: ClaudeReasoningEffort | null } {
    const entry = CLAUDE_MODE_TO_SELECTION[mode];
    if (entry) return entry;
    if (mode === MODEL_MODE_DEFAULT) return { family: MODEL_MODE_DEFAULT, effort: null };
    return { family: mode as ClaudeModelFamily, effort: null };
}

export function getClaudeReasoningOptions(family: ClaudeModelFamily): readonly ClaudeReasoningEffort[] {
    if (family === 'claude-fable-5-1'
        || family === 'claude-fable-5' || family === 'claude-fable-5[1m]'
        || family === 'claude-opus-5' || family === 'claude-sonnet-5'
        || family === 'claude-opus-4-8' || family === 'claude-opus-4-8[1m]'
        || family === 'claude-opus-4-7' || family === 'claude-opus-4-7[1m]') return ['max', 'xhigh', 'high', 'medium', 'low'];
    if (family === 'claude-opus-4-6' || family === 'claude-opus-4-6[1m]'
        || family === 'claude-sonnet-4-6' || family === 'claude-sonnet-4-6[1m]') return ['max', 'high', 'medium', 'low'];
    if (family === 'claude-haiku-4-5') return [];
    return ['high', 'medium', 'low'];
}

export function claudeSupportsFastMode(family: ClaudeModelFamily): boolean {
    return family === 'claude-opus-5'
        || family === 'claude-opus-4-8' || family === 'claude-opus-4-8[1m]';
}

/** Strip the [1m] suffix to get the base family ("default" passes through). */
export function claudeBaseFamily(family: ClaudeModelFamily): ClaudeModelFamily {
    return family.replace('[1m]', '') as ClaudeModelFamily;
}

/**
 * Families where 1M context is an explicit opt-in via the [1m] suffix.
 * Claude 5 / Opus 4.8 are always-1M (see claudeAlways1M); Haiku has no 1M variant.
 */
export function claudeHas1MOptIn(family: ClaudeModelFamily): boolean {
    const base = claudeBaseFamily(family);
    return base === 'claude-opus-4-7' || base === 'claude-opus-4-6' || base === 'claude-sonnet-4-6';
}

/** Families whose context window is 1M by default with no 200K tier — the [1m] suffix is a no-op. */
export function claudeAlways1M(family: ClaudeModelFamily): boolean {
    const base = claudeBaseFamily(family);
    return base === 'claude-fable-5-1' || base === 'claude-fable-5' || base === 'claude-opus-5'
        || base === 'claude-sonnet-5' || base === 'claude-opus-4-8';
}

/** Combine a base family with the 1M toggle into the wire family value. */
export function claudeFamilyWith1M(family: ClaudeModelFamily, enable1M: boolean): ClaudeModelFamily {
    const base = claudeBaseFamily(family);
    if (!enable1M || !claudeHas1MOptIn(base)) return base;
    return `${base}[1m]` as ClaudeModelFamily;
}

export function buildClaudeModelMode(
    family: ClaudeModelFamily,
    effort: ClaudeReasoningEffort,
): ModelMode {
    if (family === MODEL_MODE_DEFAULT) return MODEL_MODE_DEFAULT;
    // Haiku 4.5 does not support effort levels — always use the base model mode.
    if (family === 'claude-haiku-4-5') return 'claude-haiku-4-5';
    return `${family}-${effort}` as ModelMode;
}

export function parseCodexModelMode(mode: ModelMode): { family: CodexModelFamily; effort: CodexReasoningEffort } {
    return CODEX_MODE_TO_SELECTION[mode] ?? { family: MODEL_MODE_DEFAULT, effort: 'medium' };
}

export function getCodexReasoningOptions(family: CodexModelFamily): readonly CodexReasoningEffort[] {
    if (family === MODEL_MODE_DEFAULT) return ['high', 'medium', 'low'];
    // Astra, like Sol/Terra, adds the top-tier `max` and `ultra` (auto multi-agent delegation) efforts.
    if (family === 'gpt-6-astra') return ['ultra', 'max', 'xhigh', 'high', 'medium', 'low'];
    // GPT-5.6 Sol/Terra add the top-tier `max` and `ultra` (auto multi-agent delegation) efforts.
    if (family === 'gpt-5.6-sol' || family === 'gpt-5.6-terra') return ['ultra', 'max', 'xhigh', 'high', 'medium', 'low'];
    // GPT-5.6 Luna adds `max` but not `ultra`.
    if (family === 'gpt-5.6-luna') return ['max', 'xhigh', 'high', 'medium', 'low'];
    return ['xhigh', 'high', 'medium', 'low'];
}

export function buildCodexModelMode(
    family: CodexModelFamily,
    effort: CodexReasoningEffort,
): ModelMode {
    if (family === MODEL_MODE_DEFAULT) return MODEL_MODE_DEFAULT;
    return `${family}-${effort}` as ModelMode;
}

export type ModelSelection = {
    model: string | null;
    reasoningEffort: string | null;
};

const MODEL_NAME_LABELS: Record<string, string> = {
    'gpt-6-astra': 'GPT-6-Astra',
    'gpt-5.6-sol': 'GPT-5.6-Sol',
    'gpt-5.6-terra': 'GPT-5.6-Terra',
    'gpt-5.6-luna': 'GPT-5.6-Luna',
    'gpt-5.5': 'GPT-5.5',
    'gpt-5.4': 'GPT-5.4',
    'gpt-5.4-mini': 'GPT-5.4-Mini',
    'gpt-5.2': 'GPT-5.2',
    'claude-fable-5-1': 'Claude Fable 5.1',
    'claude-fable-5': 'Claude Fable 5',
    'claude-opus-5': 'Claude Opus 5',
    'claude-sonnet-5': 'Claude Sonnet 5',
    'claude-opus-4-8': 'Claude Opus 4.8',
    'claude-opus-4-7': 'Claude Opus 4.7',
    'claude-opus-4-6': 'Claude Opus 4.6',
    'claude-sonnet-4-6': 'Claude Sonnet 4.6',
    'claude-haiku-4-5': 'Claude Haiku 4.5',
    'gemini-3.8-flash': 'Gemini 3.8 Flash',
    'gemini-3.7-flash': 'Gemini 3.7 Flash',
    'gemini-3.1-pro-preview': 'Gemini 3.1 Pro (Preview)',
    'gemini-3.6-flash': 'Gemini 3.6 Flash',
    'gemini-3.5-flash': 'Gemini 3.5 Flash',
    'gemini-3.5-flash-lite': 'Gemini 3.5 Flash-Lite',
    'gemini-3.1-flash-lite': 'Gemini 3.1 Flash-Lite',
    'gemini-2.5-pro': 'Gemini 2.5 Pro',
    'gemini-2.5-flash-lite': 'Gemini 2.5 Flash-Lite',
    'qoder-auto': 'Auto',
    'qoder-qmodel_38max': 'Qwen3.8-Max',
    'qoder-qfmodel': 'Qwen3.8-Flash',
    'qoder-qmodel_latest': 'Qwen3.7-Max',
    'qoder-qmodel': 'Qwen3.7-Plus',
    'qoder-q37fmodel': 'Qwen3.7-Flash',
    'qoder-dmodel': 'DeepSeek-V4-Pro',
    'qoder-dfmodel': 'DeepSeek-Flash',
    'qoder-gmodel': 'GLM-5.3',
    'qoder-gfmodel': 'GLM-5.3-Flash',
    'qoder-gm51model': 'GLM-5.2',
    'qoder-kmodel_latest': 'Kimi-K3',
    'qoder-kmodel': 'Kimi-K2.8-Preview',
    'qoder-mmodel': 'MiniMax-M2.7',
    // Raw ids as Qoder reports them back through ACP config metadata and `--model`.
    // Deliberately vendor-neutral: this map is keyed by model name only, so another
    // engine reporting the same opaque token must not end up labelled with a brand.
    'auto': 'Auto',
};

const REASONING_EFFORT_LABELS: Record<string, string> = {
    low: 'Low',
    medium: 'Medium',
    high: 'High',
    max: 'Max',
    xhigh: 'XHigh',
    ultra: 'Ultra',
};

export function resolveModelSelectionForFlavor(flavor: string | null | undefined, modelMode: string): ModelSelection {
    if (modelMode === MODEL_MODE_DEFAULT) return { model: null, reasoningEffort: null };
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
    // Qoder keeps the prefixed mode id on the wire (same invariant as gemini); the
    // CLI-facing `--model` value is derived by qoderModelModeToCliModel at spawn time.
    if (flavor === 'qoder') return { model: modelMode, reasoningEffort: null };
    return { model: null, reasoningEffort: null };
}

export function resolveLocalModelDisplay(modelMode: string | null | undefined): ModelSelection {
    if (!modelMode || modelMode === MODEL_MODE_DEFAULT) return { model: null, reasoningEffort: null };
    if (!isModelMode(modelMode)) {
        return parseRetiredCodexMode(modelMode) ?? { model: modelMode, reasoningEffort: null };
    }

    const parsedCodex = parseCodexModelMode(modelMode);
    if (parsedCodex.family !== MODEL_MODE_DEFAULT) {
        return { model: parsedCodex.family, reasoningEffort: parsedCodex.effort };
    }

    const parsedClaude = CLAUDE_MODE_TO_SELECTION[modelMode as ModelMode];
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
    if (MODEL_NAME_LABELS[model]) return MODEL_NAME_LABELS[model];
    if (isModelMode(model)) {
        const codexParsed = parseCodexModelMode(model);
        if (codexParsed.family !== MODEL_MODE_DEFAULT) {
            return MODEL_NAME_LABELS[codexParsed.family] ?? codexParsed.family;
        }
    }
    const stripped = normalizeModelId(model);
    if (stripped !== model && MODEL_NAME_LABELS[stripped]) return MODEL_NAME_LABELS[stripped];
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
    const show1m = is1m && !claudeAlways1M(stripped as ClaudeModelFamily);
    const parts = [show1m ? '1M' : '', effortLabel ?? ''].filter(Boolean);
    return parts.length > 0 ? `${modelLabel} (${parts.join(', ')})` : modelLabel;
}

// ─── Context Window Sizes ──────────────────────────────────────

const DEFAULT_CONTEXT_WINDOW = 200_000;
const EXTENDED_CONTEXT_WINDOW = 1_000_000;

const AGENT_DEFAULT_CONTEXT_WINDOWS: Record<AgentFlavor, number> = {
    claude: 200_000,
    codex: 272_000,
    gemini: 1_000_000,
    // Conservative until confirmed: Qoder exposes `--context-window` as an override,
    // and the CLI reports its real window through ACP config metadata, which takes
    // precedence over this default in getMaxContextSize.
    qoder: 200_000,
};

const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
    // Claude models (newer families are native 1M; older supported families opt in via [1m])
    'claude-fable-5-1': 1_000_000,
    'claude-fable-5': 1_000_000, // Fable 5 defaults to 1M; base name resolves to 1M
    'claude-fable-5[1m]': 1_000_000,
    'claude-opus-5': 1_000_000,
    'claude-sonnet-5': 1_000_000,
    'claude-opus-4-8': 1_000_000, // 4.8 defaults to 1M (no opt-in needed); base name resolves to 1M
    'claude-opus-4-8[1m]': 1_000_000,
    'claude-opus-4-7': 200_000,
    'claude-opus-4-7[1m]': 1_000_000,
    'claude-opus-4-6': 200_000,
    'claude-opus-4-6[1m]': 1_000_000,
    'claude-sonnet-4-6': 200_000,
    'claude-sonnet-4-6[1m]': 1_000_000,
    'claude-haiku-4-5': 200_000,
    // Codex models (fallback; actual value comes from CLI via context_window_size)
    'gpt-6-astra': 1_050_000,
    'gpt-5.6-sol': 272_000,
    'gpt-5.6-terra': 272_000,
    'gpt-5.6-luna': 272_000,
    'gpt-5.5': 272_000,
    'gpt-5.4': 272_000,
    'gpt-5.4-mini': 272_000,
    'gpt-5.2': 272_000,
    // Gemini models
    'gemini-3.8-flash': 1_048_576,
    'gemini-3.7-flash': 1_048_576,
    'gemini-3.6-flash': 1_000_000,
    'gemini-3.1-pro-preview': 1_000_000,
    'gemini-3.5-flash': 1_000_000,
    'gemini-3.5-flash-lite': 1_000_000,
    'gemini-3.1-flash-lite': 1_000_000,
    'gemini-2.5-pro': 1_000_000,
    'gemini-2.5-flash-lite': 1_000_000,
};

/**
 * Get the max context window size for a given model mode and agent flavor.
 * Falls back to agent default, then global default.
 */
function findContextWindow(model: string): number | undefined {
    if (MODEL_CONTEXT_WINDOWS[model]) return MODEL_CONTEXT_WINDOWS[model];
    const stripped = normalizeModelId(model);
    if (stripped !== model && MODEL_CONTEXT_WINDOWS[stripped]) return MODEL_CONTEXT_WINDOWS[stripped];
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
        if (MODEL_CONTEXT_WINDOWS[modelMode]) return MODEL_CONTEXT_WINDOWS[modelMode];

        // Strip -fast suffix for lookups
        const stripped = modelMode.replace(/-fast$/, '');
        if (stripped !== modelMode && MODEL_CONTEXT_WINDOWS[stripped]) return MODEL_CONTEXT_WINDOWS[stripped];

        // For codex composite modes like "gpt-5.6-sol-high", extract family
        if (isModelMode(modelMode)) {
            const parsed = parseCodexModelMode(modelMode);
            if (parsed.family !== MODEL_MODE_DEFAULT && MODEL_CONTEXT_WINDOWS[parsed.family]) {
                return MODEL_CONTEXT_WINDOWS[parsed.family];
            }
        }

        // For claude composite modes like "claude-opus-4-6-high", extract family
        const claudeMode = isModelMode(modelMode) ? modelMode : (isModelMode(stripped) ? stripped : null);
        if (claudeMode) {
            const parsedClaude = parseClaudeModelMode(claudeMode);
            if (parsedClaude.family !== MODEL_MODE_DEFAULT && MODEL_CONTEXT_WINDOWS[parsedClaude.family]) {
                return MODEL_CONTEXT_WINDOWS[parsedClaude.family];
            }
        }
    }
    // Fall back to agent default
    if (agentFlavor && agentFlavor in AGENT_DEFAULT_CONTEXT_WINDOWS) {
        return AGENT_DEFAULT_CONTEXT_WINDOWS[agentFlavor as AgentFlavor];
    }
    return DEFAULT_CONTEXT_WINDOW;
}
