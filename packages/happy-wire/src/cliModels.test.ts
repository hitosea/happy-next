import { describe, expect, it } from 'vitest';
import { applyCliModels, cliModelModes, mergeCliModels, type CliModel } from './cliModels';
import { BUNDLED_MODEL_CATALOG } from './modelCatalog';

const bundledClaude = BUNDLED_MODEL_CATALOG.models.find((model) => model.agent === 'claude' && model.status === 'active' && model.descriptionTranslations)!;

describe('applyCliModels', () => {
    it('keeps bundled labels and translations, takes efforts and fast mode from the CLI', () => {
        const catalog = applyCliModels(BUNDLED_MODEL_CATALOG, {
            claude: [{ id: bundledClaude.id, label: 'Whatever', description: 'CLI text', efforts: ['low', 'high'], fastMode: false }],
        });
        const entry = catalog.models.find((model) => model.id === bundledClaude.id)!;
        expect(entry).toMatchObject({ label: bundledClaude.label, descriptionTranslations: bundledClaude.descriptionTranslations, efforts: ['high', 'low'], status: 'active' });
        expect(entry.fastMode).toBeUndefined();
    });

    it('adds models the bundled catalog does not know, in the CLI order', () => {
        const listed: CliModel[] = [
            { id: 'claude-new-9', label: 'New 9', description: 'Brand new', efforts: ['low', 'max', 'ultra'], fastMode: true },
            { id: bundledClaude.id, label: 'x', efforts: [] },
        ];
        const catalog = applyCliModels(BUNDLED_MODEL_CATALOG, { claude: listed });
        const claude = catalog.models.filter((model) => model.agent === 'claude' && model.status === 'active');
        expect(claude.map((model) => model.id)).toEqual(['claude-new-9', bundledClaude.id]);
        expect(claude[0]).toMatchObject({ displayName: 'Claude New 9', efforts: ['max', 'low'], fastMode: true, contextWindow: 200_000 });
    });

    it('retires models the CLI no longer lists and leaves other agents alone', () => {
        const catalog = applyCliModels(BUNDLED_MODEL_CATALOG, { codex: [{ id: 'gpt-x', label: 'GPT-X', efforts: ['medium'] }] });
        const codex = catalog.models.filter((model) => model.agent === 'codex');
        expect(codex.filter((model) => model.status === 'active').map((model) => model.id)).toEqual(['gpt-x']);
        expect(codex.length).toBe(BUNDLED_MODEL_CATALOG.models.filter((model) => model.agent === 'codex').length + 1);
        expect(catalog.models.filter((model) => model.agent === 'claude')).toEqual(BUNDLED_MODEL_CATALOG.models.filter((model) => model.agent === 'claude'));
    });

    it('gives Gemini models no efforts and keeps the base for empty lists', () => {
        const catalog = applyCliModels(BUNDLED_MODEL_CATALOG, { gemini: [{ id: 'gemini-9', label: 'gemini-9', efforts: ['high'] }], codex: [] });
        expect(catalog.models.find((model) => model.id === 'gemini-9')?.efforts).toEqual([]);
        expect(applyCliModels(BUNDLED_MODEL_CATALOG, { codex: [] })).toBe(BUNDLED_MODEL_CATALOG);
    });
});

describe('dated Claude ids', () => {
    it('match the undated catalog entry', () => {
        const catalog = applyCliModels(BUNDLED_MODEL_CATALOG, { claude: [{ id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5', efforts: [] }] });
        expect(catalog.models.filter((model) => model.agent === 'claude' && model.status === 'active').map((model) => model.id)).toEqual(['claude-haiku-4-5']);
    });
});

describe('mergeCliModels', () => {
    it('unions models across machines', () => {
        const merged = mergeCliModels([
            [{ id: 'a', label: 'A', efforts: ['low'] }],
            [{ id: 'b', label: 'B', efforts: [] }, { id: 'a', label: 'A', efforts: ['high'], fastMode: true }],
        ]);
        expect(merged).toEqual([{ id: 'a', label: 'A', efforts: ['low', 'high'], fastMode: true }, { id: 'b', label: 'B', efforts: [] }]);
    });
});

describe('cliModelModes', () => {
    it('builds the modes each agent takes', () => {
        const models: CliModel[] = [{ id: 'm', label: 'M', efforts: ['high', 'low'] }, { id: 'n', label: 'N', efforts: [] }];
        expect(cliModelModes('claude', models)).toEqual(['default', 'm', 'm-low', 'm-high', 'n']);
        expect(cliModelModes('codex', models)).toEqual(['default', 'm-low', 'm-high', 'n']);
        expect(cliModelModes('gemini', models)).toEqual(['default', 'm', 'n']);
    });
});
