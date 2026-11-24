/**
 * Antigravity session copy, for the app's fork, resume-by-copy and upgrade flows.
 *
 * agy declares no ACP fork (only load/resume/list/close), so the copy is made on
 * disk: each conversation is one SQLite file, ~/.gemini/antigravity-cli/conversations/<id>.db,
 * whose protobuf rows carry the session id. A UUID keeps its length when swapped for
 * another, so replacing it byte for byte leaves every length prefix valid, and
 * `session/load` of the new id replays the history and continues it on its own.
 * The brain/ and annotations/ entries are recreated by agy on first use.
 */

import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { logger } from '@/ui/logger';

type SqliteModule = typeof import('node:sqlite');

/** Where agy keeps one SQLite file per conversation. */
export function antigravityConversationsDir(home: string = homedir()): string {
  return join(home, '.gemini', 'antigravity-cli', 'conversations');
}

/**
 * Copies an Antigravity conversation into a new agy session and returns its id.
 * Needs Node.js 22.5+ for `node:sqlite`; loaded at call time so older Node only loses this.
 */
export async function forkAntigravitySession(sessionId: string, conversationsDir: string = antigravityConversationsDir()): Promise<string> {
  const sqlite = process.getBuiltinModule('node:sqlite') as SqliteModule | undefined;
  if (!sqlite) {
    throw new Error(`Copying an Antigravity session needs Node.js 22.5 or newer (running ${process.version})`);
  }
  const sourcePath = join(conversationsDir, `${sessionId}.db`);
  if (!existsSync(sourcePath)) {
    throw new Error(`Antigravity session ${sessionId} was not found`);
  }
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
      const from = Buffer.from(sessionId);
      const to = Buffer.from(newSessionId);
      const tables = target.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`).all() as { name: string }[];
      target.exec('BEGIN');
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

  logger.debug(`[Antigravity] Copied session ${sessionId} into ${newSessionId}`);
  return newSessionId;
}

function replaceAllBytes(value: Buffer, from: Buffer, to: Buffer): Buffer {
  const result = Buffer.from(value);
  for (let index = result.indexOf(from); index !== -1; index = result.indexOf(from, index + to.length)) {
    to.copy(result, index);
  }
  return result;
}
