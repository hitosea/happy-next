/**
 * Antigravity session copy, for the app's fork, duplicate, resume-by-copy and upgrade flows.
 *
 * agy declares no ACP fork (only load/resume/list/close), so the copy is made on
 * disk: each conversation is one SQLite file, ~/.gemini/antigravity-cli/conversations/<id>.db,
 * whose protobuf rows carry the session id. A UUID keeps its length when swapped for
 * another, so replacing it byte for byte leaves every length prefix valid, and
 * `session/load` of the new id replays the history and continues it on its own.
 * The brain/ and annotations/ entries are recreated by agy on first use.
 *
 * A duplicate also drops every turn from a user message on. A turn is that message and
 * the steps, model calls and executor state it set off, and each row names its turn's id
 * (TURN_ID_FIELDS), so the copy is cut on turn boundaries. Nothing else counts steps or
 * turns, and agy numbers what it appends from the rows left. Verified against agy 1.5.16;
 * a row whose turn cannot be read fails the copy rather than leave a half-cut conversation.
 */

import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { userPromptText } from 'happy-wire';
import { stripAcpSessionInstructions } from '@/agent/acp/sessionInstructions';
import { logger } from '@/ui/logger';
import type { SessionUserMessage } from '@/utils/sessionUserMessages';

type SqliteModule = typeof import('node:sqlite');
type Database = InstanceType<SqliteModule['DatabaseSync']>;

/** `steps.step_type` of a message the user sent. */
const USER_INPUT_STEP = 14;

/** Where each per-turn table keeps the id of the turn a row belongs to: the column, then its top-level protobuf field. */
const TURN_ID_FIELDS = [
  { table: 'steps', key: 'idx', column: 'metadata', field: 12 },
  { table: 'gen_metadata', key: 'idx', column: 'data', field: 4 },
  { table: 'executor_metadata', key: 'idx', column: 'data', field: 9 },
] as const;

/** Where agy keeps one SQLite file per conversation. */
export function antigravityConversationsDir(home: string = homedir()): string {
  return join(home, '.gemini', 'antigravity-cli', 'conversations');
}

/** `node:sqlite` arrived in Node.js 22.5; it is loaded at call time so older Node only loses these features. */
function loadSqlite(): SqliteModule {
  const sqlite = process.getBuiltinModule('node:sqlite') as SqliteModule | undefined;
  if (!sqlite) {
    throw new Error(`Reading Antigravity sessions needs Node.js 22.5 or newer (running ${process.version})`);
  }
  return sqlite;
}

function conversationPath(sessionId: string, conversationsDir: string): string {
  const path = join(conversationsDir, `${sessionId}.db`);
  if (!existsSync(path)) {
    throw new Error(`Antigravity session ${sessionId} was not found`);
  }
  return path;
}

/**
 * The value of a top-level protobuf field: the bytes of a length-delimited one or the number of a varint.
 * Undefined when the field is absent or the buffer is not protobuf.
 */
