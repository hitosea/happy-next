import { describe, expect, it, vi } from 'vitest';
import type { AcpBackendOptions } from '../acp/AcpBackend';

const mocks = vi.hoisted(() => ({ createBackend: vi.fn() }));
vi.mock('../acp/AcpBackend', () => ({
  AcpBackend: class {
    constructor(public options: AcpBackendOptions) { mocks.createBackend(options); }
  },
}));
vi.mock('@/ui/logger', () => ({ logger: { debug: vi.fn(), warn: vi.fn() } }));
vi.mock('@/qoder/constants', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/qoder/constants')>()),
  resolveQoderCommand: () => '/opt/qoder/qodercli',
}));
import { QoderTransport, createQoderBackend, qoderMcpToolName, unwrapQoderMcpCall } from './qoder';

describe('createQoderBackend', () => {
  it('runs qodercli in ACP mode with SDK variables blanked, token usage exposed and the resume session passed on', () => {
    const onReplayedUpdate = vi.fn();
    createQoderBackend({ cwd: '/work', env: { QODER_AGENT_SDK_ENTRYPOINT: 'desktop', KEEP: '1' }, resumeSessionId: 'abc', onReplayedUpdate });

    expect(mocks.createBackend).toHaveBeenCalledWith(expect.objectContaining({
      agentName: 'qoder',
      cwd: '/work',
      command: '/opt/qoder/qodercli',
      args: ['--acp'],
      env: expect.objectContaining({ QODER_AGENT_SDK_ENTRYPOINT: '', QODER_EXPOSE_TOKEN_USAGE: '1', KEEP: '1' }),
      resumeSessionId: 'abc',
      onReplayedUpdate,
    }));
  });
});

describe('QoderTransport', () => {
  const transport = new QoderTransport('qoder');

  it('reads an MCP tool name back from the title', () => {
    expect(transport.identifyToolCall({ kind: 'other', title: 'change_title (happy)' })).toEqual({ name: 'mcp__happy__change_title' });
    expect(transport.identifyToolCall({ kind: 'other', title: 'change_title (happy MCP Server)' })).toEqual({ name: 'mcp__happy__change_title' });
  });

  it('names plan mode calls from _meta, where their tool call and permission request titles differ', () => {
    const enterPlan = { kind: 'other', _meta: { qoder: { toolName: 'EnterPlanMode' } } };
    expect(transport.identifyToolCall({ ...enterPlan, title: 'EnterPlanMode' })).toEqual({ name: 'EnterPlanMode' });
    expect(transport.identifyToolCall({ ...enterPlan, title: 'Allow entering plan mode?' })).toEqual({ name: 'EnterPlanMode' });
    expect(transport.identifyToolCall({ kind: 'switch_mode', title: 'Exit plan mode', _meta: { qoder: { toolName: 'ExitPlanMode' } } })).toEqual({ name: 'ExitPlanMode' });
  });

  it('names an mcp_call after the MCP tool it runs, with that tool\'s arguments, in its tool call and permission request alike', () => {
    const rawInput = { toolName: 'mcp__happy__change_title', arguments: { title: 'Fix login' } };
    const identified = { name: 'mcp__happy__change_title', input: { title: 'Fix login' } };
    expect(transport.identifyToolCall({ kind: 'other', title: 'mcp_call', rawInput, _meta: { qoder: { toolName: 'mcp_call' } } })).toEqual(identified);
    expect(transport.identifyToolCall({ kind: 'other', title: 'Allow MCP tool happy/change_title?', rawInput, _meta: { qoder: { toolName: 'mcp_call' } } })).toEqual(identified);
    expect(transport.identifyToolCall({ kind: 'other', title: 'mcp_call', rawInput })).toEqual(identified);
  });

  it('keeps the mcp_call name when its input names no tool', () => {
    expect(transport.identifyToolCall({ kind: 'other', title: 'mcp_call', rawInput: {} })).toEqual({ name: 'mcp_call' });
  });

  it('falls back to the title, and leaves calls whose kind names them alone', () => {
    expect(transport.identifyToolCall({ kind: 'other', title: 'Allow entering plan mode?' })).toEqual({ name: 'Allow entering plan mode?' });
    expect(transport.identifyToolCall({ kind: 'execute', title: 'git status (repo)', _meta: { qoder: { toolName: 'Bash' } } })).toBeNull();
  });
});

describe('qoderMcpToolName', () => {
  it('reads both title forms qodercli uses', () => {
    expect(qoderMcpToolName('change_title (happy)')).toBe('mcp__happy__change_title');
    expect(qoderMcpToolName('change_title (happy MCP Server)')).toBe('mcp__happy__change_title');
    expect(qoderMcpToolName('Run tests')).toBeNull();
  });
});

describe('unwrapQoderMcpCall', () => {
  it('reads the tool and its arguments, giving a <server>/<tool> name in qodercli\'s form', () => {
    expect(unwrapQoderMcpCall({ toolName: 'mcp__happy__preview_html', arguments: { path: '/tmp/a.html' } }))
      .toEqual({ name: 'mcp__happy__preview_html', input: { path: '/tmp/a.html' } });
    expect(unwrapQoderMcpCall({ toolName: 'happy/orchestrator_list', arguments: { status: 'running' } }))
      .toEqual({ name: 'mcp__happy__orchestrator_list', input: { status: 'running' } });
  });

  it('gives a tool without arguments empty input, and an input naming no tool null', () => {
    expect(unwrapQoderMcpCall({ toolName: 'mcp__happy__orchestrator_get_context' })).toEqual({ name: 'mcp__happy__orchestrator_get_context', input: {} });
    expect(unwrapQoderMcpCall({ arguments: {} })).toBeNull();
    expect(unwrapQoderMcpCall(undefined)).toBeNull();
  });
});
