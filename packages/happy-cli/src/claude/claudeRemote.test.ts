import { beforeEach, describe, expect, it, vi } from 'vitest';
import { claudeRemote, type ClaudeSteer } from './claudeRemote';
import { AbortError, query } from '@/claude/sdk';
import type { SDKMessage } from '@/claude/sdk';

vi.mock('@/claude/sdk', async () => {
    class AbortError extends Error {}
    return {
        query: vi.fn(),
        AbortError
    };
});

vi.mock('@/ui/logger', () => ({
    logger: {
        debug: vi.fn(),
        debugLargeJson: vi.fn()
    }
}));

vi.mock('@/claude/utils/systemPrompt', () => ({
    systemPrompt: ''
}));

vi.mock('@/claude/utils/claudeCheckSession', () => ({
    claudeCheckSession: () => true
}));

vi.mock('@/modules/watcher/awaitFileExist', () => ({
    awaitFileExist: async () => true
}));

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function createMockResponse(messages: Array<{ message: SDKMessage, delayMs?: number }>) {
    async function* iterate() {
        for (const item of messages) {
            if (item.delayMs) {
                await sleep(item.delayMs);
            }
            yield item.message;
        }
    }

    return {
        [Symbol.asyncIterator]() {
            return iterate();
        },
        interrupt: vi.fn(async () => undefined)
    };
}

