import { describe, expect, it } from 'vitest';
import { extractCodexSessionId, extractGeminiSessionId, extractGeminiSessionIdFromJsonLine, normalizeAntigravityOutputText, normalizeDeepSeekOutputText, normalizeGeminiOutputText } from './orchestratorOutput';

describe('normalizeGeminiOutputText', () => {
  it('keeps plain text output unchanged when stdout is not JSON', () => {
    const stdout = 'Hello from Gemini\nHow can I help?\n';
    expect(normalizeGeminiOutputText(stdout)).toBe('Hello from Gemini\nHow can I help?');
  });

  it('extracts natural language text from single JSON output', () => {
    const stdout = JSON.stringify({
      session_id: '11111111-2222-4333-8444-555555555555',
      response: {
        parts: [{ text: '这是纯文本回答' }],
      },
    });
    expect(normalizeGeminiOutputText(stdout)).toBe('这是纯文本回答');
  });

  it('uses only the response field and ignores metadata strings next to it', () => {
    const stdout = JSON.stringify({
      session_id: '11111111-2222-4333-8444-555555555555',
      response: '最终回答',
      stats: { models: { 'gemini-2.5-pro': { api: { totalRequests: 1 } } }, note: 'telemetry note' },
    });
    expect(normalizeGeminiOutputText(stdout)).toBe('最终回答');
  });

  it('extracts natural language text from line-delimited JSON output', () => {
    const stdout = [
      JSON.stringify({ session_id: '11111111-2222-4333-8444-555555555555' }),
      JSON.stringify({ output: { text: '第一段' } }),
      JSON.stringify({ output: { text: '第二段' } }),
    ].join('\n');

    expect(normalizeGeminiOutputText(stdout)).toBe('第一段\n第二段');
  });
});

describe('extractCodexSessionId', () => {
  it('extracts session id from codex output header', () => {
    const output = 'session id: 019cfcd3-1c88-79f2-81f2-cbad04e7a7a8\n';
    expect(extractCodexSessionId(output)).toBe('019cfcd3-1c88-79f2-81f2-cbad04e7a7a8');
  });

  it('extracts session id when output contains ANSI color escapes', () => {
    const output = 'session id: \u001b[32m019cfcd3-1c88-79f2-81f2-cbad04e7a7a8\u001b[0m\n';
    expect(extractCodexSessionId(output)).toBe('019cfcd3-1c88-79f2-81f2-cbad04e7a7a8');
  });
});

describe('extractGeminiSessionIdFromJsonLine', () => {
  it('extracts session_id from gemini json line', () => {
    const line = JSON.stringify({ session_id: '11111111-2222-4333-8444-555555555555' });
    expect(extractGeminiSessionIdFromJsonLine(line)).toBe('11111111-2222-4333-8444-555555555555');
  });
});

describe('extractGeminiSessionId', () => {
  it('extracts conversation_id from Antigravity print-mode JSON', () => {
    const stdout = JSON.stringify({ conversation_id: 'd0268b9f-972d-447f-bf01-96a44a40e632', status: 'SUCCESS', response: '1\n' });
    expect(extractGeminiSessionId(stdout)).toBe('d0268b9f-972d-447f-bf01-96a44a40e632');
    expect(normalizeGeminiOutputText(stdout)).toBe('1');
  });

  it('extracts session_id from pretty-printed JSON output', () => {
    const stdout = JSON.stringify({
      session_id: '11111111-2222-4333-8444-555555555555',
      response: 'hello',
    }, null, 2);
    expect(extractGeminiSessionId(stdout)).toBe('11111111-2222-4333-8444-555555555555');
  });

  it('extracts session_id from single-line JSON output', () => {
    const stdout = JSON.stringify({ session_id: '22222222-3333-4444-8555-666666666666' });
    expect(extractGeminiSessionId(stdout)).toBe('22222222-3333-4444-8555-666666666666');
  });

  it('extracts session_id from line-delimited JSON output', () => {
    const stdout = [
      JSON.stringify({ session_id: '33333333-4444-5555-8666-777777777777' }),
      JSON.stringify({ output: { text: 'hello' } }),
    ].join('\n');
    expect(extractGeminiSessionId(stdout)).toBe('33333333-4444-5555-8666-777777777777');
  });

  it('returns null for output without session_id', () => {
    expect(extractGeminiSessionId('plain text output')).toBeNull();
    expect(extractGeminiSessionId(JSON.stringify({ response: 'hello' }))).toBeNull();
    expect(extractGeminiSessionId('')).toBeNull();
  });
});

describe('normalizeAntigravityOutputText', () => {
  const id = '394d3a42-6be8-48a3-afa4-57a85f609d1b';
  const lines = [
    { event: 'init', conversation_id: id, init: { cwd: '/tmp', tools: ['browser_click_element', 'run_command'] } },
    { event: 'step_update', step_update: { conversation_id: id, step_index: 0, state: 'DONE', step_type: 'user_input' } },
    { event: 'step_update', step_update: { conversation_id: id, step_index: 1, state: 'ACTIVE', step_type: 'agent_response', text_delta: 'Hel' } },
    { event: 'step_update', step_update: { conversation_id: id, step_index: 1, state: 'DONE', step_type: 'agent_response', text_delta: 'lo\n' } },
  ].map((line) => JSON.stringify(line));
  const result = JSON.stringify({ event: 'result', result: { conversation_id: id, status: 'SUCCESS', response: 'Hello\n' } });

  it('names the conversation from the first streamed line', () => {
    expect(extractGeminiSessionIdFromJsonLine(lines[0])).toBe(id);
    expect(extractGeminiSessionId([...lines, result].join('\n'))).toBe(id);
  });

  it('reads the answer from the result event, leaving out the tool list', () => {
    expect(normalizeAntigravityOutputText([...lines, result].join('\n'))).toBe('Hello');
  });

  it('falls back to the reply streamed so far when the run ends without a result', () => {
    expect(normalizeAntigravityOutputText(lines.join('\n'))).toBe('Hello');
  });

  it('still reads a single JSON document', () => {
    expect(normalizeAntigravityOutputText(JSON.stringify({ conversation_id: id, status: 'SUCCESS', response: '1\n' }))).toBe('1');
  });
});

describe('normalizeDeepSeekOutputText', () => {
  const id = 'dsh-session-019d0000-1111-7222-8333-444444444444';
  const lines = [
    JSON.stringify({ type: 'session', sessionId: id, cwd: '/tmp' }),
    JSON.stringify({ type: 'tool_call', name: 'read', arguments: { path: 'README.md' } }),
    JSON.stringify({ type: 'final', sessionId: id, reason: 'stop', text: 'DeepSeek final answer\n' }),
  ];

  it('extracts camelCase sessionId from headless NDJSON lines', () => {
    expect(extractGeminiSessionIdFromJsonLine(lines[0])).toBe(id);
    expect(extractGeminiSessionId(lines.join('\n'))).toBe(id);
  });

  it('extracts the final event text cleanly', () => {
    expect(normalizeDeepSeekOutputText(lines.join('\n'))).toBe('DeepSeek final answer');
  });

  it('returns plain text unchanged when stdout is not NDJSON', () => {
    expect(normalizeDeepSeekOutputText('plain output\n')).toBe('plain output');
  });
});
