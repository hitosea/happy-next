import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiSessionClient } from './apiSession';
import * as trimToolUseResultModule from './trimToolUseResult';
import * as toolOutputStoreModule from '../modules/common/toolOutputStore';
import * as encryptionModule from './encryption';
import * as toolImageStoreModule from '../modules/common/toolImageStore';

// Use vi.hoisted to ensure mock function is available when vi.mock factory runs
const { mockIo } = vi.hoisted(() => ({
    mockIo: vi.fn()
}));

vi.mock('socket.io-client', () => ({
    io: mockIo
}));

describe('ApiSessionClient connection handling', () => {
    let mockSocket: any;
    let consoleSpy: any;
    let mockSession: any;

    beforeEach(() => {
        consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

        // Mock socket.io client
        mockSocket = {
            connect: vi.fn(),
            on: vi.fn(),
            off: vi.fn(),
            disconnect: vi.fn()
        };

        mockIo.mockReturnValue(mockSocket);

        // Create a proper mock session with metadata
        mockSession = {
            id: 'test-session-id',
            seq: 0,
            metadata: {
                path: '/tmp',
                host: 'localhost',
                homeDir: '/home/user',
                happyHomeDir: '/home/user/.happy-next',
                happyLibDir: '/home/user/.happy/lib',
                happyToolsDir: '/home/user/.happy/tools'
            },
            metadataVersion: 0,
            agentState: null,
            agentStateVersion: 0,
            encryptionKey: new Uint8Array(32),
            encryptionVariant: 'legacy' as const
        };
    });

    it('should handle socket connection failure gracefully', async () => {
        // Should not throw during client creation
        // Note: socket is created with autoConnect: false, so connection happens later
        expect(() => {
            new ApiSessionClient('fake-token', mockSession, async () => new Uint8Array(32));
        }).not.toThrow();
    });

    it('should emit correct events on socket connection', () => {
        const client = new ApiSessionClient('fake-token', mockSession, async () => new Uint8Array(32));

        // Should have set up event listeners
        expect(mockSocket.on).toHaveBeenCalledWith('connect', expect.any(Function));
        expect(mockSocket.on).toHaveBeenCalledWith('disconnect', expect.any(Function));
        expect(mockSocket.on).toHaveBeenCalledWith('error', expect.any(Function));
    });

    it('should advertise supportsMessageReceipt capability in socket auth', () => {
        new ApiSessionClient('fake-token', mockSession, async () => new Uint8Array(32));

        expect(mockIo).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({
                auth: expect.objectContaining({
                    clientType: 'session-scoped',
                    sessionId: 'test-session-id',
                    supportsMessageReceipt: true,
                }),
            }),
        );
    });

    afterEach(() => {
        consoleSpy.mockRestore();
        vi.restoreAllMocks();
    });
});

