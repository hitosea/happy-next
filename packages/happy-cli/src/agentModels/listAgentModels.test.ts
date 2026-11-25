import { describe, expect, it } from 'vitest';
import { parseClaudeModels, parseCodexModels, parseGeminiModels } from './listAgentModels';

describe('parseClaudeModels', () => {
    it('lists each model by its resolved id, starting on Medium, with the context windows Claude Code takes', () => {
        expect(parseClaudeModels([
            { value: 'default', resolvedModel: 'claude-opus-5-5', displayName: 'Default (recommended)' },
            { value: 'opus', resolvedModel: 'claude-opus-5-5', displayName: 'Opus 5.5', description: 'Complex work', supportedEffortLevels: ['low', 'medium', 'max'] },
            { value: 'claude-haiku-4-5-20251001', resolvedModel: 'claude-haiku-4-5-20251001', displayName: 'Haiku 4.5' },
        ])).toEqual([
            {
                code: 'claude-opus-5-5',
                value: 'Opus 5.5',
                description: 'Complex work',
                efforts: [{ code: 'low' }, { code: 'medium' }, { code: 'max' }],
                defaultEffort: 'medium',
                contextWindows: [200_000, 1_000_000],
                defaultContextWindow: 200_000,
                contextWindowRange: { min: 100_000, max: 1_000_000 },
            },
            { code: 'claude-haiku-4-5-20251001', value: 'Haiku 4.5' },
        ]);
    });
});

describe('parseCodexModels', () => {
    it('leaves out hidden models and starts on the default effort', () => {
        expect(parseCodexModels([
            { id: 'gpt-6-sol', displayName: 'GPT-6-Sol', description: 'Workhorse', supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'ultra' }], defaultReasoningEffort: 'ultra' },
            { id: 'internal', hidden: true },
        ])).toEqual([{ code: 'gpt-6-sol', value: 'GPT-6-Sol', description: 'Workhorse', efforts: [{ code: 'low' }, { code: 'ultra' }], defaultEffort: 'ultra' }]);
    });
});

describe('parseGeminiModels', () => {
    it('names models by their ids and leaves out `auto`', () => {
        expect(parseGeminiModels([
            { modelId: 'auto' },
            { modelId: 'gemini-3.1-pro-preview-customtools' },
        ])).toEqual([{ code: 'gemini-3.1-pro-preview-customtools', value: 'gemini-3.1-pro-preview-customtools' }]);
    });
});
