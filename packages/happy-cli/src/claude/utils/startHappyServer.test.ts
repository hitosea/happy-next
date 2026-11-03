import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { ApiSessionClient } from '@/api/apiSession';
import { startHappyServer } from './startHappyServer';

// The orchestrator tools settle a run's callback when their result shows the run ended in full
describe('orchestrator tools and the callback ledger', () => {
    const endedAt = '2026-11-03T00:00:05.000Z';
    const task = (taskId: string) => ({ taskId, status: 'completed', outputText: `${taskId} done` });
    const ended = (tasks: unknown[], total: number) => ({
        runId: 'run-1',
        terminal: true,
        run: { status: 'completed', updatedAt: endedAt, summary: { total, queued: 0, running: 0, completed: total, failed: 0, cancelled: 0 } },
        tasks,
    });

    let api: Record<string, ReturnType<typeof vi.fn>>;
    let server: Awaited<ReturnType<typeof startHappyServer>>;
    let mcp: Client;

    beforeEach(async () => {
        api = {
            orchestratorCallbacksAck: vi.fn(async () => {}),
            orchestratorPend: vi.fn(),
            orchestratorExec: vi.fn(),
        };
        server = await startHappyServer({ sessionId: 'session-1', getMetadataSnapshot: () => null, ...api } as unknown as ApiSessionClient);
        mcp = new Client({ name: 'test', version: '1.0.0' });
        await mcp.connect(new StreamableHTTPClientTransport(new URL(server.url)));
    });

    afterEach(async () => {
        await mcp.close();
        server.stop();
    });

    const call = async (name: string, args: Record<string, unknown>) => {
        const result = await mcp.callTool({ name, arguments: args });
        return JSON.parse((result.content as Array<{ text: string }>)[0].text);
    };

    it('pend fetches the run as it is now, and settles its callback when every task is shown', async () => {
        api.orchestratorPend.mockResolvedValue({ ok: true, data: { ...ended([task('a'), task('b')], 2), changed: true, cursor: 'c1' } });

        const result = await call('orchestrator_pend', { runId: 'run-1' });
        expect(api.orchestratorPend).toHaveBeenCalledWith('run-1');
        expect(result.data).not.toHaveProperty('cursor');
        expect(result.data).not.toHaveProperty('next');
        expect(result.data.tasks).toHaveLength(2);
        expect(api.orchestratorCallbacksAck).toHaveBeenCalledWith([{ runId: 'run-1', knownAt: endedAt }]);
    });

    it('pend of one task leaves the callback owed, as does a run still going, which it says to await', async () => {
        api.orchestratorPend.mockResolvedValueOnce({ ok: true, data: ended([task('a'), task('b')], 2) });
        expect((await call('orchestrator_pend', { runId: 'run-1', taskId: 'b' })).data.tasks).toEqual([expect.objectContaining({ taskId: 'b' })]);

        api.orchestratorPend.mockResolvedValueOnce({ ok: true, data: { ...ended([task('a')], 1), terminal: false, run: { status: 'running', updatedAt: endedAt, summary: { total: 1 } } } });
        expect((await call('orchestrator_pend', { runId: 'run-1' })).data.next.hint).toContain('<orchestrator-callback>');
        expect(api.orchestratorCallbacksAck).not.toHaveBeenCalled();
    });

    it('exec settles the callback of a run it returns finished', async () => {
        api.orchestratorExec.mockResolvedValue({ ok: true, data: ended([task('a')], 1) });
        await call('orchestrator_exec', { command: 'true', machineIds: ['machine-1'] });
        expect(api.orchestratorCallbacksAck).toHaveBeenCalledWith([{ runId: 'run-1', knownAt: endedAt }]);
    });
});
