import { describe, expect, it } from 'vitest';
import { qoderModelsFromCatalog } from './models';

describe('qoderModelsFromCatalog', () => {
    it('gives the shape qodercli reports over ACP', () => {
        // Trimmed from a real daemon.get_models answer; the expectation is what ACP listed for the same account
        const catalog = [
            { value: 'auto', displayName: 'Auto', isDefault: true, isEnabled: true, isReasoning: true, isVl: true, priceFactor: 0.5 },
            { value: 'qmodel_38max', displayName: 'Qwen3.8-Max', isEnabled: true, isNew: true, isReasoning: true, isVl: true, priceFactor: 0.5, efforts: ['xhigh', 'low', 'medium'], defaultEffort: 'medium', supportsDisabled: true },
            { value: 'qmodel', displayName: 'Qwen3.7-Plus', isEnabled: true, isNew: true, isReasoning: true, isVl: true, priceFactor: 0.1, supportsDisabled: true },
            { value: 'dfmodel', displayName: 'DeepSeek-Flash', isEnabled: true, isNew: true, isVl: true, priceFactor: 0.1, efforts: ['high', 'max', 'low'], defaultEffort: 'max', supportsDisabled: true, availableContextWindows: [1000000, 200000, 400000], defaultContextWindow: 200000 },
            { value: 'mmodel', displayName: 'MiniMax-M2.7', isEnabled: true, isNew: true, priceFactor: 0.2, availableContextWindows: [200000], defaultContextWindow: 128000 },
            { value: 'retired', displayName: 'Retired', isEnabled: false },
        ];

        expect(qoderModelsFromCatalog(catalog)).toEqual([
            { code: 'auto', value: 'Auto (default)', description: 'Reasoning · Vision · 0.50x Credit' },
            {
                code: 'qmodel_38max',
                value: 'Qwen3.8-Max',
                description: 'Reasoning · Vision · New · 0.50x Credit',
                efforts: [{ code: 'xhigh', value: 'Extra High' }, { code: 'low', value: 'Low' }, { code: 'medium', value: 'Medium' }, { code: 'none', value: 'None' }],
                defaultEffort: 'xhigh',
            },
            { code: 'qmodel', value: 'Qwen3.7-Plus', description: 'Reasoning · Vision · New · 0.10x Credit', efforts: [{ code: 'none', value: 'None' }], defaultEffort: 'none' },
            {
                code: 'dfmodel',
                value: 'DeepSeek-Flash',
                description: 'Vision · New · 0.10x Credit',
                efforts: [{ code: 'high', value: 'High' }, { code: 'max', value: 'Max' }, { code: 'low', value: 'Low' }, { code: 'none', value: 'None' }],
                defaultEffort: 'high',
                contextWindows: [200000, 400000, 1000000],
                defaultContextWindow: 200000,
            },
            { code: 'mmodel', value: 'MiniMax-M2.7', description: 'New · 0.20x Credit', contextWindows: [200000], defaultContextWindow: 200000 },
        ]);
    });

    it('fails on an answer without models', () => {
        expect(() => qoderModelsFromCatalog(undefined)).toThrow();
        expect(() => qoderModelsFromCatalog([])).toThrow();
    });
});
