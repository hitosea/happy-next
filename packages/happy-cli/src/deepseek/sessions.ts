/**
 * DeepSeek Harness session copy, for the app's resume, copy, duplicate, fork-from-message and upgrade flows.
 *
 * dsh forks sessions itself (its session controller's `fork`), but not over ACP, so the copy is
 * written on disk the way that fork writes one: a header with the new id and `isSeeded: true`, the
 * source's events through a cut copied as they are, then a `session/end-seed` event marked
 * `inherited: true`. dsh reads that marker as the end of the inherited prefix, whose events may
 * still name the source session. The cut is the one dsh's fork picks, the end of a completed turn
 * (plus what follows it before the next prompt), so no open step or tool call needs closing.
 * `session/resume` of the new id then replays nothing and continues the conversation; Happy's
 * resume backfills the history from the copy. Verified against dsh 0.2.2.
 */

import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import * as zlib from 'node:zlib';
import { userPromptText } from 'happy-wire';
import { stripAcpSessionInstructions } from '@/agent/acp/sessionInstructions';
import { resolveDeepSeekHome } from '@/deepseek/constants';
import { extractTextBlocks, readDeepSeekSessionLog, type DeepSeekSessionEvent } from '@/deepseek/transcript';
import { logger } from '@/ui/logger';
import type { SessionUserMessage } from '@/utils/sessionUserMessages';

interface UserPrompt {
  /** Position of the prompt's `user/message` among the session's events (header excluded). */
  at: number;
  message: SessionUserMessage;
}

/** The prompts the user sent, oldest first; dsh's own context messages (instructions, skills) are not. */
function userPrompts(events: DeepSeekSessionEvent[]): UserPrompt[] {
  const prompts: UserPrompt[] = [];
  events.forEach((event, at) => {
    const data = event.data as { id?: unknown; source?: { kind?: unknown }; content?: unknown } | undefined;
    if (event.type !== 'user/message' || data?.source?.kind !== 'user' || typeof data.id !== 'string') return;
    const content = userPromptText(stripAcpSessionInstructions(extractTextBlocks(data.content)));
    if (!content) return;
    const timestamp = typeof event.time === 'number' ? new Date(event.time).toISOString() : undefined;
    prompts.push({ at, message: { uuid: data.id, content, timestamp, index: prompts.length } });
  });
  return prompts;
}

/**
 * The last event of the latest completed turn among `events`, with the bookkeeping that follows it
 * up to the next prompt, as dsh's fork cuts; -1 before any turn completed.
 */
function completedPrefixEnd(events: DeepSeekSessionEvent[]): number {
  let end = events.map((event) => event.type).lastIndexOf('turn/end');
  if (end === -1) return -1;
  for (const next of events.slice(end + 1)) {
    if (next.type === 'turn/start' || next.type === 'agent/inbox/spliced' || (next.type === 'user/message' && (next as { surfaceOp?: unknown }).surfaceOp === 'append')) break;
    end++;
  }
  return end;
}

async function readSessionEvents(sessionId: string, dshHome: string) {
  const log = await readDeepSeekSessionLog(sessionId, dshHome);
  const [header, ...events] = log?.events ?? [];
  if (!log || header?.type !== 'session') throw new Error(`DeepSeek session ${sessionId} was not found`);
  // Events are numbered from 0 with no gap; a torn or skipped one ends what can be copied
  const dense = events.findIndex((event, index) => event.seq !== index);
  return { path: log.path, header: header as Record<string, unknown>, events: dense === -1 ? events : events.slice(0, dense) };
}

/** The user messages of a DeepSeek session, oldest first. Each message's uuid is dsh's id for it. */
export async function readDeepSeekSessionUserMessages(sessionId: string, dshHome: string = resolveDeepSeekHome()): Promise<SessionUserMessage[]> {
  return userPrompts((await readSessionEvents(sessionId, dshHome)).events).map((prompt) => prompt.message);
}

/**
 * Copies a DeepSeek session into a new dsh session beside it and returns the new id. The copy ends
 * with the last completed turn or, with `truncateBeforeUuid` (a user message's uuid from
 * readDeepSeekSessionUserMessages), before that message's turn.
 */
export async function forkDeepSeekSession(
  sessionId: string,
  options: { dshHome?: string; truncateBeforeUuid?: string } = {},
): Promise<string> {
  const { path, header, events } = await readSessionEvents(sessionId, options.dshHome ?? resolveDeepSeekHome());
  let before = events.length;
  if (options.truncateBeforeUuid) {
    const prompt = userPrompts(events).find((candidate) => candidate.message.uuid === options.truncateBeforeUuid);
    if (!prompt) throw new Error('The message to copy up to was not found in the DeepSeek session');
    before = prompt.at;
  }
  const end = completedPrefixEnd(events.slice(0, before));

  const newSessionId = randomUUID();
  const { cwd, delegationDepth, agentPreset } = header;
  const newHeader = { type: 'session', version: header.version, id: newSessionId, createdAt: Date.now(), cwd, isSeeded: true, delegationDepth: delegationDepth ?? 0, agentPreset };
  const inherited = events.slice(0, end + 1);
  const marker = { type: 'session/end-seed', seq: end + 1, time: inherited.at(-1)?.time ?? Date.now(), data: { inherited: true } };
  // dsh reads the header as a record of its own: one line, and its own frame when compressed
  const records = [[newHeader], [...inherited, marker]].map((batch) => `${batch.map((event) => JSON.stringify(event)).join('\n')}\n`);
  const fileName = basename(path);
  let content: string | Buffer = records.join('');
  if (fileName.endsWith('.zstd')) {
    // Node.js 22.15+ has zstd; a dsh writing compressed logs needs a Node.js at least that new anyway
    const { zstdCompressSync, constants } = zlib as unknown as {
      zstdCompressSync?: (input: string, options: { params: Record<number, number> }) => Buffer;
      constants: Record<string, number>;
    };
    if (typeof zstdCompressSync !== 'function') throw new Error(`Copying a DeepSeek session needs Node.js 22.15 or newer (running ${process.version})`);
    content = Buffer.concat(records.map((record) => zstdCompressSync(record, { params: { [constants.ZSTD_c_checksumFlag]: 1 } })));
  }

  const sessionDir = join(dirname(dirname(path)), newSessionId);
  try {
    await mkdir(sessionDir, { mode: 0o700 });
    await writeFile(join(sessionDir, fileName), content, { mode: 0o600, flag: 'wx' });
  } catch (error) {
    await rm(sessionDir, { recursive: true, force: true });
    throw error;
  }
  logger.debug(`[DeepSeek] Copied session ${sessionId} into ${newSessionId} through event ${end}`);
  return newSessionId;
}
