import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startHappyServer } from './startHappyServer';

function terminalResponse(taskCount: number, options: { terminal?: boolean; tasks?: boolean } = {}) {
    const tasks = Array.from({ length: taskCount }, (_, i) => ({ taskId: `t${i + 1}`, status: 'completed' }));
    return {
        ok: true,
        data: {
            runId: 'run-1',
            terminal: options.terminal ?? true,
            run: { status: 'completed', summary: { total: taskCount } },
            ...(options.tasks === false ? {} : { tasks }),
        },
    };
}

describe('happy MCP server: what the agent knows of finished runs', () => {
    let stop: (() => Promise<void>) | null = null;
    let mcpClient: Client | null = null;

    afterEach(async () => {
        await mcpClient?.close();
        await stop?.();
        mcpClient = null;
        stop = null;
    });

    async function connect(fake: Record<string, unknown>) {
        const client = {
            sessionId: 'controller-session',
            markOrchestratorRunEndKnown: vi.fn(),
            markOrchestratorRunReopened: vi.fn(),
            takeUndeliveredOrchestratorCallbacks: vi.fn((): string[] => []),
            getMetadataSnapshot: () => ({ machineId: 'm1' }),
            ...fake,
        };
        const server = await startHappyServer(client as any);
        stop = server.stop;
        mcpClient = new Client({ name: 'test', version: '1.0.0' });
        await mcpClient.connect(new StreamableHTTPClientTransport(new URL(server.url)));
        return { client, call: (name: string, args: Record<string, unknown>) => mcpClient!.callTool({ name, arguments: args }) as Promise<any> };
    }

    it('marks the run for any pend returning its end, with or without tasks', async () => {
        const pend = vi.fn()
            .mockResolvedValueOnce(terminalResponse(2))
            .mockResolvedValueOnce(terminalResponse(2, { tasks: false }))
            .mockResolvedValueOnce(terminalResponse(2));
        const { client, call } = await connect({ orchestratorPend: pend });
        await call('orchestrator_pend', { runId: 'run-1', include: 'all_tasks', waitFor: 'terminal' });
        await call('orchestrator_pend', { runId: 'run-1' });
        await call('orchestrator_pend', { runId: 'run-1', taskId: 't1' });
        expect(client.markOrchestratorRunEndKnown.mock.calls).toEqual([['run-1'], ['run-1'], ['run-1']]);
    });

    it('does not mark the run for a pend before it finished', async () => {
        const { client, call } = await connect({ orchestratorPend: vi.fn(async () => terminalResponse(2, { terminal: false })) });
        await call('orchestrator_pend', { runId: 'run-1', include: 'all_tasks' });
        expect(client.markOrchestratorRunEndKnown).not.toHaveBeenCalled();
    });

    it('marks the run when exec or transfer returns a finished run', async () => {
        const { client, call } = await connect({
            orchestratorExec: vi.fn(async () => terminalResponse(1)),
            orchestratorTransfer: vi.fn(async () => ({ ...terminalResponse(1), data: { ...terminalResponse(1).data, runId: 'run-2' } })),
        });
        await call('orchestrator_exec', { command: 'ls', machineIds: ['m1'] });
        await call('orchestrator_transfer', { fromMachineId: 'm1', fromPath: '/a', toMachineIds: ['m1'], toPath: '/b' });
        expect(client.markOrchestratorRunEndKnown.mock.calls).toEqual([['run-1'], ['run-2']]);
    });

    it('does not mark the run when exec returns before it finished', async () => {
        const { client, call } = await connect({ orchestratorExec: vi.fn(async () => terminalResponse(1, { terminal: false })) });
        await call('orchestrator_exec', { command: 'sleep 100', machineIds: ['m1'] });
        expect(client.markOrchestratorRunEndKnown).not.toHaveBeenCalled();
    });

    it('does not mark the run for a list that shows it finished', async () => {
        const { client, call } = await connect({ orchestratorListRuns: vi.fn(async () => ({ ok: true, data: { runs: [{ runId: 'run-1', status: 'completed' }] } })) });
        await call('orchestrator_list', {});
        expect(client.markOrchestratorRunEndKnown).not.toHaveBeenCalled();
    });

    it('marks a run the agent cancelled, unless the cancel failed', async () => {
        const cancel = vi.fn()
            .mockRejectedValueOnce(new Error('not found'))
            .mockResolvedValueOnce({ ok: true, data: { runId: 'run-1', status: 'canceling', accepted: true } });
        const { client, call } = await connect({ orchestratorCancel: cancel });
        await call('orchestrator_cancel', { runId: 'run-1' });
        expect(client.markOrchestratorRunEndKnown).not.toHaveBeenCalled();
        await call('orchestrator_cancel', { runId: 'run-1' });
        expect(client.markOrchestratorRunEndKnown).toHaveBeenCalledWith('run-1');
    });

    it('starts a new round of the run only when a follow-up was accepted', async () => {
        const sendMessage = vi.fn()
            .mockRejectedValueOnce(new Error('conflict'))
            .mockResolvedValueOnce({ ok: true, data: { accepted: true, runId: 'run-1', taskId: 't1' } });
        const { client, call } = await connect({ orchestratorSendMessage: sendMessage });
        await call('orchestrator_send_message', { taskId: 't1', message: 'more' });
        expect(client.markOrchestratorRunReopened).not.toHaveBeenCalled();
        await call('orchestrator_send_message', { taskId: 't1', message: 'more' });
        expect(client.markOrchestratorRunReopened).toHaveBeenCalledWith('run-1');
    });

    describe('callbacks in tool results', () => {
        const parsed = (result: any) => JSON.parse(result.content[0].text);

        it('puts them first in the JSON, leaving the result as it was', async () => {
            const { call } = await connect({
                orchestratorExec: vi.fn(async () => terminalResponse(1, { terminal: false })),
                takeUndeliveredOrchestratorCallbacks: vi.fn(() => ['<orchestrator-callback>run-9</orchestrator-callback>']),
            });
            const result = await call('orchestrator_exec', { command: 'ls', machineIds: ['m1'] });

            expect(result.content).toHaveLength(1);
            expect(Object.keys(parsed(result))[0]).toBe('orchestratorCallbacks');
            expect(parsed(result).orchestratorCallbacks).toEqual(['<orchestrator-callback>run-9</orchestrator-callback>']);
            expect(parsed(result).data.runId).toBe('run-1');
        });

        it('adds nothing when there are none', async () => {
            const { call } = await connect({ orchestratorExec: vi.fn(async () => terminalResponse(1)) });
            const result = await call('orchestrator_exec', { command: 'ls', machineIds: ['m1'] });
            expect(parsed(result)).not.toHaveProperty('orchestratorCallbacks');
        });

        it('come with every orchestrator tool, even a failed call, but not the plain text tools', async () => {
            const takeUndeliveredOrchestratorCallbacks = vi.fn(() => ['callback']);
            const { call } = await connect({
                takeUndeliveredOrchestratorCallbacks,
                isTitlePinned: false,
                sendClaudeSessionMessage: vi.fn(),
                orchestratorGetContext: vi.fn(async () => ({ data: { machines: [] } })),
                orchestratorListRuns: vi.fn(async () => ({ ok: true, data: { runs: [] } })),
                orchestratorCancel: vi.fn(async () => { throw new Error('no such run'); }),
            });
            const context = await call('orchestrator_get_context', {});
            const list = await call('orchestrator_list', {});
            const cancel = await call('orchestrator_cancel', { runId: 'run-1' });
            expect(parsed(context).orchestratorCallbacks).toEqual(['callback']);
            expect(parsed(context).data.controllerSessionId).toBe('controller-session');
            expect(parsed(list).orchestratorCallbacks).toEqual(['callback']);
            expect(cancel.isError).toBe(true);
            expect(parsed(cancel).orchestratorCallbacks).toEqual(['callback']);

            await call('change_title', { title: 'x' });
            expect(takeUndeliveredOrchestratorCallbacks).toHaveBeenCalledTimes(3);
        });

        it('are taken after the tool marked its own run, so it is not told of that run twice', async () => {
            const { client, call } = await connect({ orchestratorExec: vi.fn(async () => terminalResponse(1)) });
            await call('orchestrator_exec', { command: 'ls', machineIds: ['m1'] });
            expect(client.markOrchestratorRunEndKnown.mock.invocationCallOrder[0])
                .toBeLessThan(client.takeUndeliveredOrchestratorCallbacks.mock.invocationCallOrder[0]);
        });
    });
});
