import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listClaudeSessionsFromIndex } from '@/claude/utils/claudeSessionIndex';
import { buildQoderFirstTurnPrompt } from './prompt';
import { qoderTranscriptStore, readAllQoderSessionUserMessages } from './transcripts';

describe('Qoder transcripts', () => {
    let tempRoot: string;

    beforeEach(() => {
        tempRoot = mkdtempSync(join(tmpdir(), 'qoder-transcripts-'));
        vi.stubEnv('QODER_CONFIG_DIR', join(tempRoot, 'qoder'));
        vi.stubEnv('HAPPY_HOME_DIR', join(tempRoot, 'happy-home'));
        mkdirSync(join(tempRoot, 'happy-home'), { recursive: true });

        const projectDir = join(tempRoot, 'qoder', 'projects', '-repo-work');
        mkdirSync(projectDir, { recursive: true });
        const firstPrompt = buildQoderFirstTurnPrompt({ userMessage: 'Fix the login bug', appendSystemPrompt: 'Happy guidance' });
        const lines = [
            { type: 'user', uuid: 'u1', parentUuid: null, cwd: '/repo/work', timestamp: '2026-10-10T10:00:00.000Z', message: { role: 'user', content: [{ type: 'text', text: firstPrompt }] } },
            { type: 'assistant', uuid: 'a1', parentUuid: 'u1', timestamp: '2026-10-10T10:01:00.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'Done' }] } },
            { type: 'user', uuid: 'u2', parentUuid: 'a1', timestamp: '2026-10-10T10:02:00.000Z', message: { role: 'user', content: [{ type: 'text', text: 'Thanks' }] } },
            { type: 'active-leaf', sessionId: 'qoder-session', leafUuid: 'u2', explicit: false, timestamp: 1791684120000 },
        ];
        writeFileSync(join(projectDir, 'qoder-session.jsonl'), lines.map((line) => JSON.stringify(line)).join('\n') + '\n');
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        rmSync(tempRoot, { recursive: true, force: true });
    });

    it('lists sessions from Qoder\'s directory, titled without Happy\'s session instructions', async () => {
        const sessions = await listClaudeSessionsFromIndex(qoderTranscriptStore());

        expect(sessions).toEqual([expect.objectContaining({
            sessionId: 'qoder-session',
            originalPath: '/repo/work',
            title: 'Fix the login bug',
            messageCount: 3,
        })]);
    });

    it('reads user messages without Happy\'s session instructions', async () => {
        const messages = await readAllQoderSessionUserMessages('qoder-session');

        expect(messages.map((message) => [message.uuid, message.content])).toEqual([['u1', 'Fix the login bug'], ['u2', 'Thanks']]);
    });
});
