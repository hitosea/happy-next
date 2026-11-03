import fastify from 'fastify';
import { Prisma } from '@prisma/client';
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from 'fastify-type-provider-zod';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type Fastify } from '@/app/api/types';
import { getValidModelModesForAgent } from 'happy-wire';

// What a client sends for a sealed value: the server only checks its form
const sealed = (text: string) => `e2e1:${Buffer.from(text).toString('base64')}`;

type RunStatus = 'queued' | 'running' | 'canceling' | 'completed' | 'failed' | 'cancelled';
type TaskStatus = 'queued' | 'dispatching' | 'running' | 'completed' | 'failed' | 'cancelled' | 'dependency_failed';
type ExecutionStatus = 'queued' | 'dispatching' | 'running' | 'completed' | 'failed' | 'cancelled' | 'timeout';

type RunRecord = {
    id: string;
    accountId: string;
    title: string;
    status: RunStatus;
    maxConcurrency: number;
    controllerSessionId: string | null;
    idempotencyKey: string | null;
    metadata: Record<string, unknown> | null;
    createdAt: Date;
    updatedAt: Date;
    completedAt: Date | null;
    cancelRequestedAt: Date | null;
    cancelledBySessionId: string | null;
    reopenedAt: Date | null;
};

type TaskRecord = {
    id: string;
    runId: string;
    seq: number;
    taskKey: string | null;
    title: string | null;
    provider: 'claude' | 'codex' | 'gemini' | 'shell';
    model: string | null;
    prompt: string;
    workingDirectory: string | null;
    timeoutMs: number | null;
    targetMachineId: string | null;
    dependsOnTaskKeys: string[];
    retryMaxAttempts: number;
    retryBackoffMs: number;
    nextAttemptAt: Date | null;
    status: TaskStatus;
    outputSummary: string | null;
    outputText: string | null;
    stderrText: string | null;
    stdoutFile: unknown;
    stderrFile: unknown;
    sealedResult: string | null;
    errorCode: string | null;
    errorMessage: string | null;
    createdAt: Date;
    updatedAt: Date;
};

type ExecutionRecord = {
    id: string;
    runId: string;
    taskId: string;
    machineId: string;
    provider: 'claude' | 'codex' | 'gemini' | 'shell';
    model: string | null;
    childSessionId: string | null;
    executionType: 'initial' | 'resume';
    resumeMessage: string | null;
    controllerSessionId: string | null;
    status: ExecutionStatus;
    attempt: number;
    dispatchToken: string;
    timeoutMs: number | null;
    pid: number | null;
    startedAt: Date | null;
    finishedAt: Date | null;
    exitCode: number | null;
    signal: string | null;
    outputSummary: string | null;
    outputText: string | null;
    stderrText: string | null;
    stdoutFile: unknown;
    stderrFile: unknown;
    sealedResult: string | null;
    errorCode: string | null;
    errorMessage: string | null;
    createdAt: Date;
    updatedAt: Date;
};

type MachineRecord = {
    id: string;
    accountId: string;
    active: boolean;
    lastActiveAt: Date;
};

