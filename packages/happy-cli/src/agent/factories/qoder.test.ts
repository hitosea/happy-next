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
import { QoderTransport, createQoderBackend, qoderMcpToolName } from './qoder';

describe('createQoderBackend', () => {
  it('runs qodercli in ACP mode with SDK variables blanked and the resume session passed on', () => {
    const onReplayedUpdate = vi.fn();
    createQoderBackend({ cwd: '/work', env: { QODER_AGENT_SDK_ENTRYPOINT: 'desktop', KEEP: '1' }, resumeSessionId: 'abc', onReplayedUpdate });

    expect(mocks.createBackend).toHaveBeenCalledWith(expect.objectContaining({
      agentName: 'qoder',
      cwd: '/work',
      command: '/opt/qoder/qodercli',
      args: ['--acp'],
      env: expect.objectContaining({ QODER_AGENT_SDK_ENTRYPOINT: '', KEEP: '1' }),
      resumeSessionId: 'abc',
      onReplayedUpdate,
    }));
  });
});

describe('QoderTransport', () => {
  const transport = new QoderTransport('qoder');

  it('reads an MCP tool name back from the permission title', () => {
    expect(transport.determineToolName('Unknown tool', 'call_1', { title: 'Hi', description: 'change_title (happy)' })).toBe('mcp__happy__change_title');
  });

  it('keeps names it already has and titles that are not an MCP tool', () => {
    expect(transport.determineToolName('execute', 'call_2', { description: 'git status (repo)' })).toBe('execute');
    expect(transport.determineToolName('Unknown tool', 'call_3', { description: 'Run git status' })).toBe('Unknown tool');
  });
});

describe('qoderMcpToolName', () => {
  it('reads both title forms qodercli uses', () => {
    expect(qoderMcpToolName('change_title (happy)')).toBe('mcp__happy__change_title');
    expect(qoderMcpToolName('change_title (happy MCP Server)')).toBe('mcp__happy__change_title');
    expect(qoderMcpToolName('Run tests')).toBeNull();
  });
});
