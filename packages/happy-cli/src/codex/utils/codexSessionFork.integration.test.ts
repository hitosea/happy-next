import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { forkAndTruncateCodexSession, forkCodexSession } from './codexSessionFork';
import { generateStableUuid, getCodexSessionPreview, listCodexSessions, readAllCodexSessionUserMessages } from './codexSessionReader';
import { backfillCodexSessionHistory } from './codexBackfill';
import { CodexAppServerBackend } from '../appserver/CodexAppServerBackend';
import { CODEX_PACKAGE } from '../package';

vi.mock('@/configuration', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/configuration')>();
  return {
    ...actual,
    configuration: {
      ...actual.configuration,
      get happyHomeDir() { return process.env.HAPPY_HOME_DIR ?? actual.configuration.happyHomeDir; },
    },
  };
});

// Real app-server, isolated history and an unreachable fixture provider. No model turns are started.
describe('native Codex forks', () => {
  let home: string;
  let originalCodexHome: string | undefined;
  let originalHappyHome: string | undefined;
  let backend: CodexAppServerBackend | undefined;
  const timestamp = '2026-09-01T00:00:00.000Z';

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'happy-native-codex-fork-'));
    originalCodexHome = process.env.CODEX_HOME;
    originalHappyHome = process.env.HAPPY_HOME_DIR;
    process.env.CODEX_HOME = home;
    process.env.HAPPY_HOME_DIR = join(home, 'happy');
    await mkdir(join(home, 'sessions'));
    await writeFile(join(home, 'config.toml'), [
      'model = "fixture-model"',
      'model_provider = "fixture"',
      '[model_providers.fixture]',
      'name = "fixture"',
      'base_url = "http://127.0.0.1:9"',
      'wire_api = "responses"',
    ].join('\n'));
  });

  afterEach(async () => {
    await backend?.dispose();
    backend = undefined;
    if (originalCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = originalCodexHome;
    if (originalHappyHome === undefined) delete process.env.HAPPY_HOME_DIR;
    else process.env.HAPPY_HOME_DIR = originalHappyHome;
    await rm(home, { recursive: true, force: true });
  });

  async function createSource(historyMode: 'paginated' | 'legacy') {
    const id = randomUUID();
    const path = join(home, 'sessions', `rollout-2026-09-01T00-00-00-${id}.jsonl`);
    const rows: unknown[] = [{
      type: 'session_meta', timestamp,
      payload: {
        id, session_id: id, timestamp, cwd: home, originator: 'codex_cli_rs', cli_version: '0.153.2',
        source: 'cli', model_provider: 'fixture', history_mode: historyMode, base_instructions: { text: 'Fixture instructions' },
      },
    }];
    for (let i = 0; i < 3; i++) {
      const turnId = randomUUID();
      rows.push(
        { type: 'event_msg', timestamp, payload: { type: 'task_started', turn_id: turnId, model_context_window: 100000 } },
        { type: 'response_item', timestamp, payload: { type: 'message', id: randomUUID(), role: 'user', content: [{ type: 'input_text', text: `Question ${i}` }] } },
        { type: 'event_msg', timestamp, payload: { type: 'user_message', message: `Question ${i}`, images: [], local_images: [], text_elements: [] } },
        { type: 'response_item', timestamp, payload: { type: 'message', id: randomUUID(), role: 'assistant', content: [{ type: 'output_text', text: `Answer ${i}` }] } },
        { type: 'event_msg', timestamp, payload: { type: 'task_complete', turn_id: turnId, last_agent_message: `Answer ${i}` } },
      );
    }
    const content = rows.map((row, ordinal) => JSON.stringify({ ...row as object, ordinal })).join('\n') + '\n';
    await writeFile(path, content);
    // Materialize the fixture's native indexes just as a real source session would have done.
    const sourceBackend = new CodexAppServerBackend({
      command: 'npx', args: ['-y', CODEX_PACKAGE, 'app-server'], cwd: home, resumeFile: path,
    });
    try {
      await sourceBackend.startSession();
    } finally {
      await sourceBackend.dispose();
    }
    return { id, path, content: await readFile(path, 'utf-8') };
  }

  it.each([
    ['paginated', false], ['paginated', true], ['legacy', false], ['legacy', true],
  ] as const)('resumes a %s fork after process shutdown and a model change (truncate=%s)', async (mode, truncate) => {
    const source = await createSource(mode);
    const fork = await forkAndTruncateCodexSession(source.id, truncate ? generateStableUuid(timestamp, 1) : undefined);
    expect(fork, fork.errorMessage).toMatchObject({ success: true, newFilePath: expect.any(String) });
    const metadata = JSON.parse((await readFile(fork.newFilePath!, 'utf-8')).split('\n')[0]).payload;
    expect(metadata.id).not.toBe(source.id);
    expect(fork.newFilePath).toContain(metadata.id);
    expect(metadata.cwd).toBe(home);

    const expectedQuestions = truncate ? ['Question 0'] : ['Question 0', 'Question 1', 'Question 2'];
    expect((await readAllCodexSessionUserMessages(metadata.id)).map(message => message.content)).toEqual(expectedQuestions);
    expect((await getCodexSessionPreview(metadata.id)).filter(message => message.role === 'user').map(message => message.content)).toEqual(expectedQuestions);

    backend = new CodexAppServerBackend({
      command: 'npx', args: ['-y', CODEX_PACKAGE, 'app-server'], cwd: home,
      resumeFile: fork.newFilePath, model: 'changed-fixture-model',
    });
    expect(await backend.startSession()).toEqual({ sessionId: metadata.id });
    expect(await readFile(source.path, 'utf-8')).toBe(source.content);
  }, 60_000);

  it('lists, backfills and forks inherited paginated messages without copying later parent updates', async () => {
    const source = await createSource('paginated');
    const fork = await forkCodexSession(source.id);
    expect(fork, fork.errorMessage).toMatchObject({ success: true });
    const metadata = JSON.parse((await readFile(fork.newFilePath!, 'utf-8')).split('\n')[0]).payload;
    const lastOrdinal = JSON.parse(source.content.trimEnd().split('\n').at(-1)!).ordinal;
    await writeFile(source.path, source.content + JSON.stringify({
      type: 'response_item', timestamp, ordinal: lastOrdinal + 1,
      payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Later parent message' }] },
    }) + '\n');

    const messages = await readAllCodexSessionUserMessages(metadata.id);
    expect(messages.map(message => message.content)).toEqual(['Question 0', 'Question 1', 'Question 2']);
    const sessions = await listCodexSessions();
    expect(sessions.find(session => session.sessionId === metadata.id.slice(-6))).toMatchObject({ title: 'Question 0', messageCount: 3 });
    const batches: unknown[] = [];
    await backfillCodexSessionHistory({ sessionIdOrPath: fork.newFilePath!, sendBatch: async batch => { batches.push(...batch); } });
    expect(batches.length).toBeGreaterThan(0);
    expect(JSON.stringify(batches)).toContain('Question 0');
    expect(JSON.stringify(batches)).not.toContain('Later parent message');

    const secondFork = await forkAndTruncateCodexSession(metadata.id, messages[1].uuid);
    expect(secondFork, secondFork.errorMessage).toMatchObject({ success: true });
    const secondId = JSON.parse((await readFile(secondFork.newFilePath!, 'utf-8')).split('\n')[0]).payload.id;
    expect(secondId).not.toBe(metadata.id);
    expect((await readAllCodexSessionUserMessages(secondId)).map(message => message.content)).toEqual(['Question 0']);
  }, 60_000);
});
