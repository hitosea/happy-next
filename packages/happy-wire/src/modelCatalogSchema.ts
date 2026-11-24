import * as z from 'zod';

export const AgentFlavorSchema = z.enum(['claude', 'codex', 'gemini', 'qoder', 'antigravity']);
export type AgentFlavor = z.infer<typeof AgentFlavorSchema>;

export const ReasoningEffortSchema = z.enum(['low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
export type ReasoningEffort = z.infer<typeof ReasoningEffortSchema>;

/** Rates in USD per million tokens. */
export const ModelPricingSchema = z.object({
    input: z.number().nonnegative(),
    output: z.number().nonnegative(),
    cacheWrite: z.number().nonnegative(),
    cacheRead: z.number().nonnegative(),
});
export type ModelPricing = z.infer<typeof ModelPricingSchema>;

export const ModelCatalogEntrySchema = z.object({
    /** Model id as passed to the agent CLI, e.g. `claude-opus-5` or `gpt-5.5`. */
    id: z.string().min(1),
    agent: AgentFlavorSchema,
    /**
     * `retired` models are hidden from pickers and rejected by `isModelMode`, but
     * keep their labels and context window so sessions created on them still resolve.
     */
    status: z.enum(['active', 'retired']),
    /** Picker label, e.g. `Opus 5`. */
    label: z.string().min(1),
    /** Compact picker label; defaults to `label`. */
    shortLabel: z.string().min(1).optional(),
    /** Label shown outside the picker, e.g. `Claude Opus 5`. */
    displayName: z.string().min(1),
    description: z.string().optional(),
    /**
     * `description` in other app languages, keyed by language code (e.g. `zh-Hans`).
     * Languages without an entry show `description`.
     */
    descriptionTranslations: z.record(z.string(), z.string()).optional(),
    /**
     * Supported reasoning efforts, strongest first (picker order). Empty when the
     * model has no effort control. Claude and Codex modes are `${id}-${effort}`.
     */
    efforts: z.array(ReasoningEffortSchema),
    contextWindow: z.number().int().positive(),
    /** Claude fast mode (`-fast` model suffix). */
    fastMode: z.boolean().optional(),
    pricing: ModelPricingSchema.optional(),
    fastPricing: ModelPricingSchema.optional(),
});
export type ModelCatalogEntry = z.infer<typeof ModelCatalogEntrySchema>;

export const ModelCatalogSchema = z.object({
    schemaVersion: z.literal(1),
    /** Codex CLI pinned by happy-cli; run as `${package}@${version}` unless HAPPY_CODEX_PACKAGE overrides it. */
    codexCli: z.object({
        package: z.string().min(1),
        /** Exact version, so a matching `codex` on PATH can be used instead of npx. */
        version: z.string().regex(/^\d+\.\d+\.\d+(?:-[\w.]+)?$/, 'Expected an exact version like 0.155.1'),
    }),
    /**
     * Unused. Clients from before it was dropped require it and reject a catalog
     * without it, so it stays in the published file until they are gone.
     */
    effortDescriptions: z.object({
        low: z.string(),
        medium: z.string(),
        high: z.string(),
        xhigh: z.string(),
        max: z.string(),
        ultra: z.string(),
    }).optional(),
    models: z.array(ModelCatalogEntrySchema),
}).superRefine((catalog, ctx) => {
    const seen = new Set<string>();
    catalog.models.forEach((model, index) => {
        const issue = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['models', index], message });
        if (seen.has(model.id)) issue(`Duplicate model id "${model.id}"`);
        seen.add(model.id);
        if (new Set(model.efforts).size !== model.efforts.length) issue(`Duplicate effort in "${model.id}"`);
        if (model.status === 'active' && model.description === undefined) issue(`Active model "${model.id}" needs a description`);
        if (model.agent === 'claude' && model.efforts.includes('ultra')) issue(`Claude model "${model.id}" cannot use the ultra effort`);
        if (model.agent === 'gemini' && model.efforts.length > 0) issue(`Gemini model "${model.id}" has no effort control`);
        if (model.agent !== 'claude' && model.fastMode) issue(`Fast mode applies only to Claude models ("${model.id}")`);
        if (model.fastPricing && !model.fastMode) issue(`fastPricing needs fastMode ("${model.id}")`);
    });
});
export type ModelCatalog = z.infer<typeof ModelCatalogSchema>;
