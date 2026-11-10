import { describe, expect, it } from 'vitest';
import catalogJson from './modelCatalog.json';
import { ModelCatalogSchema, type ModelCatalogEntry } from './modelCatalogSchema';
import {
    BUNDLED_MODEL_CATALOG,
    getValidModelModesForAgent,
    isModelMode,
} from './modelCatalog';

function withModel(patch: Partial<ModelCatalogEntry>) {
    const base = BUNDLED_MODEL_CATALOG.models.find((m) => m.agent === 'claude' && !m.fastMode)!;
    return { ...catalogJson, models: [...catalogJson.models, { ...base, id: 'claude-test', ...patch }] };
}

describe('modelCatalogSchema', () => {
    it('accepts the bundled catalog', () => {
        expect(ModelCatalogSchema.safeParse(catalogJson).success).toBe(true);
    });

    it('keeps the effort descriptions older clients require', () => {
        expect(Object.keys(catalogJson.effortDescriptions).sort()).toEqual(['high', 'low', 'max', 'medium', 'ultra', 'xhigh']);
    });

    it('rejects duplicate ids', () => {
        expect(ModelCatalogSchema.safeParse(withModel({ id: 'claude-opus-5' })).success).toBe(false);
    });

    it('rejects flags that do not fit the agent', () => {
        expect(ModelCatalogSchema.safeParse(withModel({ efforts: ['ultra', 'high'] })).success).toBe(false);
        expect(ModelCatalogSchema.safeParse(withModel({ agent: 'gemini', efforts: [], fastMode: true })).success).toBe(false);
        expect(ModelCatalogSchema.safeParse(withModel({ fastPricing: { input: 1, output: 1, cacheWrite: 1, cacheRead: 1 } })).success).toBe(false);
    });

    it('requires an exact Codex CLI version', () => {
        for (const version of ['latest', '^0.155.0', '0.155']) {
            const catalog = { ...catalogJson, codexCli: { ...catalogJson.codexCli, version } };
            expect(ModelCatalogSchema.safeParse(catalog).success).toBe(false);
        }
        const beta = { ...catalogJson, codexCli: { ...catalogJson.codexCli, version: '0.156.0-beta.2' } };
        expect(ModelCatalogSchema.safeParse(beta).success).toBe(true);
    });

    it('requires a description on active models', () => {
        expect(ModelCatalogSchema.safeParse(withModel({ description: undefined })).success).toBe(false);
        expect(ModelCatalogSchema.safeParse(withModel({ description: undefined, status: 'retired' })).success).toBe(true);
    });

    it('derives effort modes for every active model', () => {
        for (const model of BUNDLED_MODEL_CATALOG.models) {
            if (model.status !== 'active') continue;
            if (model.agent !== 'codex') expect(isModelMode(model.id)).toBe(true);
            for (const effort of model.efforts) expect(isModelMode(`${model.id}-${effort}`)).toBe(true);
        }
    });

    it('has no [1m] Claude modes', () => {
        expect(getValidModelModesForAgent('claude').some((mode) => mode.includes('[1m]'))).toBe(false);
        expect(getValidModelModesForAgent('claude')).not.toContain('claude-haiku-4-5-low');
    });
});
