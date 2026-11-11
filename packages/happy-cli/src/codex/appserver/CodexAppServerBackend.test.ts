import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CodexAppServerBackend, resolveModel } from './CodexAppServerBackend';
import { Methods } from './types';
import { logger } from '@/ui/logger';
import { recordNativeThreadEmpty } from '@/daemon/sessionBinding';

vi.mock('@/daemon/sessionBinding', () => ({ recordNativeThreadEmpty: vi.fn(), recordManagedProcess: vi.fn() }));

function createBackend(): CodexAppServerBackend {
  return new CodexAppServerBackend({
    cwd: process.cwd(),
    command: 'codex',
  });
}

describe('CodexAppServerBackend.startSession resume routing', () => {
  beforeEach(() => {
    vi.spyOn(logger, 'info').mockImplementation(() => {
      // no-op in tests
    });
    vi.spyOn(logger, 'debug').mockImplementation(() => {
      // no-op in tests
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses thread/resume with path when resumeFile is provided', async () => {
    const backend = new CodexAppServerBackend({
      cwd: process.cwd(),
      command: 'codex',
      resumeFile: '/tmp/rollout-duplicate.jsonl',
    });
    const anyBackend = backend as any;

    const request = vi.fn(async (method: string) => {
      if (method === Methods.INITIALIZE) {
        return { userAgent: 'codex-test' };
      }
      if (method === Methods.THREAD_RESUME) {
        return {
          thread: { id: 'thread-resumed' },
          model: 'codex-mini',
          reasoningEffort: null,
        };
      }
      throw new Error(`Unexpected method: ${method}`);
    });

    anyBackend.peer = {
      spawn: vi.fn(async () => undefined),
      onNotification: vi.fn(),
      onServerRequest: vi.fn(),
      onClose: vi.fn(),
      request,
      notify: vi.fn(),
    };

    await backend.startSession();

    expect(request).toHaveBeenCalledWith(
      Methods.THREAD_RESUME,
      expect.objectContaining({
        path: '/tmp/rollout-duplicate.jsonl',
      })
    );
    expect(request).not.toHaveBeenCalledWith(Methods.THREAD_START, expect.anything());
    expect(recordNativeThreadEmpty).toHaveBeenCalledWith('thread-resumed', false);
  });

  it('uses thread/start when neither resumeThreadId nor resumeFile is provided', async () => {
    const backend = createBackend();
    const anyBackend = backend as any;

    const request = vi.fn(async (method: string) => {
      if (method === Methods.INITIALIZE) {
        return { userAgent: 'codex-test' };
      }
      if (method === Methods.THREAD_START) {
        return {
          thread: { id: 'thread-new' },
          model: 'codex-mini',
          reasoningEffort: null,
        };
      }
      throw new Error(`Unexpected method: ${method}`);
    });

    anyBackend.peer = {
      spawn: vi.fn(async () => undefined),
      onNotification: vi.fn(),
      onServerRequest: vi.fn(),
      onClose: vi.fn(),
      request,
      notify: vi.fn(),
    };

    await backend.startSession();

    expect(request).toHaveBeenCalledWith(Methods.THREAD_START, expect.anything());
    expect(request).not.toHaveBeenCalledWith(Methods.THREAD_RESUME, expect.anything());
    expect(recordNativeThreadEmpty).toHaveBeenCalledWith('thread-new', true);
  });

  it('clears empty-thread evidence before a turn RPC even if the request fails', async () => {
    const backend = createBackend();
    const anyBackend = backend as any;
    anyBackend.threadId = 'empty';
    const request = vi.fn().mockRejectedValue(new Error('disconnected'));
    anyBackend.peer = { request };
    await expect(anyBackend.doSendMessage('hello')).rejects.toThrow('disconnected');
    expect(recordNativeThreadEmpty).toHaveBeenCalledWith('empty', false);
    expect(vi.mocked(recordNativeThreadEmpty).mock.invocationCallOrder.at(-1)).toBeLessThan(request.mock.invocationCallOrder[0]);
  });

  it('does not submit a turn if clearing durable empty-thread evidence fails', async () => {
    const backend = createBackend();
    const anyBackend = backend as any;
    anyBackend.threadId = 'empty';
    const request = vi.fn();
    anyBackend.peer = { request };
    vi.mocked(recordNativeThreadEmpty).mockImplementationOnce(() => { throw new Error('disk full'); });
    await expect(anyBackend.doSendMessage('hello')).rejects.toThrow('disk full');
    expect(request).not.toHaveBeenCalled();
  });

  it.each(['compactThread', 'startReview', 'setGoal', 'clearGoal'])('clears empty-thread evidence before %s can persist history', async method => {
    const backend = createBackend() as any;
    backend.threadId = 'empty';
    const request = vi.fn().mockResolvedValue({});
    backend.peer = { request };
    await backend[method]({ type: 'uncommittedChanges' });
    expect(recordNativeThreadEmpty).toHaveBeenCalledWith('empty', false);
    expect(vi.mocked(recordNativeThreadEmpty).mock.invocationCallOrder.at(-1)).toBeLessThan(request.mock.invocationCallOrder[0]);
  });

  it('detects the structured legacy denial format from Codex 0.145.0', async () => {
    const backend = createBackend();
    const anyBackend = backend as any;

    anyBackend.peer = {
      spawn: vi.fn(async () => undefined),
      onNotification: vi.fn(),
      onServerRequest: vi.fn(),
      onClose: vi.fn(),
      request: vi.fn(async (method: string) => {
        if (method === Methods.INITIALIZE) {
          return {
            userAgent: 'happy-codex-backend/0.145.0 (Linux; x86_64) test',
          };
        }
        if (method === Methods.THREAD_START) {
          return {
            thread: { id: 'thread-new' },
            model: 'codex-mini',
            reasoningEffort: null,
          };
        }
        throw new Error(`Unexpected method: ${method}`);
      }),
      notify: vi.fn(),
    };

    await backend.startSession();

    expect(anyBackend.structuredLegacyDenials).toBe(true);
  });
});

describe('CodexAppServerBackend.waitForResponseComplete', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns immediately when a turn completed before waiting starts', async () => {
    const backend = createBackend();
    const anyBackend = backend as any;

    anyBackend.resetTurnComplete();
    anyBackend.handleNotification(Methods.NOTIFY_TURN_COMPLETED, {
      threadId: 't1',
      turn: { id: 'turn-1', status: 'completed', items: [] },
    });

    await expect(backend.waitForResponseComplete(100)).resolves.toBeUndefined();
  });

  it('does not timeout while progress events continue', async () => {
    const backend = createBackend();
    const anyBackend = backend as any;

    anyBackend.resetTurnComplete();
    const waitPromise = backend.waitForResponseComplete(120);

    for (let i = 0; i < 4; i++) {
      await vi.advanceTimersByTimeAsync(90);
      anyBackend.handleNotification(Methods.NOTIFY_AGENT_MESSAGE_DELTA, {
        threadId: 't1', turnId: 'turn-1', itemId: 'i1', delta: 'x',
      });
    }

    anyBackend.handleNotification(Methods.NOTIFY_TURN_COMPLETED, {
      threadId: 't1',
      turn: { id: 'turn-1', status: 'completed', items: [] },
    });
    await expect(waitPromise).resolves.toBeUndefined();
  });

  it('does not timeout while approval is pending', async () => {
    const permissionHandler = {
      handleToolCall: vi.fn().mockImplementation(
        () => new Promise(() => {}) // never resolves — simulates user not responding
      ),
    };
    const backend = new CodexAppServerBackend({
      cwd: process.cwd(),
      command: 'codex',
      permissionHandler,
    });
    const anyBackend = backend as any;
    anyBackend.peer = { respond: vi.fn() };

    anyBackend.resetTurnComplete();

    // Simulate a legacy exec approval request arriving
    anyBackend.handleExecApproval(
      { call_id: 'call-1', command: ['ls'], cwd: '/tmp' },
      999
    );

    const waitPromise = backend.waitForResponseComplete(120).then(
      () => 'resolved',
      (error: Error) => error
    );

    await vi.advanceTimersByTimeAsync(500);
    expect(await Promise.race([waitPromise, Promise.resolve('still-waiting')])).toBe('still-waiting');
  });

  it('does not terminate turn on error notification (waits for turn/completed)', async () => {
    const backend = createBackend();
    const anyBackend = backend as any;

    anyBackend.resetTurnComplete();
    const waitPromise = backend.waitForResponseComplete(120).then(
      () => 'resolved',
      (error: Error) => error
    );

    // Error notification should NOT resolve the turn
    anyBackend.handleNotification(Methods.NOTIFY_ERROR, {
      threadId: 't1', turnId: 'turn-1', willRetry: true,
      error: { message: 'Reconnecting... 1/5' },
    });

    // turn/completed resolves it
    anyBackend.handleNotification(Methods.NOTIFY_TURN_COMPLETED, {
      threadId: 't1',
      turn: { id: 'turn-1', status: 'completed', items: [] },
    });
    const result = await waitPromise;
    expect(result).toBe('resolved');
  });
});

