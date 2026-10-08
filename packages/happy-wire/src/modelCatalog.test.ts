import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    BUNDLED_MODEL_CATALOG,
    getModelCatalog,
    getModelFamilyOptions,
    onModelCatalogChanged,
    parseModelCatalog,
    setModelCatalog,
    buildCodexModelMode,
    claudeAlways1M,
    claudeBaseFamily,
    claudeFamilyWith1M,
    claudeHas1MOptIn,
    claudeSupportsFastMode,
    formatModelDisplay,
    getClaudeReasoningOptions,
    getCodexReasoningOptions,
    getMaxContextSize,
    getValidModelModesForAgent,
    isModelMode,
    isModelModeForAgent,
    MODEL_MODE_DEFAULT,
    parseCodexModelMode,
    resolveLocalModelDisplay,
    qoderModelModeToCliModel,
    cliModelToQoderModelMode,
    resolveModelSelectionForFlavor,
    splitFastModeSuffix,
} from './modelCatalog';

describe('splitFastModeSuffix', () => {
    it('splits a trailing -fast off a model id or a composite mode', () => {
        expect(splitFastModeSuffix('gpt-5.5-fast')).toEqual({ mode: 'gpt-5.5', fast: true });
        expect(splitFastModeSuffix('gpt-5.5-high-fast')).toEqual({ mode: 'gpt-5.5-high', fast: true });
        expect(splitFastModeSuffix('default-fast')).toEqual({ mode: 'default', fast: true });
    });

    it('leaves values without a trailing -fast unchanged', () => {
        expect(splitFastModeSuffix('gpt-5.5-high')).toEqual({ mode: 'gpt-5.5-high', fast: false });
        expect(splitFastModeSuffix('fast-model')).toEqual({ mode: 'fast-model', fast: false });
    });
});

