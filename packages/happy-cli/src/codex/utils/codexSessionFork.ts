/** Fork native Codex history through app-server so IDs and paginated indexes stay consistent. */

import { stat } from 'node:fs/promises';
import { basename, isAbsolute } from 'node:path';
import { z } from 'zod';
import { logger } from '@/ui/logger';
import { CODEX_PACKAGE } from '@/codex/package';
import { CodexJsonRpcPeer } from '../appserver/CodexJsonRpcPeer';
import { Methods, type InitializeParams, type ThreadForkParams, type ThreadForkResponse, type ThreadTurnsListResponse } from '../appserver/types';
import { findCodexSessionFile, generateStableUuid, extractUserText, isSystemMessage, readCodexSessionContent } from './codexSessionReader';

export interface CodexForkResult {
  success: boolean;
  /** Absolute path to the new forked JSONL file */
  newFilePath?: string;
  errorMessage?: string;
}

const rolloutRecordSchema = z.object({
  type: z.string(),
  timestamp: z.string().optional(),
  payload: z.record(z.unknown()),
});

function readForkSource(content: string, truncateBeforeUuid?: string) {
  let threadId: string | undefined;
  let currentTurnId: string | undefined;
  let targetTurnId: string | undefined;
  let userIndex = 0;
  const turnsWithUserMessages = new Set<string>();

  for (const line of content.split('\n')) {
    let value: unknown;
    try { value = JSON.parse(line); } catch { continue; }
    const result = rolloutRecordSchema.safeParse(value);
    if (!result.success) continue;
    const { type, payload, timestamp } = result.data;

    if (type === 'session_meta' && typeof payload.id === 'string') {
      threadId = payload.id;
      if (!truncateBeforeUuid) break;
    }
    if (type === 'event_msg' && payload.type === 'task_started') {
      currentTurnId = typeof payload.turn_id === 'string' ? payload.turn_id : undefined;
    } else if (type === 'turn_context' && typeof payload.turn_id === 'string') {
      currentTurnId = payload.turn_id;
    }

    if (type !== 'response_item' || payload.role !== 'user') continue;
    const text = extractUserText(payload);
    if (!text || isSystemMessage(text)) continue;
    if (generateStableUuid(timestamp ?? '', userIndex) === truncateBeforeUuid) {
      if (!currentTurnId) throw new Error('Cannot resolve the selected message to a Codex turn');
      if (turnsWithUserMessages.has(currentTurnId)) {
        throw new Error('Cannot fork before a message in the middle of a Codex turn; select the first message of a later turn');
      }
      targetTurnId = currentTurnId;
      break;
    }
    if (currentTurnId) turnsWithUserMessages.add(currentTurnId);
    userIndex++;
  }

  if (!threadId) throw new Error('Codex session metadata is missing a thread id');
  if (truncateBeforeUuid && !targetTurnId) throw new Error('Selected Codex message was not found in the session');
  return { threadId, targetTurnId };
}

async function findPreviousTurn(peer: CodexJsonRpcPeer, threadId: string, targetTurnId: string): Promise<string> {
  let previousTurnId: string | undefined;
  let cursor: string | null = null;
  const visitedCursors = new Set<string>();
  do {
    const page: ThreadTurnsListResponse = await peer.request(Methods.THREAD_TURNS_LIST, {
      threadId, cursor, sortDirection: 'asc', limit: 100, itemsView: 'notLoaded',
    });
    for (const turn of page.data) {
      if (turn.id === targetTurnId) {
        if (!previousTurnId) {
          throw new Error('Cannot fork before the first Codex turn; start a new session instead');
        }
        return previousTurnId;
      }
      previousTurnId = turn.id;
    }
    cursor = page.nextCursor;
    if (cursor) {
      if (visitedCursors.has(cursor)) throw new Error('Codex returned a repeated turn pagination cursor');
      visitedCursors.add(cursor);
    }
  } while (cursor);
  throw new Error('Selected Codex turn is no longer present in the session');
}

export async function forkCodexSession(codexSessionId: string): Promise<CodexForkResult> {
  return forkAndTruncateCodexSession(codexSessionId);
}

/** Preserve history before the selected user message, never mutating the source thread. */
export async function forkAndTruncateCodexSession(
  codexSessionId: string,
  truncateBeforeUuid?: string,
): Promise<CodexForkResult> {
  let peer: CodexJsonRpcPeer | undefined;
  try {
    const originalPath = findCodexSessionFile(codexSessionId);
    if (!originalPath) throw new Error(`Codex session file not found for: ${codexSessionId}`);
    const { threadId, targetTurnId } = readForkSource(await readCodexSessionContent(originalPath), truncateBeforeUuid);
    // Old Happy copies kept the source ID inside a renamed rollout. Do not silently fork the original instead.
    if (!basename(originalPath).endsWith(`-${threadId}.jsonl`)) {
      throw new Error('Codex session file does not match its thread id; copy the original session again');
    }

    peer = new CodexJsonRpcPeer();
    await peer.spawn('npx', ['-y', CODEX_PACKAGE, 'app-server'], { cwd: process.cwd() });
    await peer.request(Methods.INITIALIZE, {
      clientInfo: { name: 'happy-codex-fork', version: '1.0.0' },
      capabilities: { experimentalApi: true },
    } satisfies InitializeParams);
    peer.notify(Methods.INITIALIZED);

    const params: ThreadForkParams = { threadId, excludeTurns: true };
    if (targetTurnId) params.lastTurnId = await findPreviousTurn(peer, threadId, targetTurnId);
    const { thread } = await peer.request<ThreadForkResponse>(Methods.THREAD_FORK, params);
    if (!thread.id || thread.id === threadId || !thread.path || !isAbsolute(thread.path) || thread.path === originalPath) {
      throw new Error('Codex did not return an independent persisted fork');
    }
    if (!(await stat(thread.path)).isFile()) throw new Error('Codex fork rollout is not a file');

    logger.debug(`[CodexSessionFork] Forked ${threadId} -> ${thread.id}`);
    return { success: true, newFilePath: thread.path };
  } catch (error) {
    return {
      success: false,
      errorMessage: error instanceof Error ? error.message : 'Failed to fork Codex session',
    };
  } finally {
    await peer?.close();
  }
}
