import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionNotification } from '@agentclientprotocol/sdk';
import { buildQoderBackfillMessages } from './backfill';

const text = (sessionUpdate: string, value: string) => ({ sessionUpdate, content: { type: 'text', text: value } }) as SessionNotification['update'];

describe('buildQoderBackfillMessages', () => {
  // A session copied from another has these set, which adds a notice of where it came from
  beforeEach(() => {
    vi.stubEnv('HAPPY_FORKED_FROM_SESSION_ID', '');
    vi.stubEnv('HAPPY_FORKED_FROM_TITLE', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('keeps each prompt and the text its turn ended on, dropping thoughts, tool calls and session guidance', () => {
    const messages = buildQoderBackfillMessages([
      text('user_message_chunk', 'Hello\n\n<happy-session-instructions>\nSet a title\n</happy-session-instructions>'),
      text('agent_thought_chunk', 'thinking'),
      text('agent_message_chunk', 'Hi '),
      { sessionUpdate: 'tool_call', toolCallId: 't1', title: 'Read' } as SessionNotification['update'],
      text('agent_message_chunk', 'there'),
      text('user_message_chunk', 'Thanks'),
    ], 'q1');

    expect(messages.map((message) => message.content)).toEqual([
      { role: 'user', content: { type: 'text', text: 'Hello' }, meta: { sentFrom: 'cli' } },
      { role: 'agent', content: { type: 'acp', provider: 'qoder', data: { type: 'message', message: 'there' } }, meta: { sentFrom: 'cli' } },
      { role: 'user', content: { type: 'text', text: 'Thanks' }, meta: { sentFrom: 'cli' } },
    ]);
    expect(messages.map((message) => message.localId)).toEqual(['q1:0', 'q1:2', 'q1:3'].map((id) => `qoder-log:${id}`));
  });

  it('keeps only the latest turns, under a notice of how many it left out', () => {
    const updates = ['a', 'b', 'c'].flatMap((value) => [text('user_message_chunk', value), text('agent_message_chunk', value.toUpperCase())]);
    expect(buildQoderBackfillMessages(updates, 'q1', 1).map((message) => message.content)).toEqual([
      expect.objectContaining({ content: expect.objectContaining({ type: 'event', data: { type: 'forked-history', omittedTurns: 2 } }) }),
      expect.objectContaining({ role: 'user', content: { type: 'text', text: 'c' } }),
      expect.objectContaining({ role: 'agent' }),
    ]);
  });

  it('leaves out the callbacks Happy handed the agent', () => {
    const messages = buildQoderBackfillMessages([
      text('user_message_chunk', 'Run it'),
      text('agent_message_chunk', 'Started'),
      text('user_message_chunk', '<orchestrator-callback>\nRun "x" (r1) reached terminal state: completed.\n</orchestrator-callback>'),
      text('agent_message_chunk', 'It finished'),
    ], 'q1');
    expect(messages.map((message) => message.content)).toEqual([
      expect.objectContaining({ role: 'user', content: { type: 'text', text: 'Run it' } }),
      expect.objectContaining({ content: expect.objectContaining({ data: { type: 'message', message: 'It finished' } }) }),
    ]);
  });
});