describe('modelCatalog', () => {
    it('validates model mode and flavor-specific mode', () => {
        expect(isModelMode('gpt-6-astra-max')).toBe(true);
        expect(isModelMode('gpt-6-astra-ultra')).toBe(true);
        expect(isModelMode('gpt-5.6-sol-ultra')).toBe(true);
        expect(isModelMode('gpt-5.5-xhigh')).toBe(true);
        expect(isModelMode('unknown-model')).toBe(false);

        expect(isModelModeForAgent('codex', 'gpt-5.6-sol-ultra')).toBe(true);
        expect(isModelModeForAgent('codex', 'gpt-6-astra-ultra')).toBe(true);
        expect(isModelModeForAgent('claude', 'claude-fable-5-1-max')).toBe(true);
        expect(isModelModeForAgent('gemini', 'gpt-5.6-sol-ultra')).toBe(false);
        expect(isModelModeForAgent('claude', 'claude-opus-4-6')).toBe(true);
        expect(isModelModeForAgent('claude', 'claude-opus-4-8')).toBe(true);
        expect(isModelModeForAgent('claude', 'claude-opus-4-8[1m]-xhigh')).toBe(true);
        expect(isModelModeForAgent('claude', 'claude-opus-5-max')).toBe(true);
        expect(isModelModeForAgent('claude', 'claude-sonnet-5-xhigh')).toBe(true);
        expect(isModelModeForAgent('gemini', 'gemini-3.6-flash')).toBe(true);
        expect(isModelModeForAgent('gemini', 'gemini-3.8-flash')).toBe(true);
        expect(isModelModeForAgent('gemini', 'gemini-3.5-flash-lite')).toBe(true);
        expect(isModelModeForAgent('gemini', 'gemini-2.5-flash-lite')).toBe(true);
    });

    it('scopes qoder modes to qoder instead of inheriting the codex fallback', () => {
        // isModelModeForAgent ends in `return CODEX_MODEL_MODE_SET.has(mode)`, so a
        // flavor with no explicit branch silently validates against Codex's list.
        expect(isModelModeForAgent('qoder', 'qoder-auto')).toBe(true);
        expect(isModelModeForAgent('qoder', 'qoder-qmodel_38max')).toBe(true);
        expect(isModelModeForAgent('qoder', MODEL_MODE_DEFAULT)).toBe(true);
        expect(isModelModeForAgent('qoder', 'gpt-5.4-low')).toBe(false);
        expect(isModelModeForAgent('qoder', 'gemini-3.8-flash')).toBe(false);
        expect(isModelModeForAgent('codex', 'qoder-auto')).toBe(false);
        expect(resolveModelSelectionForFlavor('qoder', 'qoder-auto')).toEqual({
            model: 'qoder-auto',
            reasoningEffort: null,
        });
        // The wire keeps the prefixed id; only the CLI arg is unprefixed.
        expect(qoderModelModeToCliModel('qoder-auto')).toBe('auto');
        // Measured ids are opaque vendor keys, not English tier names.
        expect(qoderModelModeToCliModel('qoder-kmodel_latest')).toBe('kmodel_latest');
        expect(qoderModelModeToCliModel(MODEL_MODE_DEFAULT)).toBeNull();
        expect(cliModelToQoderModelMode('qmodel_38max')).toBe('qoder-qmodel_38max');
        // A tier that never existed must not resolve, rather than falling back to auto.
        expect(cliModelToQoderModelMode('performance')).toBeNull();
        expect(getMaxContextSize('qoder-auto', 'qoder')).toBeGreaterThan(0);
    });

    it('parses codex model mode into family and effort', () => {
        expect(parseCodexModelMode('gpt-5.5-medium')).toEqual({
            family: 'gpt-5.5',
            effort: 'medium',
        });
        expect(parseCodexModelMode('claude-opus-4-6')).toEqual({
            family: MODEL_MODE_DEFAULT,
            effort: 'medium',
        });
    });

    it('builds codex model mode and default', () => {
        expect(buildCodexModelMode('gpt-6-astra', 'max')).toBe('gpt-6-astra-max');
        expect(buildCodexModelMode('gpt-6-astra', 'ultra')).toBe('gpt-6-astra-ultra');
        expect(buildCodexModelMode('gpt-5.6-luna', 'low')).toBe('gpt-5.6-luna-low');
        expect(buildCodexModelMode('gpt-5.6-luna', 'xhigh')).toBe('gpt-5.6-luna-xhigh');
        expect(buildCodexModelMode('gpt-5.6-sol', 'ultra')).toBe('gpt-5.6-sol-ultra');
        expect(buildCodexModelMode('gpt-5.6-luna', 'max')).toBe('gpt-5.6-luna-max');
        expect(buildCodexModelMode(MODEL_MODE_DEFAULT, 'high')).toBe(MODEL_MODE_DEFAULT);
    });

    it('returns valid reasoning options per codex family', () => {
        expect(getCodexReasoningOptions('gpt-6-astra')).toEqual(['ultra', 'max', 'xhigh', 'high', 'medium', 'low']);
        expect(getCodexReasoningOptions('gpt-5.5')).toEqual(['xhigh', 'high', 'medium', 'low']);
        expect(getCodexReasoningOptions('gpt-5.6-sol')).toEqual(['ultra', 'max', 'xhigh', 'high', 'medium', 'low']);
        expect(getCodexReasoningOptions('gpt-5.6-terra')).toEqual(['ultra', 'max', 'xhigh', 'high', 'medium', 'low']);
        expect(getCodexReasoningOptions('gpt-5.6-luna')).toEqual(['max', 'xhigh', 'high', 'medium', 'low']);
        expect(getCodexReasoningOptions(MODEL_MODE_DEFAULT)).toEqual(['high', 'medium', 'low']);
    });

    it('resolves session model selection payload for each flavor', () => {
        expect(resolveModelSelectionForFlavor('codex', 'gpt-5.2-high')).toEqual({
            model: 'gpt-5.2',
            reasoningEffort: 'high',
        });
        expect(resolveModelSelectionForFlavor('claude', 'claude-opus-4-5')).toEqual({
            model: 'claude-opus-4-5',
            reasoningEffort: null,
        });
        expect(resolveModelSelectionForFlavor('gemini', 'gemini-2.5-flash-lite')).toEqual({
            model: 'gemini-2.5-flash-lite',
            reasoningEffort: null,
        });
        expect(resolveModelSelectionForFlavor('codex', MODEL_MODE_DEFAULT)).toEqual({
            model: null,
            reasoningEffort: null,
        });
        expect(resolveModelSelectionForFlavor('codex', 'custom-model-id')).toEqual({
            model: 'custom-model-id',
            reasoningEffort: null,
        });
    });

    it('maps claude base families and the 1M opt-in toggle', () => {
        expect(claudeBaseFamily('claude-sonnet-4-6[1m]')).toBe('claude-sonnet-4-6');
        expect(claudeBaseFamily('claude-fable-5')).toBe('claude-fable-5');
        expect(claudeHas1MOptIn('claude-opus-4-7')).toBe(true);
        expect(claudeHas1MOptIn('claude-opus-4-6[1m]')).toBe(true);
        // Claude 5 / Opus 4.8 are always 1M (no 200K tier); Haiku has no 1M variant.
        expect(claudeHas1MOptIn('claude-fable-5')).toBe(false);
        expect(claudeHas1MOptIn('claude-opus-4-8')).toBe(false);
        expect(claudeHas1MOptIn('claude-haiku-4-5')).toBe(false);
        expect(claudeAlways1M('claude-fable-5')).toBe(true);
        expect(claudeAlways1M('claude-fable-5-1')).toBe(true);
        expect(claudeAlways1M('claude-opus-5')).toBe(true);
        expect(claudeAlways1M('claude-sonnet-5')).toBe(true);
        expect(claudeAlways1M('claude-opus-4-8[1m]')).toBe(true);
        expect(claudeAlways1M('claude-opus-4-7')).toBe(false);
        expect(claudeAlways1M('claude-haiku-4-5')).toBe(false);
        expect(claudeFamilyWith1M('claude-opus-4-7', true)).toBe('claude-opus-4-7[1m]');
        expect(claudeFamilyWith1M('claude-opus-4-7[1m]', false)).toBe('claude-opus-4-7');
        // Always-1M families canonicalize to the base name — the suffix would be a no-op.
        expect(claudeFamilyWith1M('claude-fable-5', true)).toBe('claude-fable-5');
        expect(claudeFamilyWith1M('claude-haiku-4-5', true)).toBe('claude-haiku-4-5');
    });

    it('exposes all effort levels for Claude 5 models', () => {
        expect(getClaudeReasoningOptions('claude-fable-5-1')).toEqual(['max', 'xhigh', 'high', 'medium', 'low']);
        expect(getClaudeReasoningOptions('claude-opus-5')).toEqual(['max', 'xhigh', 'high', 'medium', 'low']);
        expect(getClaudeReasoningOptions('claude-sonnet-5')).toEqual(['max', 'xhigh', 'high', 'medium', 'low']);
    });

    it('limits Claude fast mode to currently supported Opus models', () => {
        expect(claudeSupportsFastMode('claude-fable-5-1')).toBe(false);
        expect(claudeSupportsFastMode('claude-opus-5')).toBe(true);
        expect(claudeSupportsFastMode('claude-opus-4-8')).toBe(true);
        expect(claudeSupportsFastMode('claude-opus-4-7')).toBe(false);
        expect(claudeSupportsFastMode('claude-sonnet-5')).toBe(false);
    });

    it('renders both [1m] and base model name formats consistently', () => {
        // Opt-in families: the 1M chip is meaningful.
        expect(formatModelDisplay('claude-opus-4-7[1m]', 'high')).toBe('Claude Opus 4.7 (1M, High)');
        expect(formatModelDisplay('claude-opus-4-7', 'high')).toBe('Claude Opus 4.7 (High)');
        // Always-1M families: both formats render identically (no false CLI→local mismatch).
        expect(formatModelDisplay('claude-fable-5[1m]', 'high')).toBe('Claude Fable 5 (High)');
        expect(formatModelDisplay('claude-fable-5', 'high')).toBe('Claude Fable 5 (High)');
        expect(formatModelDisplay('claude-fable-5-1', 'max')).toBe('Claude Fable 5.1 (Max)');
        expect(formatModelDisplay('claude-opus-4-8[1m]', null)).toBe('Claude Opus 4.8');
        // Both formats resolve the same context window.
        expect(getMaxContextSize('claude-fable-5[1m]-high', 'claude')).toBe(1_000_000);
        expect(getMaxContextSize('claude-fable-5-high', 'claude')).toBe(1_000_000);
        expect(getMaxContextSize('default', 'claude', 'claude-fable-5[1m]')).toBe(1_000_000);
        expect(getMaxContextSize('default', 'claude', 'claude-fable-5')).toBe(1_000_000);
    });

    it('keeps codex model list in catalog shape', () => {
        expect(getValidModelModesForAgent('codex')[0]).toBe(MODEL_MODE_DEFAULT);
        expect(getValidModelModesForAgent('codex')).toContain('gpt-6-astra-max');
        expect(getValidModelModesForAgent('codex')).toContain('gpt-6-astra-ultra');
        expect(getValidModelModesForAgent('codex')).toContain('gpt-5.5-high');
    });

    it('drops retired codex families from the pickers but keeps old sessions resolving', () => {
        // Retired from the pickers: no longer a valid mode, no longer offered.
        expect(isModelMode('gpt-5.4-high')).toBe(false);
        expect(isModelMode('gpt-5.4-mini-low')).toBe(false);
        expect(isModelMode('gpt-5.2-xhigh')).toBe(false);
        expect(isModelModeForAgent('codex', 'gpt-5.4-high')).toBe(false);
        expect(getValidModelModesForAgent('codex')).not.toContain('gpt-5.4-high');
        expect(getValidModelModesForAgent('codex')).not.toContain('gpt-5.4-mini-high');
        expect(getValidModelModesForAgent('codex')).not.toContain('gpt-5.2-high');

        // A session saved while they were current still runs on what it was created with —
        // without the retired map the composite string would be sent as a model name.
        expect(resolveModelSelectionForFlavor('codex', 'gpt-5.4-high')).toEqual({
            model: 'gpt-5.4',
            reasoningEffort: 'high',
        });
        expect(resolveModelSelectionForFlavor('codex', 'gpt-5.4-mini-xhigh')).toEqual({
            model: 'gpt-5.4-mini',
            reasoningEffort: 'xhigh',
        });
        expect(resolveLocalModelDisplay('gpt-5.2-medium')).toEqual({
            model: 'gpt-5.2',
            reasoningEffort: 'medium',
        });
        // The retired map is codex-only: another flavor still passes the raw id through.
        expect(resolveModelSelectionForFlavor('claude', 'gpt-5.4-high')).toEqual({
            model: 'gpt-5.4-high',
            reasoningEffort: null,
        });

        // Retired families keep their label and context window so old sessions still render.
        expect(formatModelDisplay('gpt-5.4', 'high')).toBe('GPT-5.4 (High)');
        expect(getMaxContextSize('gpt-5.4-high', 'codex')).toBe(272_000);
    });

    it('keeps gemini free-tier fallback model in catalog', () => {
        expect(getValidModelModesForAgent('gemini')[0]).toBe(MODEL_MODE_DEFAULT);
        expect(getValidModelModesForAgent('gemini')).toContain('gemini-3.8-flash');
        expect(getValidModelModesForAgent('gemini')).toContain('gemini-3.7-flash');
        expect(getValidModelModesForAgent('gemini')).toContain('gemini-3.6-flash');
        expect(getValidModelModesForAgent('gemini')).toContain('gemini-3.5-flash-lite');
        expect(getValidModelModesForAgent('gemini')).not.toContain('gemini-3.5-pro-preview');
        expect(getValidModelModesForAgent('gemini')).toContain('gemini-2.5-flash-lite');
    });

    it('resolves context windows for claude composite and fast model modes', () => {
        expect(getMaxContextSize('claude-fable-5-1-max', 'claude')).toBe(1_000_000);
        expect(getMaxContextSize('claude-opus-5-max', 'claude')).toBe(1_000_000);
        expect(getMaxContextSize('claude-sonnet-5-xhigh', 'claude')).toBe(1_000_000);
        expect(getMaxContextSize('claude-opus-4-8-high', 'claude')).toBe(1_000_000);
        expect(getMaxContextSize('claude-opus-4-8[1m]', 'claude')).toBe(1_000_000);
        expect(getMaxContextSize('claude-opus-4-8[1m]-xhigh', 'claude')).toBe(1_000_000);
        expect(getMaxContextSize('claude-opus-4-6-high', 'claude')).toBe(200_000);
        expect(getMaxContextSize('claude-opus-4-6-fast', 'claude')).toBe(200_000);
        expect(getMaxContextSize('claude-opus-4-6', 'claude')).toBe(200_000);
        // 1M context variants
        expect(getMaxContextSize('claude-opus-4-6[1m]', 'claude')).toBe(1_000_000);
        expect(getMaxContextSize('claude-opus-4-6[1m]-high', 'claude')).toBe(1_000_000);
        expect(getMaxContextSize('claude-sonnet-4-6[1m]', 'claude')).toBe(1_000_000);
    });

    it('resolves context window from actualModel when modelMode is default', () => {
        // Exact match
        expect(getMaxContextSize('default', 'claude', 'claude-sonnet-4-6')).toBe(200_000);
        // SDK date-stamped model ID (prefix match)
        expect(getMaxContextSize('default', 'claude', 'claude-opus-4-20250514')).toBe(200_000);
        expect(getMaxContextSize('default', 'claude', 'claude-sonnet-4-1-20250805')).toBe(200_000);
        // -fast suffix
        expect(getMaxContextSize('default', 'claude', 'claude-sonnet-4-6-fast')).toBe(200_000);
        // Codex actual model
        expect(getMaxContextSize('default', 'codex', 'gpt-6-astra')).toBe(1_050_000);
        expect(getMaxContextSize('default', 'codex', 'gpt-5.2')).toBe(272_000);
        expect(getMaxContextSize('default', 'codex', 'gpt-5.6-sol')).toBe(272_000);
        expect(getMaxContextSize('default', 'codex', 'gpt-5.6-terra')).toBe(272_000);
        expect(getMaxContextSize('default', 'codex', 'gpt-5.6-luna')).toBe(272_000);
        // Gemini actual model
        expect(getMaxContextSize('default', 'gemini', 'gemini-3.8-flash')).toBe(1_048_576);
        expect(getMaxContextSize('default', 'gemini', 'gemini-2.5-flash-lite')).toBe(1_000_000);
        // Unknown model falls back to agent default
        expect(getMaxContextSize('default', 'claude', 'some-unknown-model')).toBe(200_000);
        // No actualModel falls back to agent default
        expect(getMaxContextSize('default', 'claude')).toBe(200_000);
        expect(getMaxContextSize('default', 'gemini')).toBe(1_000_000);
    });

    it('infers a 1M window when actual context usage already exceeds the computed window', () => {
        // A 200K window can't hold >200K tokens — so the session must be on 1M,
        // even when modelMode is default and the reported model lacks [1m].
        expect(getMaxContextSize('default', 'claude', 'claude-opus-4-7', 250_000)).toBe(1_000_000);
        expect(getMaxContextSize('default', 'claude', undefined, 300_000)).toBe(1_000_000);
        // Usage within the computed window leaves it unchanged.
        expect(getMaxContextSize('default', 'claude', 'claude-opus-4-7', 150_000)).toBe(200_000);
        expect(getMaxContextSize('default', 'claude', 'claude-opus-4-7')).toBe(200_000);
        // Never shrinks an already-larger window.
        expect(getMaxContextSize('claude-opus-4-7[1m]', 'claude', undefined, 5_000)).toBe(1_000_000);
    });
});

