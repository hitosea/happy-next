/**
 * ACP Session Backfill (Antigravity, Qoder)
 *
 * ACP `session/load` replays the restored conversation as session updates. The
 * runner collects them while loading and this turns the user prompts and the text
 * each turn ended on into a message batch, so a resumed or copied session shows
 * its history in the app.
 */

import type { SessionNotification } from '@agentclientprotocol/sdk';
import { stripAcpSessionInstructions } from '@/agent/acp/sessionInstructions';
import { userPromptText } from 'happy-wire';
import { selectBackfillTurns, withForkedHistoryNotices } from '@/modules/common/backfillTurns';

type BackfillMessage = { content: unknown; localId: string };

export function buildAcpBackfillMessages(updates: SessionNotification['update'][], sessionId: string, provider: 'antigravity' | 'deepseek' | 'qoder', maxTurns = 20): BackfillMessage[] {
  // Chunks of one role run together into a message; a tool call ends the agent's, so the text after
  // the turn's last tool call is a message of its own — the reply the turn ended on.
  const entries: { role: 'user' | 'agent'; text: string; index: number }[] = [];
  let continues = false;
  for (const update of updates) {
    if (update.sessionUpdate === 'tool_call') {
      continues = false;
      continue;
    }
    if (update.sessionUpdate !== 'user_message_chunk' && update.sessionUpdate !== 'agent_message_chunk') continue;
    if (update.content.type !== 'text') continue;
    const role = update.sessionUpdate === 'user_message_chunk' ? 'user' : 'agent';
    const last = entries[entries.length - 1];
    if (continues && last?.role === role) {
      last.text += update.content.text;
    } else {
      entries.push({ role, text: update.content.text, index: entries.length });
    }
    continues = true;
  }

  // A prompt the user never sent is left out, so the reply after it still ends the turn before
  const texts = entries.flatMap((entry) => {
    const text = entry.role === 'user' ? userPromptText(stripAcpSessionInstructions(entry.text)) : entry.text;
    return text?.trim() ? [{ ...entry, text }] : [];
  });
  const { selected, omittedTurns } = selectBackfillTurns(texts, (entry) => entry.role === 'agent' ? 'reply' : 'prompt', maxTurns);
  const localIdPrefix = `${provider}-log:${sessionId}:`;
  return withForkedHistoryNotices(localIdPrefix, omittedTurns, selected.map((entry) => ({
    localId: `${localIdPrefix}${entry.index}`,
    content: entry.role === 'user'
      ? { role: 'user', content: { type: 'text', text: entry.text }, meta: { sentFrom: 'cli' } }
      : { role: 'agent', content: { type: 'acp', provider, data: { type: 'message', message: entry.text } }, meta: { sentFrom: 'cli' } },
  })));
}