describe('ApiSessionClient v3 outbox', () => {
    let mockSocket: any;
    let consoleSpy: any;
    let mockSession: any;

    beforeEach(() => {
        consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

        mockSocket = {
            connect: vi.fn(),
            on: vi.fn(),
            off: vi.fn(),
            close: vi.fn(),
            disconnect: vi.fn(),
            emit: vi.fn(),
            connected: true
        };

        mockIo.mockReturnValue(mockSocket);

        mockSession = {
            id: 'test-session-id',
            seq: 0,
            metadata: {
                path: '/tmp',
                host: 'localhost',
                homeDir: '/home/user',
                happyHomeDir: '/home/user/.happy-next',
                happyLibDir: '/home/user/.happy/lib',
                happyToolsDir: '/home/user/.happy/tools'
            },
            metadataVersion: 0,
            agentState: null,
            agentStateVersion: 0,
            encryptionKey: new Uint8Array(32),
            encryptionVariant: 'legacy' as const
        };
    });

    afterEach(() => {
        consoleSpy.mockRestore();
        vi.restoreAllMocks();
    });

    it('should initialize sendSync in the constructor', () => {
        const client = new ApiSessionClient('fake-token', mockSession, async () => new Uint8Array(32));

        // The sendSync field should exist (it's private, but we can verify
        // indirectly by ensuring close() doesn't throw)
        expect(() => client.close()).not.toThrow();
    });

    it('registers image-bearing tool calls before sending them to the app', () => {
        const client = new ApiSessionClient('fake-token', mockSession, async () => new Uint8Array(32));
        const register = vi.spyOn(toolImageStoreModule, 'registerToolImageForCall').mockImplementation(() => {});
        const enqueue = vi.spyOn(client as any, 'enqueueMessage').mockImplementation(() => {});
        const body = { type: 'tool-call' as const, callId: 'image-call', name: 'view_image', input: { path: '/outside/image.png' }, id: 'message-1' };
        client.sendAgentMessage('codex', body);
        expect(register).toHaveBeenCalledWith('test-session-id', '/tmp', 'view_image', 'image-call', body.input);
        expect(register.mock.invocationCallOrder[0]).toBeLessThan(enqueue.mock.invocationCallOrder[0]);
        client.sendAgentMessage('codex', { type: 'tool-result', callId: 'image-call', output: {}, id: 'result-1' });
        expect(register).toHaveBeenCalledTimes(1);
        client.close();
    });

    it('registers every Claude tool call, including subagents', () => {
        const client = new ApiSessionClient('fake-token', mockSession, async () => new Uint8Array(32));
        const register = vi.spyOn(toolImageStoreModule, 'registerToolImageForCall').mockImplementation(() => {});
        client.sendClaudeSessionMessage({
            type: 'assistant',
            uuid: 'uuid-1',
            isSidechain: true,
            message: {
                role: 'assistant',
                content: [
                    { type: 'tool_use', id: 'read-1', name: 'Read', input: { file_path: '/tmp/photo.png' } },
                    { type: 'tool_use', id: 'edit-1', name: 'Edit', input: { file_path: '/tmp/photo.png' } },
                ],
            },
        } as any);
        expect(register).toHaveBeenCalledWith('test-session-id', '/tmp', 'Read', 'read-1', { file_path: '/tmp/photo.png' });
        expect(register).toHaveBeenCalledTimes(2);
        client.close();
    });

    it('should NOT emit via socket when sending a Claude session message (v3 outbox only)', () => {
        const client = new ApiSessionClient('fake-token', mockSession, async () => new Uint8Array(32));

        const body = {
            type: 'assistant' as const,
            message: {
                content: [{ type: 'text', text: 'Hello' }],
                role: 'assistant' as const
            }
        };

        client.sendClaudeSessionMessage(body as any);

        // Socket emit should NOT be called — messages now go through v3 HTTP outbox only
        expect(mockSocket.emit).not.toHaveBeenCalledWith('message', expect.anything());
    });

    it('should NOT emit via socket when sending an agent message (v3 outbox only)', () => {
        const client = new ApiSessionClient('fake-token', mockSession, async () => new Uint8Array(32));

        client.sendAgentMessage('gemini', { type: 'message', message: 'Hello from Gemini' });

        // Socket emit should NOT be called — messages now go through v3 HTTP outbox only
        expect(mockSocket.emit).not.toHaveBeenCalledWith('message', expect.anything());
    });

    it('should NOT emit via socket when sending a codex message (v3 outbox only)', () => {
        const client = new ApiSessionClient('fake-token', mockSession, async () => new Uint8Array(32));

        client.sendCodexMessage({ type: 'message', text: 'Hello from Codex' });

        // Socket emit should NOT be called — messages now go through v3 HTTP outbox only
        expect(mockSocket.emit).not.toHaveBeenCalledWith('message', expect.anything());
    });

    it('should use snake_case tool_use_result payloads when trimming Claude tool results', () => {
        const client = new ApiSessionClient('fake-token', mockSession, async () => new Uint8Array(32)) as any;
        const trimSpy = vi.spyOn(trimToolUseResultModule, 'trimToolUseResult').mockReturnValue({
            _outputTrimmed: true,
            _callId: 'toolu_read_1',
            _toolResultKind: 'text',
        });

        client.buildMessageContent({
            type: 'assistant',
            uuid: 'assistant-1',
            message: {
                role: 'assistant',
                content: [{
                    type: 'tool_use',
                    id: 'toolu_read_1',
                    name: 'Read',
                    input: {
                        file_path: '/tmp/demo.ts',
                    },
                }],
            },
        });

        const toolUseResult = {
            type: 'text',
            file: {
                filePath: '/tmp/demo.ts',
                content: 'export const demo = 1;\n',
                numLines: 1,
                startLine: 1,
                totalLines: 1,
            },
        };

        const messageContent = client.buildMessageContent({
            type: 'user',
            uuid: 'user-1',
            message: {
                role: 'user',
                content: [{
                    type: 'tool_result',
                    tool_use_id: 'toolu_read_1',
                    content: 'demo',
                }],
            },
            tool_use_result: toolUseResult,
        });

        expect(trimSpy).toHaveBeenCalledWith(
            'Read',
            toolUseResult,
            'test-session-id',
            'toolu_read_1'
        );
        expect(messageContent).toMatchObject({
            role: 'agent',
            content: {
                type: 'output',
                data: {
                    toolUseResult: {
                        _outputTrimmed: true,
                        _callId: 'toolu_read_1',
                        _toolResultKind: 'text',
                    },
                },
            },
        });

        trimSpy.mockRestore();
    });

    it('should preserve trimmed WebSearch results from snake_case tool_use_result payloads', () => {
        const client = new ApiSessionClient('fake-token', mockSession, async () => new Uint8Array(32)) as any;
        const saveSpy = vi.spyOn(toolOutputStoreModule, 'saveToolOutputRecord').mockImplementation(() => {});

        client.buildMessageContent({
            type: 'assistant',
            uuid: 'assistant-web-1',
            message: {
                role: 'assistant',
                content: [{
                    type: 'tool_use',
                    id: 'toolu_web_1',
                    name: 'WebSearch',
                    input: {
                        query: 'Claude Code CLI tool 2026',
                    },
                }],
            },
        });

        const messageContent = client.buildMessageContent({
            type: 'user',
            uuid: 'user-web-1',
            message: {
                role: 'user',
                content: [{
                    type: 'tool_result',
                    tool_use_id: 'toolu_web_1',
                    content: 'large raw result',
                }],
            },
            tool_use_result: {
                query: 'Claude Code CLI tool 2026',
                results: [
                    { title: 'Claude Code', url: 'https://example.com/claude-code' },
                ],
            },
        });

        expect(messageContent).toMatchObject({
            role: 'agent',
            content: {
                type: 'output',
                data: {
                    toolUseResult: {
                        query: 'Claude Code CLI tool 2026',
                        _outputTrimmed: true,
                        _callId: 'toolu_web_1',
                        _toolResultKind: 'structured',
                    },
                },
            },
        });

        saveSpy.mockRestore();
    });
});