describe('runtime model catalog', () => {
    const withOpus6 = {
        ...BUNDLED_MODEL_CATALOG,
        models: [
            { ...BUNDLED_MODEL_CATALOG.models.find((model) => model.id === 'claude-opus-5')!, id: 'claude-opus-6', label: 'Opus 6', displayName: 'Claude Opus 6' },
            ...BUNDLED_MODEL_CATALOG.models,
        ],
    };

    afterEach(() => setModelCatalog(BUNDLED_MODEL_CATALOG));

    it('serves lookups from the catalog set at runtime', () => {
        expect(isModelMode('claude-opus-6-high')).toBe(false);
        setModelCatalog(withOpus6);
        expect(getModelCatalog()).toBe(withOpus6);
        expect(isModelModeForAgent('claude', 'claude-opus-6-high')).toBe(true);
        expect(resolveModelSelectionForFlavor('claude', 'claude-opus-6-max')).toEqual({ model: 'claude-opus-6', reasoningEffort: 'max' });
        expect(getModelFamilyOptions('claude')[1]).toMatchObject({ value: 'claude-opus-6', label: 'Opus 6' });
        expect(getMaxContextSize('claude-opus-6-high', 'claude')).toBe(1_000_000);
        expect(formatModelDisplay('claude-opus-6', 'high')).toBe('Claude Opus 6 (High)');
    });

    it('notifies listeners only when the content changes', () => {
        const listener = vi.fn();
        const unsubscribe = onModelCatalogChanged(listener);
        setModelCatalog(JSON.parse(JSON.stringify(BUNDLED_MODEL_CATALOG)));
        expect(listener).not.toHaveBeenCalled();
        setModelCatalog(withOpus6);
        expect(listener).toHaveBeenCalledTimes(1);
        unsubscribe();
    });

    it('rejects invalid payloads', () => {
        expect(parseModelCatalog({ schemaVersion: 2 })).toBeNull();
        expect(parseModelCatalog(JSON.parse(JSON.stringify(withOpus6)))).toEqual(withOpus6);
    });
});