function protoField(buffer: Uint8Array | null | undefined, field: number): Buffer | bigint | undefined {
  if (!buffer) return undefined;
  const bytes = Buffer.from(buffer);
  const readVarint = (at: number): [bigint, number] => {
    let value = 0n;
    for (let shift = 0n, i = at; i < bytes.length; shift += 7n, i++) {
      value |= BigInt(bytes[i] & 0x7f) << shift;
      if (!(bytes[i] & 0x80)) return [value, i + 1];
    }
    throw new RangeError('truncated varint');
  };
  try {
    for (let at = 0; at < bytes.length;) {
      const [key, afterKey] = readVarint(at);
      const number = Number(key >> 3n);
      const wireType = Number(key & 7n);
      if (wireType === 0) {
        const [value, next] = readVarint(afterKey);
        if (number === field) return value;
        at = next;
      } else if (wireType === 2) {
        const [length, start] = readVarint(afterKey);
        const end = start + Number(length);
        if (end > bytes.length) return undefined;
        if (number === field) return bytes.subarray(start, end);
        at = end;
      } else if (wireType === 1 || wireType === 5) {
        at = afterKey + (wireType === 1 ? 8 : 4);
      } else {
        return undefined;
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function protoBytes(buffer: Uint8Array | null | undefined, ...path: number[]): Buffer | undefined {
  const value = path.reduce<Buffer | bigint | undefined>((current, field) => (Buffer.isBuffer(current) ? protoField(current, field) : undefined), Buffer.from(buffer ?? []));
  return Buffer.isBuffer(value) ? value : undefined;
}

function turnIdOf(row: Record<string, unknown>, column: string, field: number): string | undefined {
  return protoBytes(row[column] as Uint8Array, field)?.toString('utf8');
}

interface UserTurn {
  idx: number;
  turnId: string;
  message: SessionUserMessage | null;
}

/** The user steps of a conversation, oldest first, each with the message the app shows for it, if any. */
function readUserTurns(db: Database): UserTurn[] {
  const rows = db.prepare('SELECT idx, metadata, step_payload FROM steps WHERE step_type = ? ORDER BY idx').all(USER_INPUT_STEP) as { idx: number; metadata: Uint8Array; step_payload: Uint8Array }[];
  let index = 0;
  return rows.flatMap((row): UserTurn[] => {
    const turnId = turnIdOf(row, 'metadata', TURN_ID_FIELDS[0].field);
    if (!turnId) return [];
    // The text as sent: Happy's first-turn guidance rides after it, as on every ACP agent
    const sent = protoBytes(row.step_payload, 19, 2)?.toString('utf8');
    const content = sent === undefined ? null : userPromptText(stripAcpSessionInstructions(sent));
    const seconds = protoField(protoBytes(row.metadata, 1), 1);
    const timestamp = typeof seconds === 'bigint' ? new Date(Number(seconds) * 1000).toISOString() : undefined;
    const message = content ? { uuid: turnId, content, timestamp, index: index++ } : null;
    return [{ idx: row.idx, turnId, message }];
  });
}

/** The user messages of an Antigravity conversation, oldest first. Each message's uuid is its turn's id. */
export function readAntigravitySessionUserMessages(sessionId: string, conversationsDir: string = antigravityConversationsDir()): SessionUserMessage[] {
  const db = new (loadSqlite().DatabaseSync)(conversationPath(sessionId, conversationsDir), { readOnly: true });
  try {
    return readUserTurns(db).flatMap((turn) => (turn.message ? [turn.message] : []));
  } finally {
    db.close();
  }
}

/** Drops the turn `turnId` and every one after it. Throws, leaving the transaction to roll back, on anything it cannot place. */
function truncateBeforeTurn(db: Database, turnId: string): void {
  const nested = db.prepare('SELECT (SELECT count(*) FROM steps WHERE has_subtrajectory != 0) + (SELECT count(*) FROM parent_references) AS n').get() as { n: number };
  if (nested.n > 0) {
    throw new Error('Copying part of an Antigravity session with subagents is not supported');
  }
  const cut = readUserTurns(db).find((turn) => turn.turnId === turnId);
  if (!cut) {
    throw new Error('The message to copy up to was not found in the Antigravity session');
  }
  const steps = TURN_ID_FIELDS[0];
  const dropped = new Set(
    (db.prepare(`SELECT ${steps.column} FROM ${steps.table} WHERE idx >= ?`).all(cut.idx) as Record<string, unknown>[]).map((row) => turnIdOf(row, steps.column, steps.field)),
  );
  for (const { table, key, column, field } of TURN_ID_FIELDS) {
    for (const row of db.prepare(`SELECT ${key}, ${column} FROM ${table}`).all() as Record<string, unknown>[]) {
      const rowTurn = turnIdOf(row, column, field);
      if (!rowTurn) {
        throw new Error(`Unrecognized Antigravity session format (${table} ${row[key]} has no turn)`);
      }
      if (dropped.has(rowTurn)) {
        db.prepare(`DELETE FROM ${table} WHERE ${key} = ?`).run(row[key] as number);
      }
    }
  }
}

/**
 * Copies an Antigravity conversation into a new agy session and returns its id. With
 * `truncateBeforeUuid` (a user message's uuid from readAntigravitySessionUserMessages),
 * the copy ends before that message.
 */
export async function forkAntigravitySession(
  sessionId: string,
  options: { conversationsDir?: string; truncateBeforeUuid?: string } = {},
): Promise<string> {
  const sqlite = loadSqlite();
  const conversationsDir = options.conversationsDir ?? antigravityConversationsDir();
  const sourcePath = conversationPath(sessionId, conversationsDir);
  const newSessionId = randomUUID();
  const targetPath = join(conversationsDir, `${newSessionId}.db`);

  try {
    // VACUUM INTO takes a consistent snapshot, WAL included, even while agy is writing the source
    const source = new sqlite.DatabaseSync(sourcePath, { readOnly: true });
    try {
      source.prepare('VACUUM INTO ?').run(targetPath);
    } finally {
      source.close();
    }

    const target = new sqlite.DatabaseSync(targetPath);
    try {
      target.exec('BEGIN');
      if (options.truncateBeforeUuid) truncateBeforeTurn(target, options.truncateBeforeUuid);
      const from = Buffer.from(sessionId);
      const to = Buffer.from(newSessionId);
      const tables = target.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`).all() as { name: string }[];
      for (const { name } of tables) {
        const table = `"${name.replaceAll('"', '""')}"`;
        for (const row of target.prepare(`SELECT rowid AS __rowid, * FROM ${table}`).all()) {
          const { __rowid: rowid, ...columns } = row;
          const changed: [string, Uint8Array | string][] = Object.entries(columns).flatMap(([column, value]): [string, Uint8Array | string][] => {
            if (value instanceof Uint8Array && Buffer.from(value).includes(from)) {
              return [[column, replaceAllBytes(Buffer.from(value), from, to)]];
            }
            if (typeof value === 'string' && value.includes(sessionId)) {
              return [[column, value.replaceAll(sessionId, newSessionId)]];
            }
            return [];
          });
          if (changed.length === 0) continue;
          const assignments = changed.map(([column]) => `"${column.replaceAll('"', '""')}" = ?`).join(', ');
          target.prepare(`UPDATE ${table} SET ${assignments} WHERE rowid = ?`).run(...changed.map(([, value]) => value), rowid as number);
        }
      }
      target.exec('COMMIT');
    } finally {
      target.close();
    }
  } catch (error) {
    await rm(targetPath, { force: true });
    throw error;
  }

  logger.debug(`[Antigravity] Copied session ${sessionId} into ${newSessionId}${options.truncateBeforeUuid ? ` up to turn ${options.truncateBeforeUuid}` : ''}`);
  return newSessionId;
}

function replaceAllBytes(value: Buffer, from: Buffer, to: Buffer): Buffer {
  const result = Buffer.from(value);
  for (let index = result.indexOf(from); index !== -1; index = result.indexOf(from, index + to.length)) {
    to.copy(result, index);
  }
  return result;
}
