import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    BUNDLED_MODEL_CATALOG,
    getModelCatalog,
    getModelFamilyOptions,
    onModelCatalogChanged,
    parseModelCatalog,
    setModelCatalog,
    buildClaudeModelMode,
    buildCodexModelMode,
    claudeSupportsFastMode,
    getClaudeContextWindowOptions,
    parseClaudeModelMode,
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
    resolveModelSelectionForFlavor,
    buildQoderModelMode,
    parseQoderModelMode,
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
        expect(isModelMode('gpt-6-luna-xhigh')).toBe(true);
        expect(isModelMode('unknown-model')).toBe(false);

        expect(isModelModeForAgent('codex', 'gpt-5.6-sol-ultra')).toBe(true);
        expect(isModelModeForAgent('codex', 'gpt-6-astra-ultra')).toBe(true);
        expect(isModelModeForAgent('claude', 'claude-fable-5-1-max')).toBe(true);
        expect(isModelModeForAgent('gemini', 'gpt-5.6-sol-ultra')).toBe(false);
        expect(isModelModeForAgent('claude', 'claude-opus-4-6')).toBe(true);
        expect(isModelModeForAgent('claude', 'claude-opus-4-8')).toBe(true);
        expect(isModelModeForAgent('claude', 'claude-opus-4-8[1m]-xhigh')).toBe(false);
        expect(isModelModeForAgent('claude', 'claude-opus-5-max')).toBe(true);
        expect(isModelModeForAgent('claude', 'claude-sonnet-5-xhigh')).toBe(true);
        expect(isModelModeForAgent('gemini', 'gemini-3.6-flash')).toBe(true);
        expect(isModelModeForAgent('gemini', 'gemini-3.8-flash')).toBe(true);
        expect(isModelModeForAgent('gemini', 'gemini-3.5-flash-lite')).toBe(true);
        expect(isModelModeForAgent('gemini', 'gemini-2.5-flash-lite')).toBe(true);
    });

    it('parses codex model mode into family and effort', () => {
        expect(parseCodexModelMode('gpt-6-luna-medium')).toEqual({
            family: 'gpt-6-luna',
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
        expect(getCodexReasoningOptions('gpt-6-luna')).toEqual(['max', 'xhigh', 'high', 'medium', 'low']);
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

    it('renders a CLI-reported [1m] model like its base model', () => {
        expect(formatModelDisplay('claude-opus-4-7[1m]', 'high')).toBe('Claude Opus 4.7 (High)');
        expect(formatModelDisplay('claude-opus-4-7', 'high')).toBe('Claude Opus 4.7 (High)');
        expect(formatModelDisplay('claude-fable-5-1', 'max')).toBe('Claude Fable 5.1 (Max)');
        expect(formatModelDisplay('claude-opus-4-8[1m]', null)).toBe('Claude Opus 4.8');
        expect(getMaxContextSize('default', 'claude', 'claude-fable-5[1m]')).toBe(1_000_000);
        expect(getMaxContextSize('default', 'claude', 'claude-fable-5')).toBe(1_000_000);
    });

    it('keeps codex model list in catalog shape', () => {
        expect(getValidModelModesForAgent('codex')[0]).toBe(MODEL_MODE_DEFAULT);
        expect(getValidModelModesForAgent('codex')).toContain('gpt-6-astra-max');
        expect(getValidModelModesForAgent('codex')).toContain('gpt-6-astra-ultra');
        expect(getValidModelModesForAgent('codex')).toContain('gpt-6-luna-high');
    });

    it('drops retired codex families from the pickers but keeps old sessions resolving', () => {
        // Retired from the pickers: no longer a valid mode, no longer offered.
        expect(isModelMode('gpt-5.5-high')).toBe(false);
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
        expect(getValidModelModesForAgent('gemini')).toContain('gemini-3.6-flash');
        expect(getValidModelModesForAgent('gemini')).toContain('gemini-3.5-flash-lite');
        expect(getValidModelModesForAgent('gemini')).not.toContain('gemini-3.5-pro-preview');
        expect(getValidModelModesForAgent('gemini')).toContain('gemini-2.5-flash-lite');
    });

    it('passes qoder account models through and uses the 200K default window', () => {
        expect(getValidModelModesForAgent('qoder')).toEqual([MODEL_MODE_DEFAULT]);
        expect(resolveModelSelectionForFlavor('qoder', 'efficient')).toEqual({ model: 'efficient', reasoningEffort: null, contextWindow: null });
        expect(resolveModelSelectionForFlavor('qoder', 'performance:high')).toEqual({ model: 'performance', reasoningEffort: 'high', contextWindow: null });
        expect(buildQoderModelMode('performance', 'high')).toBe('performance:high');
        expect(buildQoderModelMode('auto', null)).toBe('auto');
        expect(parseQoderModelMode('auto')).toEqual({ model: 'auto', effort: null, contextWindow: null });
        expect(resolveLocalModelDisplay('smodel:max')).toEqual({ model: 'smodel', reasoningEffort: 'max' });
        expect(getMaxContextSize('default', 'qoder')).toBe(200_000);
    });

    it('carries a picked qoder context window in the mode', () => {
        expect(buildQoderModelMode('performance', 'high', 1_000_000)).toBe('performance:high@1000000');
        expect(buildQoderModelMode('auto', null, 400_000)).toBe('auto@400000');
        expect(parseQoderModelMode('performance:high@1000000')).toEqual({ model: 'performance', effort: 'high', contextWindow: 1_000_000 });
        expect(parseQoderModelMode('auto@400000')).toEqual({ model: 'auto', effort: null, contextWindow: 400_000 });
        expect(resolveModelSelectionForFlavor('qoder', 'dfmodel:max@1000000')).toEqual({ model: 'dfmodel', reasoningEffort: 'max', contextWindow: 1_000_000 });
        expect(resolveLocalModelDisplay('dfmodel:max@1000000')).toEqual({ model: 'dfmodel', reasoningEffort: 'max' });
        expect(getMaxContextSize('dfmodel@400000', 'qoder')).toBe(400_000);
    });

    it('carries a picked claude context window in the mode', () => {
        expect(getClaudeContextWindowOptions('claude-opus-5-5')).toEqual({ presets: [200_000, 1_000_000], min: 100_000, max: 1_000_000 });
        expect(getClaudeContextWindowOptions('claude-haiku-4-5')).toBeNull();
        expect(getClaudeContextWindowOptions(MODEL_MODE_DEFAULT)).toBeNull();
        expect(buildClaudeModelMode('claude-opus-5-5', 'high', 400_000)).toBe('claude-opus-5-5-high@400000');
        expect(buildClaudeModelMode('claude-opus-5-5', 'high', 350_000)).toBe('claude-opus-5-5-high@350000');
        expect(buildClaudeModelMode('claude-opus-5-5', 'high', 50_000)).toBe('claude-opus-5-5-high');
        expect(buildClaudeModelMode('claude-opus-5-5', 'high', 1_200_000)).toBe('claude-opus-5-5-high');
        expect(buildClaudeModelMode('claude-haiku-4-5', 'high', 400_000)).toBe('claude-haiku-4-5');
        expect(parseClaudeModelMode('claude-opus-5-5-high@400000')).toEqual({ family: 'claude-opus-5-5', effort: 'high', contextWindow: 400_000 });
        expect(parseClaudeModelMode('claude-opus-5-5-high')).toEqual({ family: 'claude-opus-5-5', effort: 'high', contextWindow: null });
        expect(isModelModeForAgent('claude', 'claude-opus-5-5-high@400000')).toBe(true);
        expect(isModelModeForAgent('claude', 'default@400000')).toBe(false);
        expect(isModelModeForAgent('codex', 'claude-opus-5-5-high@400000')).toBe(false);
        expect(resolveModelSelectionForFlavor('claude', 'claude-opus-5-5-high@400000')).toEqual({ model: 'claude-opus-5-5', reasoningEffort: 'high', contextWindow: 400_000 });
        expect(resolveLocalModelDisplay('claude-opus-5-5-high@400000')).toEqual({ model: 'claude-opus-5-5', reasoningEffort: 'high' });
        expect(getMaxContextSize('claude-opus-5-5-high@400000', 'claude')).toBe(400_000);
        expect(getMaxContextSize('claude-opus-5-5-high', 'claude')).toBe(1_000_000);
    });

    it('resolves context windows for claude composite and fast model modes', () => {
        expect(getMaxContextSize('claude-fable-5-1-max', 'claude')).toBe(1_000_000);
        expect(getMaxContextSize('claude-opus-5-max', 'claude')).toBe(1_000_000);
        expect(getMaxContextSize('claude-sonnet-5-xhigh', 'claude')).toBe(1_000_000);
        expect(getMaxContextSize('claude-opus-4-8-high', 'claude')).toBe(1_000_000);
        expect(getMaxContextSize('claude-opus-4-6-high', 'claude')).toBe(1_000_000);
        expect(getMaxContextSize('claude-opus-4-6-fast', 'claude')).toBe(1_000_000);
        expect(getMaxContextSize('claude-opus-4-6', 'claude')).toBe(1_000_000);
    });

    it('resolves context window from actualModel when modelMode is default', () => {
        // Exact match
        expect(getMaxContextSize('default', 'claude', 'claude-sonnet-4-6')).toBe(1_000_000);
        // SDK date-stamped model ID (prefix match)
        expect(getMaxContextSize('default', 'claude', 'claude-opus-4-20250514')).toBe(200_000);
        expect(getMaxContextSize('default', 'claude', 'claude-sonnet-4-1-20250805')).toBe(200_000);
        // -fast suffix
        expect(getMaxContextSize('default', 'claude', 'claude-sonnet-4-6-fast')).toBe(1_000_000);
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
        // even when modelMode is default and nothing reports the real window.
        expect(getMaxContextSize('default', 'claude', 'claude-haiku-4-5', 250_000)).toBe(1_000_000);
        expect(getMaxContextSize('default', 'claude', undefined, 300_000)).toBe(1_000_000);
        // Usage within the computed window leaves it unchanged.
        expect(getMaxContextSize('default', 'claude', 'claude-haiku-4-5', 150_000)).toBe(200_000);
        expect(getMaxContextSize('default', 'claude', 'claude-haiku-4-5')).toBe(200_000);
        // Never shrinks an already-larger window.
        expect(getMaxContextSize('claude-fable-5-high', 'claude', undefined, 5_000)).toBe(1_000_000);
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
