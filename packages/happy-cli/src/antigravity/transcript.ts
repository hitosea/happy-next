/**
 * agy's own log of a conversation, one JSON line per step:
 * ~/.gemini/antigravity-cli/brain/<id>/.system_generated/logs/transcript.jsonl.
 *
 * Unlike the SQLite conversation it is plain JSON, with each model call's token counts, so it
 * backs the orchestrator's live preview and the usage report. A copied conversation's log only
 * has the steps taken since the copy, so the history itself is read from SQLite (sessions.ts).
 * The format is agy's internal one (verified against 1.5.16): a missing file or a line that does
 * not parse is skipped, and only costs the preview or the usage of those steps.
 */

import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { userPromptText } from 'happy-wire';
import { stripAcpSessionInstructions } from '@/agent/acp/sessionInstructions';
import type { SessionPreviewMessage } from '@/gemini/utils/sessionReader';

export interface AntigravityTranscriptStep {
  step_index: number;
  type: string;
  created_at?: string;
  content?: string;
  input_tokens?: number;
  cache_read_tokens?: number;
  output_tokens?: number;
}

/** Steps of an Antigravity conversation in the order agy took them; none when agy has not written the log. */
export async function readAntigravityTranscript(sessionId: string, home: string = homedir()): Promise<AntigravityTranscriptStep[]> {
  const path = join(home, '.gemini', 'antigravity-cli', 'brain', sessionId, '.system_generated', 'logs', 'transcript.jsonl');
  const text = await readFile(path, 'utf8').catch(() => '');
  return text.split('\n').flatMap((line): AntigravityTranscriptStep[] => {
    try {
      const step = JSON.parse(line) as AntigravityTranscriptStep;
      return typeof step?.step_index === 'number' && typeof step.type === 'string' ? [step] : [];
    } catch {
      return [];
    }
  });
}

/** agy wraps what the user sent in <USER_REQUEST> and appends context of its own after it. */
const USER_REQUEST = /<USER_REQUEST>\n?([\s\S]*?)\n?<\/USER_REQUEST>/;

/** The last `limit` messages of the conversation: what the user sent and the model's replies. */
export function antigravityPreviewMessages(steps: AntigravityTranscriptStep[], limit: number): SessionPreviewMessage[] {
  const messages = steps.flatMap((step): SessionPreviewMessage[] => {
    const content = step.content?.trim();
    if (!content) return [];
    if (step.type === 'PLANNER_RESPONSE') return [{ role: 'assistant', content, timestamp: step.created_at }];
    if (step.type !== 'USER_INPUT') return [];
    const sent = userPromptText(stripAcpSessionInstructions(content.match(USER_REQUEST)?.[1] ?? content));
    return sent ? [{ role: 'user', content: sent, timestamp: step.created_at }] : [];
  });
  return messages.slice(-limit);
}

/**
 * Tokens of the model calls after step `afterStep`, in the breakdown usage reports take. agy's
 * `input_tokens` already leaves out what was read from cache.
 */
export function antigravityUsageAfter(steps: AntigravityTranscriptStep[], afterStep: number): { lastStep: number; tokens: { total: number; input: number; output: number; cache_creation: number; cache_read: number } } {
  const tokens = { total: 0, input: 0, output: 0, cache_creation: 0, cache_read: 0 };
  let lastStep = afterStep;
  for (const step of steps) {
    if (step.step_index <= afterStep) continue;
    lastStep = Math.max(lastStep, step.step_index);
    tokens.input += step.input_tokens ?? 0;
    tokens.output += step.output_tokens ?? 0;
    tokens.cache_read += step.cache_read_tokens ?? 0;
  }
  tokens.total = tokens.input + tokens.output + tokens.cache_read;
  return { lastStep, tokens };
}
