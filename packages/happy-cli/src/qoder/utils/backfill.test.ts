import { describe, expect, it } from 'vitest';
import type { SessionNotification } from '@agentclientprotocol/sdk';
import { buildQoderBackfillMessages } from './backfill';

const text = (sessionUpdate: string, value: string) => ({ sessionUpdate, content: { type: 'text', text: value } }) as SessionNotification['update'];

describe('buildQoderBackfillMessages', () => {
  it('merges chunks into turns and drops thoughts, tool calls and session guidance', () => {
    const messages = buildQoderBackfillMessages([
      text('user_message_chunk', 'Hello\n\n<happy-session-instructions>\nSet a title\n</happy-session-instructions>'),
      text('agent_thought_chunk', 'thinking'),
      text('agent_message_chunk', 'Hi '),
      { sessionUpdate: 'tool_call', toolCallId: 't1', title: 'Read' } as SessionNotification['update'],
      text('agent_message_chunk', 'there'),
      text('user_message_chunk', 'Thanks'),
    ]);

    expect(messages.map((message) => message.content)).toEqual([
      { role: 'user', content: { type: 'text', text: 'Hello' }, meta: { sentFrom: 'cli' } },
      { role: 'agent', content: { type: 'acp', provider: 'qoder', data: { type: 'message', message: 'Hi there' } }, meta: { sentFrom: 'cli' } },
      { role: 'user', content: { type: 'text', text: 'Thanks' }, meta: { sentFrom: 'cli' } },
    ]);
    expect(new Set(messages.map((message) => message.localId)).size).toBe(3);
  });

  it('keeps only the latest turns', () => {
    const updates = ['a', 'b', 'c'].flatMap((value) => [text('user_message_chunk', value), text('agent_message_chunk', value.toUpperCase())]);
    expect(buildQoderBackfillMessages(updates, 2).map((message) => message.content)).toEqual([
      expect.objectContaining({ role: 'user', content: { type: 'text', text: 'c' } }),
      expect.objectContaining({ role: 'agent' }),
    ]);
  });
});
