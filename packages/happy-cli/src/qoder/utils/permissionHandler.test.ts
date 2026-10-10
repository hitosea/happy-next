import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/ui/logger', () => ({ logger: { debug: vi.fn(), debugLargeJson: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

import { QoderPermissionHandler } from './permissionHandler';

describe('QoderPermissionHandler', () => {
  let agentState: any;
  let permissionRpcHandler: ((response: { id: string; approved: boolean; decision?: 'approved' | 'denied' }) => Promise<void>) | undefined;
  let session: any;

  beforeEach(() => {
    agentState = {};
    session = {
      sessionId: 'session-1',
      rpcHandlerManager: {
        registerHandler: vi.fn((name: string, handler: typeof permissionRpcHandler) => {
          if (name === 'permission') permissionRpcHandler = handler;
        }),
      },
      updateAgentState: vi.fn((updater: (state: any) => any) => { agentState = updater(agentState); }),
    };
  });

  it('approves Happy tools without asking', async () => {
    const handler = new QoderPermissionHandler(session, { sendToAllDevices: vi.fn() } as any);
    await expect(handler.handleToolCall('call-1', 'mcp__happy__change_title', { title: 'x' })).resolves.toEqual({ decision: 'approved' });
    expect(session.updateAgentState).not.toHaveBeenCalled();
  });

  it('sends every other request to the app and resolves with its answer', async () => {
    const handler = new QoderPermissionHandler(session, { sendToAllDevices: vi.fn() } as any);
    const pending = handler.handleToolCall('call-2', 'Bash', { command: 'rm -rf build' });

    expect(agentState.requests?.['call-2']).toMatchObject({ tool: 'Bash', arguments: { command: 'rm -rf build' } });
    await permissionRpcHandler!({ id: 'call-2', approved: false, decision: 'denied' });
    await expect(pending).resolves.toEqual({ decision: 'denied' });
  });
});
