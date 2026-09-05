import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { forkAndTruncateCodexSession, forkCodexSession } from './codexSessionFork';
import { generateStableUuid } from './codexSessionReader';
import { Methods } from '../appserver/types';
import { CODEX_PACKAGE } from '../package';

const peer = vi.hoisted(() => ({ spawn: vi.fn(), request: vi.fn(), notify: vi.fn(), close: vi.fn() }));
vi.mock('../appserver/CodexJsonRpcPeer', () => ({ CodexJsonRpcPeer: vi.fn(() => peer) }));

const sourceId = '11111111-2222-4333-8444-555555555555';
const forkId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const timestamp = '2026-09-04T06:59:26.000Z';
const user = (text: string) => ({ type: 'response_item', timestamp, payload: { role: 'user', content: [{ type: 'input_text', text }] } });
const started = (id: string) => ({ type: 'event_msg', timestamp, payload: { type: 'task_started', turn_id: id } });

describe('Codex session fork', () => {
  let home: string;
  let sourcePath: string;
  let forkPath: string;
  let sourceContent: string;

  async function writeSource(records: unknown[]) {
    sourceContent = records.map((record) => JSON.stringify(record)).join('\n') + '\n';
    await writeFile(sourcePath, sourceContent);
  }

  beforeEach(async () => {
    vi.resetAllMocks();
    home = await mkdtemp(join(tmpdir(), 'happy-codex-fork-'));
    vi.stubEnv('CODEX_HOME', home);
    const sessions = join(home, 'sessions');
    await mkdir(sessions);
    sourcePath = join(sessions, `rollout-2026-09-04T06-59-26-${sourceId}.jsonl`);
    forkPath = join(sessions, `rollout-2026-09-05T01-38-15-${forkId}.jsonl`);
    await writeSource([
      { type: 'session_meta', timestamp, payload: { id: sourceId, session_id: sourceId, history_mode: 'paginated' } },
      started('turn-1'), user('# AGENTS.md\nSystem context'), user('First question'),
      { type: 'compacted', timestamp, payload: { message: 'summary' } },
      started('turn-2'), user('Second question'),
      started('turn-3'), user('Third question'),
    ]);
    peer.request.mockImplementation(async (method: string) => {
      if (method === Methods.INITIALIZE) return {};
      if (method === Methods.THREAD_TURNS_LIST) {
        return { data: ['turn-1', 'turn-2', 'turn-3'].map((id) => ({ id })), nextCursor: null };
      }
      if (method === Methods.THREAD_FORK) {
        await writeFile(forkPath, JSON.stringify({ type: 'session_meta', payload: { id: forkId } }) + '\n');
        return { thread: { id: forkId, path: forkPath } };
      }
      throw new Error(`Unexpected request: ${method}`);
    });
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(home, { recursive: true, force: true });
  });

  it('forks paginated history by canonical ID, never by copying or resuming the source', async () => {
    expect(await forkCodexSession(sourceId)).toEqual({ success: true, newFilePath: forkPath });
    expect(peer.spawn).toHaveBeenCalledWith('npx', ['-y', CODEX_PACKAGE, 'app-server'], { cwd: process.cwd() });
    expect(peer.request).toHaveBeenNthCalledWith(1, Methods.INITIALIZE, expect.objectContaining({ capabilities: { experimentalApi: true } }));
    expect(peer.notify).toHaveBeenCalledWith(Methods.INITIALIZED);
    expect(peer.request).toHaveBeenNthCalledWith(2, Methods.THREAD_FORK, { threadId: sourceId, excludeTurns: true });
    expect(peer.request).toHaveBeenCalledTimes(2);
    expect(await readFile(sourcePath, 'utf-8')).toBe(sourceContent);
    expect(await readdir(join(home, 'sessions'))).toHaveLength(2);
    expect(peer.close).toHaveBeenCalledOnce();
  });

  it('resolves display suffixes to the full native thread ID', async () => {
    expect((await forkCodexSession('555555')).success).toBe(true);
    expect(peer.request).toHaveBeenCalledWith(Methods.THREAD_FORK, { threadId: sourceId, excludeTurns: true });
  });

  it('forks through the previous turn, excluding the selected message and later history', async () => {
    expect((await forkAndTruncateCodexSession(sourceId, generateStableUuid(timestamp, 1))).success).toBe(true);
    expect(peer.request).toHaveBeenCalledWith(Methods.THREAD_FORK, { threadId: sourceId, excludeTurns: true, lastTurnId: 'turn-1' });
    expect(await readFile(sourcePath, 'utf-8')).toBe(sourceContent);
  });

  it('keeps the previous turn across native pagination pages', async () => {
    peer.request.mockReset()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ data: [{ id: 'turn-1' }], nextCursor: 'page-2' })
      .mockResolvedValueOnce({ data: [{ id: 'turn-2' }], nextCursor: null })
      .mockImplementationOnce(async () => {
        await writeFile(forkPath, 'native fork');
        return { thread: { id: forkId, path: forkPath } };
      });
    expect((await forkAndTruncateCodexSession(sourceId, generateStableUuid(timestamp, 1))).success).toBe(true);
    expect(peer.request).toHaveBeenCalledWith(Methods.THREAD_TURNS_LIST, {
      threadId: sourceId, cursor: 'page-2', sortDirection: 'asc', limit: 100, itemsView: 'notLoaded',
    });
    expect(peer.request).toHaveBeenLastCalledWith(Methods.THREAD_FORK, { threadId: sourceId, excludeTurns: true, lastTurnId: 'turn-1' });
  });

  it('rejects old renamed copies instead of accidentally forking their original thread', async () => {
    await writeFile(forkPath, sourceContent);
    expect(await forkCodexSession(forkId)).toEqual({ success: false, errorMessage: expect.stringContaining('does not match its thread id') });
    expect(peer.spawn).not.toHaveBeenCalled();
  });

  it('rejects a missing source before spawning Codex', async () => {
    expect((await forkCodexSession('missing')).success).toBe(false);
    expect(peer.spawn).not.toHaveBeenCalled();
  });

  it('rejects missing metadata', async () => {
    await writeSource([user('Question')]);
    expect(await forkCodexSession(sourceId)).toEqual({ success: false, errorMessage: expect.stringContaining('metadata') });
    expect(peer.spawn).not.toHaveBeenCalled();
  });

  it('rejects an unknown truncation UUID instead of silently copying the entire session', async () => {
    expect(await forkAndTruncateCodexSession(sourceId, 'missing')).toEqual({ success: false, errorMessage: expect.stringContaining('not found') });
    expect(peer.spawn).not.toHaveBeenCalled();
  });

  it('rejects first-turn truncation rather than returning a full fork', async () => {
    expect(await forkAndTruncateCodexSession(sourceId, generateStableUuid(timestamp, 0))).toEqual({ success: false, errorMessage: expect.stringContaining('first Codex turn') });
    expect(peer.request).not.toHaveBeenCalledWith(Methods.THREAD_FORK, expect.anything());
    expect(peer.close).toHaveBeenCalledOnce();
  });

  it('rejects a mid-turn message rather than dropping earlier messages in that turn', async () => {
    await writeFile(sourcePath, sourceContent + JSON.stringify(user('Steered question')) + '\n');
    expect(await forkAndTruncateCodexSession(sourceId, generateStableUuid(timestamp, 3))).toEqual({ success: false, errorMessage: expect.stringContaining('middle of a Codex turn') });
    expect(peer.spawn).not.toHaveBeenCalled();
  });

  it('rejects a selected turn no longer present in native history', async () => {
    peer.request.mockReset().mockResolvedValueOnce({}).mockResolvedValueOnce({ data: [{ id: 'turn-1' }], nextCursor: null });
    expect(await forkAndTruncateCodexSession(sourceId, generateStableUuid(timestamp, 1))).toEqual({ success: false, errorMessage: expect.stringContaining('no longer present') });
    expect(peer.close).toHaveBeenCalledOnce();
  });

  it('stops on repeated pagination cursors', async () => {
    peer.request.mockReset().mockResolvedValueOnce({}).mockResolvedValue({ data: [{ id: 'turn-1' }], nextCursor: 'same' });
    expect(await forkAndTruncateCodexSession(sourceId, generateStableUuid(timestamp, 1))).toEqual({ success: false, errorMessage: expect.stringContaining('repeated') });
    expect(peer.request).toHaveBeenCalledTimes(3);
  });

  it.each(['spawn', 'initialize', 'fork'])('closes the peer after a %s failure without falling back to resume', async (phase) => {
    if (phase === 'spawn') peer.spawn.mockRejectedValueOnce(new Error('failed'));
    else if (phase === 'initialize') peer.request.mockRejectedValueOnce(new Error('failed'));
    else peer.request.mockReset().mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('failed'));
    expect(await forkCodexSession(sourceId)).toEqual({ success: false, errorMessage: 'failed' });
    expect(peer.close).toHaveBeenCalledOnce();
    expect(peer.request).not.toHaveBeenCalledWith(Methods.THREAD_RESUME, expect.anything());
    expect(await readFile(sourcePath, 'utf-8')).toBe(sourceContent);
    expect(await readdir(join(home, 'sessions'))).toHaveLength(1);
  });

  it.each([
    { id: sourceId, path: '/tmp/fork.jsonl' },
    { id: forkId, path: null },
    { id: forkId, path: 'relative.jsonl' },
  ])('rejects an invalid native fork result: %j', async (thread) => {
    peer.request.mockReset().mockResolvedValueOnce({}).mockResolvedValueOnce({ thread });
    expect(await forkCodexSession(sourceId)).toEqual({ success: false, errorMessage: expect.stringContaining('independent persisted fork') });
    expect(peer.close).toHaveBeenCalledOnce();
  });

  it('does not return a rollout path that has not been persisted', async () => {
    peer.request.mockReset().mockResolvedValueOnce({}).mockResolvedValueOnce({ thread: { id: forkId, path: forkPath } });
    expect((await forkCodexSession(sourceId)).success).toBe(false);
    expect(peer.close).toHaveBeenCalledOnce();
  });
});
