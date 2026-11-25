import { describe, expect, it } from 'vitest';
import { mergeClaudeListing, parseClaudeModels, parseCodexModels, parseGeminiModels } from './listAgentModels';

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

    it('takes the version from the description when the name is the family alone', () => {
        expect(parseClaudeModels([
            { value: 'opus', resolvedModel: 'claude-opus-5-5', displayName: 'Opus', description: 'Opus 5.5 · Complex work' },
            { value: 'sonnet', resolvedModel: 'claude-sonnet-5-5', displayName: 'Sonnet', description: 'Fast · cheap' },
        ]).map(({ value, description }) => ({ value, description }))).toEqual([
            { value: 'Opus 5.5', description: 'Complex work' },
            { value: 'Sonnet', description: 'Fast · cheap' },
        ]);
    });
});

describe('mergeClaudeListing', () => {
    const DAY = 24 * 60 * 60 * 1000;
    const now = 100 * DAY;
    const full = [
        { value: 'default', resolvedModel: 'claude-opus-5-5', displayName: 'Default (recommended)' },
        { value: 'opus', resolvedModel: 'claude-opus-5-5', displayName: 'Opus 5.5' },
        { value: 'claude-opus-4-8', resolvedModel: 'claude-opus-4-8', displayName: 'Opus 4.8' },
    ];
    const short = [
        { value: 'default', resolvedModel: 'claude-opus-5-5', displayName: 'Default (recommended)' },
        { value: 'fable', resolvedModel: 'claude-fable-6', displayName: 'Fable', description: 'Fable 6 · Newest' },
        { value: 'opus', resolvedModel: 'claude-opus-5-5', displayName: 'Opus', description: 'Opus 5.5 · Complex work' },
    ];
    const codes = (listing: { models: { code: string }[] }) => listing.models.map((model) => model.code);

    it('keeps a full list and when it came', () => {
        const listing = mergeClaudeListing(full, undefined, now);
        expect(codes(listing)).toEqual(['claude-opus-5-5', 'claude-opus-4-8']);
        expect(listing.fullListAt).toBe(now);
    });

    it('lets a short list refresh and add to a recent full one, not remove from it', () => {
        const kept = mergeClaudeListing(full, undefined, now - 29 * DAY);
        const listing = mergeClaudeListing(short, kept, now);
        expect(codes(listing)).toEqual(['claude-fable-6', 'claude-opus-5-5', 'claude-opus-4-8']);
        expect(listing.models[1].description).toBe('Complex work');
        expect(listing.fullListAt).toBe(now - 29 * DAY);
    });

    it('takes a short list as is with no full one within 30 days', () => {
        expect(mergeClaudeListing(short, undefined, now)).toEqual({ models: parseClaudeModels(short), fullListAt: null });
        const old = mergeClaudeListing(full, undefined, now - 31 * DAY);
        expect(mergeClaudeListing(short, old, now)).toEqual({ models: parseClaudeModels(short), fullListAt: null });
    });

    it('lets a full list replace a kept one, dropping a model it no longer has', () => {
        const kept = mergeClaudeListing(short, mergeClaudeListing(full, undefined, now - DAY), now);
        expect(codes(mergeClaudeListing(full, kept, now))).toEqual(['claude-opus-5-5', 'claude-opus-4-8']);
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
