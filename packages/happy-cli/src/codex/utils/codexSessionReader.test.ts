import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('listCodexSessions', () => {
  let tempRoot: string;
  let happyHomeDir: string;
  let codexHomeDir: string;
  let oldHappyHomeDir: string | undefined;
  let oldCodexHomeDir: string | undefined;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'codex-session-reader-'));
    happyHomeDir = join(tempRoot, 'happy-home');
    codexHomeDir = join(tempRoot, 'codex-home');
    mkdirSync(happyHomeDir, { recursive: true });
    mkdirSync(codexHomeDir, { recursive: true });

    oldHappyHomeDir = process.env.HAPPY_HOME_DIR;
    oldCodexHomeDir = process.env.CODEX_HOME;
    process.env.HAPPY_HOME_DIR = happyHomeDir;
    process.env.CODEX_HOME = codexHomeDir;
  });

  afterEach(() => {
    if (oldHappyHomeDir === undefined) {
      delete process.env.HAPPY_HOME_DIR;
    } else {
      process.env.HAPPY_HOME_DIR = oldHappyHomeDir;
    }

    if (oldCodexHomeDir === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = oldCodexHomeDir;
    }

    vi.resetModules();
    if (tempRoot && existsSync(tempRoot)) {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('lists codex sessions and writes cache metadata', async () => {
    const sessionUuid = '11111111-2222-3333-4444-555555555555';
    const codexSessionsDir = join(codexHomeDir, 'sessions', '2026', '03', '11');
    mkdirSync(codexSessionsDir, { recursive: true });
    const filePath = join(codexSessionsDir, `rollout-2026-03-11T000000-${sessionUuid}.jsonl`);

    const lines = [
      {
        type: 'session_meta',
        payload: {
          id: sessionUuid,
          cwd: '/workspace/happy',
          git: { branch: 'main' },
          timestamp: '2026-03-11T00:00:00.000Z',
        },
        timestamp: '2026-03-11T00:00:00.000Z',
      },
      {
        type: 'response_item',
        payload: {
          role: 'user',
          content: [{ type: 'input_text', text: 'Please optimize Codex session listing speed' }],
        },
        timestamp: '2026-03-11T00:00:01.000Z',
      },
      {
        type: 'response_item',
        payload: {
          role: 'assistant',
          content: [{ type: 'output_text', text: 'Working on it' }],
        },
        timestamp: '2026-03-11T00:00:02.000Z',
      },
    ];
    writeFileSync(filePath, lines.map((line) => JSON.stringify(line)).join('\n') + '\n');

    vi.resetModules();
    const { listCodexSessions } = await import('./codexSessionReader');

    const sessions = await listCodexSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].sessionId).toBe('555555');
    expect(sessions[0].sessionFile).toBe(filePath);
    expect(sessions[0].originalPath).toBe('/workspace/happy');
    expect(sessions[0].title).toBe('Please optimize Codex session listing speed');
    // user + assistant messages, matching what the preview shows
    expect(sessions[0].messageCount).toBe(2);
    expect(sessions[0].gitBranch).toBe('main');

    const cachePath = join(happyHomeDir, 'codex-session-metadata-cache.json');
    expect(existsSync(cachePath)).toBe(true);
    const cache = JSON.parse(readFileSync(cachePath, 'utf8'));
    expect(cache.entries[filePath].sessionId).toBe('555555');
    expect(cache.lastRun.filesProcessed).toBe(1);
    expect(cache.lastRun.filesReparsed).toBe(1);
    expect(cache.lastRun.resultCount).toBe(1);
  });

  it.each([false, true])(
    'keeps cross-directory sessions scoped to metadata (selectMostRecent=%s)',
    async (selectMostRecent) => {
      const sessionUuid = '11111111-2222-3333-4444-555555555555';
      const sessionsDir = join(codexHomeDir, 'sessions');
      mkdirSync(sessionsDir, { recursive: true });
      const filePath = join(sessionsDir, `rollout-2026-03-11T000000-${sessionUuid}.jsonl`);
      const originalCwd = join(tempRoot, 'original');
      const latestCwd = join(tempRoot, 'latest');
      const records = [
        { type: 'session_meta', payload: { id: sessionUuid, cwd: originalCwd } },
        { type: 'response_item', payload: {
          role: 'user', content: [{ type: 'input_text', text: 'Continue in another directory' }],
        } },
        { type: 'turn_context', payload: { cwd: join(tempRoot, 'intermediate') } },
        { type: 'turn_context', payload: { cwd: latestCwd } },
      ];
      writeFileSync(filePath, records.map(record => JSON.stringify(record)).join('\n') + '\n');

      vi.resetModules();
      const { listCodexSessions } = await import('./codexSessionReader');
      const { resolveCodexResumeFile } = await import('../cli');
      const { readCodexResumeDirectory } = await import('../resumeDirectory');
      const invocation = { kind: 'resume' as const, includeAllDirectories: false, selectMostRecent };

      // Exercise both a fresh index and its cached representation.
      for (let pass = 0; pass < 2; pass++) {
        const sessions = await listCodexSessions();
        expect(sessions).toHaveLength(1);
        expect(sessions[0].originalPath).toBe(originalCwd);
        const cache = JSON.parse(readFileSync(join(happyHomeDir, 'codex-session-metadata-cache.json'), 'utf8'));
        expect(cache.entries[filePath].originalPath).toBe(originalCwd);

        const selectSession = vi.fn(async () => sessions[0]);
        const dependencies = {
          findSessionFile: () => filePath,
          listSessions: async () => sessions,
          isInteractive: () => true,
          selectSession,
        };
        await expect(resolveCodexResumeFile(invocation, originalCwd, dependencies)).resolves.toBe(filePath);
        if (selectMostRecent) {
          expect(selectSession).not.toHaveBeenCalled();
        } else {
          expect(selectSession).toHaveBeenCalledWith(sessions);
        }
        selectSession.mockClear();
        await expect(resolveCodexResumeFile(invocation, latestCwd, dependencies))
          .rejects.toThrow('No resumable Codex session found');
        expect(selectSession).not.toHaveBeenCalled();
        await expect(resolveCodexResumeFile(
          { ...invocation, includeAllDirectories: true }, latestCwd, dependencies,
        )).resolves.toBe(filePath);
        await expect(resolveCodexResumeFile(
          { ...invocation, sessionId: sessions[0].sessionId }, latestCwd, dependencies,
        )).resolves.toBe(filePath);
      }

      // List membership does not determine the working directory used after selection.
      expect(await readCodexResumeDirectory(filePath)).toBe(latestCwd);
    },
  );

  it('keeps user messages on both sides of a compacted record', async () => {
    const sessionUuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const codexSessionsDir = join(codexHomeDir, 'sessions', '2026', '03', '12');
    mkdirSync(codexSessionsDir, { recursive: true });
    const filePath = join(codexSessionsDir, `rollout-2026-03-12T000000-${sessionUuid}.jsonl`);
    const lines = [
      { type: 'response_item', payload: { role: 'user', content: [{ type: 'input_text', text: 'before compact' }] }, timestamp: '2026-03-12T00:00:01.000Z' },
      { type: 'compacted', payload: { message: 'summary' }, timestamp: '2026-03-12T00:00:02.000Z' },
      { type: 'response_item', payload: { role: 'user', content: [{ type: 'input_text', text: 'after compact' }] }, timestamp: '2026-03-12T00:00:03.000Z' },
    ];
    writeFileSync(filePath, lines.map((line) => JSON.stringify(line)).join('\n') + '\n');

    vi.resetModules();
    const { readAllCodexSessionUserMessages } = await import('./codexSessionReader');
    const messages = await readAllCodexSessionUserMessages(sessionUuid);
    expect(messages.map((message) => message.content)).toEqual(['before compact', 'after compact']);
  });

  function createHistorySnapshot() {
    const parentId = '11111111-2222-4333-8444-555555555555';
    const forkId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const sessions = join(codexHomeDir, 'sessions');
    mkdirSync(sessions, { recursive: true });
    const parentPath = join(sessions, `rollout-2026-09-01T00-00-00-${parentId}.jsonl`);
    const forkPath = join(sessions, `rollout-2026-09-01T00-01-00-${forkId}.jsonl`);
    const user = (text: string, ordinal: number) => ({ type: 'response_item', ordinal, timestamp: '2026-09-01T00:00:00.000Z', payload: { role: 'user', content: [{ type: 'input_text', text }] } });
    const prefix = [
      { type: 'session_meta', ordinal: 0, payload: { id: parentId, history_mode: 'paginated' } },
      user('Question with multibyte text: \u4e2d\u6587', 1),
    ].map(row => JSON.stringify(row)).join('\n') + '\n';
    writeFileSync(parentPath, prefix + JSON.stringify(user('Later parent message', 2)) + '\n');
    const forkMeta = {
      type: 'session_meta', ordinal: 0,
      payload: { id: forkId, history_mode: 'paginated', history_base: { thread_id: parentId, end_byte_offset: Buffer.byteLength(prefix), end_ordinal_exclusive: 2 } },
    };
    writeFileSync(forkPath, [forkMeta, user('Fork question', 1)].map(row => JSON.stringify(row)).join('\n') + '\n');
    return { parentId, forkId, parentPath, forkPath, forkMeta, user };
  }

  it('reads a paginated parent at its byte snapshot boundary and preserves the fork identity', async () => {
    const fixture = createHistorySnapshot();
    const { readCodexSessionContent, readAllCodexSessionUserMessages } = await import('./codexSessionReader');
    const content = await readCodexSessionContent(fixture.forkPath);
    expect(JSON.parse(content.split('\n')[0]).payload.id).toBe(fixture.forkId);
    expect(content).not.toContain('Later parent message');
    const messages = await readAllCodexSessionUserMessages(fixture.forkId);
    expect(messages.map(message => message.content)).toEqual(['Question with multibyte text: \u4e2d\u6587', 'Fork question']);
    expect(messages[0].uuid).toBe((await readAllCodexSessionUserMessages(fixture.parentId))[0].uuid);
  });

  it('resolves nested forks without including later updates to either parent', async () => {
    const fixture = createHistorySnapshot();
    const secondId = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
    const secondPath = join(codexHomeDir, 'sessions', `rollout-2026-09-01T00-02-00-${secondId}.jsonl`);
    const snapshotLength = readFileSync(fixture.forkPath).length;
    writeFileSync(fixture.forkPath, readFileSync(fixture.forkPath, 'utf-8') + JSON.stringify(fixture.user('Later fork message', 2)) + '\n');
    writeFileSync(secondPath, JSON.stringify({
      ...fixture.forkMeta,
      payload: { ...fixture.forkMeta.payload, id: secondId, history_base: { thread_id: fixture.forkId, end_byte_offset: snapshotLength } },
    }) + '\n');
    const { readAllCodexSessionUserMessages } = await import('./codexSessionReader');
    expect((await readAllCodexSessionUserMessages(secondId)).map(message => message.content)).toEqual(['Question with multibyte text: \u4e2d\u6587', 'Fork question']);
  });

  it('can read inherited history after the parent was archived', async () => {
    const fixture = createHistorySnapshot();
    const archive = join(codexHomeDir, 'archived_sessions');
    mkdirSync(archive);
    renameSync(fixture.parentPath, join(archive, `rollout-2026-09-01T00-00-00-${fixture.parentId}.jsonl`));
    const { readAllCodexSessionUserMessages } = await import('./codexSessionReader');
    expect(await readAllCodexSessionUserMessages(fixture.forkId)).toHaveLength(2);
  });

  it('reads the messages of an archived session so a fork target can be picked', async () => {
    const fixture = createHistorySnapshot();
    const { readAllCodexSessionUserMessages } = await import('./codexSessionReader');
    const live = await readAllCodexSessionUserMessages(fixture.parentId);
    const archive = join(codexHomeDir, 'archived_sessions');
    mkdirSync(archive);
    renameSync(fixture.parentPath, join(archive, `rollout-2026-09-01T00-00-00-${fixture.parentId}.jsonl`));
    expect(await readAllCodexSessionUserMessages(fixture.parentId)).toEqual(live);
  });

  it('rejects cyclic ancestry instead of looping', async () => {
    const fixture = createHistorySnapshot();
    const metadata = { ...fixture.forkMeta, payload: { ...fixture.forkMeta.payload, history_base: { thread_id: fixture.forkId, end_byte_offset: 0 } } };
    writeFileSync(fixture.forkPath, JSON.stringify(metadata) + '\n');
    const { readCodexSessionContent } = await import('./codexSessionReader');
    await expect(readCodexSessionContent(fixture.forkPath)).rejects.toThrow('ancestry');
  });

  it('rejects a truncated parent snapshot rather than returning incomplete history', async () => {
    const fixture = createHistorySnapshot();
    writeFileSync(fixture.parentPath, '');
    const { readCodexSessionContent } = await import('./codexSessionReader');
    await expect(readCodexSessionContent(fixture.forkPath)).rejects.toThrow('incomplete');
  });

  it('does not expand ancestry for legacy forks that already contain copied history', async () => {
    const fixture = createHistorySnapshot();
    writeFileSync(fixture.forkPath, [
      { ...fixture.forkMeta, payload: { id: fixture.forkId, history_mode: 'legacy', forked_from_id: fixture.parentId } },
      fixture.user('Already copied message', 1),
    ].map(row => JSON.stringify(row)).join('\n') + '\n');
    const { readAllCodexSessionUserMessages } = await import('./codexSessionReader');
    expect((await readAllCodexSessionUserMessages(fixture.forkId)).map(message => message.content)).toEqual(['Already copied message']);
  });

  it('rejects a snapshot boundary in the middle of a record', async () => {
    const fixture = createHistorySnapshot();
    fixture.forkMeta.payload.history_base.end_byte_offset--;
    writeFileSync(fixture.forkPath, JSON.stringify(fixture.forkMeta) + '\n');
    const { readCodexSessionContent } = await import('./codexSessionReader');
    await expect(readCodexSessionContent(fixture.forkPath)).rejects.toThrow('record boundary');
  });

  it('rejects missing parent history rather than silently returning only local fork messages', async () => {
    const fixture = createHistorySnapshot();
    rmSync(fixture.parentPath);
    const { readCodexSessionContent } = await import('./codexSessionReader');
    await expect(readCodexSessionContent(fixture.forkPath)).rejects.toThrow('parent history not found');
  });
});

