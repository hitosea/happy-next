import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readQoderContextUsage } from './contextUsage';

const assistant = (usage: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
    type: 'assistant',
    isSidechain: false,
    message: { model: 'auto', usage },
    ...extra,
});

describe('readQoderContextUsage', () => {
    let configDir: string;

    const writeTranscript = (records: unknown[]) => {
        const projectDir = join(configDir, 'projects', '-repo-work');
        mkdirSync(projectDir, { recursive: true });
        writeFileSync(join(projectDir, 'qoder-session.jsonl'), records.map((record) => JSON.stringify(record)).join('\n') + '\n');
    };

    beforeEach(() => {
        configDir = mkdtempSync(join(tmpdir(), 'qoder-context-'));
        vi.stubEnv('QODER_CONFIG_DIR', configDir);
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        rmSync(configDir, { recursive: true, force: true });
    });

    it('reads the latest main-chain request\'s input tokens and works the window out from its ratio', async () => {
        writeTranscript([
            assistant({ input_tokens: 9000, context_usage_ratio: 0.045 }),
            // As qodercli 1.1.86 recorded it with QODER_EXPOSE_TOKEN_USAGE=1
            assistant({ input_tokens: 18198, cache_read_input_tokens: 2304, output_tokens: 2, context_usage_ratio: 0.09099 }),
            assistant({ input_tokens: 500000, context_usage_ratio: 0.5 }, { isSidechain: true }),
            { type: 'user', message: { content: 'next' } },
        ]);

        expect(await readQoderContextUsage('qoder-session')).toEqual({ usedTokens: 18198, windowSize: 200000 });
    });

    it('estimates the tokens from the default Qoder window when the counts are zero', async () => {
        writeTranscript([assistant({ input_tokens: 0, output_tokens: 0, context_usage_ratio: 0.5 })]);

        expect(await readQoderContextUsage('qoder-session')).toEqual({ usedTokens: 100000, windowSize: 200000 });
    });

    it('returns null for a conversation without recorded usage, or none at all', async () => {
        writeTranscript([{ type: 'user', message: { content: 'hi' } }, assistant({})]);

        expect(await readQoderContextUsage('qoder-session')).toBeNull();
        expect(await readQoderContextUsage('missing-session')).toBeNull();
    });
});
