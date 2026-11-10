/**
 * How full a Qoder conversation's context window is, for the app's context indicator.
 *
 * qodercli sends no usage_update over ACP. With QODER_EXPOSE_TOKEN_USAGE set (see
 * createQoderBackend) its transcript gives each request's `message.usage`: the prompt's
 * `input_tokens` and the share of the window it used, `context_usage_ratio`
 * (input_tokens / window), so the two give the window too. Without the variable it
 * records no usage (1.1.85+) or only the ratio with zero counts (earlier versions).
 */

import { join } from 'node:path';
import { getMaxContextSize } from 'happy-wire';
import { findClaudeProjectId } from '@/claude/utils/claudeSessionIndex';
import { qoderTranscriptStore } from '@/qoder/transcripts';
import { readTailLines } from '@/utils/readTailLines';

type TranscriptRecord = {
  type?: string;
  isSidechain?: boolean;
  message?: { model?: string; usage?: { input_tokens?: number; context_usage_ratio?: number } };
};

/**
 * The context use of Qoder conversation `sessionId` after its latest request, or null
 * when qodercli has not recorded it.
 */
export async function readQoderContextUsage(sessionId: string): Promise<{ usedTokens: number; windowSize: number } | null> {
  const store = qoderTranscriptStore();
  const projectId = await findClaudeProjectId(sessionId, store);
  if (!projectId) return null;
  for (const line of await readTailLines(join(store.configDir, 'projects', projectId, `${sessionId}.jsonl`))) {
    if (!line.includes('"context_usage_ratio"')) continue;
    const record = JSON.parse(line) as TranscriptRecord;
    const ratio = record.message?.usage?.context_usage_ratio;
    if (record.type !== 'assistant' || record.isSidechain || typeof ratio !== 'number' || ratio <= 0) continue;
    const inputTokens = record.message?.usage?.input_tokens;
    if (typeof inputTokens === 'number' && inputTokens > 0) {
      // The ratio is rounded to five decimals; windows are whole thousands of tokens.
      return { usedTokens: inputTokens, windowSize: Math.round(inputTokens / ratio / 1000) * 1000 };
    }
    // Zero counts: the share the app shows stays exact, the token count is an estimate.
    const windowSize = getMaxContextSize(record.message?.model, 'qoder');
    return { usedTokens: Math.round(ratio * windowSize), windowSize };
  }
  return null;
}