const {
    state,
    resetState,
    dbMock,
    invokeUserRpcMock,
    listConnectedUserRpcMethodsMock,
    eventRouterMock,
} = vi.hoisted(() => {
    const state = {
        nowMs: Date.parse('2026-03-16T00:00:00.000Z'),
        runSeq: 1,
        taskSeq: 1,
        executionSeq: 1,
        runs: [] as RunRecord[],
        tasks: [] as TaskRecord[],
        executions: [] as ExecutionRecord[],
        machines: [] as MachineRecord[],
        sessions: [] as Array<{ id: string; accountId: string; predecessorSessionId?: string | null }>,
        callbacks: [] as Array<{ runId: string; sessionId: string; endedAt: Date }>,
        sessionConnections: [] as Array<{ sessionId: string; supportsCallbackLedger: boolean }>,
        accessKeys: [] as Array<{ accountId: string; machineId: string; sessionId: string; updatedAt: Date }>,
        onlineMachineIds: new Set<string>(),
        dispatchReadyMachineIds: new Set<string>(),
        shellReadyMachineIds: new Set<string>(),
    };

    const nextDate = () => {
        const value = new Date(state.nowMs);
        state.nowMs += 1;
        return value;
    };

    const resetState = () => {
        state.nowMs = Date.parse('2026-03-16T00:00:00.000Z');
        state.runSeq = 1;
        state.taskSeq = 1;
        state.executionSeq = 1;
        state.runs = [];
        state.tasks = [];
        state.executions = [];
        state.machines = [
            {
                id: 'machine-1',
                accountId: 'user-1',
                active: true,
                lastActiveAt: new Date('2026-03-16T00:00:00.000Z'),
            },
        ];
        state.sessions = [
            { id: 'controller-session-1', accountId: 'user-1' },
        ];
        state.callbacks = [];
        state.sessionConnections = [];
        state.accessKeys = [
            { accountId: 'user-1', machineId: 'machine-1', sessionId: 'controller-session-1', updatedAt: new Date('2026-03-16T00:00:00.000Z') },
        ];
        state.onlineMachineIds = new Set(['machine-1']);
        state.dispatchReadyMachineIds = new Set(['machine-1']);
        state.shellReadyMachineIds = new Set(['machine-1']);
    };

    const matchesStatus = (value: string, where: any): boolean => {
        if (!where) {
            return true;
        }
        if (typeof where === 'string') {
            return value === where;
        }
        if (Array.isArray(where.in)) {
            return where.in.includes(value);
        }
        return true;
    };

    const matchesRun = (run: RunRecord, where: any): boolean => {
        if (!where) {
            return true;
        }
        if (typeof where.id === 'string' && run.id !== where.id) {
            return false;
        }
        if (where.id?.lt && !(run.id < where.id.lt)) {
            return false;
        }
        if (where.accountId && run.accountId !== where.accountId) {
            return false;
        }
        if (typeof where.controllerSessionId === 'string' && run.controllerSessionId !== where.controllerSessionId) {
            return false;
        }
        if (where.controllerSessionId === null && run.controllerSessionId !== null) {
            return false;
        }
        if (where.controllerSessionId?.not === null && run.controllerSessionId === null) {
            return false;
        }
        if (where.idempotencyKey && run.idempotencyKey !== where.idempotencyKey) {
            return false;
        }
        if (where.status && !matchesStatus(run.status, where.status)) {
            return false;
        }
        if (where.createdAt instanceof Date && run.createdAt.getTime() !== where.createdAt.getTime()) {
            return false;
        }
        if (where.createdAt?.lt && !(run.createdAt < where.createdAt.lt)) {
            return false;
        }
        if (where.tasks?.some && !state.tasks.some((task) => (
            task.runId === run.id && matchesTask(task, where.tasks.some)
        ))) {
            return false;
        }
        if (where.executions?.some && !state.executions.some((execution) => (
            execution.runId === run.id && matchesExecution(execution, where.executions.some)
        ))) {
            return false;
        }
        if (Array.isArray(where.AND) && !where.AND.every((item: any) => matchesRun(run, item))) {
            return false;
        }
        if (Array.isArray(where.OR) && !where.OR.some((item: any) => matchesRun(run, item))) {
            return false;
        }
        return true;
    };

    const matchesTask = (task: TaskRecord, where: any): boolean => {
        if (!where) {
            return true;
        }
        if (where.id && task.id !== where.id) {
            return false;
        }
        if (typeof where.runId === 'string' && task.runId !== where.runId) {
            return false;
        }
        if (typeof where.provider === 'string' && task.provider !== where.provider) {
            return false;
        }
        if (Array.isArray(where.provider?.in) && !where.provider.in.includes(task.provider)) {
            return false;
        }
        if (where.taskKey?.not === null && task.taskKey === null) {
            return false;
        }
        if (where.status && !matchesStatus(task.status, where.status)) {
            return false;
        }
        if (Array.isArray(where.runId?.in) && !where.runId.in.includes(task.runId)) {
            return false;
        }
        if (where.run) {
            const run = state.runs.find((item) => item.id === task.runId);
            if (!run || !matchesRun(run, where.run)) {
                return false;
            }
        }
        if (Array.isArray(where.OR)) {
            const orMatched = where.OR.some((item: any) => {
                if ('nextAttemptAt' in item) {
                    if (item.nextAttemptAt === null) {
                        return task.nextAttemptAt === null;
                    }
                    if (item.nextAttemptAt?.lte) {
                        return task.nextAttemptAt !== null && task.nextAttemptAt <= item.nextAttemptAt.lte;
                    }
                }
                return false;
            });
            if (!orMatched) {
                return false;
            }
        }
        return true;
    };

    const matchesExecution = (execution: ExecutionRecord, where: any): boolean => {
        if (!where) {
            return true;
        }
        if (typeof where.id === 'string' && execution.id !== where.id) {
            return false;
        }
        if (Array.isArray(where.id?.notIn) && where.id.notIn.includes(execution.id)) {
            return false;
        }
        if (typeof where.machineId === 'string' && execution.machineId !== where.machineId) {
            return false;
        }
        if (where.startedAt?.lt && !(execution.startedAt !== null && execution.startedAt < where.startedAt.lt)) {
            return false;
        }
        if (typeof where.runId === 'string' && execution.runId !== where.runId) {
            return false;
        }
        if (Array.isArray(where.runId?.in) && !where.runId.in.includes(execution.runId)) {
            return false;
        }
        if (where.taskId && execution.taskId !== where.taskId) {
            return false;
        }
        if (where.childSessionId?.not === null && execution.childSessionId === null) {
            return false;
        }
        if (where.childSessionId === null && execution.childSessionId !== null) {
            return false;
        }
        if (where.status && !matchesStatus(execution.status, where.status)) {
            return false;
        }
        if (where.createdAt?.lt && !(execution.createdAt < where.createdAt.lt)) {
            return false;
        }
        if (where.createdAt?.gte && !(execution.createdAt >= where.createdAt.gte)) {
            return false;
        }
        if (typeof where.controllerSessionId === 'string' && execution.controllerSessionId !== where.controllerSessionId) {
            return false;
        }
        if (where.controllerSessionId?.not === null && execution.controllerSessionId === null) {
            return false;
        }
        if (where.run?.accountId) {
            const run = state.runs.find((item) => item.id === execution.runId);
            if (!run || run.accountId !== where.run.accountId) {
                return false;
            }
        }
        return true;
    };

    // A field set to undefined is left as it is
    const updateRun = (run: RunRecord, data: any) => {
        Object.assign(run, Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined)), { updatedAt: nextDate() });
        return run;
    };

    // A JSON column set to `Prisma.DbNull` reads back as null
    const withDbNulls = (data: any) => Object.fromEntries(Object.entries(data)
        .map(([key, value]) => [key, value === Prisma.DbNull ? null : value]));

    const updateTask = (task: TaskRecord, data: any) => {
        Object.assign(task, withDbNulls(data), { updatedAt: nextDate() });
        return task;
    };

    const updateExecution = (execution: ExecutionRecord, data: any) => {
        Object.assign(execution, withDbNulls(data), { updatedAt: nextDate() });
        return execution;
    };

    const selectTask = (task: TaskRecord, select: any) => {
        const includeRun = !!select?.run;
        const includeExecutions = !!select?.executions;
        return {
            ...task,
            ...(includeRun
                ? {
                    run: (() => {
                        const run = state.runs.find((item) => item.id === task.runId);
                        if (!run) {
                            return null;
                        }
                        return {
                            id: run.id,
                            title: run.title,
                            status: run.status,
                            updatedAt: run.updatedAt,
                            accountId: run.accountId,
                            controllerSessionId: run.controllerSessionId,
                        };
                    })(),
                }
                : {}),
            ...(includeExecutions
                ? {
                    executions: state.executions
                        .filter((item) => item.taskId === task.id)
                        .sort((a, b) => (
                            select.executions?.orderBy?.attempt === 'desc'
                                ? b.attempt - a.attempt
                                : a.attempt - b.attempt
                        ))
                        .slice(0, select.executions?.take ?? undefined)
                        .map((item) => ({ ...item })),
                }
                : {}),
        };
    };

    const selectRun = (run: RunRecord, select: any) => {
        const includeTasks = !!select?.tasks;
        const tasks = includeTasks
            ? state.tasks
                .filter((task) => task.runId === run.id)
                .sort((a, b) => a.seq - b.seq)
                .map((task) => selectTask(task, select.tasks?.select))
            : undefined;
        return {
            ...run,
            ...(includeTasks ? { tasks } : {}),
        };
    };

    const runApi = {
        create: vi.fn(async (args: any) => {
            const now = nextDate();
            const run: RunRecord = {
                id: `run-${state.runSeq++}`,
                accountId: args.data.accountId,
                title: args.data.title,
                status: args.data.status,
                maxConcurrency: args.data.maxConcurrency,
                controllerSessionId: args.data.controllerSessionId ?? null,
                idempotencyKey: args.data.idempotencyKey ?? null,
                metadata: args.data.metadata ?? null,
                createdAt: now,
                updatedAt: now,
                completedAt: null,
                cancelRequestedAt: null,
                cancelledBySessionId: null,
                reopenedAt: null,
            };
            state.runs.push(run);
            return selectRun(run, args.select);
        }),
        findFirst: vi.fn(async (args: any) => {
            const run = state.runs.find((item) => matchesRun(item, args?.where));
            if (!run) {
                return null;
            }
            return selectRun(run, args?.select);
        }),
        findUnique: vi.fn(async (args: any) => {
            const run = state.runs.find((item) => item.id === args?.where?.id);
            if (!run) {
                return null;
            }
            return selectRun(run, args?.select);
        }),
        findUniqueOrThrow: vi.fn(async (args: any) => {
            const run = state.runs.find((item) => item.id === args?.where?.id);
            if (!run) {
                throw new Error('run not found');
            }
            return selectRun(run, args?.select);
        }),
        findMany: vi.fn(async (args: any) => {
            let rows = state.runs.filter((item) => matchesRun(item, args?.where));
            const orderBy = args?.orderBy;
            if (Array.isArray(orderBy)) {
                for (const order of orderBy.slice().reverse()) {
                    const [key, direction] = Object.entries(order)[0] as [keyof RunRecord, 'asc' | 'desc'];
                    rows = rows.sort((a, b) => {
                        const av = a[key] as any;
                        const bv = b[key] as any;
                        if (av < bv) {
                            return direction === 'asc' ? -1 : 1;
                        }
                        if (av > bv) {
                            return direction === 'asc' ? 1 : -1;
                        }
                        return 0;
                    });
                }
            } else if (orderBy) {
                const [key, direction] = Object.entries(orderBy)[0] as [keyof RunRecord, 'asc' | 'desc'];
                rows = rows.sort((a, b) => {
                    const av = a[key] as any;
                    const bv = b[key] as any;
                    if (av < bv) {
                        return direction === 'asc' ? -1 : 1;
                    }
                    if (av > bv) {
                        return direction === 'asc' ? 1 : -1;
                    }
                    return 0;
                });
            }
            if (typeof args?.take === 'number') {
                rows = rows.slice(0, args.take);
            }
            return rows.map((item) => selectRun(item, args?.select));
        }),
        update: vi.fn(async (args: any) => {
            const run = state.runs.find((item) => item.id === args?.where?.id);
            if (!run) {
                throw new Error('run not found');
            }
            updateRun(run, args?.data ?? {});
            return selectRun(run, args?.select);
        }),
        updateMany: vi.fn(async (args: any) => {
            const rows = state.runs.filter((item) => matchesRun(item, args?.where));
            for (const run of rows) {
                updateRun(run, args?.data ?? {});
            }
            return { count: rows.length };
        }),
        count: vi.fn(async (args: any) => state.runs.filter((item) => matchesRun(item, args?.where)).length),
        groupBy: vi.fn(async (args: any) => {
            const by: string[] = args?.by ?? [];
            const grouped = new Map<string, { fields: Record<string, unknown>; count: number }>();
            for (const run of state.runs.filter((item) => matchesRun(item, args?.where))) {
                const key = by.map((field) => String((run as any)[field])).join('|');
                const existing = grouped.get(key);
                if (existing) {
                    existing.count += 1;
                    continue;
                }
                grouped.set(key, {
                    fields: Object.fromEntries(by.map((field) => [field, (run as any)[field]])),
                    count: 1,
                });
            }
            return [...grouped.values()].map((item) => ({ ...item.fields, _count: { _all: item.count } }));
        }),
    };

    const taskApi = {
        createMany: vi.fn(async (args: any) => {
            for (const data of args.data as any[]) {
                const now = nextDate();
                state.tasks.push({
                    id: `task-${state.taskSeq++}`,
                    runId: data.runId,
                    seq: data.seq,
                    taskKey: data.taskKey ?? null,
                    title: data.title ?? null,
                    provider: data.provider,
                    model: data.model ?? null,
                    prompt: data.prompt,
                    workingDirectory: data.workingDirectory ?? null,
                    timeoutMs: data.timeoutMs ?? null,
                    targetMachineId: data.targetMachineId ?? null,
                    dependsOnTaskKeys: data.dependsOnTaskKeys ?? [],
                    retryMaxAttempts: data.retryMaxAttempts ?? 1,
                    retryBackoffMs: data.retryBackoffMs ?? 0,
                    nextAttemptAt: data.nextAttemptAt ?? null,
                    status: data.status ?? 'queued',
                    outputSummary: null,
                    outputText: null,
                    stderrText: null,
                    stdoutFile: null,
                    stderrFile: null,
                    sealedResult: null,
                    errorCode: null,
                    errorMessage: null,
                    createdAt: now,
                    updatedAt: now,
                });
            }
            return { count: args.data.length };
        }),
        findUnique: vi.fn(async (args: any) => {
            const task = state.tasks.find((item) => item.id === args?.where?.id);
            if (!task) {
                return null;
            }
            return selectTask(task, args?.select);
        }),
        findFirst: vi.fn(async (args: any) => {
            let rows = state.tasks.filter((item) => matchesTask(item, args?.where));
            if (args?.where?.run?.accountId) {
                rows = rows.filter((task) => {
                    const run = state.runs.find((item) => item.id === task.runId);
                    return run?.accountId === args.where.run.accountId;
                });
            }
            const task = rows[0];
            if (!task) {
                return null;
            }
            return selectTask(task, args?.select);
        }),
        findMany: vi.fn(async (args: any) => {
            let rows = state.tasks.filter((item) => matchesTask(item, args?.where));
            if (args?.orderBy?.seq) {
                rows = rows.sort((a, b) => args.orderBy.seq === 'asc' ? a.seq - b.seq : b.seq - a.seq);
            }
            if (typeof args?.take === 'number') {
                rows = rows.slice(0, args.take);
            }
            return rows.map((item) => selectTask(item, args?.select));
        }),
        updateMany: vi.fn(async (args: any) => {
            const rows = state.tasks.filter((item) => matchesTask(item, args?.where));
            for (const task of rows) {
                updateTask(task, args?.data ?? {});
            }
            return { count: rows.length };
        }),
        groupBy: vi.fn(async (args: any) => {
            const rows = state.tasks.filter((item) => matchesTask(item, args?.where));
            const by: string[] = args?.by ?? [];
            const map = new Map<string, { fields: Record<string, unknown>; count: number }>();
            for (const row of rows) {
                const key = by.map((field) => String((row as any)[field])).join('|');
                const current = map.get(key) ?? {
                    fields: Object.fromEntries(by.map((field) => [field, (row as any)[field]])),
                    count: 0,
                };
                current.count += 1;
                map.set(key, current);
            }
            return [...map.values()].map((item) => ({
                ...item.fields,
                _count: { _all: item.count },
            }));
        }),
        count: vi.fn(async (args: any) => {
            let rows = state.tasks;
            if (args?.where?.status) {
                rows = rows.filter((item) => matchesStatus(item.status, args.where.status));
            }
            if (args?.where?.runId) {
                rows = rows.filter((item) => item.runId === args.where.runId);
            }
            return rows.length;
        }),
    };

    const executionApi = {
        create: vi.fn(async (args: any) => {
            const now = nextDate();
            const execution: ExecutionRecord = {
                id: `exec-${state.executionSeq++}`,
                runId: args.data.runId,
                taskId: args.data.taskId,
                machineId: args.data.machineId,
                provider: args.data.provider,
                model: args.data.model ?? null,
                childSessionId: args.data.childSessionId ?? null,
                executionType: args.data.executionType ?? 'initial',
                resumeMessage: args.data.resumeMessage ?? null,
                controllerSessionId: args.data.controllerSessionId ?? null,
                status: args.data.status,
                attempt: args.data.attempt ?? 1,
                dispatchToken: args.data.dispatchToken,
                timeoutMs: args.data.timeoutMs ?? null,
                pid: null,
                startedAt: null,
                finishedAt: null,
                exitCode: null,
                signal: null,
                outputSummary: null,
                outputText: null,
                stderrText: null,
                stdoutFile: null,
                stderrFile: null,
                sealedResult: null,
                errorCode: null,
                errorMessage: null,
                createdAt: now,
                updatedAt: now,
            };
            state.executions.push(execution);
            return { ...execution };
        }),
        findFirst: vi.fn(async (args: any) => {
            let rows = state.executions.filter((item) => matchesExecution(item, args?.where));
            if (args?.orderBy?.attempt) {
                rows = rows.sort((a, b) => (
                    args.orderBy.attempt === 'asc'
                        ? a.attempt - b.attempt
                        : b.attempt - a.attempt
                ));
            }
            const execution = rows[0];
            if (!execution) {
                return null;
            }
            const run = state.runs.find((item) => item.id === execution.runId)!;
            const task = state.tasks.find((item) => item.id === execution.taskId)!;
            return {
                ...execution,
                run: {
                    status: run.status,
                    accountId: run.accountId,
                    title: run.title,
                    controllerSessionId: run.controllerSessionId,
                    reopenedAt: run.reopenedAt,
                },
                task: {
                    retryMaxAttempts: task.retryMaxAttempts,
                    retryBackoffMs: task.retryBackoffMs,
                },
            };
        }),
        findUnique: vi.fn(async (args: any) => {
            const execution = state.executions.find((item) => item.id === args?.where?.id);
            if (!execution) {
                return null;
            }
            return { ...execution };
        }),
        findMany: vi.fn(async (args: any) => {
            let rows = state.executions.filter((item) => matchesExecution(item, args?.where));
            if (args?.orderBy?.attempt) {
                rows = rows.sort((a, b) => (
                    args.orderBy.attempt === 'asc'
                        ? a.attempt - b.attempt
                        : b.attempt - a.attempt
                ));
            }
            if (Array.isArray(args?.distinct)) {
                const seen = new Set<string>();
                rows = rows.filter((item) => {
                    const key = args.distinct.map((field: string) => String((item as any)[field])).join('|');
                    if (seen.has(key)) {
                        return false;
                    }
                    seen.add(key);
                    return true;
                });
            }
            return rows.map((item) => {
                const run = state.runs.find((row) => row.id === item.runId);
                const task = state.tasks.find((row) => row.id === item.taskId);
                return {
                    ...item,
                    run: {
                        controllerSessionId: run?.controllerSessionId ?? null,
                        status: run?.status,
                        completedAt: run?.completedAt ?? null,
                    },
                    task: {
                        retryMaxAttempts: task?.retryMaxAttempts,
                        retryBackoffMs: task?.retryBackoffMs,
                    },
                };
            });
        }),
        update: vi.fn(async (args: any) => {
            const execution = state.executions.find((item) => item.id === args?.where?.id);
            if (!execution) {
                throw new Error('execution not found');
            }
            updateExecution(execution, args?.data ?? {});
            return { ...execution };
        }),
        updateMany: vi.fn(async (args: any) => {
            const rows = state.executions.filter((item) => matchesExecution(item, args?.where));
            for (const row of rows) {
                updateExecution(row, args?.data ?? {});
            }
            return { count: rows.length };
        }),
        groupBy: vi.fn(async (args: any) => {
            const rows = state.executions.filter((item) => matchesExecution(item, args?.where));
            const by: string[] = args?.by ?? [];
            const grouped = new Map<string, { fields: Record<string, unknown>; count: number }>();

            for (const row of rows) {
                const key = by.map((field) => String((row as any)[field])).join('|');
                const existing = grouped.get(key);
                if (existing) {
                    existing.count += 1;
                    continue;
                }

                const fields: Record<string, unknown> = {};
                for (const field of by) {
                    fields[field] = (row as any)[field];
                }
                grouped.set(key, { fields, count: 1 });
            }

            return [...grouped.values()].map((item) => ({
                ...item.fields,
                ...(args?._count?._all ? { _count: { _all: item.count } } : {}),
            }));
        }),
        count: vi.fn(async (args: any) => {
            return state.executions.filter((item) => matchesExecution(item, args?.where)).length;
        }),
    };

    const machineApi = {
        findMany: vi.fn(async (args: any) => {
            let rows = state.machines.filter((item) => item.accountId === args?.where?.accountId);
            if (args?.where?.id?.in) {
                const allowed = new Set(args.where.id.in);
                rows = rows.filter((item) => allowed.has(item.id));
            }
            return rows.map((item) => ({ ...item }));
        }),
        findFirst: vi.fn(async (args: any) => {
            let rows = state.machines.filter((item) => item.accountId === args?.where?.accountId);
            if (typeof args?.where?.active === 'boolean') {
                rows = rows.filter((item) => item.active === args.where.active);
            }
            rows = rows.sort((a, b) => b.lastActiveAt.getTime() - a.lastActiveAt.getTime());
            return rows[0] ? { ...rows[0] } : null;
        }),
    };

    const sessionApi = {
        findFirst: vi.fn(async (args: any) => {
            const row = state.sessions.find((item) => (
                item.id === args?.where?.id &&
                item.accountId === args?.where?.accountId
            ));
            if (!row) {
                return null;
            }
            return { ...row };
        }),
        findMany: vi.fn(async (args: any) => state.sessions
            .filter((item) => (
                item.accountId === args?.where?.accountId &&
                args?.where?.predecessorSessionId?.in?.includes(item.predecessorSessionId)
            ))
            .map((item) => ({ id: item.id }))),
        updateMany: vi.fn(async (args: any) => {
            const rows = state.sessions.filter((item) => (
                item.id === args?.where?.id &&
                item.accountId === args?.where?.accountId &&
                !item.predecessorSessionId
            ));
            for (const row of rows) {
                Object.assign(row, args.data);
            }
            return { count: rows.length };
        }),
    };

    const callbackRunMatches = (runId: string, where: any) => {
        const run = state.runs.find((item) => item.id === runId)!;
        return matchesRun(run, where);
    };
    const callbackMatches = (row: { runId: string; sessionId: string; endedAt: Date }, where: any) => (
        (!where?.runId || row.runId === where.runId) &&
        (!where?.sessionId?.in || where.sessionId.in.includes(row.sessionId)) &&
        (!where?.run || callbackRunMatches(row.runId, where.run)) &&
        (!where?.OR || where.OR.some((clause: any) => (
            row.runId === clause.runId && row.endedAt.getTime() <= clause.endedAt.lte.getTime()
        )))
    );
    const callbackApi = {
        upsert: vi.fn(async (args: any) => {
            const { runId, sessionId } = args.where.runId_sessionId;
            const row = state.callbacks.find((item) => item.runId === runId && item.sessionId === sessionId);
            if (row) {
                Object.assign(row, args.update);
                return { ...row };
            }
            state.callbacks.push({ ...args.create });
            return { ...args.create };
        }),
        findMany: vi.fn(async (args: any) => state.callbacks
            .filter((row) => callbackMatches(row, args?.where))
            .sort((a, b) => a.endedAt.getTime() - b.endedAt.getTime())
            .slice(0, args?.take ?? Infinity)
            .map((row) => {
                const run = state.runs.find((item) => item.id === row.runId)!;
                return { ...row, run: { title: run.title, status: run.status } };
            })),
        deleteMany: vi.fn(async (args: any) => {
            const before = state.callbacks.length;
            state.callbacks = state.callbacks.filter((row) => !callbackMatches(row, args?.where));
            return { count: before - state.callbacks.length };
        }),
    };

    const accessKeyApi = {
        findFirst: vi.fn(async (args: any) => {
            let rows = state.accessKeys.filter((item) =>
                item.sessionId === args?.where?.sessionId &&
                item.accountId === args?.where?.accountId,
            );
            if (args?.orderBy?.updatedAt === 'desc') {
                rows = rows.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
            }
            return rows[0] ? { machineId: rows[0].machineId } : null;
        }),
        findMany: vi.fn(async (args: any) => {
            let rows = state.accessKeys.filter((item) =>
                item.sessionId === args?.where?.sessionId &&
                item.accountId === args?.where?.accountId,
            );
            if (args?.orderBy?.updatedAt === 'desc') {
                rows = rows.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
            }
            return rows.map((r) => ({ machineId: r.machineId }));
        }),
    };

    const tx = {
        orchestratorRun: runApi,
        orchestratorTask: taskApi,
        orchestratorExecution: executionApi,
        machine: machineApi,
        session: sessionApi,
        accessKey: accessKeyApi,
        orchestratorRunCallback: callbackApi,
    };

    const dbMock = {
        orchestratorRun: runApi,
        orchestratorTask: taskApi,
        orchestratorExecution: executionApi,
        machine: machineApi,
        session: sessionApi,
        accessKey: accessKeyApi,
        orchestratorRunCallback: callbackApi,
        $transaction: vi.fn(async (fn: any) => fn(tx)),
    };

    const invokeUserRpcMock = vi.fn(async (_userId: string, method: string) => {
        if (method.endsWith(':detect-providers')) {
            return { providers: ['claude', 'codex', 'gemini'] };
        }
        return {};
    });
    const listConnectedUserRpcMethodsMock = vi.fn((_userId: string) => [
        ...Array.from(state.dispatchReadyMachineIds).map((machineId) => `${machineId}:orchestrator-sealed-dispatch`),
        ...Array.from(state.shellReadyMachineIds).map((machineId) => `${machineId}:orchestrator-sealed-shell-dispatch`),
    ]);
    const eventRouterMock = {
        emitEphemeral: vi.fn((_event: any) => ({ sessionScoped: 1 })),
        getConnections: vi.fn((_userId: string) => {
            const connections = new Set<any>();
            for (const machineId of state.onlineMachineIds) {
                connections.add({
                    connectionType: 'machine-scoped',
                    machineId,
                    socket: {
                        connected: true,
                    },
                });
            }
            for (const connection of state.sessionConnections) {
                connections.add({ connectionType: 'session-scoped', ...connection });
            }
            return connections;
        }),
    };

    return {
        state,
        resetState,
        dbMock,
        invokeUserRpcMock,
        listConnectedUserRpcMethodsMock,
        eventRouterMock,
    };
});

