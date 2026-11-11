import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync, statSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('listClaudeSessionsFromIndex', () => {
    let tempRoot: string;
    let claudeConfigDir: string;
    let happyHomeDir: string;
    let oldClaudeConfigDir: string | undefined;
    let oldHappyHomeDir: string | undefined;

    beforeEach(() => {
        tempRoot = mkdtempSync(join(tmpdir(), 'claude-session-index-'));
        claudeConfigDir = join(tempRoot, 'claude');
        happyHomeDir = join(tempRoot, 'happy-home');

        mkdirSync(join(claudeConfigDir, 'projects'), { recursive: true });
        mkdirSync(happyHomeDir, { recursive: true });

        oldClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR;
        oldHappyHomeDir = process.env.HAPPY_HOME_DIR;

        process.env.CLAUDE_CONFIG_DIR = claudeConfigDir;
        process.env.HAPPY_HOME_DIR = happyHomeDir;
    });

    afterEach(() => {
        if (oldClaudeConfigDir === undefined) {
            delete process.env.CLAUDE_CONFIG_DIR;
        } else {
            process.env.CLAUDE_CONFIG_DIR = oldClaudeConfigDir;
        }

        if (oldHappyHomeDir === undefined) {
            delete process.env.HAPPY_HOME_DIR;
        } else {
            process.env.HAPPY_HOME_DIR = oldHappyHomeDir;
        }

        vi.restoreAllMocks();
        vi.resetModules();
        if (tempRoot && existsSync(tempRoot)) {
            rmSync(tempRoot, { recursive: true, force: true });
        }
    });

    it('uses summary records from JSONL when sessions-index title is missing', async () => {
        const projectId = 'project-summary';
        const projectDir = join(claudeConfigDir, 'projects', projectId);
        mkdirSync(projectDir, { recursive: true });

        writeFileSync(
            join(projectDir, 'sessions-index.json'),
            JSON.stringify({
                originalPath: '/repo/work',
                entries: [{ sessionId: 'session-a' }]
            })
        );

        const jsonlLines = [
            { type: 'user', uuid: 'u1', parentUuid: null, isSidechain: false, timestamp: '2026-03-10T10:00:00.000Z', message: { content: [{ type: 'text', text: 'Initial request' }] } },
            { type: 'assistant', uuid: 'a1', parentUuid: 'u1', timestamp: '2026-03-10T10:01:00.000Z', message: { content: [{ type: 'text', text: 'Answer' }] } },
            { type: 'user', uuid: 'u2', parentUuid: 'a1', timestamp: '2026-03-10T10:02:00.000Z', message: { content: [{ type: 'text', text: 'Follow up' }] } },
            { type: 'summary', leafUuid: 'u2', summary: 'Session summary from file' }
        ];
        writeFileSync(
            join(projectDir, 'session-a.jsonl'),
            jsonlLines.map((line) => JSON.stringify(line)).join('\n') + '\n'
        );

        vi.resetModules();
        const { listClaudeSessionsFromIndex } = await import('./claudeSessionIndex');
        const sessions = await listClaudeSessionsFromIndex();

        expect(sessions).toHaveLength(1);
        expect(sessions[0].title).toBe('Session summary from file');
        expect(sessions[0].messageCount).toBe(3);

        const cachePath = join(happyHomeDir, 'claude-session-metadata-cache.json');
        expect(existsSync(cachePath)).toBe(true);
        const cache = JSON.parse(readFileSync(cachePath, 'utf8'));
        expect(cache.lastRun.filesProcessed).toBe(1);
        expect(cache.lastRun.filesReparsed).toBe(1);
        expect(cache.lastRun.resultCount).toBe(1);
        expect(cache.lastRun.extra.indexFilesRead).toBe(1);
    });

    it('uses Claude’s own ai-title for the list, and a rename on top of it', async () => {
        const projectId = 'project-ai-title';
        const projectDir = join(claudeConfigDir, 'projects', projectId);
        mkdirSync(projectDir, { recursive: true });

        writeFileSync(
            join(projectDir, 'sessions-index.json'),
            JSON.stringify({ originalPath: '/repo/work', entries: [{ sessionId: 'session-ai' }] })
        );

        const lines = [
            { type: 'user', uuid: 'u1', parentUuid: null, isSidechain: false, timestamp: '2026-03-10T10:00:00.000Z', message: { content: [{ type: 'text', text: 'Fix the login flow' }] } },
            { type: 'ai-title', aiTitle: 'Login flow repair', sessionId: 'session-ai' },
        ];
        const path = join(projectDir, 'session-ai.jsonl');
        writeFileSync(path, lines.map((line) => JSON.stringify(line)).join('\n') + '\n');

        vi.resetModules();
        const { listClaudeSessionsFromIndex } = await import('./claudeSessionIndex');
        const sessions = await listClaudeSessionsFromIndex();
        expect(sessions[0].title).toBe('Login flow repair');

        writeFileSync(path, [...lines, { type: 'custom-title', customTitle: 'Auth rewrite', sessionId: 'session-ai' }]
            .map((line) => JSON.stringify(line)).join('\n') + '\n');
        const reparsed = await listClaudeSessionsFromIndex();
        expect(reparsed[0].title).toBe('Auth rewrite');
    });

    it('keeps user messages on both sides of a compaction summary available for fork resolution', async () => {
        const projectId = 'project-compacted';
        const projectDir = join(claudeConfigDir, 'projects', projectId);
        mkdirSync(projectDir, { recursive: true });
        const lines = [
            { type: 'user', uuid: 'before', timestamp: '2026-03-10T10:00:00.000Z', message: { role: 'user', content: [{ type: 'text', text: 'before compact' }] } },
            { type: 'assistant', uuid: 'answer', timestamp: '2026-03-10T10:01:00.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'answer' }] } },
            { type: 'summary', leafUuid: 'answer', summary: 'compacted context' },
            { type: 'user', uuid: 'after', timestamp: '2026-03-10T10:02:00.000Z', message: { role: 'user', content: [{ type: 'text', text: 'after compact' }] } },
        ];
        writeFileSync(join(projectDir, 'session-compacted.jsonl'), lines.map((line) => JSON.stringify(line)).join('\n') + '\n');

        vi.resetModules();
        const { readAllClaudeSessionUserMessages } = await import('./claudeSessionIndex');
        const messages = await readAllClaudeSessionUserMessages(projectId, 'session-compacted');
        expect(messages.map((message) => message.uuid)).toEqual(['before', 'after']);
    });

    it('lists only the prompts the user sent, as they typed them', async () => {
        const projectId = 'project-prompts';
        const projectDir = join(claudeConfigDir, 'projects', projectId);
        mkdirSync(projectDir, { recursive: true });
        const user = (uuid: string, content: unknown, extra: object = {}) => ({ type: 'user', uuid, timestamp: '2026-03-10T10:00:00.000Z', message: { role: 'user', content }, ...extra });
        const lines = [
            user('typed', 'Fix the build\n\n<attached-files>\nThe user attached these files to this message. Read them as needed:\n- /tmp/a.png\n</attached-files>'),
            user('image-note', [{ type: 'text', text: '[Image: source: /tmp/claude/images/1.png]' }], { isMeta: true }),
            user('callback', '<orchestrator-callback>\nRun "x" reached terminal state: completed.\n</orchestrator-callback>'),
            user('notification', '<task-notification>done</task-notification>'),
            user('interrupted', [{ type: 'text', text: '[Request interrupted by user]' }]),
            user('summary', 'This session is being continued from a previous conversation.', { isCompactSummary: true }),
            user('skill', [{ type: 'text', text: 'Base directory for this skill: /skills/run' }]),
            user('tool', [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }]),
            user('subagent', 'Explore the repo', { isSidechain: true }),
            user('command', '<command-name>/model</command-name>\n            <command-message>model</command-message>\n            <command-args>opus</command-args>'),
            user('caveat', '<local-command-caveat>The command below was run directly in Claude Code.</local-command-caveat>', { isMeta: true }),
            user('output', '<local-command-stdout>Set model to opus</local-command-stdout>'),
        ];
        writeFileSync(join(projectDir, 'session-prompts.jsonl'), lines.map((line) => JSON.stringify(line)).join('\n') + '\n');

        vi.resetModules();
        const { readAllClaudeSessionUserMessages } = await import('./claudeSessionIndex');
        const messages = await readAllClaudeSessionUserMessages(projectId, 'session-prompts');
        expect(messages.map(({ uuid, content, index }) => ({ uuid, content, index }))).toEqual([
            { uuid: 'typed', content: 'Fix the build', index: 0 },
            { uuid: 'command', content: '/model opus', index: 1 },
        ]);
    });

    it('falls back to first meaningful user message when no summary exists', async () => {
        const projectId = 'project-fallback';
        const projectDir = join(claudeConfigDir, 'projects', projectId);
        mkdirSync(projectDir, { recursive: true });

        writeFileSync(
            join(projectDir, 'sessions-index.json'),
            JSON.stringify({
                originalPath: '/repo/another',
                entries: [{ sessionId: 'session-b' }]
            })
        );

        const jsonlLines = [
            {
                type: 'user',
                uuid: 'u1',
                parentUuid: null,
                isMeta: true,
                isSidechain: false,
                timestamp: '2026-03-10T09:00:00.000Z',
                message: { content: [{ type: 'text', text: 'This session is being continued with the conversation from before' }] }
            },
            { type: 'assistant', uuid: 'a1', parentUuid: 'u1', timestamp: '2026-03-10T09:01:00.000Z', message: { content: [{ type: 'text', text: 'system info' }] } },
            {
                type: 'user',
                uuid: 'u2',
                parentUuid: 'a1',
                timestamp: '2026-03-10T09:02:00.000Z',
                message: { content: [{ type: 'text', text: '<ide_context>ignored' }] }
            },
            { type: 'assistant', uuid: 'a2', parentUuid: 'u2', timestamp: '2026-03-10T09:03:00.000Z', message: { content: [{ type: 'text', text: 'reply' }] } },
            {
                type: 'user',
                uuid: 'u3',
                parentUuid: 'a2',
                timestamp: '2026-03-10T09:04:00.000Z',
                message: { content: [{ type: 'text', text: 'Need help optimizing list loading performance for session history' }] }
            }
        ];
        writeFileSync(
            join(projectDir, 'session-b.jsonl'),
            jsonlLines.map((line) => JSON.stringify(line)).join('\n') + '\n'
        );

        vi.resetModules();
        const { listClaudeSessionsFromIndex } = await import('./claudeSessionIndex');
        const sessions = await listClaudeSessionsFromIndex();

        expect(sessions).toHaveLength(1);
        expect(sessions[0].title).toBe('Need help optimizing list loading performance for session history');
        expect(sessions[0].messageCount).toBe(5);

        const cachePath = join(happyHomeDir, 'claude-session-metadata-cache.json');
        const cache = JSON.parse(readFileSync(cachePath, 'utf8'));
        expect(cache.entries[`${projectId}:session-b`].titleExtracted).toBe(true);
        expect(cache.lastRun.filesProcessed).toBe(1);
        expect(cache.lastRun.filesReparsed).toBe(1);
    });

    it('does not reparse unchanged file when updatedAt/gitBranch are already extracted as missing', async () => {
        const projectId = 'project-no-metadata';
        const projectDir = join(claudeConfigDir, 'projects', projectId);
        mkdirSync(projectDir, { recursive: true });

        writeFileSync(
            join(projectDir, 'sessions-index.json'),
            JSON.stringify({
                originalPath: '/repo/no-meta',
                entries: [{ sessionId: 'session-c', title: 'Indexed title', messageCount: 1 }]
            })
        );

        const jsonlLines = [
            {
                type: 'user',
                uuid: 'u1',
                parentUuid: null,
                isMeta: false,
                isSidechain: false,
                message: { content: [{ type: 'text', text: 'Hello without timestamp and branch' }] }
            },
            {
                type: 'assistant',
                uuid: 'a1',
                parentUuid: 'u1',
                message: { content: [{ type: 'text', text: 'Ack' }] }
            }
        ];
        writeFileSync(
            join(projectDir, 'session-c.jsonl'),
            jsonlLines.map((line) => JSON.stringify(line)).join('\n') + '\n'
        );

        vi.resetModules();
        const { listClaudeSessionsFromIndex } = await import('./claudeSessionIndex');
        await listClaudeSessionsFromIndex();

        const cachePath = join(happyHomeDir, 'claude-session-metadata-cache.json');
        const firstWriteMtimeMs = statSync(cachePath).mtimeMs;
        const firstCache = JSON.parse(readFileSync(cachePath, 'utf8'));
        const firstEntry = firstCache.entries[`${projectId}:session-c`];
        expect(firstEntry.updatedAtExtracted).toBe(true);
        expect(firstEntry.gitBranchExtracted).toBe(true);
        expect(firstEntry.updatedAt).toBeUndefined();
        expect(firstEntry.gitBranch).toBeNull();

        await new Promise((resolve) => setTimeout(resolve, 25));
        await listClaudeSessionsFromIndex();

        const secondWriteMtimeMs = statSync(cachePath).mtimeMs;
        expect(secondWriteMtimeMs).toBe(firstWriteMtimeMs);
    });

    it('finds the most recently modified transcript when several projects hold the same session', async () => {
        const write = (projectId: string, mtimeSeconds: number) => {
            const projectDir = join(claudeConfigDir, 'projects', projectId);
            mkdirSync(projectDir, { recursive: true });
            const sessionPath = join(projectDir, 'session-moved.jsonl');
            writeFileSync(sessionPath, '{}\n');
            utimesSync(sessionPath, mtimeSeconds, mtimeSeconds);
        };
        write('-repo', 2_000);
        write('-repo--claude-worktrees-feature', 3_000);
        write('-repo-other', 1_000);

        const { findClaudeProjectId } = await import('./claudeSessionIndex');

        expect(await findClaudeProjectId('session-moved')).toBe('-repo--claude-worktrees-feature');
        expect(await findClaudeProjectId('session-missing')).toBeNull();
    });
});