describe('readCodexSessionIdFromFile', () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'codex-session-id-'));
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('reads the id from session_meta', async () => {
    const filePath = join(tempRoot, 'rollout-2026-10-28T05-06-31-11111111-1111-1111-1111-111111111111.jsonl');
    writeFileSync(filePath, [
      JSON.stringify({ type: 'session_meta', payload: { id: '01a17bf0-58ec-75e3-a24b-592f97316664', base_instructions: 'x'.repeat(200_000) } }),
      JSON.stringify({ type: 'response_item', payload: { role: 'user', content: [{ type: 'input_text', text: 'hi' }] } }),
    ].join('\n') + '\n');
    const { readCodexSessionIdFromFile } = await import('./codexSessionReader');
    expect(await readCodexSessionIdFromFile(filePath)).toBe('01a17bf0-58ec-75e3-a24b-592f97316664');
  });

  it('falls back to the id in the file name when session_meta has none', async () => {
    const filePath = join(tempRoot, 'rollout-2026-10-28T05-06-31-22222222-2222-2222-2222-222222222222.jsonl');
    writeFileSync(filePath, 'not json\n');
    const { readCodexSessionIdFromFile } = await import('./codexSessionReader');
    expect(await readCodexSessionIdFromFile(filePath)).toBe('22222222-2222-2222-2222-222222222222');
  });

  it('falls back to the file name when the file is missing', async () => {
    const { readCodexSessionIdFromFile } = await import('./codexSessionReader');
    expect(await readCodexSessionIdFromFile(join(tempRoot, 'rollout-x-33333333-3333-3333-3333-333333333333.jsonl')))
      .toBe('33333333-3333-3333-3333-333333333333');
    expect(await readCodexSessionIdFromFile(join(tempRoot, 'missing.jsonl'))).toBeNull();
  });
});