vi.mock('@/storage/db', () => ({
    db: dbMock,
}));

vi.mock('@/app/api/socket/rpcRegistry', () => ({
    invokeUserRpc: invokeUserRpcMock,
    listConnectedUserRpcMethods: listConnectedUserRpcMethodsMock,
    hasUserRpcMethod: vi.fn((_userId: string, method: string) => {
        const machineId = method.replace(/:detect-providers$/, '');
        return state.dispatchReadyMachineIds.has(machineId);
    }),
}));

vi.mock('@/app/events/eventRouter', () => ({
    eventRouter: eventRouterMock,
    buildOrchestratorActivityEphemeral: vi.fn((sessionId: string, activity: Record<string, string[]>, totalRunCount?: number) => ({
        type: 'orchestrator-activity',
        sessionId,
        activity,
        totalRunCount,
    })),
    buildOrchestratorRunTerminalEphemeral: vi.fn((runId: string, status: string, title: string) => ({
        type: 'orchestrator-run-terminal',
        runId,
        status,
        title,
    })),
}));

import { orchestratorRoutes } from '@/app/api/routes/orchestratorRoutes';
import { orchestratorSchedulerTick } from './scheduler';

async function createApp() {
    const app = fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    const typed = app.withTypeProvider<ZodTypeProvider>() as unknown as Fastify;

    typed.decorate('authenticate', async (request: any, reply: any) => {
        const userId = request.headers['x-user-id'];
        if (typeof userId !== 'string') {
            return reply.code(401).send({ error: 'Unauthorized' });
        }
        request.userId = userId;
    });

    orchestratorRoutes(typed);
    await typed.ready();
    return typed;
}

