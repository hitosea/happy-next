import { describe, expect, it } from 'vitest';
import { parseClaudeModels, parseCodexModels, parseGeminiModels } from './cliModels';

describe('parseClaudeModels', () => {
    it('lists each model by its resolved id and leaves out `default`', () => {
        expect(parseClaudeModels([
            { value: 'default', resolvedModel: 'claude-opus-5-5', displayName: 'Default (recommended)' },
            { value: 'opus', resolvedModel: 'claude-opus-5-5', displayName: 'Opus 5.5', description: 'Complex work', supportedEffortLevels: ['low', 'max'], supportsFastMode: true },
            { value: 'claude-haiku-4-5-20251001', resolvedModel: 'claude-haiku-4-5-20251001', displayName: 'Haiku 4.5' },
        ])).toEqual([
            { id: 'claude-opus-5-5', label: 'Opus 5.5', description: 'Complex work', efforts: ['low', 'max'], fastMode: true },
            { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5', description: undefined, efforts: [], fastMode: false },
        ]);
    });
});

describe('parseCodexModels', () => {
    it('leaves out hidden models', () => {
        expect(parseCodexModels([
            { id: 'gpt-6-sol', displayName: 'GPT-6-Sol', description: 'Workhorse', supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'ultra' }] },
            { id: 'internal', hidden: true },
        ])).toEqual([{ id: 'gpt-6-sol', label: 'GPT-6-Sol', description: 'Workhorse', efforts: ['low', 'ultra'] }]);
    });
});

describe('parseGeminiModels', () => {
    it('leaves out `auto`', () => {
        expect(parseGeminiModels([
            { modelId: 'auto', name: 'Auto', description: 'Let Gemini decide' },
            { modelId: 'gemini-2.5-pro', name: 'gemini-2.5-pro', description: null },
        ])).toEqual([{ id: 'gemini-2.5-pro', label: 'gemini-2.5-pro', description: undefined, efforts: [] }]);
    });
});
