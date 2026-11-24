import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { forkAntigravitySession } from './sessions';

const SESSION_ID = '928be517-67a7-4c75-b803-848303b34ec0';

describe('forkAntigravitySession', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'agy-fork-'));
    const db = new DatabaseSync(join(dir, `${SESSION_ID}.db`));
    db.exec('CREATE TABLE trajectory_meta (trajectory_id text PRIMARY KEY, cascade_id text)');
    db.exec('CREATE TABLE steps (idx integer PRIMARY KEY, metadata blob)');
    db.prepare('INSERT INTO trajectory_meta VALUES (?, ?)').run('traj-1', SESSION_ID);
    // A protobuf-like blob: a length prefix, the id twice, and bytes that are not UTF-8
    const blob = Buffer.concat([Buffer.from([0x0a, 0x24]), Buffer.from(SESSION_ID), Buffer.from([0xff, 0x00]), Buffer.from(SESSION_ID)]);
    db.prepare('INSERT INTO steps VALUES (?, ?)').run(0, blob);
    db.prepare('INSERT INTO steps VALUES (?, ?)').run(1, Buffer.from([0x01, 0x02]));
    db.close();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('copies the conversation under a new id and leaves the source untouched', async () => {
    const newSessionId = await forkAntigravitySession(SESSION_ID, dir);
    expect(newSessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(newSessionId).not.toBe(SESSION_ID);

    const copy = new DatabaseSync(join(dir, `${newSessionId}.db`), { readOnly: true });
    expect(copy.prepare('SELECT cascade_id FROM trajectory_meta').get()).toEqual({ cascade_id: newSessionId });
    const steps = copy.prepare('SELECT metadata FROM steps ORDER BY idx').all() as { metadata: Uint8Array }[];
    const first = Buffer.from(steps[0].metadata);
    expect(first.length).toBe(2 + 36 + 2 + 36);
    expect(first.includes(Buffer.from(SESSION_ID))).toBe(false);
    expect(first.subarray(0, 2)).toEqual(Buffer.from([0x0a, 0x24]));
    expect(first.subarray(38, 40)).toEqual(Buffer.from([0xff, 0x00]));
    expect(first.toString('latin1').split(newSessionId).length).toBe(3);
    expect(Buffer.from(steps[1].metadata)).toEqual(Buffer.from([0x01, 0x02]));
    copy.close();

    const source = new DatabaseSync(join(dir, `${SESSION_ID}.db`), { readOnly: true });
    expect(source.prepare('SELECT cascade_id FROM trajectory_meta').get()).toEqual({ cascade_id: SESSION_ID });
    source.close();
  });

  it('fails without leaving a file behind when the session does not exist', async () => {
    await expect(forkAntigravitySession('00000000-0000-0000-0000-000000000000', dir)).rejects.toThrow('was not found');
    expect(readdirSync(dir)).toEqual([`${SESSION_ID}.db`]);
  });
});
