import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    state,
    invokeUserRpcMock,
    hasUserRpcMethodMock,
    dbMock,
    resetState,
} = vi.hoisted(() => {
    const state = {
        runStatus: 'running',
        taskStatus: 'dispatching',
        executionStatus: 'dispatching',
        executionErrorMessage: null as string | null,
        rpcMethods: [] as string[],
    };

    const resetState = () => {
        state.runStatus = 'running';
        state.taskStatus = 'dispatching';
        state.executionStatus = 'dispatching';
        state.executionErrorMessage = null;
        state.rpcMethods = [];
    };

    const invokeUserRpcMock = vi.fn(async () => ({}));
    const hasUserRpcMethodMock = vi.fn((_userId: string, method: string) => state.rpcMethods.includes(method));

    const dbMock = {
        orchestratorRun: {
            findMany: vi.fn(async () => []),
            findUnique: vi.fn(async () => null),
        },
        $transaction: vi.fn(async (fn: any) => {
            const tx = {
                orchestratorExecution: {
                    findUnique: vi.fn(async () => ({
                        id: 'exec_1',
                        status: state.executionStatus,
                        runId: 'run_1',
                        taskId: 'task_1',
                        attempt: 1,
                    })),
                    update: vi.fn(async (args: any) => {
                        state.executionStatus = args.data.status;
                        state.executionErrorMessage = args.data.errorMessage ?? null;
                        return { id: 'exec_1' };
                    }),
                    findMany: vi.fn(async () => []),
                },
                orchestratorTask: {
                    findUnique: vi.fn(async () => ({
                        retryMaxAttempts: 1,
                        retryBackoffMs: 0,
                    })),
                    updateMany: vi.fn(async (args: any) => {
                        if (state.taskStatus !== args.where.status) {
                            return { count: 0 };
                        }
                        state.taskStatus = args.data.status;
                        return { count: 1 };
                    }),
                    groupBy: vi.fn(async () => [
                        { status: state.taskStatus, _count: { _all: 1 } },
                    ]),
                },
                orchestratorRun: {
                    findUnique: vi.fn(async () => ({
                        id: 'run_1',
                        status: state.runStatus,
                    })),
                    // A run with no controller session owes no callbacks
                    findUniqueOrThrow: vi.fn(async () => ({
                        id: 'run_1',
                        controllerSessionId: null,
                        reopenedAt: null,
                        cancelledBySessionId: null,
                    })),
                    update: vi.fn(async (args: any) => {
                        state.runStatus = args.data.status;
                        return { id: 'run_1', status: state.runStatus, updatedAt: new Date() };
                    }),
                },
            };
            return fn(tx);
        }),
    };

    return {
        state,
        invokeUserRpcMock,
        hasUserRpcMethodMock,
        dbMock,
        resetState,
    };
});

vi.mock('@/storage/db', () => ({
    db: dbMock,
}));

vi.mock('@/app/api/socket/rpcRegistry', () => ({
    invokeUserRpc: invokeUserRpcMock,
    hasUserRpcMethod: hasUserRpcMethodMock,
}));

import { executeSchedulerActions, type SchedulerAction } from './scheduler';
import { orchestratorSchedulerTick } from './scheduler';

describe('orchestrator scheduler actions', () => {
    beforeEach(() => {
        resetState();
        invokeUserRpcMock.mockClear();
        dbMock.$transaction.mockClear();
        dbMock.orchestratorRun.findMany.mockClear();
    });

    it('dispatches action via invokeUserRpc', async () => {
        const actions: SchedulerAction[] = [
            {
                type: 'dispatch',
                accountId: 'user_1',
                machineId: 'machine_1',
                executionId: 'exec_1',
                runId: 'run_1',
                taskId: 'task_1',
                dispatchToken: 'token_1',
                payload: {
                    executionId: 'exec_1',
                    runId: 'run_1',
                    taskId: 'task_1',
                    dispatchToken: 'token_1',
                    provider: 'codex',
                    executionType: 'initial',
                    prompt: 'hello',
                    timeoutMs: 1000,
                },
            },
        ];

        await executeSchedulerActions(actions);

        expect(invokeUserRpcMock).toHaveBeenCalledWith(
            'user_1',
            'machine_1:orchestrator-sealed-dispatch',
            expect.objectContaining({ executionId: 'exec_1' }),
            expect.any(Number),
        );
        expect(dbMock.$transaction).not.toHaveBeenCalled();
    });

    it('marks task/execution failed when dispatch rpc fails', async () => {
        invokeUserRpcMock.mockRejectedValueOnce(new Error('RPC method not available'));

        const actions: SchedulerAction[] = [
            {
                type: 'dispatch',
                accountId: 'user_1',
                machineId: 'machine_1',
                executionId: 'exec_1',
                runId: 'run_1',
                taskId: 'task_1',
                dispatchToken: 'token_1',
                payload: {
                    executionId: 'exec_1',
                    runId: 'run_1',
                    taskId: 'task_1',
                    dispatchToken: 'token_1',
                    provider: 'claude',
                    executionType: 'initial',
                    prompt: 'hello',
                    timeoutMs: 1000,
                },
            },
        ];

        await executeSchedulerActions(actions);

        expect(state.executionStatus).toBe('failed');
        expect(state.taskStatus).toBe('failed');
        expect(state.runStatus).toBe('failed');
        expect(dbMock.$transaction).toHaveBeenCalledTimes(1);
    });

    it('tells a machine on a CLI from before sealed tasks to update it', async () => {
        invokeUserRpcMock.mockRejectedValueOnce(new Error('RPC method not available'));
        state.rpcMethods = ['machine_1:orchestrator-dispatch', 'machine_1:orchestrator-shell-dispatch'];

        await executeSchedulerActions([
            {
                type: 'dispatch',
                accountId: 'user_1',
                machineId: 'machine_1',
                executionId: 'exec_1',
                runId: 'run_1',
                taskId: 'task_1',
                dispatchToken: 'token_1',
                payload: {
                    executionId: 'exec_1',
                    runId: 'run_1',
                    taskId: 'task_1',
                    dispatchToken: 'token_1',
                    provider: 'shell',
                    executionType: 'initial',
                    prompt: 'e2e1:AAAA',
                    timeoutMs: null,
                },
            },
        ]);

        expect(invokeUserRpcMock).toHaveBeenCalledWith(
            'user_1',
            'machine_1:orchestrator-sealed-shell-dispatch',
            expect.anything(),
            expect.any(Number),
        );
        expect(state.executionStatus).toBe('failed');
        expect(state.executionErrorMessage).toMatch(/too old to open encrypted orchestrator tasks/);
    });

    it('scheduler tick exits quietly when there are no active runs', async () => {
        dbMock.orchestratorRun.findMany.mockResolvedValueOnce([]);

        await orchestratorSchedulerTick(new Date('2026-03-16T00:00:00.000Z'));

        expect(dbMock.orchestratorRun.findMany).toHaveBeenCalledTimes(1);
        expect(invokeUserRpcMock).not.toHaveBeenCalled();
    });
});
