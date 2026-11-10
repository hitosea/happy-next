import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentMessage } from '../core';
import { QoderTransport } from '../factories/qoder';
import { DefaultTransport } from '../transport';
import type { TransportHandler } from '../transport';
import { handleToolCall, type HandlerContext } from './sessionUpdateHandlers';

vi.mock('@/ui/logger', () => ({ logger: { debug: vi.fn(), warn: vi.fn() } }));

function context(transport: TransportHandler) {
  const emitted: AgentMessage[] = [];
  const ctx: HandlerContext = {
    transport,
    activeToolCalls: new Set(),
    toolCallStartTimes: new Map(),
    toolCallTimeouts: new Map(),
    toolCallIdToNameMap: new Map(),
    idleTimeout: null,
    toolCallCountSincePrompt: 0,
    emit: (msg) => emitted.push(msg),
    emitIdleStatus: vi.fn(),
    clearIdleTimeout: vi.fn(),
    setIdleTimeout: vi.fn(),
  };
  return { ctx, toolCalls: () => emitted.filter((msg) => msg.type === 'tool-call') };
}

describe('handleToolCall', () => {
  let ctx: HandlerContext | undefined;

  afterEach(() => {
    ctx?.toolCallTimeouts.forEach((timeout) => clearTimeout(timeout));
    ctx = undefined;
  });

  it('emits the tool a Qoder mcp_call runs, with its arguments flat and no wrapper title', () => {
    const handler = context(new QoderTransport('qoder'));
    ctx = handler.ctx;

    handleToolCall({
      sessionUpdate: 'tool_call',
      toolCallId: 'call_00_a',
      kind: 'other',
      title: 'mcp_call',
      rawInput: { toolName: 'mcp__happy__preview_html', arguments: { path: '/tmp/a.html' } },
      _meta: { qoder: { toolName: 'mcp_call' } },
    }, ctx);

    expect(handler.toolCalls()).toEqual([{ type: 'tool-call', toolName: 'mcp__happy__preview_html', args: { path: '/tmp/a.html' }, callId: 'call_00_a' }]);
    expect(ctx.toolCallIdToNameMap.get('call_00_a')).toBe('mcp__happy__preview_html');
  });

  it('keeps rawInput and the title as description for calls the transport does not unwrap', () => {
    const handler = context(new DefaultTransport('test'));
    ctx = handler.ctx;

    handleToolCall({ sessionUpdate: 'tool_call', toolCallId: 'call_01_b', kind: 'execute', title: 'git status', rawInput: { command: 'git status' } }, ctx);

    expect(handler.toolCalls()).toEqual([{ type: 'tool-call', toolName: 'execute', args: { command: 'git status', description: 'git status' }, callId: 'call_01_b' }]);
  });
});
