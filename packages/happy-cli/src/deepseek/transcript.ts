/**
 * DeepSeek Harness Session Transcript Reader
 *
 * `dsh` persists each session as append-only JSONL under
 * `$DSH_HOME/sessions/<cwd slug>/<id>/session.v4.jsonl.zstd` (one Zstandard frame per batch). Because ACP `session/resume`
 * restores conversation state without replaying historical notifications, this module
 * reads the persisted JSONL log for:
 *  1. Backfilling history into the app on session resume (`buildAcpBackfillMessages`).
 *  2. Computing incremental token usage per turn (`deepseekUsageAfter`).
 */

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as zlib from 'node:zlib';
import type { SessionNotification } from '@agentclientprotocol/sdk';
import { userPromptText } from 'happy-wire';
import { stripAcpSessionInstructions } from '@/agent/acp/sessionInstructions';
import type { SessionPreviewMessage } from '@/gemini/utils/sessionReader';
import { resolveDeepSeekHome } from '@/deepseek/constants';

export interface DeepSeekSessionEvent {
  seq?: number;
  type?: string;
  /** Epoch milliseconds, as dsh writes it. */
  time?: number;
  ts?: string | number;
  timestamp?: string | number;
  data?: Record<string, unknown>;
}

export interface DeepSeekUsageTokens {
  total: number;
  input: number;
  output: number;
  cache_creation: number;
  cache_read: number;
}

const ZSTD_MAGIC = 0xfd2fb528;

/**
 * dsh appends each durable batch as its own checksummed Zstandard frame, and Node's one-shot
 * decompressor stops after the first one (the session header). Walk the frame headers and decode
 * every complete frame; a torn final frame (dsh mid-write) ends the log.
 */
function decompressZstdFrames(bytes: Buffer): string | null {
  const decompress = (zlib as unknown as { zstdDecompressSync?: (input: Buffer) => Buffer }).zstdDecompressSync;
  if (typeof decompress !== 'function') return null;
  const decoded: Buffer[] = [];
  let offset = 0;
  try {
    while (offset + 5 <= bytes.length && bytes.readUInt32LE(offset) === ZSTD_MAGIC) {
      const start = offset;
      const descriptor = bytes[offset + 4];
      const contentSizeFlag = descriptor >>> 6;
      const singleSegment = (descriptor & 0x20) !== 0;
      const dictionaryFlag = descriptor & 3;
      offset += 5 + (singleSegment ? 0 : 1) + (dictionaryFlag === 3 ? 4 : dictionaryFlag)
        + (contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag);
      let lastBlock = false;
      while (!lastBlock && offset + 3 <= bytes.length) {
        const header = bytes.readUIntLE(offset, 3);
        lastBlock = (header & 1) !== 0;
        offset += 3 + (((header >>> 1) & 3) === 1 ? 1 : header >>> 3);
      }
      if ((descriptor & 4) !== 0) offset += 4;
      if (!lastBlock || offset > bytes.length) break;
      decoded.push(decompress(bytes.subarray(start, offset)));
    }
  } catch {
    // A corrupt frame ends the readable log; earlier frames still count
  }
  return decoded.length > 0 ? Buffer.concat(decoded).toString('utf8') : null;
}

/**
 * dsh keeps a session at `$DSH_HOME/sessions/<cwd slug>/<id>/session.v<N>.jsonl[.zstd]`; the slug is
 * dsh's own, so the folder holding `<id>` is looked up rather than derived from the cwd.
 */
async function findDeepSeekSessionLog(sessionsDir: string, sessionId: string): Promise<string | null> {
  for (const workspace of await readdir(sessionsDir, { withFileTypes: true }).catch(() => [])) {
    if (!workspace.isDirectory()) continue;
    const sessionDir = join(sessionsDir, workspace.name, sessionId);
    const logs = (await readdir(sessionDir).catch(() => [] as string[]))
      .filter((name) => /^session\.v\d+\.jsonl(\.zstd)?$/.test(name))
      .sort((a, b) => Number(b.match(/\d+/)![0]) - Number(a.match(/\d+/)![0]));
    if (logs.length > 0) return join(sessionDir, logs[0]);
  }
  return null;
}

/** A session's log file and its events, the `session` header first; null when there is none. */
export async function readDeepSeekSessionLog(
  sessionId: string,
  dshHome: string = resolveDeepSeekHome(),
): Promise<{ path: string; events: DeepSeekSessionEvent[] } | null> {
  if (!sessionId || sessionId.includes('/') || sessionId.includes('\\') || sessionId.startsWith('.')) return null;
  let path: string | null;
  let rawText: string | null;
  try {
    path = await findDeepSeekSessionLog(join(dshHome, 'sessions'), sessionId);
    if (!path) return null;
    rawText = path.endsWith('.zstd') ? decompressZstdFrames(await readFile(path)) : await readFile(path, 'utf8');
  } catch {
    return null;
  }

  const events: DeepSeekSessionEvent[] = [];
  for (const line of (rawText ?? '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        events.push(parsed as DeepSeekSessionEvent);
      }
    } catch {
      // Skip partial/non-JSON lines
    }
  }
  return { path, events };
}