describe('orchestrator integration paths', () => {
    beforeEach(() => {
        resetState();
        invokeUserRpcMock.mockReset();
        invokeUserRpcMock.mockImplementation(async (_userId: string, method: string) => {
            if (method.endsWith(':detect-providers')) {
                return { providers: ['claude', 'codex', 'gemini'] };
            }
            return {};
        });
        listConnectedUserRpcMethodsMock.mockClear();
        eventRouterMock.getConnections.mockClear();
        eventRouterMock.emitEphemeral.mockClear();
    });

    it('submit -> scheduler dispatch -> daemon start/finish -> run completed', async () => {
        const app = await createApp();
        const submit = await app.inject({
            method: 'POST',
            url: '/v1/orchestrator/submit',
            headers: { 'x-user-id': 'user-1' },
            payload: {
                title: sealed('integration-run'),
                tasks: [
                    {
                        provider: 'codex',
                        prompt: sealed('do work'),
                    },
                ],
            },
        });
        expect(submit.statusCode).toBe(200);
        const submitBody = submit.json();
        const runId = submitBody.data.runId as string;

        await orchestratorSchedulerTick(new Date('2026-03-16T00:00:00.000Z'));
        expect(invokeUserRpcMock).toHaveBeenCalledWith(
            'user-1',
            'machine-1:orchestrator-sealed-dispatch',
            expect.objectContaining({
                runId,
            }),
            expect.any(Number),
        );
        expect(state.executions).toHaveLength(1);
        const execution = state.executions[0];

        const start = await app.inject({
            method: 'POST',
            url: `/v1/orchestrator/executions/${execution.id}/start`,
            headers: { 'x-user-id': 'user-1' },
            payload: {
                dispatchToken: execution.dispatchToken,
            },
        });
        expect(start.statusCode).toBe(200);

        const finish = await app.inject({
            method: 'POST',
            url: `/v1/orchestrator/executions/${execution.id}/finish`,
            headers: { 'x-user-id': 'user-1' },
            payload: {
                dispatchToken: execution.dispatchToken,
                status: 'completed',
                outputSummary: 'done',
            },
        });
        expect(finish.statusCode).toBe(200);
        expect(finish.json().data.runStatus).toBe('completed');

        const runGet = await app.inject({
            method: 'GET',
            url: `/v1/orchestrator/runs/${runId}`,
            headers: { 'x-user-id': 'user-1' },
        });
        expect(runGet.statusCode).toBe(200);
        expect(runGet.json().data.status).toBe('completed');
        expect(runGet.json().data.summary).toEqual(
            expect.objectContaining({
                total: 1,
                completed: 1,
            }),
        );

        await app.close();
    });

    it('submit -> cancel -> run cancelled', async () => {
        const app = await createApp();
        const submit = await app.inject({
            method: 'POST',
            url: '/v1/orchestrator/submit',
            headers: { 'x-user-id': 'user-1' },
            payload: {
                title: sealed('cancel-run'),
                tasks: [
                    {
                        provider: 'claude',
                        prompt: sealed('do work'),
                    },
                ],
            },
        });
        const runId = submit.json().data.runId as string;

        const cancel = await app.inject({
            method: 'POST',
            url: `/v1/orchestrator/runs/${runId}/cancel`,
            headers: { 'x-user-id': 'user-1' },
            payload: {
                reason: 'stop',
            },
        });
        expect(cancel.statusCode).toBe(200);
        expect(cancel.json().data.status).toBe('cancelled');

        const runGet = await app.inject({
            method: 'GET',
            url: `/v1/orchestrator/runs/${runId}`,
            headers: { 'x-user-id': 'user-1' },
        });
        expect(runGet.statusCode).toBe(200);
        expect(runGet.json().data.status).toBe('cancelled');
        expect(runGet.json().data.summary).toEqual(
            expect.objectContaining({
                total: 1,
                cancelled: 1,
            }),
        );

        await app.close();
    });

    it('cancel with DAG marks downstream task as dependency_failed before response returns', async () => {
        const app = await createApp();
        const submit = await app.inject({
            method: 'POST',
            url: '/v1/orchestrator/submit',
            headers: { 'x-user-id': 'user-1' },
            payload: {
                title: sealed('cancel-dag-run'),
                tasks: [
                    {
                        taskKey: 'task-a',
                        provider: 'claude',
                        prompt: sealed('task a'),
                    },
                    {
                        taskKey: 'task-b',
                        provider: 'codex',
                        prompt: sealed('task b'),
                        dependsOn: ['task-a'],
                    },
                ],
            },
        });
        expect(submit.statusCode).toBe(200);
        const runId = submit.json().data.runId as string;

        const cancel = await app.inject({
            method: 'POST',
            url: `/v1/orchestrator/runs/${runId}/cancel`,
            headers: { 'x-user-id': 'user-1' },
            payload: {
                reason: 'stop',
            },
        });
        expect(cancel.statusCode).toBe(200);
        expect(cancel.json().data.status).toBe('cancelled');

        const runGet = await app.inject({
            method: 'GET',
            url: `/v1/orchestrator/runs/${runId}`,
            headers: { 'x-user-id': 'user-1' },
        });
        expect(runGet.statusCode).toBe(200);
        expect(runGet.json().data.status).toBe('cancelled');
        const tasks = runGet.json().data.tasks as Array<{ taskKey: string | null; status: string }>;
        const taskA = tasks.find((task) => task.taskKey === 'task-a');
        const taskB = tasks.find((task) => task.taskKey === 'task-b');
        expect(taskA?.status).toBe('cancelled');
        expect(taskB?.status).toBe('dependency_failed');
        expect(runGet.json().data.summary).toEqual(
            expect.objectContaining({
                total: 2,
                failed: 1,
                cancelled: 1,
            }),
        );

        await app.close();
    });

    it('submit -> dispatch rpc failure -> execution failed -> run failed', async () => {
        invokeUserRpcMock.mockRejectedValueOnce(new Error('machine offline'));

        const app = await createApp();
        const submit = await app.inject({
            method: 'POST',
            url: '/v1/orchestrator/submit',
            headers: { 'x-user-id': 'user-1' },
            payload: {
                title: sealed('offline-run'),
                tasks: [
                    {
                        provider: 'gemini',
                        prompt: sealed('do work'),
                    },
                ],
            },
        });
        const runId = submit.json().data.runId as string;

        await orchestratorSchedulerTick(new Date('2026-03-16T00:00:00.000Z'));

        expect(state.executions).toHaveLength(1);
        expect(state.executions[0].status).toBe('failed');
        expect(state.tasks[0].status).toBe('failed');

        const runGet = await app.inject({
            method: 'GET',
            url: `/v1/orchestrator/runs/${runId}`,
            headers: { 'x-user-id': 'user-1' },
        });
        expect(runGet.statusCode).toBe(200);
        expect(runGet.json().data.status).toBe('failed');
        expect(runGet.json().data.summary).toEqual(
            expect.objectContaining({
                total: 1,
                failed: 1,
            }),
        );

        await app.close();
    });

    it('rejects a run, a follow-up or a result that is not sealed', async () => {
        const app = await createApp();
        for (const payload of [
            { title: 'plain', tasks: [{ provider: 'claude', prompt: sealed('work') }] },
            { title: sealed('plain'), tasks: [{ provider: 'claude', prompt: 'work' }] },
            { title: sealed('plain'), tasks: [{ provider: 'claude', prompt: sealed('work'), title: 'task' }] },
            { title: sealed('plain'), tasks: [{ provider: 'claude', prompt: 'e2e1:not base64!' }] },
        ]) {
            const submit = await app.inject({
                method: 'POST',
                url: '/v1/orchestrator/submit',
                headers: { 'x-user-id': 'user-1' },
                payload,
            });
            expect(submit.statusCode).toBe(400);
        }
        expect(state.runs).toHaveLength(0);

        const submit = await app.inject({
            method: 'POST',
            url: '/v1/orchestrator/submit',
            headers: { 'x-user-id': 'user-1' },
            payload: { title: sealed('sealed'), tasks: [{ provider: 'claude', prompt: sealed('work') }] },
        });
        expect(submit.statusCode).toBe(200);
        await orchestratorSchedulerTick(new Date('2026-03-16T00:00:00.000Z'));
        const execution = state.executions[0];
        const finish = await app.inject({
            method: 'POST',
            url: `/v1/orchestrator/executions/${execution.id}/finish`,
            headers: { 'x-user-id': 'user-1' },
            payload: { dispatchToken: execution.dispatchToken, status: 'completed', sealedResult: 'done' },
        });
        expect(finish.statusCode).toBe(400);
        expect(state.executions[0].status).not.toBe('completed');

        state.tasks[0].status = 'completed';
        const sendMessage = await app.inject({
            method: 'POST',
            url: `/v1/orchestrator/tasks/${state.tasks[0].id}/send-message`,
            headers: { 'x-user-id': 'user-1' },
            payload: { message: 'again' },
        });
        expect(sendMessage.statusCode).toBe(400);
        await app.close();
    });

    it('rejects submit when dependency references unknown taskKey', async () => {
        const app = await createApp();
        const submit = await app.inject({
            method: 'POST',
            url: '/v1/orchestrator/submit',
            headers: { 'x-user-id': 'user-1' },
            payload: {
                title: sealed('dependency-invalid'),
                tasks: [
                    {
                        taskKey: 'task-a',
                        provider: 'claude',
                        prompt: sealed('work'),
                        dependsOn: ['task-b'],
                    },
                ],
            },
        });

        expect(submit.statusCode).toBe(400);
        expect(submit.json().error.code).toBe('INVALID_DEPENDENCY');
        await app.close();
    });

    it('rejects submit when dependency graph has cycle', async () => {
        const app = await createApp();
        const submit = await app.inject({
            method: 'POST',
            url: '/v1/orchestrator/submit',
            headers: { 'x-user-id': 'user-1' },
            payload: {
                title: sealed('dependency-cycle'),
                tasks: [
                    {
                        taskKey: 'task-a',
                        provider: 'claude',
                        prompt: sealed('work-a'),
                        dependsOn: ['task-b'],
                    },
                    {
                        taskKey: 'task-b',
                        provider: 'codex',
                        prompt: sealed('work-b'),
                        dependsOn: ['task-a'],
                    },
                ],
            },
        });

        expect(submit.statusCode).toBe(400);
        expect(submit.json().error.code).toBe('INVALID_DAG_CYCLE');
        await app.close();
    });

    it('rejects submit when task model does not match provider', async () => {
        const app = await createApp();
        const submit = await app.inject({
            method: 'POST',
            url: '/v1/orchestrator/submit',
            headers: { 'x-user-id': 'user-1' },
            payload: {
                title: sealed('invalid-task-model'),
                tasks: [
                    {
                        provider: 'claude',
                        model: 'gpt-5.5-high',
                        prompt: sealed('work'),
                    },
                ],
            },
        });

        expect(submit.statusCode).toBe(400);
        expect(submit.json().error.code).toBe('INVALID_ARGUMENT');
        await app.close();
    });

    it('rejects a codex task whose -fast model mode belongs to another provider', async () => {
        const app = await createApp();
        const submit = await app.inject({
            method: 'POST',
            url: '/v1/orchestrator/submit',
            headers: { 'x-user-id': 'user-1' },
            payload: {
                title: sealed('invalid-fast-task-model'),
                tasks: [
                    {
                        provider: 'codex',
                        model: 'claude-opus-5-max-fast',
                        prompt: sealed('work'),
                    },
                ],
            },
        });

        expect(submit.statusCode).toBe(400);
        expect(submit.json().error.code).toBe('INVALID_ARGUMENT');
        await app.close();
    });

    it('accepts a codex -fast model mode and forwards it to the dispatch as-is', async () => {
        const app = await createApp();
        const submit = await app.inject({
            method: 'POST',
            url: '/v1/orchestrator/submit',
            headers: { 'x-user-id': 'user-1' },
            payload: {
                title: sealed('codex-fast-task-model'),
                tasks: [
                    {
                        provider: 'codex',
                        model: 'gpt-5.5-high-fast',
                        prompt: sealed('work'),
                    },
                ],
            },
        });

        expect(submit.statusCode).toBe(200);
        const runId = submit.json().data.runId as string;
        expect(state.tasks.find((task) => task.runId === runId)?.model).toBe('gpt-5.5-high-fast');

        await orchestratorSchedulerTick(new Date('2026-03-16T00:00:00.000Z'));
        expect(invokeUserRpcMock).toHaveBeenCalledWith(
            'user-1',
            'machine-1:orchestrator-sealed-dispatch',
            expect.objectContaining({
                provider: 'codex',
                model: 'gpt-5.5-high-fast',
            }),
            expect.any(Number),
        );
        await app.close();
    });

    it('allows unknown model strings outside catalog and forwards as-is', async () => {
        const app = await createApp();
        const submit = await app.inject({
            method: 'POST',
            url: '/v1/orchestrator/submit',
            headers: { 'x-user-id': 'user-1' },
            payload: {
                title: sealed('unknown-task-model-forward'),
                tasks: [
                    {
                        provider: 'claude',
                        model: 'claude-sonnet-4-6-20260315',
                        prompt: sealed('work'),
                    },
                ],
            },
        });

        expect(submit.statusCode).toBe(200);
        const runId = submit.json().data.runId as string;
        const createdTask = state.tasks.find((task) => task.runId === runId);
        expect(createdTask?.model).toBe('claude-sonnet-4-6-20260315');

        await orchestratorSchedulerTick(new Date('2026-03-16T00:00:00.000Z'));
        expect(invokeUserRpcMock).toHaveBeenCalledWith(
            'user-1',
            'machine-1:orchestrator-sealed-dispatch',
            expect.objectContaining({
                provider: 'claude',
                model: 'claude-sonnet-4-6-20260315',
            }),
            expect.any(Number),
        );
        await app.close();
    });

    it('normalizes default model and persists model in dispatch/execution/task responses', async () => {
        const app = await createApp();
        const submit = await app.inject({
            method: 'POST',
            url: '/v1/orchestrator/submit',
            headers: { 'x-user-id': 'user-1' },
            payload: {
                title: sealed('task-model-passthrough'),
                tasks: [
                    {
                        provider: 'codex',
                        model: 'gpt-5.3-codex-high',
                        prompt: sealed('work-a'),
                    },
                    {
                        provider: 'claude',
                        model: 'default',
                        prompt: sealed('work-b'),
                    },
                ],
            },
        });
        expect(submit.statusCode).toBe(200);
        const runId = submit.json().data.runId as string;

        const createdTasks = state.tasks.filter((task) => task.runId === runId).sort((a, b) => a.seq - b.seq);
        expect(createdTasks[0].model).toBe('gpt-5.3-codex-high');
        expect(createdTasks[1].model).toBeNull();

        await orchestratorSchedulerTick(new Date('2026-03-16T00:00:00.000Z'));

        expect(invokeUserRpcMock).toHaveBeenCalledWith(
            'user-1',
            'machine-1:orchestrator-sealed-dispatch',
            expect.objectContaining({
                provider: 'codex',
                model: 'gpt-5.3-codex-high',
            }),
            expect.any(Number),
        );
        expect(state.executions).toEqual(expect.arrayContaining([
            expect.objectContaining({
                provider: 'codex',
                model: 'gpt-5.3-codex-high',
            }),
        ]));

        const getRun = await app.inject({
            method: 'GET',
            url: `/v1/orchestrator/runs/${runId}`,
            headers: { 'x-user-id': 'user-1' },
        });
        expect(getRun.statusCode).toBe(200);
        const responseTasks = getRun.json().data.tasks;
        expect(responseTasks[0].model).toBe('gpt-5.3-codex-high');
        expect(responseTasks[1].model).toBeNull();
        await app.close();
    });

    it('captures childSessionId on finish and supports resume send-message for terminal task', async () => {
        const app = await createApp();
        const submit = await app.inject({
            method: 'POST',
            url: '/v1/orchestrator/submit',
            headers: { 'x-user-id': 'user-1' },
            payload: {
                title: sealed('resume-task-message'),
                tasks: [
                    {
                        provider: 'codex',
                        prompt: sealed('initial prompt'),
                    },
                ],
            },
        });
        expect(submit.statusCode).toBe(200);

        await orchestratorSchedulerTick(new Date('2026-03-16T00:00:00.000Z'));
        expect(state.executions).toHaveLength(1);
        const initialExecution = state.executions[0];
        expect(initialExecution.executionType).toBe('initial');
        expect(initialExecution.childSessionId).toBeNull();

        const finish = await app.inject({
            method: 'POST',
            url: `/v1/orchestrator/executions/${initialExecution.id}/finish`,
            headers: { 'x-user-id': 'user-1' },
            payload: {
                dispatchToken: initialExecution.dispatchToken,
                status: 'completed',
                childSessionId: '11111111-2222-4333-8444-555555555555',
                finishedAt: '2026-03-16T00:00:01.000Z',
            },
        });
        expect(finish.statusCode).toBe(200);
        expect(state.executions[0].childSessionId).toBe('11111111-2222-4333-8444-555555555555');

        const taskId = state.tasks[0].id;
        const sendMessage = await app.inject({
            method: 'POST',
            url: `/v1/orchestrator/tasks/${taskId}/send-message`,
            headers: { 'x-user-id': 'user-1' },
            payload: {
                message: sealed('follow up question'),
            },
        });
        expect(sendMessage.statusCode).toBe(200);
        expect(state.tasks[0].status).toBe('queued');
        expect(state.executions).toHaveLength(2);
        expect(state.executions[1]).toEqual(expect.objectContaining({
            executionType: 'resume',
            childSessionId: '11111111-2222-4333-8444-555555555555',
            resumeMessage: sealed('follow up question'),
            status: 'queued',
        }));

        await orchestratorSchedulerTick(new Date('2026-03-16T00:00:02.000Z'));
        expect(invokeUserRpcMock).toHaveBeenLastCalledWith(
            'user-1',
            'machine-1:orchestrator-sealed-dispatch',
            expect.objectContaining({
                executionType: 'resume',
                childSessionId: '11111111-2222-4333-8444-555555555555',
                prompt: sealed('initial prompt'),
                resumeMessage: sealed('follow up question'),
            }),
            expect.any(Number),
        );
        await app.close();
    });

    it('works for the session that sent a follow-up, not the one that submitted the run', async () => {
        const app = await createApp();
        state.sessions.push({ id: 'controller-session-2', accountId: 'user-1' });
        const terminalCallbackSessions = () => eventRouterMock.emitEphemeral.mock.calls
            .map(([event]) => event)
            .filter((event: any) => event.payload.type === 'orchestrator-run-terminal')
            .map((event: any) => event.recipientFilter.sessionId);
        const activityOf = async (sessionId: string) => (await app.inject({
            method: 'GET',
            url: `/v1/orchestrator/activity?controllerSessionId=${sessionId}`,
            headers: { 'x-user-id': 'user-1' },
        })).json().data;
        const runTitlesOf = async (sessionId: string) => (await app.inject({
            method: 'GET',
            url: `/v1/orchestrator/runs?controllerSessionId=${sessionId}`,
            headers: { 'x-user-id': 'user-1' },
        })).json().data.items.map((item: any) => item.title);

        const submit = await app.inject({
            method: 'POST',
            url: '/v1/orchestrator/submit',
            headers: { 'x-user-id': 'user-1' },
            payload: {
                title: sealed('submitted-by-session-1'),
                controllerSessionId: 'controller-session-1',
                tasks: [{ provider: 'codex', prompt: sealed('initial prompt'), retry: { maxAttempts: 3 } }],
            },
        });
        expect(submit.statusCode).toBe(200);
        const runId = submit.json().data.runId as string;

        await orchestratorSchedulerTick(new Date('2026-03-16T00:00:00.000Z'));
        const initialExecution = state.executions[0];
        await app.inject({
            method: 'POST',
            url: `/v1/orchestrator/executions/${initialExecution.id}/finish`,
            headers: { 'x-user-id': 'user-1' },
            payload: {
                dispatchToken: initialExecution.dispatchToken,
                status: 'completed',
                childSessionId: 'child-session-1',
            },
        });
        expect(terminalCallbackSessions()).toEqual(['controller-session-1']);
        eventRouterMock.emitEphemeral.mockClear();

        const sendMessage = await app.inject({
            method: 'POST',
            url: `/v1/orchestrator/tasks/${state.tasks[0].id}/send-message`,
            headers: { 'x-user-id': 'user-1' },
            payload: {
                message: sealed('follow up from session 2'),
                controllerSessionId: 'controller-session-2',
            },
        });
        expect(sendMessage.statusCode).toBe(200);
        expect(state.executions[1].controllerSessionId).toBe('controller-session-2');
        expect(state.runs[0].reopenedAt).toEqual(state.executions[1].createdAt);

        expect(await activityOf('controller-session-2')).toEqual({
            activity: { [runId]: [state.tasks[0].id] },
            totalRunCount: 1,
        });
        expect(await activityOf('controller-session-1')).toEqual({ activity: {}, totalRunCount: 1 });
        expect(await runTitlesOf('controller-session-1')).toEqual([sealed('submitted-by-session-1')]);
        expect(await runTitlesOf('controller-session-2')).toEqual([sealed('submitted-by-session-1')]);

        // A failed attempt is retried for the same session.
        await orchestratorSchedulerTick(new Date('2026-03-16T00:00:01.000Z'));
        await app.inject({
            method: 'POST',
            url: `/v1/orchestrator/executions/${state.executions[1].id}/finish`,
            headers: { 'x-user-id': 'user-1' },
            payload: {
                dispatchToken: state.executions[1].dispatchToken,
                status: 'failed',
                finishedAt: '2026-03-16T00:00:02.000Z',
            },
        });
        expect(state.tasks[0].status).toBe('queued');
        await orchestratorSchedulerTick(new Date('2026-03-16T00:01:00.000Z'));
        expect(state.executions).toHaveLength(3);
        expect(state.executions[2].controllerSessionId).toBe('controller-session-2');

        await app.inject({
            method: 'POST',
            url: `/v1/orchestrator/executions/${state.executions[2].id}/finish`,
            headers: { 'x-user-id': 'user-1' },
            payload: { dispatchToken: state.executions[2].dispatchToken, status: 'completed' },
        });
        expect(state.runs[0].status).toBe('completed');
        expect(terminalCallbackSessions()).toEqual(['controller-session-2']);

        const batch = await app.inject({
            method: 'GET',
            url: '/v1/orchestrator/activity/batch',
            headers: { 'x-user-id': 'user-1' },
        });
        expect(batch.json().data.totalRunCounts).toEqual({
            'controller-session-1': 1,
            'controller-session-2': 1,
        });
        await app.close();
    });

    it('rejects a follow-up sent for a session of another account', async () => {
        const app = await createApp();
        state.sessions.push({ id: 'foreign-session', accountId: 'user-2' });
        const response = await app.inject({
            method: 'POST',
            url: '/v1/orchestrator/tasks/task-1/send-message',
            headers: { 'x-user-id': 'user-1' },
            payload: { message: sealed('hello'), controllerSessionId: 'foreign-session' },
        });
        expect(response.statusCode).toBe(400);
        await app.close();
    });

    it('records childSessionId while the execution is running and keeps the first one', async () => {
        const app = await createApp();
        await app.inject({
            method: 'POST',
            url: '/v1/orchestrator/submit',
            headers: { 'x-user-id': 'user-1' },
            payload: {
                title: sealed('early-child-session'),
                tasks: [{ provider: 'codex', prompt: sealed('initial prompt') }],
            },
        });
        await orchestratorSchedulerTick(new Date('2026-03-16T00:00:00.000Z'));
        const execution = state.executions[0];
        expect(execution.childSessionId).toBeNull();

        const report = (childSessionId: string, dispatchToken: string = execution.dispatchToken) => app.inject({
            method: 'POST',
            url: `/v1/orchestrator/executions/${execution.id}/child-session`,
            headers: { 'x-user-id': 'user-1' },
            payload: { dispatchToken, childSessionId },
        });

        const wrongToken = await report('11111111-2222-4333-8444-555555555555', 'wrong-token');
        expect(wrongToken.statusCode).toBe(409);
        expect(state.executions[0].childSessionId).toBeNull();

        const first = await report('11111111-2222-4333-8444-555555555555');
        expect(first.statusCode).toBe(200);
        expect(first.json().data.recorded).toBe(true);
        expect(state.executions[0].childSessionId).toBe('11111111-2222-4333-8444-555555555555');

        const second = await report('99999999-2222-4333-8444-555555555555');
        expect(second.statusCode).toBe(200);
        expect(second.json().data.recorded).toBe(false);
        expect(state.executions[0].childSessionId).toBe('11111111-2222-4333-8444-555555555555');
        await app.close();
    });

    it('rejects send-message when task has no captured childSessionId', async () => {
        const app = await createApp();
        const submit = await app.inject({
            method: 'POST',
            url: '/v1/orchestrator/submit',
            headers: { 'x-user-id': 'user-1' },
            payload: {
                title: sealed('resume-task-missing-child-session'),
                tasks: [
                    {
                        provider: 'codex',
                        prompt: sealed('initial prompt'),
                    },
                ],
            },
        });
        expect(submit.statusCode).toBe(200);

        await orchestratorSchedulerTick(new Date('2026-03-16T00:00:00.000Z'));
        const initialExecution = state.executions[0];
        const finish = await app.inject({
            method: 'POST',
            url: `/v1/orchestrator/executions/${initialExecution.id}/finish`,
            headers: { 'x-user-id': 'user-1' },
            payload: {
                dispatchToken: initialExecution.dispatchToken,
                status: 'failed',
                finishedAt: '2026-03-16T00:00:01.000Z',
            },
        });
        expect(finish.statusCode).toBe(200);
        expect(state.executions[0].childSessionId).toBeNull();

        const taskId = state.tasks[0].id;
        const sendMessage = await app.inject({
            method: 'POST',
            url: `/v1/orchestrator/tasks/${taskId}/send-message`,
            headers: { 'x-user-id': 'user-1' },
            payload: {
                message: sealed('follow up question'),
            },
        });
        expect(sendMessage.statusCode).toBe(409);
        expect(sendMessage.json().error.code).toBe('CONFLICT');
        await app.close();
    });

    it('rejects send-message when task is not in completed/failed terminal state', async () => {
        const app = await createApp();
        const submit = await app.inject({
            method: 'POST',
            url: '/v1/orchestrator/submit',
            headers: { 'x-user-id': 'user-1' },
            payload: {
                title: sealed('resume-task-invalid-state'),
                tasks: [
                    {
                        provider: 'claude',
                        prompt: sealed('initial prompt'),
                    },
                ],
            },
        });
        expect(submit.statusCode).toBe(200);

        const taskId = state.tasks[0].id;
        const sendMessage = await app.inject({
            method: 'POST',
            url: `/v1/orchestrator/tasks/${taskId}/send-message`,
            headers: { 'x-user-id': 'user-1' },
            payload: {
                message: sealed('follow up question'),
            },
        });
        expect(sendMessage.statusCode).toBe(409);
        expect(sendMessage.json().error.code).toBe('CONFLICT');
        await app.close();
    });

    it('allows task without taskKey to depend on keyed task and schedules in order', async () => {
        const app = await createApp();
        const submit = await app.inject({
            method: 'POST',
            url: '/v1/orchestrator/submit',
            headers: { 'x-user-id': 'user-1' },
            payload: {
                title: sealed('dependency-non-keyed-downstream'),
                tasks: [
                    {
                        taskKey: 'task-a',
                        provider: 'claude',
                        prompt: sealed('work-a'),
                    },
                    {
                        provider: 'codex',
                        prompt: sealed('work-b'),
                        dependsOn: ['task-a'],
                    },
                ],
            },
        });
        expect(submit.statusCode).toBe(200);

        await orchestratorSchedulerTick(new Date('2026-03-16T00:00:00.000Z'));
        expect(state.executions).toHaveLength(1);
        expect(state.executions[0].provider).toBe('claude');

        const finishUpstream = await app.inject({
            method: 'POST',
            url: `/v1/orchestrator/executions/${state.executions[0].id}/finish`,
            headers: { 'x-user-id': 'user-1' },
            payload: {
                dispatchToken: state.executions[0].dispatchToken,
                status: 'completed',
                finishedAt: '2026-03-16T00:00:01.000Z',
            },
        });
        expect(finishUpstream.statusCode).toBe(200);

        await orchestratorSchedulerTick(new Date('2026-03-16T00:00:02.000Z'));
        expect(state.executions).toHaveLength(2);
        expect(state.executions[1].provider).toBe('codex');
        await app.close();
    });

    it('returns orchestrator context with machine online and dispatch readiness', async () => {
        state.machines.push({
            id: 'machine-2',
            accountId: 'user-1',
            active: true,
            lastActiveAt: new Date('2026-03-16T00:00:01.000Z'),
        });
        state.onlineMachineIds = new Set(['machine-1']);
        state.dispatchReadyMachineIds = new Set(['machine-1']);

        const app = await createApp();
        const response = await app.inject({
            method: 'GET',
            url: '/v1/orchestrator/context',
            headers: { 'x-user-id': 'user-1' },
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();
        expect(body.data.modelModes).toEqual({
            claude: getValidModelModesForAgent('claude'),
            codex: getValidModelModesForAgent('codex'),
            gemini: getValidModelModesForAgent('gemini'),
            qoder: getValidModelModesForAgent('qoder'),
        });
        expect(body.data.defaults).toEqual(expect.objectContaining({
            retryMaxAttempts: 1,
            retryBackoffMs: 0,
        }));
        expect(body.data.machines).toEqual([
            expect.objectContaining({
                machineId: 'machine-1',
                online: true,
                dispatchReady: true,
                shellReady: true,
                providers: ['claude', 'codex', 'gemini'],
                modelModes: {
                    claude: getValidModelModesForAgent('claude'),
                    codex: getValidModelModesForAgent('codex'),
                    gemini: getValidModelModesForAgent('gemini'),
                },
            }),
            expect.objectContaining({
                machineId: 'machine-2',
                online: false,
                dispatchReady: false,
                shellReady: false,
                providers: [],
                modelModes: {},
            }),
        ]);
        await app.close();
    });

    it('returns per-machine detected providers from detect-providers RPC', async () => {
        state.machines.push({
            id: 'machine-2',
            accountId: 'user-1',
            active: true,
            lastActiveAt: new Date('2026-03-16T00:00:01.000Z'),
        });
        state.onlineMachineIds = new Set(['machine-1', 'machine-2']);
        state.dispatchReadyMachineIds = new Set(['machine-1', 'machine-2']);

        invokeUserRpcMock.mockImplementation(async (_userId: string, method: string) => {
            if (method === 'machine-1:detect-providers') {
                return { providers: ['claude', 'codex', 'gemini'] };
            }
            if (method === 'machine-2:detect-providers') {
                return { providers: ['claude'] };
            }
            return {};
        });

        const app = await createApp();
        const response = await app.inject({
            method: 'GET',
            url: '/v1/orchestrator/context',
            headers: { 'x-user-id': 'user-1' },
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();
        const m1 = body.data.machines.find((m: any) => m.machineId === 'machine-1');
        const m2 = body.data.machines.find((m: any) => m.machineId === 'machine-2');

        expect(m1.providers).toEqual(['claude', 'codex', 'gemini']);
        expect(m1.modelModes).toEqual({
            claude: getValidModelModesForAgent('claude'),
            codex: getValidModelModesForAgent('codex'),
            gemini: getValidModelModesForAgent('gemini'),
        });

        expect(m2.providers).toEqual(['claude']);
        expect(m2.modelModes).toEqual({
            claude: getValidModelModesForAgent('claude'),
        });
        await app.close();
    });

    it('returns empty providers when detect-providers RPC times out', async () => {
        invokeUserRpcMock.mockImplementation(async (_userId: string, method: string) => {
            if (method.endsWith(':detect-providers')) {
                throw new Error('timeout');
            }
            return {};
        });

        const app = await createApp();
        const response = await app.inject({
            method: 'GET',
            url: '/v1/orchestrator/context',
            headers: { 'x-user-id': 'user-1' },
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();
        const m1 = body.data.machines.find((m: any) => m.machineId === 'machine-1');
        expect(m1.providers).toEqual([]);
        expect(m1.modelModes).toEqual({});
        await app.close();
    });

    it('exposes dag/retry task fields in get and pend responses', async () => {
        const app = await createApp();
        const submit = await app.inject({
            method: 'POST',
            url: '/v1/orchestrator/submit',
            headers: { 'x-user-id': 'user-1' },
            payload: {
                title: sealed('response-task-fields'),
                tasks: [
                    {
                        taskKey: 'task-a',
                        provider: 'claude',
                        prompt: sealed('step a'),
                    },
                    {
                        provider: 'codex',
                        prompt: sealed('step b'),
                        dependsOn: ['task-a'],
                        retry: {
                            maxAttempts: 3,
                            backoffMs: 5000,
                        },
                    },
                ],
            },
        });
        expect(submit.statusCode).toBe(200);
        const runId = submit.json().data.runId as string;

        const getRun = await app.inject({
            method: 'GET',
            url: `/v1/orchestrator/runs/${runId}`,
            headers: { 'x-user-id': 'user-1' },
        });
        expect(getRun.statusCode).toBe(200);
        const getTasks = getRun.json().data.tasks;
        expect(getTasks[1]).toEqual(expect.objectContaining({
            dependsOn: ['task-a'],
            retry: {
                maxAttempts: 3,
                backoffMs: 5000,
            },
            nextAttemptAt: null,
        }));

        const pend = await app.inject({
            method: 'GET',
            url: `/v1/orchestrator/runs/${runId}/pend?include=all_tasks&timeoutMs=0`,
            headers: { 'x-user-id': 'user-1' },
        });
        expect(pend.statusCode).toBe(200);
        const pendTasks = pend.json().data.tasks;
        expect(pendTasks[1]).toEqual(expect.objectContaining({
            dependsOn: ['task-a'],
            retry: {
                maxAttempts: 3,
                backoffMs: 5000,
            },
            nextAttemptAt: null,
        }));

        const listRuns = await app.inject({
            method: 'GET',
            url: '/v1/orchestrator/runs',
            headers: { 'x-user-id': 'user-1' },
        });
        expect(listRuns.statusCode).toBe(200);
        expect(listRuns.json().data.items[0]).toEqual(expect.objectContaining({
            runId,
            summary: expect.any(Object),
        }));
        await app.close();
    });

    it('includes machines in run list response items', async () => {
        const app = await createApp();
        const submit = await app.inject({
            method: 'POST',
            url: '/v1/orchestrator/submit',
            headers: { 'x-user-id': 'user-1' },
            payload: {
                title: sealed('list-machines'),
                tasks: [
                    {
                        provider: 'claude',
                        prompt: sealed('step a'),
                    },
                ],
            },
        });
        expect(submit.statusCode).toBe(200);
        const runId = submit.json().data.runId as string;

        await orchestratorSchedulerTick(new Date('2026-03-16T00:00:00.000Z'));
        expect(state.executions).toHaveLength(1);
        expect(state.executions[0].machineId).toBe('machine-1');

        const listRuns = await app.inject({
            method: 'GET',
            url: '/v1/orchestrator/runs',
            headers: { 'x-user-id': 'user-1' },
        });
        expect(listRuns.statusCode).toBe(200);

        const item = listRuns.json().data.items.find((run: any) => run.runId === runId);
        expect(item).toBeDefined();
        expect(item.machines).toEqual(['machine-1']);

        await app.close();
    });

    it('includes the providers of its tasks in run list response items', async () => {
        const app = await createApp();
        const submit = await app.inject({
            method: 'POST',
            url: '/v1/orchestrator/submit',
            headers: { 'x-user-id': 'user-1' },
            payload: {
                title: sealed('list-providers'),
                tasks: [
                    { provider: 'claude', prompt: sealed('step a') },
                    { provider: 'codex', prompt: sealed('step b') },
                    { provider: 'claude', prompt: sealed('step c') },
                ],
            },
        });
        expect(submit.statusCode).toBe(200);
        const runId = submit.json().data.runId as string;

        const listRuns = await app.inject({
            method: 'GET',
            url: '/v1/orchestrator/runs',
            headers: { 'x-user-id': 'user-1' },
        });
        expect(listRuns.statusCode).toBe(200);

        const item = listRuns.json().data.items.find((run: any) => run.runId === runId);
        expect(item.providers).toEqual(['claude', 'codex']);

        await app.close();
    });

    it('filters the run list and its counts by executor kind and by machine', async () => {
        const app = await createApp();
        const submit = await app.inject({
            method: 'POST',
            url: '/v1/orchestrator/submit',
            headers: { 'x-user-id': 'user-1' },
            payload: { title: sealed('agent run'), tasks: [{ provider: 'claude', prompt: sealed('step a') }] },
        });
        expect(submit.statusCode).toBe(200);
        const agentRunId = submit.json().data.runId as string;
        await orchestratorSchedulerTick(new Date('2026-03-16T00:00:00.000Z'));

        const list = async (query: string) => {
            const response = await app.inject({ method: 'GET', url: `/v1/orchestrator/runs?${query}`, headers: { 'x-user-id': 'user-1' } });
            expect(response.statusCode).toBe(200);
            return response.json().data.items.map((run: any) => run.runId);
        };
        const counts = async (query: string) => {
            const response = await app.inject({ method: 'GET', url: `/v1/orchestrator/runs/counts?${query}`, headers: { 'x-user-id': 'user-1' } });
            expect(response.statusCode).toBe(200);
            return response.json().data;
        };

        expect(await list('kind=agent')).toEqual([agentRunId]);
        expect(await list('kind=shell')).toEqual([]);
        expect(await list('machineId=machine-1')).toEqual([agentRunId]);
        expect(await list('kind=agent&machineId=machine-2')).toEqual([]);
        expect(Object.values(await counts('kind=agent')).reduce((sum: number, n: any) => sum + n, 0)).toBe(1);
        expect(await counts('kind=transfer')).toEqual({});

        await app.close();
    });

    it('includes machines in run detail even when executions are not included', async () => {
        const app = await createApp();
        const submit = await app.inject({
            method: 'POST',
            url: '/v1/orchestrator/submit',
            headers: { 'x-user-id': 'user-1' },
            payload: {
                title: sealed('detail-machines-fallback'),
                tasks: [
                    {
                        provider: 'codex',
                        prompt: sealed('step a'),
                    },
                ],
            },
        });
        expect(submit.statusCode).toBe(200);
        const runId = submit.json().data.runId as string;

        await orchestratorSchedulerTick(new Date('2026-03-16T00:00:00.000Z'));
        expect(state.executions).toHaveLength(1);
        expect(state.executions[0].machineId).toBe('machine-1');

        const getRun = await app.inject({
            method: 'GET',
            url: `/v1/orchestrator/runs/${runId}`,
            headers: { 'x-user-id': 'user-1' },
        });
        expect(getRun.statusCode).toBe(200);

        const body = getRun.json();
        expect(body.data.machines).toEqual(['machine-1']);
        expect(body.data.tasks[0].executions).toBeUndefined();

        await app.close();
    });

    it('returns single-task detail with optional execution history', async () => {
        const app = await createApp();
        const submit = await app.inject({
            method: 'POST',
            url: '/v1/orchestrator/submit',
            headers: { 'x-user-id': 'user-1' },
            payload: {
                title: sealed('single-task-detail'),
                tasks: [
                    {
                        taskKey: 'task-a',
                        provider: 'claude',
                        prompt: sealed('step a'),
                    },
                ],
            },
        });
        expect(submit.statusCode).toBe(200);
        const runId = submit.json().data.runId as string;
        const taskId = state.tasks.find((task) => task.runId === runId)!.id;

        await orchestratorSchedulerTick(new Date('2026-03-16T00:00:00.000Z'));

        const response = await app.inject({
            method: 'GET',
            url: `/v1/orchestrator/runs/${runId}/tasks/${taskId}?includeExecutions=true`,
            headers: { 'x-user-id': 'user-1' },
        });

        expect(response.statusCode).toBe(200);
        expect(response.json().data).toEqual(expect.objectContaining({
            run: expect.objectContaining({
                runId,
                title: sealed('single-task-detail'),
            }),
            task: expect.objectContaining({
                taskId,
                executions: [
                    expect.objectContaining({
                        attempt: 1,
                        status: 'dispatching',
                    }),
                ],
            }),
        }));
        await app.close();
    });

    it('filters run list by controllerSessionId', async () => {
        const app = await createApp();
        state.sessions.push({ id: 'controller-session-2', accountId: 'user-1' });

        const firstSubmit = await app.inject({
            method: 'POST',
            url: '/v1/orchestrator/submit',
            headers: { 'x-user-id': 'user-1' },
            payload: {
                title: sealed('run-from-session-1'),
                controllerSessionId: 'controller-session-1',
                tasks: [
                    {
                        provider: 'claude',
                        prompt: sealed('step a'),
                    },
                ],
            },
        });
        expect(firstSubmit.statusCode).toBe(200);

        const secondSubmit = await app.inject({
            method: 'POST',
            url: '/v1/orchestrator/submit',
            headers: { 'x-user-id': 'user-1' },
            payload: {
                title: sealed('run-from-session-2'),
                controllerSessionId: 'controller-session-2',
                tasks: [
                    {
                        provider: 'codex',
                        prompt: sealed('step b'),
                    },
                ],
            },
        });
        expect(secondSubmit.statusCode).toBe(200);

        const thirdSubmit = await app.inject({
            method: 'POST',
            url: '/v1/orchestrator/submit',
            headers: { 'x-user-id': 'user-1' },
            payload: {
                title: sealed('run-without-session'),
                tasks: [
                    {
                        provider: 'gemini',
                        prompt: sealed('step c'),
                    },
                ],
            },
        });
        expect(thirdSubmit.statusCode).toBe(200);

        const response = await app.inject({
            method: 'GET',
            url: '/v1/orchestrator/runs?controllerSessionId=controller-session-1',
            headers: { 'x-user-id': 'user-1' },
        });

        expect(response.statusCode).toBe(200);
        expect(response.json().data.items).toEqual([
            expect.objectContaining({
                title: sealed('run-from-session-1'),
            }),
        ]);
        await app.close();
    });

    it('marks downstream queued tasks as dependency_failed when dependency task fails', async () => {
        const app = await createApp();
        const submit = await app.inject({
            method: 'POST',
            url: '/v1/orchestrator/submit',
            headers: { 'x-user-id': 'user-1' },
            payload: {
                title: sealed('dependency-failed-propagation'),
                tasks: [
                    {
                        taskKey: 'task-a',
                        provider: 'claude',
                        prompt: sealed('do task a'),
                    },
                    {
                        taskKey: 'task-b',
                        provider: 'codex',
                        prompt: sealed('do task b'),
                        dependsOn: ['task-a'],
                    },
                ],
            },
        });
        expect(submit.statusCode).toBe(200);
        const runId = submit.json().data.runId as string;

        await orchestratorSchedulerTick(new Date('2026-03-16T00:00:00.000Z'));
        expect(state.executions).toHaveLength(1);
        const execution = state.executions[0];

        const finish = await app.inject({
            method: 'POST',
            url: `/v1/orchestrator/executions/${execution.id}/finish`,
            headers: { 'x-user-id': 'user-1' },
            payload: {
                dispatchToken: execution.dispatchToken,
                status: 'failed',
                errorCode: 'UPSTREAM_FAIL',
                errorMessage: 'task a failed',
            },
        });
        expect(finish.statusCode).toBe(200);

        await orchestratorSchedulerTick(new Date('2026-03-16T00:00:05.000Z'));

        const downstreamTask = state.tasks.find((task) => task.taskKey === 'task-b');
        expect(downstreamTask?.status).toBe('dependency_failed');
        expect(downstreamTask?.errorCode).toBe('DEPENDENCY_FAILED');

        const runGet = await app.inject({
            method: 'GET',
            url: `/v1/orchestrator/runs/${runId}`,
            headers: { 'x-user-id': 'user-1' },
        });
        expect(runGet.statusCode).toBe(200);
        expect(runGet.json().data.status).toBe('failed');
        await app.close();
    });

    it('retries failed task with fixed backoff until max attempts', async () => {
        const app = await createApp();
        const submit = await app.inject({
            method: 'POST',
            url: '/v1/orchestrator/submit',
            headers: { 'x-user-id': 'user-1' },
            payload: {
                title: sealed('retry-fixed-backoff'),
                tasks: [
                    {
                        taskKey: 'task-a',
                        provider: 'codex',
                        prompt: sealed('retry me'),
                        retry: {
                            maxAttempts: 3,
                            backoffMs: 5000,
                        },
                    },
                ],
            },
        });
        expect(submit.statusCode).toBe(200);
        const runId = submit.json().data.runId as string;

        await orchestratorSchedulerTick(new Date('2026-03-16T00:00:00.000Z'));
        expect(state.executions).toHaveLength(1);
        expect(state.executions[0].attempt).toBe(1);

        let finish = await app.inject({
            method: 'POST',
            url: `/v1/orchestrator/executions/${state.executions[0].id}/finish`,
            headers: { 'x-user-id': 'user-1' },
            payload: {
                dispatchToken: state.executions[0].dispatchToken,
                status: 'failed',
                finishedAt: '2026-03-16T00:00:00.000Z',
                errorCode: 'ATTEMPT_1_FAILED',
            },
        });
        expect(finish.statusCode).toBe(200);
        expect(state.tasks[0].status).toBe('queued');
        expect(state.tasks[0].nextAttemptAt?.toISOString()).toBe('2026-03-16T00:00:05.000Z');

        await orchestratorSchedulerTick(new Date('2026-03-16T00:00:03.000Z'));
        expect(state.executions).toHaveLength(1);

        await orchestratorSchedulerTick(new Date('2026-03-16T00:00:05.000Z'));
        expect(state.executions).toHaveLength(2);
        expect(state.executions[1].attempt).toBe(2);

        finish = await app.inject({
            method: 'POST',
            url: `/v1/orchestrator/executions/${state.executions[1].id}/finish`,
            headers: { 'x-user-id': 'user-1' },
            payload: {
                dispatchToken: state.executions[1].dispatchToken,
                status: 'failed',
                finishedAt: '2026-03-16T00:00:05.000Z',
                errorCode: 'ATTEMPT_2_FAILED',
            },
        });
        expect(finish.statusCode).toBe(200);
        expect(state.tasks[0].status).toBe('queued');
        expect(state.tasks[0].nextAttemptAt?.toISOString()).toBe('2026-03-16T00:00:10.000Z');

        await orchestratorSchedulerTick(new Date('2026-03-16T00:00:09.000Z'));
        expect(state.executions).toHaveLength(2);

        await orchestratorSchedulerTick(new Date('2026-03-16T00:00:10.000Z'));
        expect(state.executions).toHaveLength(3);
        expect(state.executions[2].attempt).toBe(3);

        finish = await app.inject({
            method: 'POST',
            url: `/v1/orchestrator/executions/${state.executions[2].id}/finish`,
            headers: { 'x-user-id': 'user-1' },
            payload: {
                dispatchToken: state.executions[2].dispatchToken,
                status: 'failed',
                finishedAt: '2026-03-16T00:00:10.000Z',
                errorCode: 'ATTEMPT_3_FAILED',
            },
        });
        expect(finish.statusCode).toBe(200);
        expect(state.tasks[0].status).toBe('failed');
        expect(state.tasks[0].nextAttemptAt).toBeNull();

        const runGet = await app.inject({
            method: 'GET',
            url: `/v1/orchestrator/runs/${runId}`,
            headers: { 'x-user-id': 'user-1' },
        });
        expect(runGet.statusCode).toBe(200);
        expect(runGet.json().data.status).toBe('failed');
        await app.close();
    });

    it('does not mark downstream dependency_failed while upstream is queued for retry', async () => {
        const app = await createApp();
        const submit = await app.inject({
            method: 'POST',
            url: '/v1/orchestrator/submit',
            headers: { 'x-user-id': 'user-1' },
            payload: {
                title: sealed('retry-dag-linkage'),
                tasks: [
                    {
                        taskKey: 'task-a',
                        provider: 'claude',
                        prompt: sealed('task a'),
                        retry: {
                            maxAttempts: 2,
                            backoffMs: 5000,
                        },
                    },
                    {
                        taskKey: 'task-b',
                        provider: 'codex',
                        prompt: sealed('task b'),
                        dependsOn: ['task-a'],
                    },
                ],
            },
        });
        expect(submit.statusCode).toBe(200);

        await orchestratorSchedulerTick(new Date('2026-03-16T00:00:00.000Z'));
        expect(state.executions).toHaveLength(1);

        const firstFail = await app.inject({
            method: 'POST',
            url: `/v1/orchestrator/executions/${state.executions[0].id}/finish`,
            headers: { 'x-user-id': 'user-1' },
            payload: {
                dispatchToken: state.executions[0].dispatchToken,
                status: 'failed',
                finishedAt: '2026-03-16T00:00:00.000Z',
            },
        });
        expect(firstFail.statusCode).toBe(200);
        expect(state.tasks.find((task) => task.taskKey === 'task-a')?.status).toBe('queued');

        await orchestratorSchedulerTick(new Date('2026-03-16T00:00:01.000Z'));
        expect(state.tasks.find((task) => task.taskKey === 'task-b')?.status).toBe('queued');

        await orchestratorSchedulerTick(new Date('2026-03-16T00:00:05.000Z'));
        expect(state.executions).toHaveLength(2);

        const secondFail = await app.inject({
            method: 'POST',
            url: `/v1/orchestrator/executions/${state.executions[1].id}/finish`,
            headers: { 'x-user-id': 'user-1' },
            payload: {
                dispatchToken: state.executions[1].dispatchToken,
                status: 'failed',
                finishedAt: '2026-03-16T00:00:05.000Z',
            },
        });
        expect(secondFail.statusCode).toBe(200);

        await orchestratorSchedulerTick(new Date('2026-03-16T00:00:06.000Z'));
        expect(state.tasks.find((task) => task.taskKey === 'task-b')?.status).toBe('dependency_failed');
        await app.close();
    });

    it('dispatches task to explicit target machine_id', async () => {
        state.machines.push({
            id: 'machine-2',
            accountId: 'user-1',
            active: true,
            lastActiveAt: new Date('2026-03-16T00:00:02.000Z'),
        });

        const app = await createApp();
        const submit = await app.inject({
            method: 'POST',
            url: '/v1/orchestrator/submit',
            headers: { 'x-user-id': 'user-1' },
            payload: {
                title: sealed('target-machine'),
                tasks: [
                    {
                        provider: 'gemini',
                        prompt: sealed('run on machine 2'),
                        target: {
                            type: 'machine_id',
                            machineId: 'machine-2',
                        },
                    },
                ],
            },
        });
        expect(submit.statusCode).toBe(200);

        await orchestratorSchedulerTick(new Date('2026-03-16T00:00:00.000Z'));
        expect(invokeUserRpcMock).toHaveBeenCalledWith(
            'user-1',
            'machine-2:orchestrator-sealed-dispatch',
            expect.objectContaining({
                provider: 'gemini',
                prompt: sealed('run on machine 2'),
            }),
            expect.any(Number),
        );
        expect(state.executions).toHaveLength(1);
        expect(state.executions[0].machineId).toBe('machine-2');
        await app.close();
    });

    it('resolves current_machine target via controllerMachineId', async () => {
        state.machines.push({
            id: 'machine-2',
            accountId: 'user-1',
            active: true,
            lastActiveAt: new Date('2026-03-16T00:00:02.000Z'),
        });
        state.onlineMachineIds.add('machine-2');
        state.dispatchReadyMachineIds.add('machine-2');
        state.sessions.push({ id: 'session-on-m2', accountId: 'user-1' });

        const app = await createApp();
        const submit = await app.inject({
            method: 'POST',
            url: '/v1/orchestrator/submit',
            headers: { 'x-user-id': 'user-1' },
            payload: {
                title: sealed('current-machine-resolve'),
                controllerSessionId: 'session-on-m2',
                controllerMachineId: 'machine-2',
                tasks: [
                    {
                        provider: 'codex',
                        prompt: sealed('run on current machine'),
                        target: { type: 'current_machine' },
                    },
                ],
            },
        });
        expect(submit.statusCode).toBe(200);

        await orchestratorSchedulerTick(new Date('2026-03-16T00:00:03.000Z'));
        expect(invokeUserRpcMock).toHaveBeenCalledWith(
            'user-1',
            'machine-2:orchestrator-sealed-dispatch',
            expect.objectContaining({
                provider: 'codex',
                prompt: sealed('run on current machine'),
            }),
            expect.any(Number),
        );
        expect(state.executions).toHaveLength(1);
        expect(state.executions[0].machineId).toBe('machine-2');
        const task = state.tasks.find((t) => t.prompt === sealed('run on current machine'));
        expect(task?.targetMachineId).toBe('machine-2');
        await app.close();
    });

    it('keeps core API strict and rejects target type "machine" alias', async () => {
        state.machines.push({
            id: 'machine-2',
            accountId: 'user-1',
            active: true,
            lastActiveAt: new Date('2026-03-16T00:00:02.000Z'),
        });

        const app = await createApp();
        const submit = await app.inject({
            method: 'POST',
            url: '/v1/orchestrator/submit',
            headers: { 'x-user-id': 'user-1' },
            payload: {
                title: sealed('target-machine-alias'),
                tasks: [
                    {
                        provider: 'codex',
                        prompt: sealed('run on machine 2 by alias'),
                        target: {
                            type: 'machine',
                            machineId: 'machine-2',
                        },
                    },
                ],
            },
        });
        expect(submit.statusCode).toBe(400);
        await app.close();
    });

    it('dispatches dependent task only after upstream dependency completed', async () => {
        const app = await createApp();
        const submit = await app.inject({
            method: 'POST',
            url: '/v1/orchestrator/submit',
            headers: { 'x-user-id': 'user-1' },
            payload: {
                title: sealed('dag-sequence'),
                tasks: [
                    {
                        taskKey: 'task-a',
                        provider: 'claude',
                        prompt: sealed('step a'),
                    },
                    {
                        taskKey: 'task-b',
                        provider: 'codex',
                        prompt: sealed('step b'),
                        dependsOn: ['task-a'],
                    },
                ],
            },
        });
        expect(submit.statusCode).toBe(200);

        await orchestratorSchedulerTick(new Date('2026-03-16T00:00:00.000Z'));
        expect(state.executions).toHaveLength(1);
        expect(state.executions[0].provider).toBe('claude');

        const finishUpstream = await app.inject({
            method: 'POST',
            url: `/v1/orchestrator/executions/${state.executions[0].id}/finish`,
            headers: { 'x-user-id': 'user-1' },
            payload: {
                dispatchToken: state.executions[0].dispatchToken,
                status: 'completed',
                finishedAt: '2026-03-16T00:00:01.000Z',
            },
        });
        expect(finishUpstream.statusCode).toBe(200);

        await orchestratorSchedulerTick(new Date('2026-03-16T00:00:02.000Z'));
        expect(state.executions).toHaveLength(2);
        expect(state.executions[1].provider).toBe('codex');
        await app.close();
    });

    describe('callback ledger', () => {
        const headers = { 'x-user-id': 'user-1' };
        const pull = async (app: Fastify, sessionId: string, predecessorSessionId?: string) => (await app.inject({
            method: 'POST',
            url: `/v1/orchestrator/sessions/${sessionId}/callbacks`,
            headers,
            payload: predecessorSessionId ? { predecessorSessionId } : {},
        })).json().data.callbacks;
        const ack = (app: Fastify, sessionId: string, runId: string, knownAt: string, userId = 'user-1') => app.inject({
            method: 'POST',
            url: `/v1/orchestrator/sessions/${sessionId}/callbacks/ack`,
            headers: { 'x-user-id': userId },
            payload: { runs: [{ runId, knownAt }] },
        });
        const terminalNotices = () => eventRouterMock.emitEphemeral.mock.calls
            .map(([event]) => event)
            .filter((event: any) => event.payload.type === 'orchestrator-run-terminal')
            .map((event: any) => event.recipientFilter.sessionId);
        const finishLatestExecution = async (app: Fastify, runId: string) => {
            await orchestratorSchedulerTick(new Date(state.nowMs));
            const execution = state.executions.filter((item) => item.runId === runId).at(-1)!;
            await app.inject({
                method: 'POST',
                url: `/v1/orchestrator/executions/${execution.id}/finish`,
                headers,
                payload: { dispatchToken: execution.dispatchToken, status: 'completed', childSessionId: 'child-session-1' },
            });
        };
        const runToEnd = async (app: Fastify) => {
            const submit = await app.inject({
                method: 'POST',
                url: '/v1/orchestrator/submit',
                headers,
                payload: {
                    title: sealed('ledger-run'),
                    controllerSessionId: 'controller-session-1',
                    tasks: [{ provider: 'codex', prompt: sealed('work') }],
                },
            });
            const runId = submit.json().data.runId as string;
            await finishLatestExecution(app, runId);
            return runId;
        };

        it('owes the session a callback for a run that ends, until its CLI acks it', async () => {
            const app = await createApp();
            const runId = await runToEnd(app);
            const endedAt = state.runs[0].updatedAt.toISOString();
            expect(state.callbacks).toEqual([{ runId, sessionId: 'controller-session-1', endedAt: state.runs[0].updatedAt }]);
            expect(terminalNotices()).toEqual(['controller-session-1']);

            expect(await pull(app, 'controller-session-1')).toEqual([{ runId, title: sealed('ledger-run'), status: 'completed', endedAt }]);
            expect(await pull(app, 'controller-session-1')).toHaveLength(1);
            // Knowing the run as of before it ended, or acking for another account, settles nothing
            await ack(app, 'controller-session-1', runId, new Date(Date.parse(endedAt) - 1).toISOString());
            await ack(app, 'controller-session-1', runId, endedAt, 'user-2');
            expect(await pull(app, 'controller-session-1')).toHaveLength(1);

            await ack(app, 'controller-session-1', runId, endedAt);
            expect(await pull(app, 'controller-session-1')).toEqual([]);
            expect((await ack(app, 'controller-session-1', runId, endedAt)).statusCode).toBe(200);
            await app.close();
        });

        it('holds back a reopened run until it ends again, then owes it once', async () => {
            const app = await createApp();
            const runId = await runToEnd(app);
            const firstEndedAt = state.runs[0].updatedAt.toISOString();

            await app.inject({
                method: 'POST',
                url: `/v1/orchestrator/tasks/${state.tasks[0].id}/send-message`,
                headers,
                payload: { message: sealed('follow up'), controllerSessionId: 'controller-session-1' },
            });
            expect(state.runs[0].status).toBe('running');
            expect(await pull(app, 'controller-session-1')).toEqual([]);

            await finishLatestExecution(app, runId);
            const secondEndedAt = state.runs[0].updatedAt.toISOString();
            expect(await pull(app, 'controller-session-1')).toEqual([expect.objectContaining({ runId, endedAt: secondEndedAt })]);
            await ack(app, 'controller-session-1', runId, firstEndedAt);
            expect(await pull(app, 'controller-session-1')).toHaveLength(1);
            await app.close();
        });

        it('lets a session continuing an offline one take its callbacks, but not an online one', async () => {
            const app = await createApp();
            state.sessions.push({ id: 'controller-session-2', accountId: 'user-1' });
            const runId = await runToEnd(app);

            state.sessionConnections = [{ sessionId: 'controller-session-1', supportsCallbackLedger: true }];
            expect(await pull(app, 'controller-session-2', 'controller-session-1')).toEqual([]);
            expect(state.sessions[1].predecessorSessionId).toBe('controller-session-1');

            state.sessionConnections = [];
            const callbacks = await pull(app, 'controller-session-2');
            expect(callbacks).toEqual([expect.objectContaining({ runId })]);
            await ack(app, 'controller-session-2', runId, callbacks[0].endedAt);
            expect(state.callbacks).toEqual([]);
            await app.close();
        });

        it('prompts the sessions continuing an offline one when its run ends', async () => {
            const app = await createApp();
            state.sessions.push(
                { id: 'controller-session-2', accountId: 'user-1', predecessorSessionId: 'controller-session-1' },
                { id: 'controller-session-3', accountId: 'user-1', predecessorSessionId: 'controller-session-2' },
            );
            state.sessionConnections = [{ sessionId: 'controller-session-3', supportsCallbackLedger: true }];
            await runToEnd(app);
            expect(terminalNotices()).toEqual(['controller-session-1', 'controller-session-2', 'controller-session-3']);

            // An online session in the chain takes them itself
            eventRouterMock.emitEphemeral.mockClear();
            state.sessionConnections = [{ sessionId: 'controller-session-2', supportsCallbackLedger: true }];
            await runToEnd(app);
            expect(terminalNotices()).toEqual(['controller-session-1', 'controller-session-2']);
            await app.close();
        });

        it('settles the callback of a CLI older than the ledger, which takes it from the notice', async () => {
            const app = await createApp();
            state.sessionConnections = [{ sessionId: 'controller-session-1', supportsCallbackLedger: false }];
            await runToEnd(app);
            expect(terminalNotices()).toEqual(['controller-session-1']);
            expect(state.callbacks).toEqual([]);
            await app.close();
        });

        const submitRun = async (app: Fastify) => (await app.inject({
            method: 'POST',
            url: '/v1/orchestrator/submit',
            headers,
            payload: {
                title: sealed('ledger-run'),
                controllerSessionId: 'controller-session-1',
                tasks: [{ provider: 'codex', prompt: sealed('work') }],
            },
        })).json().data.runId as string;
        const cancel = async (app: Fastify, runId: string, payload: Record<string, string> = {}) => (await app.inject({
            method: 'POST',
            url: `/v1/orchestrator/runs/${runId}/cancel`,
            headers,
            payload,
        })).json().data;

        it('owes and announces a run a cancel from the app ends', async () => {
            const app = await createApp();
            const runId = await submitRun(app);

            expect(await cancel(app, runId)).toEqual({ runId, status: 'cancelled', accepted: true });
            expect(state.callbacks).toEqual([{ runId, sessionId: 'controller-session-1', endedAt: state.runs[0].updatedAt }]);
            await vi.waitFor(() => expect(terminalNotices()).toEqual(['controller-session-1']));

            // Cancelling it again ends nothing
            await cancel(app, runId);
            await ack(app, 'controller-session-1', runId, state.runs[0].updatedAt.toISOString());
            expect(state.callbacks).toEqual([]);
            expect(terminalNotices()).toEqual(['controller-session-1']);
            await app.close();
        });

        it('owes no callback to the session whose agent cancelled the run, until a follow-up reopens it', async () => {
            const app = await createApp();
            const runId = await submitRun(app);
            await orchestratorSchedulerTick(new Date(state.nowMs));

            expect((await cancel(app, runId, { controllerSessionId: 'controller-session-1' })).status).toBe('canceling');
            await finishLatestExecution(app, runId);
            expect(['completed', 'cancelled']).toContain(state.runs[0].status);
            expect(state.callbacks).toEqual([]);
            expect(terminalNotices()).toEqual([]);

            await app.inject({
                method: 'POST',
                url: `/v1/orchestrator/tasks/${state.tasks[0].id}/send-message`,
                headers,
                payload: { message: sealed('follow up'), controllerSessionId: 'controller-session-1' },
            });
            expect(state.runs[0].cancelledBySessionId).toBeNull();
            await finishLatestExecution(app, runId);
            expect(state.callbacks).toEqual([expect.objectContaining({ runId, sessionId: 'controller-session-1' })]);
            await app.close();
        });
    });

    describe('shell tasks', () => {
        const terminalCallbacks = () => eventRouterMock.emitEphemeral.mock.calls
            .map(([event]) => event)
            .filter((event: any) => event.payload.type === 'orchestrator-run-terminal');

        it('exec runs a command on every shell-ready machine and records stdout and stderr', async () => {
            state.machines.push({
                id: 'machine-2',
                accountId: 'user-1',
                active: true,
                lastActiveAt: new Date('2026-03-16T00:00:00.000Z'),
            });
            state.shellReadyMachineIds = new Set(['machine-1', 'machine-2']);
            const app = await createApp();

            const exec = await app.inject({
                method: 'POST',
                url: '/v1/orchestrator/exec',
                headers: { 'x-user-id': 'user-1' },
                payload: {
                    prompt: sealed('uptime\necho done'),
                    title: sealed('$ uptime'),
                    machineIds: 'all_online',
                    controllerSessionId: 'controller-session-1',
                    waitMs: 0,
                },
            });
            expect(exec.statusCode).toBe(200);
            const data = exec.json().data;
            expect(data.terminal).toBe(false);
            expect(data.next).toEqual({ hint: 'Await <orchestrator-callback>.', runId: data.runId });
            expect(data.tasks.map((task: any) => task.machineId)).toEqual(['machine-1', 'machine-2']);
            expect(state.runs[0]).toEqual(expect.objectContaining({ title: sealed('$ uptime'), maxConcurrency: 2 }));
            expect(state.tasks.map((task) => [task.provider, task.prompt, task.model])).toEqual([
                ['shell', sealed('uptime\necho done'), null],
                ['shell', sealed('uptime\necho done'), null],
            ]);

            await orchestratorSchedulerTick(new Date('2026-03-16T00:00:00.000Z'));
            expect(invokeUserRpcMock).toHaveBeenCalledWith(
                'user-1',
                'machine-1:orchestrator-sealed-shell-dispatch',
                expect.objectContaining({ provider: 'shell', prompt: sealed('uptime\necho done'), timeoutMs: null }),
                expect.any(Number),
            );

            for (const [index, execution] of state.executions.entries()) {
                const finish = await app.inject({
                    method: 'POST',
                    url: `/v1/orchestrator/executions/${execution.id}/finish`,
                    headers: { 'x-user-id': 'user-1' },
                    payload: {
                        dispatchToken: execution.dispatchToken,
                        status: index === 0 ? 'completed' : 'failed',
                        exitCode: index,
                        sealedResult: sealed(`result-${index}`),
                        errorCode: index === 0 ? null : 'EXIT_CODE',
                    },
                });
                expect(finish.statusCode).toBe(200);
            }
            expect(state.tasks.map((task) => [task.sealedResult, task.outputText, task.errorCode])).toEqual([
                [sealed('result-0'), null, null],
                [sealed('result-1'), null, 'EXIT_CODE'],
            ]);
            expect(state.runs[0].status).toBe('failed');
            expect(terminalCallbacks()).toHaveLength(1);

            const run = await app.inject({
                method: 'GET',
                url: `/v1/orchestrator/runs/${data.runId}?includeExecutions=true`,
                headers: { 'x-user-id': 'user-1' },
            });
            expect(run.json().data.tasks[1]).toEqual(expect.objectContaining({
                provider: 'shell',
                sealedResult: sealed('result-1'),
                executions: [expect.objectContaining({ exitCode: 1, sealedResult: sealed('result-1') })],
            }));
            await app.close();
        });

        it('exec returns the output itself when the run finishes while it waits, without a callback', async () => {
            const app = await createApp();
            const pending = app.inject({
                method: 'POST',
                url: '/v1/orchestrator/exec',
                headers: { 'x-user-id': 'user-1' },
                payload: {
                    prompt: sealed('hostname'),
                    title: sealed('$ hostname'),
                    machineIds: ['machine-1'],
                    controllerSessionId: 'controller-session-1',
                    waitMs: 10_000,
                },
            });
            await vi.waitFor(() => expect(state.runs).toHaveLength(1));
            await orchestratorSchedulerTick(new Date('2026-03-16T00:00:00.000Z'));
            const execution = state.executions[0];
            await app.inject({
                method: 'POST',
                url: `/v1/orchestrator/executions/${execution.id}/finish`,
                headers: { 'x-user-id': 'user-1' },
                payload: {
                    dispatchToken: execution.dispatchToken,
                    status: 'completed',
                    exitCode: 0,
                    sealedResult: sealed('host-1'),
                },
            });

            const exec = await pending;
            expect(exec.statusCode).toBe(200);
            const data = exec.json().data;
            expect(data.terminal).toBe(true);
            expect(data.next).toBeUndefined();
            expect(data.tasks).toEqual([expect.objectContaining({
                machineId: 'machine-1',
                status: 'completed',
                exitCode: 0,
                sealedResult: sealed('host-1'),
            })]);
            expect(terminalCallbacks()).toHaveLength(0);
            // Owed until the CLI acks what the result showed, in case the agent never got it
            expect(state.callbacks).toEqual([expect.objectContaining({
                sessionId: 'controller-session-1',
                endedAt: new Date(data.run.updatedAt),
            })]);
            await app.close();
        });

        it('exec gets no callback when the run finishes during a scheduler tick that read it as running', async () => {
            const app = await createApp();
            const pending = app.inject({
                method: 'POST',
                url: '/v1/orchestrator/exec',
                headers: { 'x-user-id': 'user-1' },
                payload: {
                    prompt: sealed('hostname'),
                    title: sealed('$ hostname'),
                    machineIds: ['machine-1'],
                    controllerSessionId: 'controller-session-1',
                    waitMs: 10_000,
                },
            });
            await vi.waitFor(() => expect(state.runs).toHaveLength(1));
            await orchestratorSchedulerTick(new Date('2026-03-16T00:00:00.000Z'));
            const execution = state.executions[0];

            // The daemon's finish commits after the tick's transaction has read the run as running
            const findRun = dbMock.orchestratorRun.findUnique.getMockImplementation()!;
            let raced = false;
            dbMock.orchestratorRun.findUnique.mockImplementation(async (args: any) => {
                const row = await findRun(args);
                if (!raced && args?.select?.maxConcurrency) {
                    raced = true;
                    await app.inject({
                        method: 'POST',
                        url: `/v1/orchestrator/executions/${execution.id}/finish`,
                        headers: { 'x-user-id': 'user-1' },
                        payload: {
                            dispatchToken: execution.dispatchToken,
                            status: 'completed',
                            exitCode: 0,
                            sealedResult: sealed('host-1'),
                        },
                    });
                }
                return row;
            });
            try {
                await orchestratorSchedulerTick(new Date('2026-03-16T00:00:01.000Z'));
            } finally {
                dbMock.orchestratorRun.findUnique.mockImplementation(findRun);
            }
            expect(raced).toBe(true);

            const exec = await pending;
            expect(exec.json().data.terminal).toBe(true);
            expect(state.runs[0].status).toBe('completed');
            expect(terminalCallbacks()).toHaveLength(0);
            await app.close();
        });

        it('pend returns shell tasks the way exec does, with the sealed result in place of the output', async () => {
            const app = await createApp();
            const exec = await app.inject({
                method: 'POST',
                url: '/v1/orchestrator/exec',
                headers: { 'x-user-id': 'user-1' },
                payload: { prompt: sealed('cat big.log'), title: sealed('$ cat big.log'), machineIds: ['machine-1'], waitMs: 0 },
            });
            const runId = exec.json().data.runId;
            await orchestratorSchedulerTick(new Date('2026-03-16T00:00:00.000Z'));
            const execution = state.executions[0];
            const finish = await app.inject({
                method: 'POST',
                url: `/v1/orchestrator/executions/${execution.id}/finish`,
                headers: { 'x-user-id': 'user-1' },
                payload: {
                    dispatchToken: execution.dispatchToken,
                    status: 'completed',
                    exitCode: 0,
                    sealedResult: sealed('last part'),
                },
            });
            expect(finish.statusCode).toBe(200);
            expect(state.executions[0]).toEqual(expect.objectContaining({ sealedResult: sealed('last part'), outputText: null }));

            const pend = await app.inject({
                method: 'GET',
                url: `/v1/orchestrator/runs/${runId}/pend?include=all_tasks&timeoutMs=0`,
                headers: { 'x-user-id': 'user-1' },
            });
            expect(pend.json().data.tasks).toEqual([{
                taskId: state.tasks[0].id,
                machineId: 'machine-1',
                status: 'completed',
                exitCode: 0,
                signal: null,
                stdout: null,
                stderr: null,
                stdoutFile: null,
                stderrFile: null,
                sealedResult: sealed('last part'),
                errorCode: null,
                errorMessage: null,
                startedAt: null,
                finishedAt: expect.any(String),
            }]);
            await app.close();
        });

        it('exec rejects unknown machines and having no shell-ready machine', async () => {
            const app = await createApp();
            const unknown = await app.inject({
                method: 'POST',
                url: '/v1/orchestrator/exec',
                headers: { 'x-user-id': 'user-1' },
                payload: { prompt: sealed('ls'), title: sealed('$ ls'), machineIds: ['machine-1', 'machine-x'] },
            });
            expect(unknown.statusCode).toBe(400);
            expect(unknown.json().error.message).toContain('machine-x');

            const plaintext = await app.inject({
                method: 'POST',
                url: '/v1/orchestrator/exec',
                headers: { 'x-user-id': 'user-1' },
                payload: { prompt: 'ls', title: sealed('$ ls'), machineIds: ['machine-1'] },
            });
            expect(plaintext.statusCode).toBe(400);

            state.shellReadyMachineIds = new Set();
            const noneReady = await app.inject({
                method: 'POST',
                url: '/v1/orchestrator/exec',
                headers: { 'x-user-id': 'user-1' },
                payload: { prompt: sealed('ls'), title: sealed('$ ls'), machineIds: 'all_online' },
            });
            expect(noneReady.statusCode).toBe(409);
            expect(state.runs).toHaveLength(0);
            await app.close();
        });

        it('leaves shell tasks to exec, which alone goes past the AI limits, and rejects follow-ups to them', async () => {
            const app = await createApp();
            for (const payload of [
                { title: sealed('ai'), tasks: [{ provider: 'claude', prompt: sealed('x'), timeoutMs: 25 * 60 * 60 * 1000 }] },
                { title: sealed('ai'), maxConcurrency: 16, tasks: [{ provider: 'claude', prompt: sealed('x') }] },
                { title: sealed('shell'), tasks: [{ provider: 'shell', prompt: sealed('ls') }] },
            ]) {
                const submit = await app.inject({
                    method: 'POST',
                    url: '/v1/orchestrator/submit',
                    headers: { 'x-user-id': 'user-1' },
                    payload,
                });
                expect(submit.statusCode).toBe(400);
            }
            expect(state.runs).toHaveLength(0);

            const exec = await app.inject({
                method: 'POST',
                url: '/v1/orchestrator/exec',
                headers: { 'x-user-id': 'user-1' },
                payload: {
                    prompt: sealed('sleep 100000'),
                    title: sealed('$ sleep 100000'),
                    machineIds: ['machine-1'],
                    timeoutMs: 7 * 24 * 60 * 60 * 1000,
                    maxConcurrency: 16,
                    waitMs: 0,
                },
            });
            expect(exec.statusCode).toBe(200);
            expect(state.tasks[0]).toEqual(expect.objectContaining({ model: null, timeoutMs: 7 * 24 * 60 * 60 * 1000 }));

            state.tasks[0].status = 'completed';
            const sendMessage = await app.inject({
                method: 'POST',
                url: `/v1/orchestrator/tasks/${state.tasks[0].id}/send-message`,
                headers: { 'x-user-id': 'user-1' },
                payload: { message: sealed('again') },
            });
            expect(sendMessage.statusCode).toBe(400);
            expect(sendMessage.json().error.code).toBe('INVALID_ARGUMENT');
            await app.close();
        });

        it('reconcile fails the executions a restarted daemon lost, and only those', async () => {
            const app = await createApp();
            for (const command of ['job-a', 'job-b', 'job-c']) {
                const exec = await app.inject({
                    method: 'POST',
                    url: '/v1/orchestrator/exec',
                    headers: { 'x-user-id': 'user-1' },
                    payload: { prompt: sealed(command), title: sealed(`$ ${command}`), machineIds: ['machine-1'], controllerSessionId: 'controller-session-1', waitMs: 0 },
                });
                expect(exec.statusCode).toBe(200);
            }
            await orchestratorSchedulerTick(new Date('2026-03-16T00:00:00.000Z'));
            const startedAts = ['2026-03-16T00:00:01.000Z', '2026-03-16T00:00:02.000Z', '2026-03-16T00:10:00.000Z'];
            for (const [index, execution] of state.executions.entries()) {
                await app.inject({
                    method: 'POST',
                    url: `/v1/orchestrator/executions/${execution.id}/start`,
                    headers: { 'x-user-id': 'user-1' },
                    payload: { dispatchToken: execution.dispatchToken, startedAt: startedAts[index] },
                });
            }
            expect(state.executions.map((execution) => execution.status)).toEqual(['running', 'running', 'running']);

            // job-a: lost with the old daemon; job-b: still running under it; job-c: started by the new one
            const reconcile = () => app.inject({
                method: 'POST',
                url: '/v1/orchestrator/machines/machine-1/reconcile',
                headers: { 'x-user-id': 'user-1' },
                payload: {
                    liveExecutionIds: [state.executions[1].id],
                    daemonStartedAt: '2026-03-16T00:05:00.000Z',
                },
            });
            expect((await reconcile()).statusCode).toBe(200);
            expect(state.executions.map((execution) => [execution.status, execution.errorCode])).toEqual([
                ['failed', 'EXECUTION_LOST'],
                ['running', null],
                ['running', null],
            ]);
            expect(state.runs.map((run) => run.status)).toEqual(['failed', 'running', 'running']);
            expect(terminalCallbacks()).toHaveLength(1);

            expect((await reconcile()).statusCode).toBe(200);
            expect(terminalCallbacks()).toHaveLength(1);

            for (const execution of state.executions.slice(1)) {
                await app.inject({
                    method: 'POST',
                    url: `/v1/orchestrator/executions/${execution.id}/finish`,
                    headers: { 'x-user-id': 'user-1' },
                    payload: { dispatchToken: execution.dispatchToken, status: 'completed', exitCode: 0 },
                });
            }
            expect(state.runs.map((run) => run.status)).toEqual(['failed', 'completed', 'completed']);
            expect(terminalCallbacks()).toHaveLength(3);
            await app.close();
        });

        it('reconcile ignores executions of other accounts and other machines', async () => {
            state.machines.push({
                id: 'machine-2',
                accountId: 'user-1',
                active: true,
                lastActiveAt: new Date('2026-03-16T00:00:00.000Z'),
            });
            const app = await createApp();
            await app.inject({
                method: 'POST',
                url: '/v1/orchestrator/exec',
                headers: { 'x-user-id': 'user-1' },
                payload: { prompt: sealed('job'), title: sealed('$ job'), machineIds: ['machine-2'], waitMs: 0 },
            });
            await orchestratorSchedulerTick(new Date('2026-03-16T00:00:00.000Z'));
            const execution = state.executions[0];
            await app.inject({
                method: 'POST',
                url: `/v1/orchestrator/executions/${execution.id}/start`,
                headers: { 'x-user-id': 'user-1' },
                payload: { dispatchToken: execution.dispatchToken, startedAt: '2026-03-16T00:00:01.000Z' },
            });

            for (const [userId, machineId] of [['user-1', 'machine-1'], ['user-2', 'machine-2']]) {
                const reconcile = await app.inject({
                    method: 'POST',
                    url: `/v1/orchestrator/machines/${machineId}/reconcile`,
                    headers: { 'x-user-id': userId },
                    payload: { liveExecutionIds: [], daemonStartedAt: '2026-03-16T00:05:00.000Z' },
                });
                expect(reconcile.statusCode).toBe(200);
            }
            expect(execution.status).toBe('running');
            await app.close();
        });
    });
});