describe('claudeRemote', () => {
    beforeEach(() => {
        vi.mocked(query).mockReset();
    });

    it('keeps consuming SDK output while waiting for the next user message after result', async () => {
        const lateAssistant: SDKMessage = {
            type: 'assistant',
            message: {
                role: 'assistant',
                content: [{ type: 'text', text: 'late assistant message' }]
            }
        };

        vi.mocked(query).mockReturnValue(
            createMockResponse([
                {
                    message: {
                        type: 'result',
                        subtype: 'success',
                        num_turns: 1,
                        total_cost_usd: 0,
                        duration_ms: 1,
                        duration_api_ms: 1,
                        is_error: false,
                        session_id: 'session-1'
                    } as SDKMessage
                },
                { message: lateAssistant, delayMs: 10 }
            ]) as any
        );

        let resolveSecondNextMessage: (value: any) => void = () => undefined;
        const secondNextMessage = new Promise<any>((resolve) => {
            resolveSecondNextMessage = resolve;
        });

        const onMessage = vi.fn();
        let nextMessageCalls = 0;

        const remotePromise = claudeRemote({
            sessionId: null,
            path: process.cwd(),
            allowedTools: [],
            hookSettingsPath: '/tmp/fake-settings.json',
            nextMessage: async () => {
                nextMessageCalls += 1;
                if (nextMessageCalls === 1) {
                    return {
                        message: 'hello',
                        mode: { permissionMode: 'default' }
                    };
                }
                if (nextMessageCalls === 2) {
                    return secondNextMessage;
                }
                return null;
            },
            onReady: vi.fn(),
            isAborted: () => false,
            canCallTool: async () => ({ behavior: 'allow', updatedInput: {} }),
            onSessionFound: vi.fn(),
            onMessage,
            signal: new AbortController().signal
        });

        await sleep(30);
        expect(onMessage).toHaveBeenCalledWith(lateAssistant);

        resolveSecondNextMessage(null);
        await remotePromise;
    });

    it('does not auto-interrupt at tool_result boundaries', async () => {
        const response = createMockResponse([
            {
                message: {
                    type: 'assistant',
                    message: {
                        role: 'assistant',
                        content: [{ type: 'text', text: 'working' }]
                    }
                } as SDKMessage
            },
            {
                message: {
                    type: 'user',
                    message: {
                        role: 'user',
                        content: [
                            {
                                type: 'tool_result',
                                tool_use_id: 'tool-1',
                                content: [{ type: 'text', text: 'ok' }],
                            } as any
                        ]
                    }
                } as SDKMessage
            }
        ]);
        vi.mocked(query).mockReturnValue(response as any);

        await claudeRemote({
            sessionId: null,
            path: process.cwd(),
            allowedTools: [],
            hookSettingsPath: '/tmp/fake-settings.json',
            nextMessage: async () => ({
                message: 'hello',
                mode: { permissionMode: 'default' }
            }),
            onReady: vi.fn(),
            isAborted: () => false,
            canCallTool: async () => ({ behavior: 'allow', updatedInput: {} }),
            onSessionFound: vi.fn(),
            onMessage: vi.fn(),
            signal: new AbortController().signal,
        });

        expect(response.interrupt).not.toHaveBeenCalled();
    });

    it('still exits cleanly on explicit AbortError', async () => {
        const response = {
            async *[Symbol.asyncIterator]() {
                throw new AbortError('aborted');
            },
            interrupt: vi.fn(async () => undefined),
        };
        vi.mocked(query).mockReturnValue(response as any);

        await expect(
            claudeRemote({
                sessionId: null,
                path: process.cwd(),
                allowedTools: [],
                hookSettingsPath: '/tmp/fake-settings.json',
                nextMessage: async () => ({
                    message: 'hello',
                    mode: { permissionMode: 'default' }
                }),
                onReady: vi.fn(),
                isAborted: () => false,
                canCallTool: async () => ({ behavior: 'allow', updatedInput: {} }),
                onSessionFound: vi.fn(),
                onMessage: vi.fn(),
                signal: new AbortController().signal,
            })
        ).resolves.toBeUndefined();
    });

    describe('compaction notices', () => {
        const status = (fields: Record<string, unknown>) => ({ message: { type: 'system', subtype: 'status', ...fields } as SDKMessage });
        const result = { message: { type: 'result', subtype: 'success', num_turns: 1, total_cost_usd: 0, duration_ms: 1, duration_api_ms: 1, is_error: false, session_id: 'session-1' } as SDKMessage };

        async function run(text: string, messages: Array<{ message: SDKMessage }>): Promise<string[]> {
            vi.mocked(query).mockReturnValue(createMockResponse(messages) as any);
            const events: string[] = [];
            let calls = 0;
            await claudeRemote({
                sessionId: null,
                path: process.cwd(),
                allowedTools: [],
                hookSettingsPath: '/tmp/fake-settings.json',
                nextMessage: async () => (calls++ === 0 ? { message: text, mode: { permissionMode: 'default' } } : null),
                onReady: vi.fn(),
                isAborted: () => false,
                canCallTool: async () => ({ behavior: 'allow', updatedInput: {} }),
                onSessionFound: vi.fn(),
                onMessage: vi.fn(),
                onCompletionEvent: (message) => events.push(message),
                signal: new AbortController().signal,
            });
            return events;
        }

        it('announces an auto-compaction once, however many progress updates arrive', async () => {
            const events = await run('hello', [
                status({ status: 'compacting', compact_output_chars: 0 }),
                status({ status: 'compacting', compact_output_chars: 6381 }),
                status({ status: null, compact_result: 'success' }),
                result,
            ]);
            expect(events).toEqual(['Compaction started', 'Compaction completed']);
        });

        it('reports a failed auto-compaction', async () => {
            const events = await run('hello', [
                status({ status: 'compacting', compact_output_chars: 0 }),
                status({ status: null, compact_result: 'failed', compact_error: 'Compaction interrupted' }),
                result,
            ]);
            expect(events).toEqual(['Compaction started', 'Compaction failed']);
        });

        it('announces a second auto-compaction in the same query', async () => {
            const events = await run('hello', [
                status({ status: 'compacting', compact_output_chars: 0 }),
                status({ status: null, compact_result: 'success' }),
                status({ status: 'compacting', compact_output_chars: 0 }),
                status({ status: null, compact_result: 'success' }),
                result,
            ]);
            expect(events).toEqual(['Compaction started', 'Compaction completed', 'Compaction started', 'Compaction completed']);
        });

        it('keeps a manual /compact to the single started/ended pair', async () => {
            const events = await run('/compact', [
                status({ status: 'compacting', compact_output_chars: 0 }),
                status({ status: null, compact_result: 'success' }),
                result,
            ]);
            expect(events).toEqual(['Compaction started', 'Compaction completed']);
        });

        it('reports a refused manual /compact as failed', async () => {
            const events = await run('/compact', [
                status({ status: null, compact_result: 'failed', compact_error: 'Not enough messages to compact.' }),
                result,
            ]);
            expect(events).toEqual(['Compaction started', 'Compaction failed']);
        });
    });

    describe('steering', () => {
        const result = { type: 'result', subtype: 'success', num_turns: 1, total_cost_usd: 0, duration_ms: 1, duration_api_ms: 1, is_error: false, session_id: 'session-1' } as SDKMessage;
        const init = { type: 'system', subtype: 'init', session_id: 'session-1' } as SDKMessage;
        const lifecycle = (uuid: string, state: string) => ({ type: 'command_lifecycle', command_uuid: uuid, state } as SDKMessage);

        /** Claude as the test drives it: `emit` yields its output, `inputs` holds what it was sent */
        function startClaude(nextMessages: Array<string | null> = []) {
            const output: SDKMessage[] = [];
            let wake: (() => void) | null = null;
            let ended = false;
            const inputs: Array<{ uuid?: string; message: { content: unknown } }> = [];
            vi.mocked(query).mockImplementation(({ prompt }: any) => {
                void (async () => {
                    for await (const input of prompt) inputs.push(input);
                })();
                return {
                    async *[Symbol.asyncIterator]() {
                        while (true) {
                            while (output.length) yield output.shift()!;
                            if (ended) return;
                            await new Promise<void>((resolve) => { wake = resolve; });
                        }
                    },
                    interrupt: vi.fn(async () => undefined),
                } as any;
            });
            const emit = async (...messages: SDKMessage[]) => {
                output.push(...messages);
                wake?.();
                await sleep(5);
            };
            const end = async () => {
                ended = true;
                wake?.();
                await sleep(5);
            };

            let steer: ClaudeSteer | null = null;
            const steerChanges: Array<boolean> = [];
            const results: Array<[string, string]> = [];
            const events: string[] = [];
            let calls = 0;
            const queue = ['hello', ...nextMessages];
            const done = claudeRemote({
                sessionId: null,
                path: process.cwd(),
                allowedTools: [],
                hookSettingsPath: '/tmp/fake-settings.json',
                nextMessage: async () => {
                    const text = queue[calls++];
                    if (text) return { message: text, mode: { permissionMode: 'default' } };
                    // The session waits for the user's next message
                    await new Promise((resolve) => setTimeout(resolve, 10_000));
                    return null;
                },
                onReady: () => events.push('ready'),
                onTurnEnd: () => events.push('turn-end'),
                flushOutgoing: async () => { events.push('flush'); },
                isAborted: () => false,
                canCallTool: async () => ({ behavior: 'allow', updatedInput: {} }),
                onSessionFound: vi.fn(),
                onMessage: (message) => events.push(`message:${message.type}`),
                onSteerChange: (next) => {
                    steer = next;
                    steerChanges.push(next !== null);
                },
                onSteerResult: (pendingId, outcome) => {
                    results.push([pendingId, outcome]);
                    events.push(`steer:${pendingId}:${outcome}`);
                },
                signal: new AbortController().signal,
            });
            return { emit, end, inputs, done, events, results, steerChanges, steer: () => steer };
        }

        it('offers steering once Claude reports its input lifecycle, and sends every message with an id', async () => {
            const claude = startClaude();
            await claude.emit(init);
            expect(claude.steer()).toBeNull();
            await claude.emit(lifecycle(claude.inputs[0].uuid!, 'started'));
            expect(claude.steer()).not.toBeNull();
            expect(claude.inputs[0].uuid).toEqual(expect.any(String));
            expect(claude.events).not.toContain('message:command_lifecycle');
            await claude.end();
            await claude.done;
            expect(claude.steerChanges).toEqual([true, false]);
        });

        it('reports a steered message read when Claude starts it, after flushing what came before', async () => {
            const claude = startClaude();
            await claude.emit(init, lifecycle('x', 'queued'));
            await expect(claude.steer()!('also this', 'p1')).resolves.toEqual({ accepted: true });
            const steered = claude.inputs[1];
            expect(steered.message.content).toBe('also this');
            claude.events.length = 0;
            await claude.emit(lifecycle(steered.uuid!, 'queued'), lifecycle(steered.uuid!, 'started'));
            expect(claude.events).toEqual(['flush', 'steer:p1:read']);
            await claude.emit(result);
            expect(claude.events).toContain('turn-end');
            await claude.end();
            await claude.done;
            expect(claude.results).toEqual([['p1', 'read']]);
        });

        it('keeps the turn going past a result while a steered message waits to start', async () => {
            const claude = startClaude();
            await claude.emit(init, lifecycle('x', 'queued'));
            await claude.steer()!('next', 'p1');
            await sleep(5);
            const uuid = claude.inputs[1].uuid!;
            claude.events.length = 0;
            await claude.emit(result);
            expect(claude.events).toEqual(['message:result']);
            await claude.emit(init, lifecycle(uuid, 'started'), result);
            expect(claude.events).toEqual(['message:result', 'message:system', 'flush', 'steer:p1:read', 'message:result', 'flush', 'turn-end', 'ready']);
            await claude.end();
            await claude.done;
        });

        it('drops a steered message Claude never started when it exits', async () => {
            const claude = startClaude();
            await claude.emit(init, lifecycle('x', 'queued'));
            await claude.steer()!('next', 'p1');
            await claude.end();
            await claude.done;
            expect(claude.results).toEqual([['p1', 'dropped']]);
        });

        it('refuses commands, and messages while no turn runs', async () => {
            const claude = startClaude();
            await claude.emit(init, lifecycle('x', 'queued'));
            await expect(claude.steer()!('/clear', 'p1')).resolves.toEqual({ accepted: false, reason: 'command' });
            await claude.emit(result);
            await expect(claude.steer()!('later', 'p2')).resolves.toEqual({ accepted: false, reason: 'not_running' });
            expect(claude.inputs).toHaveLength(1);
            await claude.end();
            await claude.done;
        });
    });
});