/** Reads the raw JSONL events persisted for a DeepSeek Harness session id, or `[]` when unavailable. */
export async function readDeepSeekTranscript(
  sessionId: string,
  dshHome: string = resolveDeepSeekHome(),
): Promise<DeepSeekSessionEvent[]> {
  return (await readDeepSeekSessionLog(sessionId, dshHome))?.events ?? [];
}

export function extractTextBlocks(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .flatMap((block) => {
      if (!block || typeof block !== 'object') return [];
      const b = block as { type?: unknown; text?: unknown };
      return b.type === 'text' && typeof b.text === 'string' ? [b.text] : [];
    })
    .join('');
}

/**
 * Projects persisted DSH session events into ACP update shapes consumed by
 * `buildAcpBackfillMessages`.
 */
export function deepSeekEventsToAcpUpdates(events: DeepSeekSessionEvent[]): SessionNotification['update'][] {
  const updates: SessionNotification['update'][] = [];
  for (const event of events) {
    if (event.type === 'user/message') {
      const message = event.data?.message as { content?: unknown; source?: { kind?: unknown } } | undefined;
      const sourceKind = (event.data?.source as { kind?: unknown } | undefined)?.kind ?? message?.source?.kind;
      // Skip synthetic runtime-context / policy notices; keep real user prompts
      if (sourceKind && sourceKind !== 'user' && sourceKind !== 'user-rpc') continue;
      const text = extractTextBlocks(message?.content ?? event.data?.content);
      if (text.trim()) {
        updates.push({
          sessionUpdate: 'user_message_chunk',
          content: { type: 'text', text },
        });
      }
      continue;
    }

    if (event.type === 'tool/call') {
      const callId = typeof event.data?.callId === 'string' ? event.data.callId : 'tool';
      const title = typeof event.data?.name === 'string' ? event.data.name : 'tool';
      updates.push({
        sessionUpdate: 'tool_call',
        toolCallId: callId,
        title,
        kind: 'other',
        status: 'in_progress',
      });
      continue;
    }

    if (event.type === 'assistant/message') {
      const message = event.data?.message as { content?: unknown } | undefined;
      const text = extractTextBlocks(message?.content);
      if (text.trim()) {
        updates.push({
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text },
        });
      }
    }
  }
  return updates;
}

/** Sums token usage across `assistant/message` events with `seq > afterSeq`. */
export function deepSeekUsageAfter(
  events: DeepSeekSessionEvent[],
  afterSeq: number,
): { lastSeq: number; tokens: DeepSeekUsageTokens } {
  let lastSeq = afterSeq;
  const tokens: DeepSeekUsageTokens = {
    total: 0,
    input: 0,
    output: 0,
    cache_creation: 0,
    cache_read: 0,
  };

  for (let index = 0; index < events.length; index++) {
    const event = events[index];
    const seq = typeof event.seq === 'number' ? event.seq : index;
    if (seq <= afterSeq) continue;
    if (seq > lastSeq) lastSeq = seq;
    if (event.type !== 'assistant/message') continue;
    const usage = event.data?.usage as Record<string, unknown> | undefined;
    if (!usage) continue;
    const input = typeof usage.inputTokens === 'number' ? usage.inputTokens : 0;
    const output = typeof usage.outputTokens === 'number' ? usage.outputTokens : 0;
    const cacheRead = typeof usage.cacheReadTokens === 'number' ? usage.cacheReadTokens : 0;
    const cacheWrite = typeof usage.cacheWriteTokens === 'number' ? usage.cacheWriteTokens : 0;
    const total = typeof usage.totalTokens === 'number' ? usage.totalTokens : input + output;
    tokens.input += input;
    tokens.output += output;
    tokens.cache_read += cacheRead;
    tokens.cache_creation += cacheWrite;
    tokens.total += total;
  }

  return { lastSeq, tokens };
}

/** Last `limit` user and assistant messages from a DSH transcript, for orchestrator live previews. */
export function deepSeekPreviewMessages(events: DeepSeekSessionEvent[], limit: number): SessionPreviewMessage[] {
  const messages: SessionPreviewMessage[] = [];
  for (const event of events) {
    const rawTs = event.time ?? event.timestamp ?? event.ts;
    const timestamp = typeof rawTs === 'string'
      ? rawTs
      : typeof rawTs === 'number'
        ? new Date(rawTs).toISOString()
        : undefined;
    if (event.type === 'user/message') {
      const message = event.data?.message as { content?: unknown; source?: { kind?: unknown } } | undefined;
      const sourceKind = (event.data?.source as { kind?: unknown } | undefined)?.kind ?? message?.source?.kind;
      if (sourceKind && sourceKind !== 'user' && sourceKind !== 'user-rpc') continue;
      const text = userPromptText(stripAcpSessionInstructions(extractTextBlocks(message?.content ?? event.data?.content)));
      if (text?.trim()) messages.push({ role: 'user', content: text.trim(), timestamp });
    } else if (event.type === 'assistant/message') {
      const message = event.data?.message as { content?: unknown } | undefined;
      const text = extractTextBlocks(message?.content).trim();
      if (text) messages.push({ role: 'assistant', content: text, timestamp });
    }
  }
  return messages.slice(-limit);
}
