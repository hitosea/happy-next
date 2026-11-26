import { describe, expect, it } from 'vitest';
import {
    buildModelMode,
    findAgentModel,
    formatModelDisplay,
    getClaudeContextWindowOptions,
    getMaxContextSize,
    isModelModeFormat,
    isModelModeOffered,
    listModelModes,
    parseModelMode,
    resolveLocalModelDisplay,
    resolveModelSelectionForFlavor,
    sortEffortsStrongestFirst,
    type AgentModel,
} from './agentModels';

const models: AgentModel[] = [
    { code: 'claude-opus-5-5', value: 'Opus 5.5', efforts: [{ code: 'low' }, { code: 'medium' }, { code: 'high' }, { code: 'max' }] },
    { code: 'claude-haiku-4-5-20251001', value: 'Haiku 4.5' },
];

describe('model modes', () => {
    it('builds and parses model:effort@contextWindow', () => {
        const mode = buildModelMode('claude-opus-5-5', 'high', 400_000);
        expect(mode).toBe('claude-opus-5-5:high@400000');
        expect(parseModelMode(mode)).toEqual({ model: 'claude-opus-5-5', reasoningEffort: 'high', contextWindow: 400_000 });
        expect(buildModelMode('default', 'high')).toBe('default');
        expect(parseModelMode('default')).toEqual({ model: null, reasoningEffort: null, contextWindow: null });
    });

    it('reads the old model-effort form for Claude and Codex only', () => {
        expect(resolveModelSelectionForFlavor('claude', 'claude-opus-5-high@400000'))
            .toEqual({ model: 'claude-opus-5', reasoningEffort: 'high', contextWindow: 400_000 });
        expect(resolveModelSelectionForFlavor('codex', 'gpt-5.1-codex-max-xhigh')).toEqual({ model: 'gpt-5.1-codex-max', reasoningEffort: 'xhigh' });
        expect(resolveModelSelectionForFlavor('gemini', 'gemini-x-high')).toEqual({ model: 'gemini-x-high', reasoningEffort: null });
        expect(resolveModelSelectionForFlavor('qoder', 'performance:high@1000000'))
            .toEqual({ model: 'performance', reasoningEffort: 'high', contextWindow: 1_000_000 });
        expect(resolveLocalModelDisplay('gpt-6-sol-medium')).toEqual({ model: 'gpt-6-sol', reasoningEffort: 'medium' });
        expect(resolveModelSelectionForFlavor('claude', 'some-model-off')).toEqual({ model: 'some-model-off', reasoningEffort: null });
        expect(resolveLocalModelDisplay('some-model-off')).toEqual({ model: 'some-model-off', reasoningEffort: null });
    });

    it('checks the format alone, or against a list', () => {
        expect(isModelModeFormat('gpt-6-sol:high')).toBe(true);
        expect(isModelModeFormat('performance:high@1000000')).toBe(true);
        expect(isModelModeFormat('bad mode')).toBe(false);
        expect(isModelModeFormat('a:b:c')).toBe(false);
        expect(isModelModeOffered('claude-opus-5-5:max', models)).toBe(true);
        expect(isModelModeOffered('claude-opus-5-5:ultra', models)).toBe(false);
        expect(isModelModeOffered('claude-haiku-4-5', models)).toBe(true);
        expect(isModelModeOffered('claude-gone', models)).toBe(false);
        expect(isModelModeOffered('default', [])).toBe(true);
        expect(listModelModes(models.slice(0, 1))).toEqual([
            'default', 'claude-opus-5-5', 'claude-opus-5-5:low', 'claude-opus-5-5:medium', 'claude-opus-5-5:high', 'claude-opus-5-5:max',
        ]);
        expect(findAgentModel(models, 'claude-haiku-4-5')?.value).toBe('Haiku 4.5');
    });
});

describe('labels and windows', () => {
    it('labels a model by its listed name, else its id', () => {
        expect(formatModelDisplay('claude-opus-5-5', 'xhigh', models)).toBe('Opus 5.5 (XHigh)');
        expect(formatModelDisplay('gpt-6-sol-fast', null)).toBe('gpt-6-sol');
        expect(formatModelDisplay(null, 'high')).toBeNull();
    });

    it('sorts efforts strongest first', () => {
        expect(sortEffortsStrongestFirst([{ code: 'off' }, { code: 'none' }, { code: 'low' }, { code: 'odd' }, { code: 'xhigh' }]).map((effort) => effort.code))
            .toEqual(['xhigh', 'low', 'none', 'off', 'odd']);
        expect(formatModelDisplay('deepseek-v4-pro', 'off')).toBe('deepseek-v4-pro (Off)');
    });

    it('gives Claude models but Haiku 4.5 a choice of window', () => {
        expect(getClaudeContextWindowOptions('claude-opus-5-5')).toEqual({ presets: [200_000, 1_000_000], min: 100_000, max: 1_000_000 });
        expect(getClaudeContextWindowOptions('claude-haiku-4-5-20251001')).toBeNull();
    });

    it('uses the picked window, else the agent default', () => {
        expect(getMaxContextSize('claude-opus-5-5:high@400000', 'claude')).toBe(400_000);
        expect(getMaxContextSize('gpt-6-sol:high', 'codex')).toBe(272_000);
        expect(getMaxContextSize('deepseek-v4-pro:high', 'deepseek')).toBe(1_000_000);
        expect(getMaxContextSize('default', 'claude', 300_000)).toBe(1_000_000);
        expect(getMaxContextSize(null, null)).toBe(200_000);
    });
});
