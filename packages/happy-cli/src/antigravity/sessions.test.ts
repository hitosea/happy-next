import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { forkAntigravitySession, readAntigravitySessionUserMessages } from './sessions';

const SESSION_ID = '928be517-67a7-4c75-b803-848303b34ec0';
const TURNS = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333'];

function varint(value: number): Buffer {
  const bytes: number[] = [];
  for (let rest = value; rest >= 128; rest = Math.floor(rest / 128)) bytes.push((rest % 128) | 0x80);
  bytes.push(value < 128 ? value : Math.floor(value / 128 ** bytes.length));
  return Buffer.from(bytes);
}

/** One length-delimited protobuf field. */
function field(number: number, value: Buffer | string): Buffer {
  const bytes = Buffer.from(value);
  return Buffer.concat([varint((number << 3) | 2), varint(bytes.length), bytes]);
}

function varintField(number: number, value: number): Buffer {
  return Buffer.concat([varint(number << 3), varint(value)]);
}

function stepMetadata(turn: string, seconds: number): Buffer {
  return Buffer.concat([field(1, varintField(1, seconds)), field(3, SESSION_ID), field(12, turn)]);
}

function openDb(sessionId: string, dir: string): DatabaseSync {
  return new DatabaseSync(join(dir, `${sessionId}.db`), { readOnly: true });
}

