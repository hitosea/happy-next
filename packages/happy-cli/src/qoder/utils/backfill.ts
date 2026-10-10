/**
 * Qoder Session Backfill
 *
 * ACP `session/load` replays the restored conversation as session updates. The
 * runner collects them while loading and this turns the user and agent text
 * into a message batch, so a resumed or copied session shows its history in the app.
 */

import { randomUUID } from 'node:crypto';
import type { SessionNotification } from '@agentclientprotocol/sdk';
import { stripQoderSessionInstructions } from '@/qoder/prompt';

type BackfillMessage = { content: unknown; localId: string };

export function buildQoderBackfillMessages(updates: SessionNotification['update'][], maxMessages = 200): BackfillMessage[] {
  const turns: { role: 'user' | 'agent'; text: string }[] = [];
  for (const update of updates) {
    if (update.sessionUpdate !== 'user_message_chunk' && update.sessionUpdate !== 'agent_message_chunk') continue;
    if (update.content.type !== 'text') continue;
    const role = update.sessionUpdate === 'user_message_chunk' ? 'user' : 'agent';
    const last = turns[turns.length - 1];
    if (last?.role === role) {
      last.text += update.content.text;
    } else {
      turns.push({ role, text: update.content.text });
    }
  }

  return turns
    .map((turn) => ({ role: turn.role, text: turn.role === 'user' ? stripQoderSessionInstructions(turn.text) : turn.text }))
    .filter((turn) => turn.text.trim().length > 0)
    .slice(-maxMessages)
    .map((turn) => ({
      localId: randomUUID(),
      content: turn.role === 'user'
        ? { role: 'user', content: { type: 'text', text: turn.text }, meta: { sentFrom: 'cli' } }
        : { role: 'agent', content: { type: 'acp', provider: 'qoder', data: { type: 'message', message: turn.text } }, meta: { sentFrom: 'cli' } },
    }));
}