describe('ApiSessionClient message receipt', () => {
    let mockSocket: any;
    let mockSession: any;

    beforeEach(() => {
        mockSocket = {
            connect: vi.fn(),
            on: vi.fn(),
            off: vi.fn(),
            close: vi.fn(),
            disconnect: vi.fn(),
            emit: vi.fn(),
            connected: true
        };

        mockIo.mockReturnValue(mockSocket);

        mockSession = {
            id: 'test-session-id',
            seq: 0,
            metadata: {
                path: '/tmp',
                host: 'localhost',
                homeDir: '/home/user',
                happyHomeDir: '/home/user/.happy-next',
                happyLibDir: '/home/user/.happy/lib',
                happyToolsDir: '/home/user/.happy/tools'
            },
            metadataVersion: 0,
            agentState: null,
            agentStateVersion: 0,
            encryptionKey: new Uint8Array(32),
            encryptionVariant: 'legacy' as const
        };
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    function getUpdateHandler() {
        const call = mockSocket.on.mock.calls.find((args: any[]) => args[0] === 'update');
        if (!call) {
            throw new Error('update handler not registered');
        }
        return call[1];
    }

    it('emits message-receipt ok=true when app-originated user message is accepted', () => {
        new ApiSessionClient('fake-token', mockSession, async () => new Uint8Array(32));

        vi.spyOn(encryptionModule, 'decodeBase64').mockReturnValue(new Uint8Array([1, 2, 3]));
        vi.spyOn(encryptionModule, 'decrypt').mockReturnValue({
            role: 'user',
            content: { type: 'text', text: 'hello' },
            meta: { sentFrom: 'web' }
        } as any);

        const updateHandler = getUpdateHandler();
        updateHandler({
            body: {
                t: 'new-message',
                sid: 'test-session-id',
                message: {
                    id: 'msg-1',
                    localId: 'local-1',
                    content: { t: 'encrypted', c: 'abc' }
                }
            }
        });

        expect(mockSocket.emit).toHaveBeenCalledWith('message-receipt', {
            sid: 'test-session-id',
            messageId: 'msg-1',
            localId: 'local-1',
            ok: true
        });
    });

    it('emits message-receipt ok=false with original error on decrypt/parse failure', () => {
        new ApiSessionClient('fake-token', mockSession, async () => new Uint8Array(32));

        vi.spyOn(encryptionModule, 'decodeBase64').mockReturnValue(new Uint8Array([1, 2, 3]));
        vi.spyOn(encryptionModule, 'decrypt').mockImplementation(() => {
            throw new Error('decrypt failed: invalid payload');
        });

        const updateHandler = getUpdateHandler();
        updateHandler({
            body: {
                t: 'new-message',
                sid: 'test-session-id',
                message: {
                    id: 'msg-1',
                    localId: 'local-1',
                    content: { t: 'encrypted', c: 'abc' }
                }
            }
        });

        expect(mockSocket.emit).toHaveBeenCalledWith('message-receipt', {
            sid: 'test-session-id',
            messageId: 'msg-1',
            localId: 'local-1',
            ok: false,
            error: 'decrypt failed: invalid payload'
        });
    });
    it('flags the post-compaction summary so the app can keep it off the minimap', () => {
        const client = new ApiSessionClient('fake-token', mockSession, async () => new Uint8Array(32)) as any;
        const titleSpy = vi.spyOn(client, 'maybeSetInitialTitleFromUserText');

        const messageContent = client.buildMessageContent({
            type: 'user',
            uuid: 'user-compact-1',
            isCompactSummary: true,
            message: {
                role: 'user',
                content: 'This session is being continued from a previous conversation that ran out of context.',
            },
        });

        expect(messageContent).toMatchObject({
            role: 'user',
            content: {
                type: 'text',
                text: 'This session is being continued from a previous conversation that ran out of context.',
            },
            meta: {
                sentFrom: 'cli',
                isCompactSummary: true,
            },
        });
        // The summary is not user input, so it must not become the session title.
        expect(titleSpy).not.toHaveBeenCalled();
        titleSpy.mockRestore();
    });

    it('leaves ordinary user prompts unflagged', () => {
        const client = new ApiSessionClient('fake-token', mockSession, async () => new Uint8Array(32)) as any;
        const titleSpy = vi.spyOn(client, 'maybeSetInitialTitleFromUserText');

        const messageContent = client.buildMessageContent({
            type: 'user',
            uuid: 'user-plain-1',
            message: { role: 'user', content: 'hello there' },
        });

        expect(messageContent).toMatchObject({
            role: 'user',
            content: { type: 'text', text: 'hello there' },
            meta: { sentFrom: 'cli' },
        });
        expect(messageContent.meta.isCompactSummary).toBeUndefined();
        expect(titleSpy).toHaveBeenCalledWith('hello there');
        titleSpy.mockRestore();
    });

    it('flags a compaction summary delivered as text blocks', () => {
        const client = new ApiSessionClient('fake-token', mockSession, async () => new Uint8Array(32)) as any;

        const messageContent = client.buildMessageContent({
            type: 'user',
            uuid: 'user-compact-2',
            isCompactSummary: true,
            message: {
                role: 'user',
                content: [{ type: 'text', text: 'continued from a previous conversation' }],
            },
        });

        expect(messageContent).toMatchObject({
            role: 'user',
            content: { type: 'text', text: 'continued from a previous conversation' },
            meta: { sentFrom: 'cli', isCompactSummary: true },
        });
    });
});

describe('ApiSessionClient keepAlive', () => {
    let aliveEmit: ReturnType<typeof vi.fn>;
    let client: ApiSessionClient;
    let releaseOutbox: () => void;
    let pushOutbox: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        aliveEmit = vi.fn();
        mockIo.mockReturnValue({
            connect: vi.fn(), on: vi.fn(), off: vi.fn(), close: vi.fn(), disconnect: vi.fn(), emit: vi.fn(),
            connected: true,
            volatile: { emit: aliveEmit },
        });
        client = new ApiSessionClient('fake-token', {
            id: 'test-session-id',
            seq: 0,
            metadata: { path: '/tmp', host: 'localhost', homeDir: '/home/user', happyHomeDir: '/home/user/.happy-next', happyLibDir: '/home/user/.happy/lib', happyToolsDir: '/home/user/.happy/tools' },
            metadataVersion: 0,
            agentState: null,
            agentStateVersion: 0,
            encryptionKey: new Uint8Array(32),
            encryptionVariant: 'legacy',
        } as any, async () => new Uint8Array(32));
        vi.spyOn((client as any).sendSync, 'invalidateAndAwait').mockImplementation(
            () => new Promise<void>((resolve) => { releaseOutbox = resolve; }),
        );
        pushOutbox = vi.spyOn(client as any, 'pushOutbox').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    const reported = () => aliveEmit.mock.calls.map(([, payload]) => payload.thinking);
    const sent = () => pushOutbox.mock.calls.map(([content]: any[]) => ({ type: content.content.data.type, turnEnd: content.meta?.turnEnd }));
    const text = (message: string) => client.sendAgentMessage('codex', { type: 'message', message });

    it('reports thinking at once', () => {
        client.keepAlive(true, 'remote');
        expect(reported()).toEqual([true]);
    });

    it('holds idle until the outbox has drained, so the last message lands first', async () => {
        client.keepAlive(true, 'remote');
        client.keepAlive(false, 'remote');
        client.keepAlive(false, 'remote'); // periodic heartbeat while the drain runs
        expect(reported()).toEqual([true]);
        releaseOutbox();
        await vi.waitFor(() => expect(reported()).toEqual([true, false]));
        client.keepAlive(false, 'remote');
        expect(reported()).toEqual([true, false, false]);
    });

    it('drops a pending idle when the agent goes busy again', async () => {
        client.keepAlive(true, 'remote');
        client.keepAlive(false, 'remote');
        client.keepAlive(true, 'remote');
        releaseOutbox();
        await Promise.resolve();
        await Promise.resolve();
        expect(reported()).toEqual([true, true]);
    });

    it('goes idle anyway when the outbox cannot drain', async () => {
        vi.useFakeTimers();
        client.keepAlive(true, 'remote');
        client.keepAlive(false, 'remote');
        await vi.advanceTimersByTimeAsync(10_000);
        expect(reported()).toEqual([true, false]);
    });

    it('sends the text a turn ends on marked, ahead of the records after it', () => {
        client.keepAlive(true, 'remote');
        text('first');
        client.sendAgentMessage('codex', { type: 'tool-call', callId: 'c1', name: 'Bash', input: {}, id: 't1' });
        text('last');
        client.sendAgentMessage('codex', { type: 'token_count', id: 'u1' } as any);
        client.sendAgentMessage('codex', { type: 'task_complete', id: 'd1' });
        expect(sent()).toEqual([{ type: 'message' }, { type: 'tool-call' }]);
        client.keepAlive(false, 'remote');
        expect(sent()).toEqual([
            { type: 'message' },
            { type: 'tool-call' },
            { type: 'message', turnEnd: true },
            { type: 'token_count' },
            { type: 'task_complete' },
        ]);
    });

    it('lets a held text go unmarked once the hold runs out', async () => {
        vi.useFakeTimers();
        client.keepAlive(true, 'remote');
        text('thinking out loud');
        await vi.advanceTimersByTimeAsync(999);
        expect(sent()).toEqual([]);
        await vi.advanceTimersByTimeAsync(1);
        expect(sent()).toEqual([{ type: 'message' }]);
        client.keepAlive(false, 'remote');
        expect(sent()).toEqual([{ type: 'message' }]);
    });

    it('holds only agent texts, not Claude tool calls or subagent texts', () => {
        const claude = (content: any[], extra: object = {}) => client.sendClaudeSessionMessage({ type: 'assistant', uuid: 'u', message: { role: 'assistant', content }, ...extra } as any);
        claude([{ type: 'tool_use', id: 'x', name: 'Bash', input: {} }]);
        claude([{ type: 'text', text: 'from a subagent' }], { isSidechain: true });
        expect(pushOutbox).toHaveBeenCalledTimes(2);
        claude([{ type: 'text', text: 'done' }]);
        expect(pushOutbox).toHaveBeenCalledTimes(2);
    });

    it('stamps Claude messages with their turn, and draws a new one after the turn ends', () => {
        const claude = (content: any[]) => client.sendClaudeSessionMessage({ type: 'assistant', uuid: 'u', message: { role: 'assistant', content } } as any);
        const turns = () => pushOutbox.mock.calls.map(([content]: any[]) => content.meta?.turn);
        claude([{ type: 'tool_use', id: 'a', name: 'Bash', input: {} }]);
        claude([{ type: 'tool_use', id: 'b', name: 'Bash', input: {} }]);
        client.endTurn();
        // A background task reporting in: Claude starts again with no prompt.
        claude([{ type: 'tool_use', id: 'c', name: 'Bash', input: {} }]);
        client.sendClaudeSessionMessage({ type: 'user', uuid: 'p', message: { role: 'user', content: 'a prompt' } } as any);
        const [first, second, resumed, prompt] = turns();
        expect(first).toEqual(expect.any(String));
        expect(second).toBe(first);
        expect(resumed).toEqual(expect.any(String));
        expect(resumed).not.toBe(first);
        expect(prompt).toBeUndefined();
    });

    it('stamps ACP messages with their turn, and draws a new one after task_complete or turn_aborted', () => {
        const turns = () => pushOutbox.mock.calls.map(([content]: any[]) => content.meta?.turn);
        const end = (type: 'task_complete' | 'turn_aborted') => client.sendAgentMessage('codex', { type, id: type });
        client.sendAgentMessage('codex', { type: 'tool-call', callId: 'a', name: 'orchestrator_exec', input: {}, id: 'a' } as any);
        end('task_complete');
        // A background task reporting in: the agent starts again with no prompt.
        client.sendAgentMessage('codex', { type: 'tool-call', callId: 'b', name: 'orchestrator_pend', input: {}, id: 'b' } as any);
        end('turn_aborted');
        client.sendAgentMessage('codex', { type: 'tool-call', callId: 'c', name: 'Bash', input: {}, id: 'c' } as any);
        const [first, firstEnd, resumed, resumedEnd, next] = turns();
        expect(first).toEqual(expect.any(String));
        expect(firstEnd).toBe(first);
        expect(resumed).toEqual(expect.any(String));
        expect(resumed).not.toBe(first);
        expect(resumedEnd).toBe(resumed);
        expect(next).not.toBe(resumed);
    });
});