describe('Antigravity sessions', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'agy-fork-'));
    const db = new DatabaseSync(join(dir, `${SESSION_ID}.db`));
    db.exec('CREATE TABLE trajectory_meta (trajectory_id text PRIMARY KEY, cascade_id text)');
    db.exec('CREATE TABLE steps (idx integer PRIMARY KEY, step_type integer, has_subtrajectory integer DEFAULT 0, metadata blob, step_payload blob)');
    db.exec('CREATE TABLE gen_metadata (idx integer PRIMARY KEY, data blob)');
    db.exec('CREATE TABLE executor_metadata (idx integer PRIMARY KEY, data blob)');
    db.exec('CREATE TABLE parent_references (id integer PRIMARY KEY, data blob)');
    db.prepare('INSERT INTO trajectory_meta VALUES (?, ?)').run('traj-1', SESSION_ID);
    const step = db.prepare('INSERT INTO steps (idx, step_type, metadata, step_payload) VALUES (?, ?, ?, ?)');
    step.run(0, 101, stepMetadata(TURNS[0], 1_700_000_000), Buffer.from([]));
    // The first message carries Happy's session guidance after the text
    step.run(1, 14, stepMetadata(TURNS[0], 1_700_000_000), field(19, field(2, 'first\n\n<happy-session-instructions>x</happy-session-instructions>')));
    step.run(2, 15, stepMetadata(TURNS[0], 1_700_000_001), field(20, 'answer one'));
    step.run(3, 14, stepMetadata(TURNS[1], 1_700_000_100), field(19, field(2, 'second')));
    step.run(4, 132, stepMetadata(TURNS[1], 1_700_000_101), field(5, 'tool call'));
    step.run(5, 15, stepMetadata(TURNS[1], 1_700_000_102), field(20, 'answer two'));
    step.run(6, 14, stepMetadata(TURNS[2], 1_700_000_200), field(19, field(2, 'third')));
    step.run(7, 15, stepMetadata(TURNS[2], 1_700_000_201), field(20, 'answer three'));
    const gen = db.prepare('INSERT INTO gen_metadata VALUES (?, ?)');
    gen.run(0, field(4, TURNS[0]));
    gen.run(1, field(4, TURNS[1]));
    gen.run(2, field(4, TURNS[1]));
    gen.run(3, field(4, TURNS[2]));
    const exec = db.prepare('INSERT INTO executor_metadata VALUES (?, ?)');
    TURNS.forEach((turn, idx) => exec.run(idx, Buffer.concat([field(1, SESSION_ID), field(9, turn)])));
    db.close();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('reads the user messages with their turn ids, text as typed and send time', () => {
    expect(readAntigravitySessionUserMessages(SESSION_ID, dir)).toEqual([
      { uuid: TURNS[0], content: 'first', timestamp: new Date(1_700_000_000_000).toISOString(), index: 0 },
      { uuid: TURNS[1], content: 'second', timestamp: new Date(1_700_000_100_000).toISOString(), index: 1 },
      { uuid: TURNS[2], content: 'third', timestamp: new Date(1_700_000_200_000).toISOString(), index: 2 },
    ]);
  });

  it('copies the whole conversation under a new id and leaves the source untouched', async () => {
    const newSessionId = await forkAntigravitySession(SESSION_ID, { conversationsDir: dir });
    expect(newSessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(newSessionId).not.toBe(SESSION_ID);

    const copy = openDb(newSessionId, dir);
    expect(copy.prepare('SELECT cascade_id FROM trajectory_meta').get()).toEqual({ cascade_id: newSessionId });
    const steps = copy.prepare('SELECT metadata FROM steps ORDER BY idx').all() as { metadata: Uint8Array }[];
    expect(steps).toHaveLength(8);
    // Same length, so every length prefix stays valid
    expect(Buffer.from(steps[0].metadata)).toEqual(Buffer.from(stepMetadata(TURNS[0], 1_700_000_000).toString('latin1').replace(SESSION_ID, newSessionId), 'latin1'));
    copy.close();

    const source = openDb(SESSION_ID, dir);
    expect(source.prepare('SELECT cascade_id FROM trajectory_meta').get()).toEqual({ cascade_id: SESSION_ID });
    source.close();
  });

  it('cuts the copy before a message, dropping that turn and later ones, tool steps included', async () => {
    const newSessionId = await forkAntigravitySession(SESSION_ID, { conversationsDir: dir, truncateBeforeUuid: TURNS[1] });
    const copy = openDb(newSessionId, dir);
    expect(copy.prepare('SELECT idx FROM steps ORDER BY idx').all()).toEqual([{ idx: 0 }, { idx: 1 }, { idx: 2 }]);
    expect(copy.prepare('SELECT idx FROM gen_metadata ORDER BY idx').all()).toEqual([{ idx: 0 }]);
    expect(copy.prepare('SELECT idx FROM executor_metadata ORDER BY idx').all()).toEqual([{ idx: 0 }]);
    copy.close();
    expect(readAntigravitySessionUserMessages(newSessionId, dir).map((message) => message.content)).toEqual(['first']);
    expect(readAntigravitySessionUserMessages(SESSION_ID, dir)).toHaveLength(3);
  });

  it('refuses to cut at a message the conversation does not have', async () => {
    await expect(forkAntigravitySession(SESSION_ID, { conversationsDir: dir, truncateBeforeUuid: 'missing' })).rejects.toThrow('was not found');
    expect(readdirSync(dir)).toEqual([`${SESSION_ID}.db`]);
  });

  it('refuses to cut a conversation with subagents', async () => {
    const db = new DatabaseSync(join(dir, `${SESSION_ID}.db`));
    db.exec('UPDATE steps SET has_subtrajectory = 1 WHERE idx = 4');
    db.close();
    await expect(forkAntigravitySession(SESSION_ID, { conversationsDir: dir, truncateBeforeUuid: TURNS[1] })).rejects.toThrow('subagents');
    expect(readdirSync(dir)).toEqual([`${SESSION_ID}.db`]);
  });

  it('refuses to cut when a row names no turn', async () => {
    const db = new DatabaseSync(join(dir, `${SESSION_ID}.db`));
    db.prepare('INSERT INTO gen_metadata VALUES (?, ?)').run(9, Buffer.from([0x01, 0x02]));
    db.close();
    await expect(forkAntigravitySession(SESSION_ID, { conversationsDir: dir, truncateBeforeUuid: TURNS[1] })).rejects.toThrow('Unrecognized');
    expect(readdirSync(dir)).toEqual([`${SESSION_ID}.db`]);
  });

  it('fails without leaving a file behind when the session does not exist', async () => {
    await expect(forkAntigravitySession('00000000-0000-0000-0000-000000000000', { conversationsDir: dir })).rejects.toThrow('was not found');
    expect(readdirSync(dir)).toEqual([`${SESSION_ID}.db`]);
  });
});
