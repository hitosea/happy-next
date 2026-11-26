import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zstdCompressSync, constants } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { buildAcpBackfillMessages } from '@/agent/acp/backfill';
import { deepSeekEventsToAcpUpdates, deepSeekUsageAfter, readDeepSeekTranscript } from './transcript';

describe('DeepSeek transcript reader', () => {
  it('reads every Zstandard frame of a session log in its workspace folder, ignoring a torn tail', async () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-home-'));
    try {
      const sessionDir = join(home, 'sessions', '--home-me-project--', 'abc-123');
      mkdirSync(sessionDir, { recursive: true });
      const lines = [
        { type: 'session', version: 4, id: 'abc-123' },
        { type: 'user/message', seq: 1, data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'Remember X\n\n<happy-session-instructions>\nhidden\n</happy-session-instructions>' }] } },
        { type: 'assistant/message', seq: 2, data: { message: { content: [{ type: 'reasoning', text: 'ok' }, { type: 'text', text: 'OK' }] } } },
      ];
      const frame = (rows: object[]) => zstdCompressSync(Buffer.from(rows.map((row) => `${JSON.stringify(row)}\n`).join('')), { params: { [constants.ZSTD_c_checksumFlag]: 1 } });
      const torn = frame([{ type: 'user/message', seq: 3 }]).subarray(0, 8);
      writeFileSync(join(sessionDir, 'session.v4.jsonl.zstd'), Buffer.concat([frame(lines.slice(0, 1)), frame(lines.slice(1)), torn]));

      const events = await readDeepSeekTranscript('abc-123', home);
      expect(events.map((event) => event.type)).toEqual(['session', 'user/message', 'assistant/message']);
      expect(await readDeepSeekTranscript('missing', home)).toEqual([]);
      expect(await readDeepSeekTranscript('../abc-123', home)).toEqual([]);

      const backfill = buildAcpBackfillMessages(deepSeekEventsToAcpUpdates(events), 'abc-123', 'deepseek');
      expect(backfill.map((message) => message.content)).toEqual([
        { role: 'user', content: { type: 'text', text: 'Remember X' }, meta: { sentFrom: 'cli' } },
        { role: 'agent', content: { type: 'acp', provider: 'deepseek', data: { type: 'message', message: 'OK' } }, meta: { sentFrom: 'cli' } },
      ]);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe('DeepSeek transcript projection', () => {
  it('projects user prompts, tool calls, and assistant replies while skipping synthetic context', () => {
    const updates = deepSeekEventsToAcpUpdates([
      { seq: 0, type: 'user/message', data: { source: { kind: 'runtime-context' }, message: { content: [{ type: 'text', text: 'cwd=/tmp' }] } } },
      { seq: 1, type: 'user/message', data: { source: { kind: 'user' }, message: { content: [{ type: 'text', text: 'Hello' }] } } },
      { seq: 2, type: 'tool/call', data: { callId: 'c1', name: 'read' } },
      { seq: 3, type: 'assistant/message', data: { message: { content: [{ type: 'reasoning', text: 'hmm' }, { type: 'text', text: 'Done!' }] } } },
    ]);

    expect(updates).toEqual([
      { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'Hello' } },
      { sessionUpdate: 'tool_call', toolCallId: 'c1', title: 'read', kind: 'other', status: 'in_progress' },
      { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Done!' } },
    ]);
  });

  it('sums assistant token usage strictly after the watermark seq', () => {
    const { lastSeq, tokens } = deepSeekUsageAfter([
      { seq: 1, type: 'assistant/message', data: { usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 } } },
      { seq: 4, type: 'assistant/message', data: { usage: { inputTokens: 200, outputTokens: 50, cacheReadTokens: 80, totalTokens: 250 } } },
      { seq: 7, type: 'assistant/message', data: { usage: { inputTokens: 300, outputTokens: 10, cacheWriteTokens: 15, totalTokens: 310 } } },
    ], 1);

    expect(lastSeq).toBe(7);
    expect(tokens).toEqual({
      total: 560,
      input: 500,
      output: 60,
      cache_creation: 15,
      cache_read: 80,
    });
  });
});