describe('CodexAppServerBackend notification handling', () => {
  it('emits model-output on agent message delta', () => {
    const backend = createBackend();
    const messages: any[] = [];
    backend.onMessage((msg) => messages.push(msg));
    const anyBackend = backend as any;

    anyBackend.handleNotification(Methods.NOTIFY_AGENT_MESSAGE_DELTA, {
      threadId: 't1', turnId: 'turn-1', itemId: 'i1', delta: 'Hello',
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({ type: 'model-output', textDelta: 'Hello' });
  });

  it('emits tool-call on item/started with commandExecution', () => {
    const backend = createBackend();
    const messages: any[] = [];
    backend.onMessage((msg) => messages.push(msg));
    const anyBackend = backend as any;

    anyBackend.handleNotification(Methods.NOTIFY_ITEM_STARTED, {
      threadId: 't1', turnId: 'turn-1',
      item: { id: 'cmd-1', type: 'commandExecution', command: 'ls -la', cwd: '/tmp', commandActions: [], status: 'inProgress' },
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      type: 'tool-call',
      toolName: 'CodexBash',
      callId: 'cmd-1',
      args: { command: 'ls -la', cwd: '/tmp' },
    });
  });

  it('emits tool-result on item/completed with commandExecution', () => {
    const backend = createBackend();
    const messages: any[] = [];
    backend.onMessage((msg) => messages.push(msg));
    const anyBackend = backend as any;

    anyBackend.handleNotification(Methods.NOTIFY_ITEM_COMPLETED, {
      threadId: 't1', turnId: 'turn-1',
      item: { id: 'cmd-1', type: 'commandExecution', command: 'ls', cwd: '/tmp', commandActions: [], status: 'completed', exitCode: 0, aggregatedOutput: 'file.txt' },
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      type: 'tool-result',
      toolName: 'CodexBash',
      callId: 'cmd-1',
      result: { exit_code: 0 },
    });
  });

  it('emits terminal-output on command output delta', () => {
    const backend = createBackend();
    const messages: any[] = [];
    backend.onMessage((msg) => messages.push(msg));
    const anyBackend = backend as any;

    anyBackend.handleNotification(Methods.NOTIFY_COMMAND_OUTPUT_DELTA, {
      threadId: 't1', turnId: 'turn-1', itemId: 'cmd-1', delta: 'output text',
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({ type: 'terminal-output', data: 'output text' });
  });

  it('handles turn/completed with failed status as error', async () => {
    const backend = createBackend();
    const anyBackend = backend as any;

    anyBackend.resetTurnComplete();

    anyBackend.handleNotification(Methods.NOTIFY_TURN_COMPLETED, {
      threadId: 't1',
      turn: { id: 'turn-1', status: 'failed', items: [], error: { message: 'Rate limited' } },
    });

    await expect(backend.waitForResponseComplete()).rejects.toThrow('Rate limited');
  });

  it('handles turn/completed with interrupted status gracefully', async () => {
    const backend = createBackend();
    const messages: any[] = [];
    backend.onMessage((msg) => messages.push(msg));
    const anyBackend = backend as any;

    anyBackend.resetTurnComplete();
    anyBackend.handleNotification(Methods.NOTIFY_TURN_COMPLETED, {
      threadId: 't1',
      turn: { id: 'turn-1', status: 'interrupted', items: [] },
    });

    await expect(backend.waitForResponseComplete()).resolves.toBeUndefined();
    expect(messages.some((m) => m.type === 'status' && m.detail === 'aborted')).toBe(true);
  });

  it('emits token-count on thread/tokenUsage/updated', () => {
    const backend = createBackend();
    const messages: any[] = [];
    backend.onMessage((msg) => messages.push(msg));
    const anyBackend = backend as any;

    anyBackend.handleNotification(Methods.NOTIFY_THREAD_TOKEN_USAGE, {
      threadId: 't1', turnId: 'turn-1',
      tokenUsage: {
        last: { inputTokens: 100, cachedInputTokens: 50, outputTokens: 200, reasoningOutputTokens: 0, totalTokens: 300 },
        total: { inputTokens: 1000, cachedInputTokens: 500, outputTokens: 2000, reasoningOutputTokens: 100, totalTokens: 3000 },
        modelContextWindow: 128000,
      },
    });

    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe('token-count');
    expect(messages[0].total_token_usage.total_tokens).toBe(3000);
    expect(messages[0].model_context_window).toBe(128000);
  });
});

describe('CodexAppServerBackend v2 item normalization', () => {
  it('normalizes fileChange v2 array changes to v1 map format', () => {
    const backend = createBackend();
    const messages: any[] = [];
    backend.onMessage((msg) => messages.push(msg));
    const anyBackend = backend as any;

    anyBackend.handleNotification(Methods.NOTIFY_ITEM_STARTED, {
      threadId: 't1', turnId: 'turn-1',
      item: {
        id: 'fc-1', type: 'fileChange', status: 'inProgress',
        changes: [
          { path: 'src/foo.ts', kind: { type: 'update' }, diff: '--- a\n+++ b' },
          { path: 'src/bar.ts', kind: { type: 'add' }, diff: '+new file' },
          { path: 'src/old.ts', kind: { type: 'delete' }, diff: '-removed' },
        ],
      },
    });

    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe('patch-apply-begin');
    expect(messages[0].changes).toEqual({
      'src/foo.ts': { modify: true },
      'src/bar.ts': { add: true },
      'src/old.ts': { delete: true },
    });
  });

  it('passes through v1 map-style changes unchanged', () => {
    const backend = createBackend();
    const messages: any[] = [];
    backend.onMessage((msg) => messages.push(msg));
    const anyBackend = backend as any;

    const v1Changes = { 'src/file.ts': { modify: { old_content: 'a', new_content: 'b' } } };
    anyBackend.handleNotification(Methods.NOTIFY_ITEM_STARTED, {
      threadId: 't1', turnId: 'turn-1',
      item: { id: 'fc-2', type: 'fileChange', status: 'inProgress', changes: v1Changes },
    });

    expect(messages[0].changes).toEqual(v1Changes);
  });

  it('forwards query for webSearch when available at STARTED', () => {
    const backend = createBackend();
    const messages: any[] = [];
    backend.onMessage((msg) => messages.push(msg));
    const anyBackend = backend as any;

    anyBackend.handleNotification(Methods.NOTIFY_ITEM_STARTED, {
      threadId: 't1', turnId: 'turn-1',
      item: { id: 'ws-1', type: 'webSearch', query: 'react hooks' },
    });

    expect(messages[0]).toMatchObject({
      type: 'tool-call',
      toolName: 'web_search',
      args: { query: 'react hooks' },
    });
  });

  it('sends empty args for webSearch when query is empty', () => {
    const backend = createBackend();
    const messages: any[] = [];
    backend.onMessage((msg) => messages.push(msg));
    const anyBackend = backend as any;

    anyBackend.handleNotification(Methods.NOTIFY_ITEM_STARTED, {
      threadId: 't1', turnId: 'turn-1',
      item: { id: 'ws-2', type: 'webSearch', query: '' },
    });

    expect(messages[0].args).toEqual({});
  });

  it('forwards commandActions as parsed_cmd for commandExecution', () => {
    const backend = createBackend();
    const messages: any[] = [];
    backend.onMessage((msg) => messages.push(msg));
    const anyBackend = backend as any;

    const actions = [{ type: 'read', command: 'cat src/foo.ts', path: 'src/foo.ts', name: 'src/foo.ts' }];
    anyBackend.handleNotification(Methods.NOTIFY_ITEM_STARTED, {
      threadId: 't1', turnId: 'turn-1',
      item: { id: 'cmd-2', type: 'commandExecution', command: 'cat src/foo.ts', cwd: '/app', commandActions: actions, status: 'inProgress' },
    });

    expect(messages[0].args.parsed_cmd).toEqual(actions);
  });

  it('surfaces error message for failed mcpToolCall on COMPLETED', () => {
    const backend = createBackend();
    const messages: any[] = [];
    backend.onMessage((msg) => messages.push(msg));
    const anyBackend = backend as any;

    anyBackend.handleNotification(Methods.NOTIFY_ITEM_COMPLETED, {
      threadId: 't1', turnId: 'turn-1',
      item: {
        id: 'mcp-1', type: 'mcpToolCall', server: 'linear', tool: 'create_issue',
        arguments: { title: 'test' }, status: 'failed',
        result: null,
        error: { message: 'Connection refused' },
      },
    });

    expect(messages[0]).toMatchObject({
      type: 'tool-result',
      toolName: 'mcp:linear:create_issue',
      callId: 'mcp-1',
      result: { error: 'Connection refused' },
    });
  });

  it('passes through result for successful mcpToolCall on COMPLETED', () => {
    const backend = createBackend();
    const messages: any[] = [];
    backend.onMessage((msg) => messages.push(msg));
    const anyBackend = backend as any;

    const mcpResult = { content: [{ type: 'text', text: 'done' }] };
    anyBackend.handleNotification(Methods.NOTIFY_ITEM_COMPLETED, {
      threadId: 't1', turnId: 'turn-1',
      item: {
        id: 'mcp-2', type: 'mcpToolCall', server: 'linear', tool: 'list_issues',
        arguments: {}, status: 'completed',
        result: mcpResult,
        error: null,
      },
    });

    expect(messages[0]).toMatchObject({
      type: 'tool-result',
      toolName: 'mcp:linear:list_issues',
      callId: 'mcp-2',
      result: mcpResult,
    });
  });
});

describe('CodexAppServerBackend approval request parsing', () => {
  it('accepts snake_case call_id for exec approval requests', async () => {
    const permissionHandler = {
      handleToolCall: vi.fn().mockResolvedValue({ decision: 'approved' }),
    };
    const backend = new CodexAppServerBackend({
      cwd: process.cwd(),
      command: 'codex',
      permissionHandler,
    });
    const anyBackend = backend as any;
    const respond = vi.fn();
    anyBackend.peer = { respond };

    anyBackend.handleExecApproval(
      {
        call_id: 'exec-call-1',
        command: ['ls', '-la'],
        cwd: '/tmp',
        reason: 'command failed; retry without sandbox?',
      },
      123
    );

    await Promise.resolve();
    await Promise.resolve();

    expect(permissionHandler.handleToolCall).toHaveBeenCalledWith(
      'exec-call-1',
      'CodexBash',
      {
        command: ['ls', '-la'],
        cwd: '/tmp',
        reason: 'command failed; retry without sandbox?',
      }
    );
    expect(respond).toHaveBeenCalledWith(123, { decision: 'approved' });
  });

  it('denies exec approval requests that do not include a call id', () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const permissionHandler = {
      handleToolCall: vi.fn().mockResolvedValue({ decision: 'approved' }),
    };
    const backend = new CodexAppServerBackend({
      cwd: process.cwd(),
      command: 'codex',
      permissionHandler,
    });
    const anyBackend = backend as any;
    const respond = vi.fn();
    anyBackend.peer = { respond };

    anyBackend.handleExecApproval({ command: ['ls'], cwd: '/tmp' }, 456);

    expect(permissionHandler.handleToolCall).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith(456, { decision: 'denied' });
    warnSpy.mockRestore();
  });

  it('uses the Codex 0.145 structured denial response for legacy approvals', async () => {
    const permissionHandler = {
      handleToolCall: vi.fn().mockResolvedValue({
        decision: 'denied',
        reason: 'User rejected the destructive command.',
      }),
    };
    const backend = new CodexAppServerBackend({
      cwd: process.cwd(),
      command: 'codex',
      permissionHandler,
    });
    const anyBackend = backend as any;
    const respond = vi.fn();
    anyBackend.peer = { respond };
    anyBackend.structuredLegacyDenials = true;

    anyBackend.handleExecApproval({
      call_id: 'exec-call-denied',
      command: ['rm', '-rf', '/tmp/test'],
      cwd: '/tmp',
    }, 457);

    await Promise.resolve();
    await Promise.resolve();

    expect(respond).toHaveBeenCalledWith(457, {
      decision: {
        denied: {
          rejection: 'User rejected the destructive command.',
        },
      },
    });
  });

  it('handles v2 command execution approval', async () => {
    const permissionHandler = {
      handleToolCall: vi.fn().mockResolvedValue({ decision: 'approved' }),
    };
    const backend = new CodexAppServerBackend({
      cwd: process.cwd(),
      command: 'codex',
      permissionHandler,
    });
    const anyBackend = backend as any;
    const respond = vi.fn();
    anyBackend.peer = { respond };

    anyBackend.handleServerRequest(Methods.COMMAND_EXECUTION_APPROVAL, {
      threadId: 't1', turnId: 'turn-1', itemId: 'cmd-1',
      command: 'rm -rf /tmp/test', cwd: '/home',
      reason: 'destructive command',
    }, 100);

    await Promise.resolve();
    await Promise.resolve();

    expect(permissionHandler.handleToolCall).toHaveBeenCalledWith(
      'cmd-1', 'CodexBash',
      expect.objectContaining({ command: ['rm -rf /tmp/test'] })
    );
    expect(respond).toHaveBeenCalledWith(100, { decision: 'accept' });
  });

  it('offers the proposed execpolicy amendment and applies it when the user allows it', async () => {
    const permissionHandler = {
      handleToolCall: vi.fn().mockResolvedValue({ decision: 'approved_for_session', execpolicyAmendment: ['npm', 'test'] }),
    };
    const backend = new CodexAppServerBackend({
      cwd: process.cwd(),
      command: 'codex',
      permissionHandler,
    });
    const anyBackend = backend as any;
    const respond = vi.fn();
    anyBackend.peer = { respond };

    anyBackend.handleServerRequest(Methods.COMMAND_EXECUTION_APPROVAL, {
      threadId: 't1', turnId: 'turn-1', itemId: 'cmd-2',
      command: 'npm test -- --watch', cwd: '/home',
      proposedExecpolicyAmendment: ['npm', 'test'],
    }, 101);

    await Promise.resolve();
    await Promise.resolve();

    expect(permissionHandler.handleToolCall).toHaveBeenCalledWith(
      'cmd-2', 'CodexBash',
      expect.objectContaining({ proposedExecpolicyAmendment: ['npm', 'test'] })
    );
    expect(respond).toHaveBeenCalledWith(101, {
      decision: { acceptWithExecpolicyAmendment: { execpolicy_amendment: ['npm', 'test'] } },
    });
  });

  it('handles v2 file change approval', async () => {
    const permissionHandler = {
      handleToolCall: vi.fn().mockResolvedValue({ decision: 'approved' }),
    };
    const backend = new CodexAppServerBackend({
      cwd: process.cwd(),
      command: 'codex',
      permissionHandler,
    });
    const anyBackend = backend as any;
    const respond = vi.fn();
    anyBackend.peer = { respond };

    anyBackend.handleServerRequest(Methods.FILE_CHANGE_APPROVAL, {
      threadId: 't1', turnId: 'turn-1', itemId: 'patch-1',
      reason: 'write outside workspace',
    }, 200);

    await Promise.resolve();
    await Promise.resolve();

    expect(permissionHandler.handleToolCall).toHaveBeenCalledWith(
      'patch-1', 'CodexPatch',
      expect.objectContaining({ reason: 'write outside workspace' })
    );
    expect(respond).toHaveBeenCalledWith(200, { decision: 'accept' });
  });

  it('respondToPermission preserves the v2 decision format', async () => {
    const permissionHandler = {
      handleToolCall: vi.fn().mockImplementation(() => new Promise(() => {})),
    };
    const backend = new CodexAppServerBackend({
      cwd: process.cwd(),
      command: 'codex',
      permissionHandler,
    });
    const anyBackend = backend as any;
    const respond = vi.fn();
    anyBackend.peer = { respond };

    anyBackend.handleServerRequest(Methods.COMMAND_EXECUTION_APPROVAL, {
      threadId: 't1', turnId: 'turn-1', itemId: 'cmd-pending',
      command: 'rm -rf /tmp/test', cwd: '/home',
    }, 201);

    await backend.respondToPermission('cmd-pending', false);

    expect(respond).toHaveBeenCalledWith(201, { decision: 'decline' });
  });

  it('uses approvalId for writeStdin approvals', async () => {
    const permissionHandler = {
      handleToolCall: vi.fn().mockResolvedValue({ decision: 'approved' }),
    };
    const backend = new CodexAppServerBackend({
      cwd: process.cwd(),
      command: 'codex',
      permissionHandler,
    });
    const anyBackend = backend as any;
    const respond = vi.fn();
    anyBackend.peer = { respond };

    anyBackend.handleServerRequest(Methods.COMMAND_EXECUTION_APPROVAL, {
      threadId: 't1', turnId: 'turn-1', itemId: 'terminal-1',
      approvalId: 'stdin-approval-1', kind: 'writeStdin',
      command: 'yes', cwd: '/home', startedAtMs: 1,
    }, 202);

    await Promise.resolve();
    await Promise.resolve();

    expect(permissionHandler.handleToolCall).toHaveBeenCalledWith(
      'stdin-approval-1',
      'CodexBash',
      expect.objectContaining({ kind: 'writeStdin', approvalId: 'stdin-approval-1' }),
    );
    expect(respond).toHaveBeenCalledWith(202, { decision: 'accept' });
  });

  it('maps Codex user questions to the app and returns answers by question id', async () => {
    const permissionHandler = {
      handleToolCall: vi.fn().mockResolvedValue({
        decision: 'approved',
        answers: { environment: 'Staging', token: 'secret-value' },
      }),
    };
    const backend = new CodexAppServerBackend({
      cwd: process.cwd(),
      command: 'codex',
      permissionHandler,
    });
    const messages: any[] = [];
    backend.onMessage((message) => messages.push(message));
    const respond = vi.fn();
    (backend as any).peer = { respond };

    (backend as any).handleServerRequest(Methods.TOOL_REQUEST_USER_INPUT, {
      threadId: 't1', turnId: 'turn-1', itemId: 'question-item-1', isBlocking: true,
      questions: [
        {
          id: 'environment', header: 'Environment', question: 'Choose an environment',
          options: [{ label: 'Staging', description: 'Use staging' }], isOther: false,
        },
        {
          id: 'token', header: 'Token', question: 'Enter the token', options: null,
          isOther: true, isSecret: true,
        },
      ],
    }, 203);

    await Promise.resolve();
    await Promise.resolve();

    expect(permissionHandler.handleToolCall).toHaveBeenCalledWith(
      'question-item-1',
      'AskUserQuestion',
      {
        isBlocking: true,
        questions: [
          expect.objectContaining({ id: 'environment', multiSelect: false, isOther: false }),
          expect.objectContaining({ id: 'token', options: [], isSecret: true }),
        ],
      },
    );
    expect(respond).toHaveBeenCalledWith(203, {
      answers: {
        environment: { answers: ['Staging'] },
        token: { answers: ['secret-value'] },
      },
    });
    expect(messages).toContainEqual(expect.objectContaining({
      type: 'tool-result',
      callId: 'question-item-1',
      result: { answers: { environment: 'Staging', token: '********' } },
    }));
  });

  it('returns the requested permission profile with the selected scope', async () => {
    const permissionHandler = {
      handleToolCall: vi.fn().mockResolvedValue({ decision: 'approved_for_session' }),
    };
    const backend = new CodexAppServerBackend({
      cwd: process.cwd(),
      command: 'codex',
      permissionHandler,
    });
    const respond = vi.fn();
    (backend as any).peer = { respond };
    const permissions = { network: { enabled: true } };

    (backend as any).handleServerRequest(Methods.PERMISSIONS_APPROVAL, {
      threadId: 't1', turnId: 'turn-1', itemId: 'permission-item-1',
      cwd: '/repo', permissions, reason: 'Download dependencies', startedAtMs: 1,
    }, 204);

    await Promise.resolve();
    await Promise.resolve();

    expect(permissionHandler.handleToolCall).toHaveBeenCalledWith(
      'codex-permissions-204',
      'CodexPermissions',
      { cwd: '/repo', permissions, reason: 'Download dependencies' },
    );
    expect(respond).toHaveBeenCalledWith(204, { permissions, scope: 'session' });
  });

  // Elicitation payloads: Codex 0.121 puts `_meta` at top level; older shapes nest it in `request`.
  describe('MCP elicitation', () => {
    function setup(permissionHandler?: { handleToolCall: ReturnType<typeof vi.fn> }) {
      const backend = new CodexAppServerBackend({
        cwd: process.cwd(),
        command: 'codex',
        permissionHandler,
      });
      const respond = vi.fn();
      (backend as any).peer = { respond };
      return { backend, respond };
    }

    const dispatch = (backend: CodexAppServerBackend, params: unknown, id: number) =>
      (backend as any).handleServerRequest(Methods.MCP_ELICITATION, params, id);

    const flush = () => new Promise((r) => setImmediate(r));

    it.each([
      {
        name: 'non-tool-call declines',
        params: { serverName: 'test', request: { type: 'Form', message: 'Enter API key', requestedSchema: {} } },
        expected: { action: 'decline' },
      },
      {
        name: 'missing codex_approval_kind declines',
        params: { serverName: 'happy', _meta: {}, message: 'Enter API key' },
        expected: { action: 'decline' },
      },
    ])('$name', ({ params, expected }) => {
      const { backend, respond } = setup();
      dispatch(backend, params, 42);
      expect(respond).toHaveBeenCalledWith(42, expected);
    });

    // The happy server is not trusted wholesale: orchestrator_exec and _transfer must ask.
    // The permission handler gets the tool's own name from the message, not its title, so
    // its never-ask list (change_title, orchestrator_get_context, ...) can match it.
    it.each([
      {
        name: 'Codex 0.121 shape',
        params: {
          serverName: 'happy',
          _meta: { codex_approval_kind: 'mcp_tool_call', tool_title: 'Orchestrator Exec', tool_params: { command: 'ls' } },
          message: 'Allow the happy MCP server to run tool "orchestrator_exec"?',
        },
      },
      {
        name: 'nested request (older shape)',
        params: {
          serverName: 'happy',
          request: {
            _meta: { codex_approval_kind: 'mcp_tool_call', tool_title: 'Orchestrator Exec', tool_params: { command: 'ls' } },
            message: 'Allow the happy MCP server to run tool "orchestrator_exec"?',
          },
        },
      },
    ])('happy server tool calls go through the permission handler by name ($name)', async ({ params }) => {
      const permissionHandler = { handleToolCall: vi.fn().mockResolvedValue({ decision: 'denied' }) };
      const { backend, respond } = setup(permissionHandler);
      dispatch(backend, params, 7);
      await flush();
      expect(permissionHandler.handleToolCall).toHaveBeenCalledWith('mcp-elicit-7', 'mcp:happy:orchestrator_exec', { command: 'ls' });
      expect(respond).toHaveBeenCalledWith(7, { action: 'decline' });
    });

    it('untrusted server routes approval through permission handler', async () => {
      const permissionHandler = {
        handleToolCall: vi.fn().mockResolvedValue({ decision: 'approved' }),
      };
      const { backend, respond } = setup(permissionHandler);
      dispatch(backend, {
        serverName: 'external',
        _meta: { codex_approval_kind: 'mcp_tool_call', tool_title: 'Some Tool', tool_params: { x: 1 } },
      }, 8);
      await flush();
      expect(permissionHandler.handleToolCall).toHaveBeenCalledWith('mcp-elicit-8', 'mcp:external:Some Tool', { x: 1 });
      expect(respond).toHaveBeenCalledWith(8, { action: 'accept' });
    });

    it('untrusted server declines when permission handler denies', async () => {
      const permissionHandler = {
        handleToolCall: vi.fn().mockResolvedValue({ decision: 'denied' }),
      };
      const { backend, respond } = setup(permissionHandler);
      dispatch(backend, {
        serverName: 'external',
        _meta: { codex_approval_kind: 'mcp_tool_call', tool_title: 'Unknown Tool' },
      }, 9);
      await flush();
      expect(respond).toHaveBeenCalledWith(9, { action: 'decline' });
    });
  });
});

describe('resolveModel', () => {
  it('strips -fast suffix and sets isFast', () => {
    expect(resolveModel('o4-mini-fast')).toEqual({ model: 'o4-mini', isFast: true });
  });

  it('leaves non-fast models unchanged', () => {
    expect(resolveModel('o4-mini')).toEqual({ model: 'o4-mini', isFast: false });
  });

  it('handles null model', () => {
    expect(resolveModel(null)).toEqual({ model: null, isFast: false });
  });

  it('handles undefined model', () => {
    expect(resolveModel(undefined)).toEqual({ model: null, isFast: false });
  });

  it('does not strip -fast from middle of model name', () => {
    expect(resolveModel('fast-model')).toEqual({ model: 'fast-model', isFast: false });
  });
});

describe('buildThreadParams', () => {
  it('passes serviceTier directly when model has -fast suffix', () => {
    const backend = new CodexAppServerBackend({
      cwd: process.cwd(),
      command: 'codex',
      model: 'o4-mini-fast',
    });
    const params = (backend as any).buildThreadParams();
    expect(params.model).toBe('o4-mini');
    expect(params.serviceTier).toBe('fast');
  });

  it('does not set serviceTier for non-fast models', () => {
    const backend = new CodexAppServerBackend({
      cwd: process.cwd(),
      command: 'codex',
      model: 'o4-mini',
    });
    const params = (backend as any).buildThreadParams();
    expect(params.model).toBe('o4-mini');
    expect(params.serviceTier).toBeUndefined();
  });

  it('preserves reasoning effort in config', () => {
    const backend = new CodexAppServerBackend({
      cwd: process.cwd(),
      command: 'codex',
      model: 'o4-mini-fast',
      reasoningEffort: 'high',
    });
    const params = (backend as any).buildThreadParams();
    expect(params.model).toBe('o4-mini');
    expect(params.serviceTier).toBe('fast');
    expect(params.config?.model_reasoning_effort).toBe('high');
  });

  it('passes the approvals reviewer, and leaves it to Codex when unset', () => {
    const reviewed = new CodexAppServerBackend({
      cwd: process.cwd(),
      command: 'codex',
      approvalPolicy: 'on-request',
      approvalsReviewer: 'auto_review',
    });
    expect((reviewed as any).buildThreadParams()).toMatchObject({ approvalPolicy: 'on-request', approvalsReviewer: 'auto_review' });
    const plain = new CodexAppServerBackend({ cwd: process.cwd(), command: 'codex' });
    expect((plain as any).buildThreadParams().approvalsReviewer).toBeUndefined();
  });

  it('makes the happy MCP server ask, except for the tools that never ask', () => {
    const backend = new CodexAppServerBackend({
      cwd: process.cwd(),
      command: 'codex',
      mcpServers: {
        happy: { command: '/bin/happy-mcp', args: ['--url', 'http://127.0.0.1:40573/'] },
        dootask: { type: 'http', url: 'https://dootask.example/mcp' },
      },
    });
    const params = (backend as any).buildThreadParams();
    const servers = params.config?.mcp_servers as Record<string, any>;
    expect(servers.happy.default_tools_approval_mode).toBe('prompt');
    expect(Object.keys(servers.happy.tools).sort()).toEqual([
      'change_title', 'orchestrator_get_context', 'orchestrator_list', 'orchestrator_pend', 'preview_html',
    ]);
    for (const tool of Object.values(servers.happy.tools)) {
      expect(tool).toEqual({ approval_mode: 'approve' });
    }
    expect(servers.happy.command).toBe('/bin/happy-mcp');
    expect(servers.happy.args).toEqual(['--url', 'http://127.0.0.1:40573/']);
    expect(servers.dootask.default_tools_approval_mode).toBeUndefined();
    expect(servers.dootask.url).toBe('https://dootask.example/mcp');
  });
});

describe('CodexAppServerBackend steering', () => {
  beforeEach(() => {
    vi.spyOn(logger, 'debug').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function runningBackend() {
    const backend = createBackend() as any;
    backend.threadId = 'thread-1';
    const request = vi.fn().mockResolvedValue({ turnId: 'turn-1' });
    backend.peer = { request };
    const messages: any[] = [];
    backend.onMessage((msg: any) => messages.push(msg));
    backend.handleNotification(Methods.NOTIFY_TURN_STARTED, { turn: { id: 'turn-1' } });
    return { backend, request, messages };
  }

  it('steers into the running turn under the message id', async () => {
    const { backend, request } = runningBackend();
    await backend.steer('pending-1', 'also check the tests');
    expect(request).toHaveBeenCalledWith(Methods.TURN_STEER, {
      threadId: 'thread-1',
      expectedTurnId: 'turn-1',
      input: [{ type: 'text', text: 'also check the tests' }],
      clientUserMessageId: 'pending-1',
    });
  });

  it('refuses when no turn is running', async () => {
    const { backend, request } = runningBackend();
    backend.handleNotification(Methods.NOTIFY_TURN_COMPLETED, { turn: { id: 'turn-1', status: 'completed' } });
    await expect(backend.steer('pending-1', 'hi')).rejects.toThrow('not_running');
    expect(request).not.toHaveBeenCalled();
  });

  it('reports read when the agent takes the message in, once', async () => {
    const { backend, messages } = runningBackend();
    await backend.steer('pending-1', 'hi');
    backend.handleNotification(Methods.NOTIFY_ITEM_STARTED, { item: { type: 'userMessage', id: 'u1', clientId: 'pending-1', content: [] } });
    backend.handleNotification(Methods.NOTIFY_ITEM_STARTED, { item: { type: 'userMessage', id: 'u1', clientId: 'pending-1', content: [] } });
    backend.handleNotification(Methods.NOTIFY_TURN_COMPLETED, { turn: { id: 'turn-1', status: 'completed' } });
    expect(messages.filter((m) => m.type === 'steer')).toEqual([{ type: 'steer', pendingId: 'pending-1', outcome: 'read' }]);
  });

  it('reports a message the agent never took as dropped before the turn goes idle', async () => {
    const { backend, messages } = runningBackend();
    await backend.steer('pending-1', 'hi');
    backend.handleNotification(Methods.NOTIFY_TURN_COMPLETED, { turn: { id: 'turn-1', status: 'interrupted' } });
    const steer = messages.findIndex((m) => m.type === 'steer');
    const idle = messages.findIndex((m) => m.type === 'status' && m.status === 'idle');
    expect(messages[steer]).toEqual({ type: 'steer', pendingId: 'pending-1', outcome: 'dropped' });
    expect(steer).toBeLessThan(idle);
  });

  it('forgets a message Codex refused', async () => {
    const { backend, request, messages } = runningBackend();
    request.mockRejectedValueOnce(new Error('turn is not steerable'));
    await expect(backend.steer('pending-1', 'hi')).rejects.toThrow('turn is not steerable');
    backend.handleNotification(Methods.NOTIFY_TURN_COMPLETED, { turn: { id: 'turn-1', status: 'completed' } });
    expect(messages.some((m) => m.type === 'steer')).toBe(false);
  });
});

describe('CodexAppServerBackend thread metadata and 0.167.1 items', () => {
  function collect() {
    const backend = createBackend();
    const messages: any[] = [];
    backend.onMessage((msg) => messages.push(msg));
    return { backend, messages, anyBackend: backend as any };
  }

  it('reports a thread rename', () => {
    const { messages, anyBackend } = collect();
    anyBackend.handleNotification(Methods.NOTIFY_THREAD_NAME_UPDATED, {
      threadId: 't1', threadName: 'Fix the fold',
    });
    expect(messages).toEqual([
      { type: 'event', name: 'thread_name_updated', payload: { name: 'Fix the fold' } },
    ]);
  });

  it('ignores a cleared or blank name', () => {
    const { messages, anyBackend } = collect();
    anyBackend.handleNotification(Methods.NOTIFY_THREAD_NAME_UPDATED, { threadId: 't1', threadName: null });
    anyBackend.handleNotification(Methods.NOTIFY_THREAD_NAME_UPDATED, { threadId: 't1', threadName: '   ' });
    expect(messages).toEqual([]);
  });

  it('reports the model and effort Codex switched to', () => {
    const { messages, anyBackend } = collect();
    anyBackend.handleNotification(Methods.NOTIFY_THREAD_SETTINGS_UPDATED, {
      threadId: 't1',
      threadSettings: { model: 'gpt-5.1-codex', modelProvider: 'openai', effort: 'high' },
    });
    expect(messages).toEqual([
      { type: 'event', name: 'thread_settings_updated', payload: { model: 'gpt-5.1-codex', effort: 'high' } },
    ]);
  });

  it('reports warnings and tags guardian ones', () => {
    const { messages, anyBackend } = collect();
    anyBackend.handleNotification(Methods.NOTIFY_WARNING, { message: 'Network is slow' });
    anyBackend.handleNotification(Methods.NOTIFY_GUARDIAN_WARNING, { threadId: 't1', message: 'Blocked a command' });
    expect(messages).toEqual([
      { type: 'event', name: 'warning', payload: { message: 'Network is slow', kind: 'warning' } },
      { type: 'event', name: 'warning', payload: { message: 'Blocked a command', kind: 'guardian' } },
    ]);
  });

  it('counts a sleep as a step', () => {
    const { messages, anyBackend } = collect();
    anyBackend.handleNotification(Methods.NOTIFY_ITEM_STARTED, {
      item: { id: 'sleep-1', type: 'sleep', durationMs: 60000 },
    });
    anyBackend.handleNotification(Methods.NOTIFY_ITEM_COMPLETED, {
      item: { id: 'sleep-1', type: 'sleep', durationMs: 60000 },
    });
    expect(messages).toEqual([
      { type: 'tool-call', toolName: 'Sleep', callId: 'sleep-1', args: { duration_ms: 60000 } },
      { type: 'tool-result', toolName: 'Sleep', callId: 'sleep-1', result: { duration_ms: 60000 } },
    ]);
  });

  it('opens a sleep that arrives completed only', () => {
    const { messages, anyBackend } = collect();
    anyBackend.handleNotification(Methods.NOTIFY_ITEM_COMPLETED, {
      item: { id: 'sleep-2', type: 'sleep', durationMs: 5000 },
    });
    expect(messages.map((m) => m.type)).toEqual(['tool-call', 'tool-result']);
  });

  it('marks where a review run starts and ends', () => {
    const { messages, anyBackend } = collect();
    anyBackend.handleNotification(Methods.NOTIFY_ITEM_COMPLETED, {
      item: { id: 'review-1', type: 'enteredReviewMode', review: 'uncommitted changes' },
    });
    anyBackend.handleNotification(Methods.NOTIFY_ITEM_COMPLETED, {
      item: { id: 'review-2', type: 'exitedReviewMode', review: 'uncommitted changes' },
    });
    expect(messages).toEqual([
      { type: 'event', name: 'review_mode', payload: { entered: true, review: 'uncommitted changes' } },
      { type: 'event', name: 'review_mode', payload: { entered: false, review: 'uncommitted changes' } },
    ]);
  });

  it('shows a generated image as a completed step carrying its saved path', () => {
    const { messages, anyBackend } = collect();
    anyBackend.handleNotification(Methods.NOTIFY_ITEM_COMPLETED, {
      item: {
        id: 'img-1',
        type: 'imageGeneration',
        status: 'completed',
        savedPath: '/tmp/generated.png',
        revisedPrompt: 'a red bicycle',
      },
    });
    expect(messages).toEqual([
      {
        type: 'tool-call',
        toolName: 'image_generation',
        callId: 'img-1',
        args: { path: '/tmp/generated.png', prompt: 'a red bicycle' },
      },
      {
        type: 'tool-result',
        toolName: 'image_generation',
        callId: 'img-1',
        result: { status: 'completed', path: '/tmp/generated.png', prompt: 'a red bicycle' },
      },
    ]);
  });

  it('reports the completed plan text', () => {
    const { messages, anyBackend } = collect();
    anyBackend.handleNotification(Methods.NOTIFY_ITEM_COMPLETED, {
      item: { id: 'plan-1', type: 'plan', text: '1. read the reducer\n2. fold the steps' },
    });
    expect(messages).toEqual([
      {
        type: 'event',
        name: 'plan_item',
        payload: { id: 'plan-1', text: '1. read the reducer\n2. fold the steps' },
      },
    ]);
  });

  it('ignores a blank plan', () => {
    const { messages, anyBackend } = collect();
    anyBackend.handleNotification(Methods.NOTIFY_ITEM_COMPLETED, {
      item: { id: 'plan-2', type: 'plan', text: '   ' },
    });
    expect(messages).toEqual([]);
  });

  it('shows a hook run as a step with how it ended', () => {
    const { messages, anyBackend } = collect();
    const run = { id: 'hook-1', eventName: 'preToolUse', status: 'running', handlerType: 'command', executionMode: 'sync' };
    anyBackend.handleNotification(Methods.NOTIFY_HOOK_STARTED, { threadId: 't1', run });
    anyBackend.handleNotification(Methods.NOTIFY_HOOK_COMPLETED, {
      threadId: 't1',
      run: {
        ...run,
        status: 'completed',
        durationMs: 1200,
        entries: [{ kind: 'warning', text: 'careful' }],
      },
    });
    expect(messages).toEqual([
      {
        type: 'tool-call',
        toolName: 'Hook',
        callId: 'hook-1',
        args: { event: 'preToolUse', handler: 'command', mode: 'sync' },
      },
      {
        type: 'tool-result',
        toolName: 'Hook',
        callId: 'hook-1',
        result: { status: 'completed', duration_ms: 1200, entries: [{ kind: 'warning', text: 'careful' }] },
      },
    ]);
  });

  it('opens a hook that arrives completed only', () => {
    const { messages, anyBackend } = collect();
    anyBackend.handleNotification(Methods.NOTIFY_HOOK_COMPLETED, {
      threadId: 't1',
      run: { id: 'hook-2', eventName: 'sessionEnd', status: 'stopped', handlerType: 'command' },
    });
    expect(messages.map((m) => m.type)).toEqual(['tool-call', 'tool-result']);
  });

  it('stays silent on an ordinary auto-review approval', () => {
    const { messages, anyBackend } = collect();
    anyBackend.handleNotification(Methods.NOTIFY_AUTO_REVIEW_COMPLETED, {
      threadId: 't1',
      reviewId: 'r1',
      review: { status: 'approved', riskLevel: 'medium' },
      action: { type: 'command', command: 'ls', cwd: '/tmp', source: 'shell' },
    });
    expect(messages).toEqual([]);
  });

  it('reports a denied auto-review with the action and reason', () => {
    const { messages, anyBackend } = collect();
    anyBackend.handleNotification(Methods.NOTIFY_AUTO_REVIEW_COMPLETED, {
      threadId: 't1',
      reviewId: 'r2',
      review: { status: 'denied', riskLevel: 'high', rationale: 'would delete the repo' },
      action: { type: 'command', command: 'rm -rf .git', cwd: '/repo', source: 'shell' },
    });
    expect(messages).toEqual([
      {
        type: 'event',
        name: 'auto_review',
        payload: {
          phase: 'completed',
          status: 'denied',
          riskLevel: 'high',
          rationale: 'would delete the repo',
          action: 'rm -rf .git',
        },
      },
    ]);
  });

  it('asks the reader to review when auto-review will not decide', () => {
    const { messages, anyBackend } = collect();
    anyBackend.handleNotification(Methods.NOTIFY_STRICT_REVIEW_REQUIRED, {
      threadId: 't1',
      turnId: 'turn-1',
      startedAtMs: 1,
    });
    expect(messages).toEqual([
      { type: 'event', name: 'auto_review', payload: { phase: 'strict' } },
    ]);
  });

  it('warns once when a quota window passes 90%, and only again after it drops below 80%', () => {
    const { messages, anyBackend } = collect();
    const send = (usedPercent: number) => anyBackend.handleNotification(Methods.NOTIFY_ACCOUNT_RATE_LIMITS, {
      rateLimits: {
        planType: 'plus',
        primary: { usedPercent, windowDurationMins: 300, resetsAt: 1800000000 },
      },
    });

    send(50);
    send(92);
    send(95);
    send(70);
    send(91);

    expect(messages).toEqual([
      {
        type: 'event',
        name: 'rate_limit',
        payload: {
          kind: 'window',
          window: 'primary',
          usedPercent: 92,
          windowDurationMins: 300,
          resetsAt: 1800000000,
          limitName: null,
          planType: 'plus',
        },
      },
      {
        type: 'event',
        name: 'rate_limit',
        payload: {
          kind: 'window',
          window: 'primary',
          usedPercent: 91,
          windowDurationMins: 300,
          resetsAt: 1800000000,
          limitName: null,
          planType: 'plus',
        },
      },
    ]);
  });

  it('keeps a quota window that a sparse update omits', () => {
    const { messages, anyBackend } = collect();
    anyBackend.handleNotification(Methods.NOTIFY_ACCOUNT_RATE_LIMITS, {
      rateLimits: { primary: { usedPercent: 92, windowDurationMins: 300 } },
    });
    // No primary here: the known 92% must survive, and must not warn a second time.
    anyBackend.handleNotification(Methods.NOTIFY_ACCOUNT_RATE_LIMITS, {
      rateLimits: { secondary: { usedPercent: 10, windowDurationMins: 10080 } },
    });
    anyBackend.handleNotification(Methods.NOTIFY_ACCOUNT_RATE_LIMITS, {
      rateLimits: { primary: { usedPercent: 93, windowDurationMins: 300 } },
    });
    expect(messages.map((m) => m.payload.usedPercent)).toEqual([92]);
  });

  it('reports a reached quota and re-arms it when the condition ends', () => {
    const { messages, anyBackend } = collect();
    const reached = 'workspace_owner_usage_limit_reached';
    const send = (rateLimitReachedType: string | null) => anyBackend.handleNotification(
      Methods.NOTIFY_ACCOUNT_RATE_LIMITS,
      { rateLimits: { rateLimitReachedType } },
    );

    send(reached);
    send(reached);
    send(null);
    send(reached);

    expect(messages).toEqual([
      { type: 'event', name: 'rate_limit', payload: { kind: 'reached', reachedType: reached } },
      { type: 'event', name: 'rate_limit', payload: { kind: 'reached', reachedType: reached } },
    ]);
  });

  it('reports exhausted credits unless the reached type already named them', () => {
    const { messages, anyBackend } = collect();
    const credits = { hasCredits: false, unlimited: false, balance: '0' };
    anyBackend.handleNotification(Methods.NOTIFY_ACCOUNT_RATE_LIMITS, {
      rateLimits: { credits },
    });
    anyBackend.handleNotification(Methods.NOTIFY_ACCOUNT_RATE_LIMITS, {
      rateLimits: { rateLimitReachedType: 'workspace_member_credits_depleted', credits },
    });
    expect(messages).toEqual([
      { type: 'event', name: 'rate_limit', payload: { kind: 'credits', balance: '0' } },
      {
        type: 'event',
        name: 'rate_limit',
        payload: { kind: 'reached', reachedType: 'workspace_member_credits_depleted' },
      },
    ]);
  });
});
