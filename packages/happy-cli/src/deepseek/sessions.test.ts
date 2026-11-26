import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { constants, zstdCompressSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { forkDeepSeekSession, readDeepSeekSessionUserMessages } from './sessions';
import { readDeepSeekTranscript } from './transcript';

const SOURCE = '1bb19cd2-10fe-4bda-a0c0-e3ebdedfc5a8';
const WORKSPACE = '--home-me-project--';

function turn(seq: number, turnNumber: number, id: string, text: string, reply: string) {
  return [
    { type: 'agent/inbox/spliced', seq, time: 1000 + seq, data: { inserted: [{ id }] } },
    { type: 'turn/start', seq: seq + 1, time: 1000 + seq + 1, data: { turn: turnNumber } },
    { type: 'user/message', seq: seq + 2, time: 1000 + seq + 2, data: { content: [{ type: 'text', text }], source: { kind: 'user' }, role: 'user', id }, surfaceOp: 'append' },
    { type: 'assistant/message', seq: seq + 3, time: 1000 + seq + 3, data: { turn: turnNumber, message: { role: 'assistant', content: [{ type: 'text', text: reply }] } } },
    { type: 'turn/end', seq: seq + 4, time: 1000 + seq + 4, data: { turn: turnNumber, reason: { kind: 'completed' } } },
    { type: 'session/end-seed', seq: seq + 5, time: 1000 + seq + 5, data: {} },
  ];
}

const HEADER = { type: 'session', version: 4, id: SOURCE, createdAt: 1, cwd: '/home/me/project', isSeeded: false, delegationDepth: 0 };
const EVENTS = [
  { type: 'permission/preset', seq: 0, time: 1000, data: { preset: 'workspace-write' } },
  ...turn(1, 1, 'u1', 'Remember X\n\n<happy-session-instructions>\nhidden\n</happy-session-instructions>', 'OK'),
  ...turn(7, 2, 'u2', 'What was it?', 'X'),
  // A third turn still running: the copy leaves it out
  { type: 'agent/inbox/spliced', seq: 13, time: 1013, data: { inserted: [{ id: 'u3' }] } },
  { type: 'turn/start', seq: 14, time: 1014, data: { turn: 3 } },
  { type: 'user/message', seq: 15, time: 1015, data: { content: [{ type: 'text', text: 'Still going' }], source: { kind: 'user' }, id: 'u3' }, surfaceOp: 'append' },
];

const frame = (rows: object[]) => zstdCompressSync(Buffer.from(rows.map((row) => `${JSON.stringify(row)}\n`).join('')), { params: { [constants.ZSTD_c_checksumFlag]: 1 } });

describe('DeepSeek session copy', () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'dsh-home-'));
    const sessionDir = join(home, 'sessions', WORKSPACE, SOURCE);
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(join(sessionDir, 'session.v4.jsonl.zstd'), Buffer.concat([frame([HEADER]), frame(EVENTS.slice(0, 8)), frame(EVENTS.slice(8))]));
  });
  afterEach(() => rmSync(home, { recursive: true, force: true }));

  it('lists the prompts the user sent', async () => {
    expect(await readDeepSeekSessionUserMessages(SOURCE, home)).toEqual([
      { uuid: 'u1', content: 'Remember X', timestamp: new Date(1003).toISOString(), index: 0 },
      { uuid: 'u2', content: 'What was it?', timestamp: new Date(1009).toISOString(), index: 1 },
      { uuid: 'u3', content: 'Still going', timestamp: new Date(1015).toISOString(), index: 2 },
    ]);
    await expect(readDeepSeekSessionUserMessages('missing', home)).rejects.toThrow('was not found');
  });

  it('copies through the last completed turn as a seeded session beside the source', async () => {
    const copy = await forkDeepSeekSession(SOURCE, { dshHome: home });
    const [header, ...events] = await readDeepSeekTranscript(copy, home);
    expect(header).toEqual({ type: 'session', version: 4, id: copy, createdAt: expect.any(Number), cwd: '/home/me/project', isSeeded: true, delegationDepth: 0 });
    // Through turn 2 and its trailing end-seed, stopping at turn 3's prompt
    expect(events.slice(0, 13)).toEqual(EVENTS.slice(0, 13));
    expect(events.slice(13)).toEqual([{ type: 'session/end-seed', seq: 13, time: 1012, data: { inherited: true } }]);
  });

  it('copies up to a user message, cutting before its turn', async () => {
    const copy = await forkDeepSeekSession(SOURCE, { dshHome: home, truncateBeforeUuid: 'u2' });
    const events = (await readDeepSeekTranscript(copy, home)).slice(1);
    expect(events.map((event) => event.seq)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(events.at(-1)).toEqual({ type: 'session/end-seed', seq: 7, time: 1006, data: { inherited: true } });
    expect((await readDeepSeekSessionUserMessages(copy, home)).map((message) => message.uuid)).toEqual(['u1']);

    // Before the first prompt nothing is inherited
    const empty = await forkDeepSeekSession(SOURCE, { dshHome: home, truncateBeforeUuid: 'u1' });
    expect((await readDeepSeekTranscript(empty, home)).slice(1)).toEqual([{ type: 'session/end-seed', seq: 0, time: expect.any(Number), data: { inherited: true } }]);

    await expect(forkDeepSeekSession(SOURCE, { dshHome: home, truncateBeforeUuid: 'nope' })).rejects.toThrow('was not found');
  });
});
