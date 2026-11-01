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

describe('happy MCP server: runs whose results the agent has', () => {
    let stop: (() => Promise<void>) | null = null;
    let mcpClient: Client | null = null;

    afterEach(async () => {
        await mcpClient?.close();
        await stop?.();
        mcpClient = null;
        stop = null;
    });

    async function connect(fake: Record<string, unknown>) {
        const client = { sessionId: 'controller-session', markOrchestratorRunResultsReceived: vi.fn(), getMetadataSnapshot: () => ({ machineId: 'm1' }), ...fake };
        const server = await startHappyServer(client as any);
        stop = server.stop;
        mcpClient = new Client({ name: 'test', version: '1.0.0' });
        await mcpClient.connect(new StreamableHTTPClientTransport(new URL(server.url)));
        return { client, call: (name: string, args: Record<string, unknown>) => mcpClient!.callTool({ name, arguments: args }) };
    }

    it('marks the run when pend returns every task of a finished run', async () => {
        const { client, call } = await connect({ orchestratorPend: vi.fn(async () => terminalResponse(2)) });
        await call('orchestrator_pend', { runId: 'run-1', include: 'all_tasks', waitFor: 'terminal' });
        expect(client.markOrchestratorRunResultsReceived).toHaveBeenCalledWith('run-1');
    });

    it('does not mark the run for a summary-only pend, or before the run finished', async () => {
        const pend = vi.fn()
            .mockResolvedValueOnce(terminalResponse(2, { tasks: false }))
            .mockResolvedValueOnce(terminalResponse(2, { terminal: false }));
        const { client, call } = await connect({ orchestratorPend: pend });
        await call('orchestrator_pend', { runId: 'run-1' });
        await call('orchestrator_pend', { runId: 'run-1', include: 'all_tasks' });
        expect(client.markOrchestratorRunResultsReceived).not.toHaveBeenCalled();
    });

    it('marks a pend for one task only when the run has no other task', async () => {
        const pend = vi.fn()
            .mockResolvedValueOnce(terminalResponse(2))
            .mockResolvedValueOnce(terminalResponse(1));
        const { client, call } = await connect({ orchestratorPend: pend });
        await call('orchestrator_pend', { runId: 'run-1', taskId: 't1' });
        expect(client.markOrchestratorRunResultsReceived).not.toHaveBeenCalled();
        await call('orchestrator_pend', { runId: 'run-1', taskId: 't1' });
        expect(client.markOrchestratorRunResultsReceived).toHaveBeenCalledWith('run-1');
    });

    it('marks the run when exec or transfer returns a finished run', async () => {
        const { client, call } = await connect({
            orchestratorExec: vi.fn(async () => terminalResponse(1)),
            orchestratorTransfer: vi.fn(async () => ({ ...terminalResponse(1), data: { ...terminalResponse(1).data, runId: 'run-2' } })),
        });
        await call('orchestrator_exec', { command: 'ls', machineIds: ['m1'] });
        await call('orchestrator_transfer', { fromMachineId: 'm1', fromPath: '/a', toMachineIds: ['m1'], toPath: '/b' });
        expect(client.markOrchestratorRunResultsReceived.mock.calls).toEqual([['run-1'], ['run-2']]);
    });

    it('does not mark the run when exec returns before it finished', async () => {
        const { client, call } = await connect({ orchestratorExec: vi.fn(async () => terminalResponse(1, { terminal: false })) });
        await call('orchestrator_exec', { command: 'sleep 100', machineIds: ['m1'] });
        expect(client.markOrchestratorRunResultsReceived).not.toHaveBeenCalled();
    });
});
