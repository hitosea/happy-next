import { type Fastify } from "../types";
import { db } from "@/storage/db";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { delay } from "@/utils/delay";
import { warn } from "@/utils/log";
import { eventRouter } from "@/app/events/eventRouter";
import { listConnectedUserRpcMethods, invokeUserRpc, hasUserRpcMethod } from "@/app/api/socket/rpcRegistry";
import { randomUUID } from "node:crypto";
import {
    MODEL_MODE_DEFAULT,
    getValidModelModesForAgent,
    isModelMode,
    isModelModeForAgent,
    splitFastModeSuffix,
} from "happy-wire";
import {
    addTaskCount,
    buildPendCursor,
    createEmptySummaryInternal,
    decodeListCursor,
    deriveRunStatus,
    encodeListCursor,
    isExecutionTerminal,
    isRunTerminal,
    type RunSummary,
    toPublicSummary,
} from "@/app/orchestrator/state";
import {
    countOrchestratorSessionRuns,
    emitOrchestratorRunActivity,
    queryOrchestratorActivityBatch,
    queryOrchestratorSessionActivity,
    runsOfSessionWhere,
} from "@/app/orchestrator/sessions";
import { awaitOrchestratorRunTerminal, notifyOrchestratorRunTerminal } from "@/app/orchestrator/terminal";
import { orchestratorMachineReconcile } from "@/app/orchestrator/reconcile";
import { orchestratorCallbacksAck, orchestratorCallbacksPull, orchestratorRunCallbacksRecordTx } from "@/app/orchestrator/callbacks";

const PROVIDERS = ['claude', 'codex', 'gemini', 'qoder'] as const;
const RUN_STATUSES = ['queued', 'running', 'canceling', 'completed', 'failed', 'cancelled'] as const;
const EXECUTION_FINAL_STATUSES = ['completed', 'failed', 'cancelled', 'timeout'] as const;
const LIST_RUN_STATUS_FILTERS = ['active', 'terminal', ...RUN_STATUSES] as const;
// A run holds AI agents (submit), shell commands (exec) or file transfers (transfer), never a mix
const LIST_RUN_KIND_FILTERS = ['agent', 'shell', 'transfer'] as const;
const IDEMPOTENCY_RETRY_TIMES = 2;
const CLI_DETECTION_TIMEOUT_MS = 20_000;
const IDEMPOTENCY_RETRY_DELAY_MS = 10;
const DEFAULT_CONTEXT_MAX_CONCURRENCY = 2;
const DEFAULT_CONTEXT_WAIT_TIMEOUT_MS = 120_000;
const DEFAULT_CONTEXT_POLL_INTERVAL_MS = 30_000;
const DEFAULT_CONTEXT_RETRY_MAX_ATTEMPTS = 1;
const DEFAULT_CONTEXT_RETRY_BACKOFF_MS = 0;
const PEND_POLL_INTERVAL_MS = 3000;
// The largest delay a timer takes (and what the Int column holds): the longest timeout of an exec command
const SHELL_TASK_MAX_TIMEOUT_MS = 2 ** 31 - 1;
const SHELL_RUN_MAX_CONCURRENCY = 32;
const RUN_MAX_TASKS = 32;
const EXEC_DEFAULT_WAIT_MS = 30_000;
// Below the 60s an MCP client waits for a tool call, so the caller is still there for the result
const EXEC_MAX_WAIT_MS = 50_000;
const SHELL_DISPATCH_METHOD_SUFFIX = ':orchestrator-sealed-shell-dispatch';
// A machine takes files with this method and serves them with the other, both only with remote shell turned on
const TRANSFER_DISPATCH_METHOD_SUFFIX = ':orchestrator-sealed-transfer-dispatch';
const TRANSFER_SOURCE_METHOD = 'orchestrator-sealed-transfer-source';
// How long the source machine has to answer one step of a transfer (opening it, one chunk)
const TRANSFER_SOURCE_RPC_TIMEOUT_MS = 60_000;

// What a client seals with the account's orchestrator key: "e2e1:" and the base64 of the AES-GCM
// bundle. The server only stores these and passes them on, with no key to read or forge them: a
// daemon runs only tasks it can open, and checks they name it.
const SEALED_PATTERN = /^e2e1:[A-Za-z0-9+/]+={0,2}$/;
const SEALED_ERROR = 'must be sealed with the orchestrator key; update the Happy CLI';
// Base64 of the bundle grows a sealed value by a third: a run's title, a task's title
const SEALED_TITLE_MAX_LENGTH = 4096;
// A task: its prompt of up to 64 KiB characters (3 UTF-8 bytes each at most) with its settings
const SEALED_TASK_MAX_LENGTH = 300_000;
// A result: up to 1M characters of stdout and of stderr each, with room for JSON escapes
const SEALED_RESULT_MAX_LENGTH = 20_000_000;

function sealedSchema(maxLength: number) {
    return z.string().max(maxLength).regex(SEALED_PATTERN, SEALED_ERROR);
}

type ProviderName = typeof PROVIDERS[number];

const MACHINE_IDENTITY_TIMEOUT_MS = 5_000;

type MachineIdentity = {
    name?: string;
    /** `os.platform()` of the machine, so a caller knows which shell syntax its commands need */
    platform?: string;
    /** The shell that runs shell tasks there */
    shell?: string;
};

async function fetchMachineIdentities(
    userId: string,
    machineIds: string[],
): Promise<Map<string, MachineIdentity>> {
    const result = new Map<string, MachineIdentity>();
    if (machineIds.length === 0) {
        return result;
    }

    const promises = machineIds.map(async (machineId): Promise<[string, MachineIdentity | null]> => {
        if (!hasUserRpcMethod(userId, `${machineId}:machine-identity`)) {
            return [machineId, null];
        }
        try {
            const response = await invokeUserRpc(
                userId,
                `${machineId}:machine-identity`,
                {},
                MACHINE_IDENTITY_TIMEOUT_MS,
            ) as { name?: unknown; platform?: unknown; shell?: unknown } | null;
            return [machineId, {
                ...(typeof response?.name === 'string' ? { name: response.name } : {}),
                ...(typeof response?.platform === 'string' ? { platform: response.platform } : {}),
                ...(typeof response?.shell === 'string' ? { shell: response.shell } : {}),
            }];
        } catch {
            return [machineId, null];
        }
    });

    const settled = await Promise.allSettled(promises);
    for (const entry of settled) {
        if (entry.status === 'fulfilled' && entry.value[1]) {
            result.set(entry.value[0], entry.value[1]);
        }
    }
    return result;
}

/**
 * The machines that take shell tasks right now: connected, with remote shell turned on. With
 * TRANSFER_DISPATCH_METHOD_SUFFIX, those that also take file transfers (a newer Happy CLI).
 */
function listShellReadyMachineIds(userId: string, methodSuffix: string = SHELL_DISPATCH_METHOD_SUFFIX): string[] {
    return listConnectedUserRpcMethods(userId)
        .filter((method) => method.endsWith(methodSuffix))
        .map((method) => method.slice(0, -methodSuffix.length));
}

type DetectionResult = {
    providers: ProviderName[];
    hostname?: string;
};

/**
 * Ask the given machines which CLI providers they have installed, and their OS hostname, through
 * their daemon's `detect-providers`. Asks in parallel with a timeout; a machine that fails to
 * answer in time has no providers.
 */
async function detectMachineProviders(
    userId: string,
    machineIds: string[],
): Promise<Map<string, DetectionResult>> {
    const result = new Map<string, DetectionResult>();
    if (machineIds.length === 0) {
        return result;
    }

    const detectionPromises = machineIds.map(async (machineId): Promise<[string, DetectionResult]> => {
        if (!hasUserRpcMethod(userId, `${machineId}:detect-providers`)) {
            return [machineId, { providers: [] }];
        }
        try {
            const response = await invokeUserRpc(
                userId,
                `${machineId}:detect-providers`,
                {},
                CLI_DETECTION_TIMEOUT_MS,
            ) as { providers?: unknown; hostname?: unknown } | null;
            const installed = Array.isArray(response?.providers) ? response.providers : [];
            return [machineId, {
                providers: PROVIDERS.filter((provider) => installed.includes(provider)),
                ...(typeof response?.hostname === 'string' && response.hostname ? { hostname: response.hostname } : {}),
            }];
        } catch {
            return [machineId, { providers: [] }];
        }
    });

    const settled = await Promise.allSettled(detectionPromises);
    for (const entry of settled) {
        if (entry.status === 'fulfilled') {
            result.set(entry.value[0], entry.value[1]);
        }
    }

    return result;
}

// A task's title and prompt arrive sealed (see SEALED_PATTERN): the prompt is the task's envelope,
// which also names the machine it runs on, its provider, model and working directory, so the
// daemon goes by those and not by the fields here. The working directory comes sealed on its own
// too, for runs to show without their prompts.
const submitTaskSchema = z.object({
    taskKey: z.string().min(1).max(128).optional(),
    title: sealedSchema(SEALED_TITLE_MAX_LENGTH).optional(),
    workingDirectory: sealedSchema(SEALED_TITLE_MAX_LENGTH).optional(),
    provider: z.enum(PROVIDERS),
    model: z.string().min(1).max(128).optional(),
    prompt: sealedSchema(SEALED_TASK_MAX_LENGTH),
    timeoutMs: z.coerce.number().int().min(1000).max(24 * 60 * 60 * 1000).optional(),
    dependsOn: z.array(z.string().min(1).max(128)).max(RUN_MAX_TASKS - 1).optional(),
    retry: z.object({
        maxAttempts: z.coerce.number().int().min(1).max(10).optional(),
        backoffMs: z.coerce.number().int().min(0).max(24 * 60 * 60 * 1000).optional(),
    }).optional(),
    target: z.object({
        type: z.enum(['current_machine', 'machine_id']),
        machineId: z.string().optional(),
    }).optional(),
}).refine((value) => {
    if (value.target?.type === 'machine_id') {
        return !!value.target.machineId;
    }
    return true;
}, {
    message: 'target.machineId is required when target.type is machine_id',
    path: ['target', 'machineId'],
});

const submitBodySchema = z.object({
    title: sealedSchema(SEALED_TITLE_MAX_LENGTH),
    controllerSessionId: z.string().optional(),
    controllerMachineId: z.string().optional(),
    tasks: z.array(submitTaskSchema).min(1).max(RUN_MAX_TASKS),
    maxConcurrency: z.coerce.number().int().min(1).max(8).optional(),
    mode: z.enum(['blocking', 'async']).optional(),
    waitTimeoutMs: z.coerce.number().int().min(1000).max(60 * 60 * 1000).optional(),
    pollIntervalMs: z.coerce.number().int().min(200).max(60_000).optional(),
    idempotencyKey: z.string().min(1).max(128).optional(),
});

// `prompt` is the sealed envelope every task of the run shares: the command, working directory
// and the machines it may run on ('all' for all_online), which each daemon checks for itself
const execBodySchema = z.object({
    prompt: sealedSchema(SEALED_TASK_MAX_LENGTH),
    title: sealedSchema(SEALED_TITLE_MAX_LENGTH),
    workingDirectory: sealedSchema(SEALED_TITLE_MAX_LENGTH).optional(),
    machineIds: z.union([
        z.array(z.string().min(1).max(128)).min(1).max(RUN_MAX_TASKS),
        z.literal('all_online'),
    ]),
    timeoutMs: z.coerce.number().int().min(1000).max(SHELL_TASK_MAX_TIMEOUT_MS).optional(),
    waitMs: z.coerce.number().int().min(0).max(EXEC_MAX_WAIT_MS).optional(),
    maxConcurrency: z.coerce.number().int().min(1).max(SHELL_RUN_MAX_CONCURRENCY).optional(),
    controllerSessionId: z.string().optional(),
});

// `prompt` is the sealed envelope every task of the run shares: the source machine and path, the
// target path and overwrite, and the target machines ('all' for all_online)
const transferBodySchema = z.object({
    prompt: sealedSchema(SEALED_TASK_MAX_LENGTH),
    title: sealedSchema(SEALED_TITLE_MAX_LENGTH),
    fromMachineId: z.string().min(1).max(128),
    toMachineIds: z.union([
        z.array(z.string().min(1).max(128)).min(1).max(RUN_MAX_TASKS),
        z.literal('all_online'),
    ]),
    timeoutMs: z.coerce.number().int().min(1000).max(SHELL_TASK_MAX_TIMEOUT_MS).optional(),
    waitMs: z.coerce.number().int().min(0).max(EXEC_MAX_WAIT_MS).optional(),
    controllerSessionId: z.string().optional(),
});

type RunWithTasks = {
    id: string;
    title: string;
    status: string;
    maxConcurrency: number;
    controllerSessionId: string | null;
    createdAt: Date;
    updatedAt: Date;
    completedAt: Date | null;
    cancelRequestedAt: Date | null;
    tasks: Array<{
        id: string;
        seq: number;
        taskKey: string | null;
        title: string | null;
        provider: string;
        model: string | null;
        workingDirectory: string | null;
        dependsOnTaskKeys: string[];
        retryMaxAttempts: number;
        retryBackoffMs: number;
        prompt?: string | null;
        nextAttemptAt: Date | null;
        status: string;
        outputSummary: string | null;
        outputText: string | null;
        stderrText: string | null;
        sealedResult: string | null;
        errorCode: string | null;
        errorMessage: string | null;
        createdAt: Date;
        updatedAt: Date;
        executions?: Array<{
            id: string;
            attempt: number;
            status: string;
            machineId: string;
            provider: string;
            model: string | null;
            childSessionId: string | null;
            executionType: string;
            resumeMessage: string | null;
            startedAt: Date | null;
            finishedAt: Date | null;
            exitCode: number | null;
            signal: string | null;
            errorCode: string | null;
            errorMessage: string | null;
            outputSummary: string | null;
            outputText: string | null;
            stderrText: string | null;
            sealedResult: string | null;
            createdAt: Date;
            updatedAt: Date;
        }>;
    }>;
};

type TaskWithRun = RunWithTasks['tasks'][number] & {
    run: {
        id: string;
        title: string;
        status: string;
        updatedAt: Date;
    };
};

function sendError(reply: any, statusCode: number, code: string, message: string, details?: Record<string, unknown>) {
    return reply.code(statusCode).send({
        ok: false,
        error: {
            code,
            message,
            ...(details ? { details } : {}),
        },
    });
}

function isUniqueConstraintError(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
        return false;
    }
    if (!('code' in error)) {
        return false;
    }
    return (error as { code?: unknown }).code === 'P2002';
}

function mapTask(task: RunWithTasks['tasks'][number]) {
    return {
        taskId: task.id,
        seq: task.seq,
        taskKey: task.taskKey,
        title: task.title,
        status: task.status,
        provider: task.provider,
        model: task.model,
        prompt: task.prompt,
        workingDirectory: task.workingDirectory,
        dependsOn: task.dependsOnTaskKeys,
        retry: {
            maxAttempts: task.retryMaxAttempts,
            backoffMs: task.retryBackoffMs,
        },
        nextAttemptAt: task.nextAttemptAt?.toISOString() ?? null,
        outputSummary: task.outputSummary,
        outputText: task.outputText,
        stderrText: task.stderrText,
        sealedResult: task.sealedResult,
        errorCode: task.errorCode,
        errorMessage: task.errorMessage,
        createdAt: task.createdAt.toISOString(),
        updatedAt: task.updatedAt.toISOString(),
        ...(Array.isArray(task.executions) ? {
            executions: task.executions.map((execution) => ({
                executionId: execution.id,
                attempt: execution.attempt,
                status: execution.status,
                machineId: execution.machineId,
                provider: execution.provider,
                model: execution.model,
                childSessionId: execution.childSessionId,
                executionType: execution.executionType,
                resumeMessage: execution.resumeMessage,
                startedAt: execution.startedAt?.toISOString() ?? null,
                finishedAt: execution.finishedAt?.toISOString() ?? null,
                exitCode: execution.exitCode,
                signal: execution.signal,
                errorCode: execution.errorCode,
                errorMessage: execution.errorMessage,
                outputSummary: execution.outputSummary,
                outputText: execution.outputText,
                stderrText: execution.stderrText,
                sealedResult: execution.sealedResult,
                createdAt: execution.createdAt.toISOString(),
                updatedAt: execution.updatedAt.toISOString(),
            })),
        } : {}),
    };
}

// What a shell task's result is read from, for `mapShellTask`
const shellTaskSelect = {
    id: true,
    status: true,
    targetMachineId: true,
    outputText: true,
    stderrText: true,
    sealedResult: true,
    stdoutFile: true,
    stderrFile: true,
    errorCode: true,
    errorMessage: true,
    executions: {
        orderBy: { attempt: 'desc' },
        take: 1,
        select: {
            exitCode: true,
            signal: true,
            startedAt: true,
            finishedAt: true,
        },
    },
} satisfies Prisma.OrchestratorTaskSelect;

/**
 * A shell task as `/exec` and `/pend` return it: the command's result on one machine, the same
 * whether the run ended within the exec call or later.
 */
function mapShellTask(task: Prisma.OrchestratorTaskGetPayload<{ select: typeof shellTaskSelect }>) {
    const execution = task.executions[0];
    return {
        taskId: task.id,
        machineId: task.targetMachineId,
        status: task.status,
        exitCode: execution?.exitCode ?? null,
        signal: execution?.signal ?? null,
        stdout: task.outputText,
        stderr: task.stderrText,
        stdoutFile: task.stdoutFile,
        stderrFile: task.stderrFile,
        sealedResult: task.sealedResult,
        errorCode: task.errorCode,
        errorMessage: task.errorMessage,
        startedAt: execution?.startedAt?.toISOString() ?? null,
        finishedAt: execution?.finishedAt?.toISOString() ?? null,
    };
}

// What a transfer task's result is read from, for `mapTransferTask`
const transferTaskSelect = {
    id: true,
    status: true,
    targetMachineId: true,
    prompt: true,
    transferResult: true,
    sealedResult: true,
    errorCode: true,
    errorMessage: true,
    executions: {
        orderBy: { attempt: 'desc' },
        take: 1,
        select: {
            startedAt: true,
            finishedAt: true,
        },
    },
} satisfies Prisma.OrchestratorTaskSelect;

/**
 * A transfer task as `/transfer` and `/pend` return it: the copy to one target machine, the same
 * whether the run ended within the transfer call or later. `result` is only set on tasks that
 * ended before results were sealed; newer ones carry it in `sealedResult`.
 */
function mapTransferTask(task: Prisma.OrchestratorTaskGetPayload<{ select: typeof transferTaskSelect }>) {
    const execution = task.executions[0];
    return {
        taskId: task.id,
        machineId: task.targetMachineId,
        status: task.status,
        // The sealed envelope, which holds where the copy comes from and goes to
        prompt: task.prompt,
        result: task.transferResult,
        sealedResult: task.sealedResult,
        errorCode: task.errorCode,
        errorMessage: task.errorMessage,
        startedAt: execution?.startedAt?.toISOString() ?? null,
        finishedAt: execution?.finishedAt?.toISOString() ?? null,
    };
}

function mapRunMachinesFromTasks(run: RunWithTasks): string[] {
    const machineSet = new Set<string>();
    for (const task of run.tasks) {
        if (!Array.isArray(task.executions)) {
            continue;
        }
        for (const execution of task.executions) {
            machineSet.add(execution.machineId);
        }
    }
    return [...machineSet];
}

function mapRunResponse(run: RunWithTasks, summary: RunSummary, includeTasks: boolean, machines: string[] = []) {
    return {
        runId: run.id,
        title: run.title,
        status: run.status,
        maxConcurrency: run.maxConcurrency,
        controllerSessionId: run.controllerSessionId,
        createdAt: run.createdAt.toISOString(),
        updatedAt: run.updatedAt.toISOString(),
        completedAt: run.completedAt?.toISOString() ?? null,
        cancelRequestedAt: run.cancelRequestedAt?.toISOString() ?? null,
        summary,
        machines,
        ...(includeTasks ? { tasks: run.tasks.map(mapTask) } : {}),
    };
}

function summarizeTasksByStatus(tasks: Array<{ status: string }>): RunSummary {
    const internal = createEmptySummaryInternal();
    for (const task of tasks) {
        addTaskCount(internal, task.status, 1);
    }
    return toPublicSummary(internal);
}

function summaryFromGrouped(grouped: Array<{ status: string; _count: { _all: number } }>): RunSummary {
    const internal = createEmptySummaryInternal();
    for (const row of grouped) {
        addTaskCount(internal, row.status, row._count._all);
    }
    return toPublicSummary(internal);
}

function summaryMapFromGrouped(grouped: Array<{ runId: string; status: string; _count: { _all: number } }>): Map<string, RunSummary> {
    const internalByRun = new Map<string, ReturnType<typeof createEmptySummaryInternal>>();
    for (const row of grouped) {
        let summary = internalByRun.get(row.runId);
        if (!summary) {
            summary = createEmptySummaryInternal();
            internalByRun.set(row.runId, summary);
        }
        addTaskCount(summary, row.status, row._count._all);
    }

    const out = new Map<string, RunSummary>();
    for (const [runId, internal] of internalByRun.entries()) {
        out.set(runId, toPublicSummary(internal));
    }
    return out;
}

async function loadRunForUser(userId: string, runId: string, includeTasks: boolean, includeExecutions: boolean = false): Promise<{ run: RunWithTasks; summary: RunSummary } | null> {
    const run = await db.orchestratorRun.findFirst({
        where: { id: runId, accountId: userId },
        select: {
            id: true,
            title: true,
            status: true,
            maxConcurrency: true,
            controllerSessionId: true,
            createdAt: true,
            updatedAt: true,
            completedAt: true,
            cancelRequestedAt: true,
            tasks: includeTasks ? {
                orderBy: { seq: 'asc' },
                select: {
                    id: true,
                    seq: true,
                    taskKey: true,
                    title: true,
                    provider: true,
                    model: true,
                    workingDirectory: true,
                    dependsOnTaskKeys: true,
                    retryMaxAttempts: true,
                    retryBackoffMs: true,
                    nextAttemptAt: true,
                    status: true,
                    outputSummary: true,
                    outputText: true,
                    stderrText: true,
                    sealedResult: true,
                    errorCode: true,
                    errorMessage: true,
                    createdAt: true,
                    updatedAt: true,
                    executions: includeExecutions ? {
                        orderBy: { attempt: 'asc' },
                        select: {
                            id: true,
                            attempt: true,
                            status: true,
                            machineId: true,
                            provider: true,
                            model: true,
                            childSessionId: true,
                            executionType: true,
                            resumeMessage: true,
                            startedAt: true,
                            finishedAt: true,
                            exitCode: true,
                            signal: true,
                            errorCode: true,
                            errorMessage: true,
                            outputSummary: true,
                            outputText: true,
                            stderrText: true,
                            sealedResult: true,
                            createdAt: true,
                            updatedAt: true,
                        },
                    } : false,
                },
            } : false,
        },
    });

    if (!run) {
        return null;
    }

    if (includeTasks) {
        return { run: run as RunWithTasks, summary: summarizeTasksByStatus(run.tasks) };
    }

    const grouped = await db.orchestratorTask.groupBy({
        by: ['status'],
        where: { runId: run.id },
        _count: { _all: true },
    });
    return {
        run: { ...run, tasks: [] } as RunWithTasks,
        summary: summaryFromGrouped(grouped),
    };
}

async function loadTaskForUser(
    userId: string,
    runId: string,
    taskId: string,
    includeExecutions: boolean = false,
): Promise<TaskWithRun | null> {
    const task = await db.orchestratorTask.findFirst({
        where: {
            id: taskId,
            runId,
            run: {
                accountId: userId,
            },
        },
        select: {
            id: true,
            seq: true,
            taskKey: true,
            title: true,
            prompt: true,
            provider: true,
            model: true,
            workingDirectory: true,
            dependsOnTaskKeys: true,
            retryMaxAttempts: true,
            retryBackoffMs: true,
            nextAttemptAt: true,
            status: true,
            outputSummary: true,
            outputText: true,
            stderrText: true,
            sealedResult: true,
            errorCode: true,
            errorMessage: true,
            createdAt: true,
            updatedAt: true,
            run: {
                select: {
                    id: true,
                    title: true,
                    status: true,
                    updatedAt: true,
                },
            },
            executions: includeExecutions ? {
                orderBy: { attempt: 'asc' },
                select: {
                    id: true,
                    attempt: true,
                    status: true,
                    machineId: true,
                    provider: true,
                    model: true,
                    childSessionId: true,
                    executionType: true,
                    resumeMessage: true,
                    startedAt: true,
                    finishedAt: true,
                    exitCode: true,
                    signal: true,
                    errorCode: true,
                    errorMessage: true,
                    outputSummary: true,
                    outputText: true,
                    stderrText: true,
                    sealedResult: true,
                    createdAt: true,
                    updatedAt: true,
                },
            } : false,
        },
    });

    return (task as TaskWithRun | null) ?? null;
}

type NewTask = {
    taskKey?: string;
    title?: string;
    // exec creates shell tasks, which run their prompt as a command, with no AI and no session;
    // transfer creates transfer tasks; each prompt is a sealed envelope
    provider: ProviderName | 'shell' | 'transfer';
    model: string | null;
    prompt: string;
    /** Sealed, for display only: the daemon runs in the envelope's */
    workingDirectory?: string;
    timeoutMs?: number;
    targetMachineId: string | null;
    dependsOnTaskKeys: string[];
    retryMaxAttempts: number;
    retryBackoffMs: number;
};

/** Create a queued run with its tasks, numbered in order; the scheduler dispatches them. */
async function createRunWithTasks(userId: string, input: {
    title: string;
    controllerSessionId?: string;
    maxConcurrency: number;
    idempotencyKey?: string;
}, newTasks: NewTask[]): Promise<{ run: RunWithTasks; summary: RunSummary }> {
    return db.$transaction(async (tx: Prisma.TransactionClient) => {
        const run = await tx.orchestratorRun.create({
            data: {
                accountId: userId,
                controllerSessionId: input.controllerSessionId,
                title: input.title,
                status: 'queued',
                maxConcurrency: input.maxConcurrency,
                idempotencyKey: input.idempotencyKey,
            },
            select: {
                id: true,
                title: true,
                status: true,
                maxConcurrency: true,
                controllerSessionId: true,
                createdAt: true,
                updatedAt: true,
                completedAt: true,
                cancelRequestedAt: true,
            },
        });

        await tx.orchestratorTask.createMany({
            data: newTasks.map((task, index) => ({
                ...task,
                runId: run.id,
                seq: index + 1,
                nextAttemptAt: null,
                status: 'queued',
            })),
        });

        const tasks = await tx.orchestratorTask.findMany({
            where: { runId: run.id },
            orderBy: { seq: 'asc' },
            select: {
                id: true,
                seq: true,
                taskKey: true,
                title: true,
                provider: true,
                model: true,
                workingDirectory: true,
                dependsOnTaskKeys: true,
                retryMaxAttempts: true,
                retryBackoffMs: true,
                nextAttemptAt: true,
                status: true,
                outputSummary: true,
                outputText: true,
                stderrText: true,
                sealedResult: true,
                errorCode: true,
                errorMessage: true,
                createdAt: true,
                updatedAt: true,
            },
        });

        return {
            run: {
                ...run,
                tasks,
            } as RunWithTasks,
            summary: summarizeTasksByStatus(tasks),
        };
    });
}

function resolveRunStatusFilter(status?: string): string[] | undefined {
    if (!status) {
        return undefined;
    }
    if (status === 'active') {
        return ['queued', 'running', 'canceling'];
    }
    if (status === 'terminal') {
        return ['completed', 'failed', 'cancelled'];
    }
    return [status];
}

function validateTaskKeyUniqueness(tasks: z.infer<typeof submitTaskSchema>[]): string | null {
    const seen = new Set<string>();
    for (const task of tasks) {
        if (!task.taskKey) {
            continue;
        }
        if (seen.has(task.taskKey)) {
            return task.taskKey;
        }
        seen.add(task.taskKey);
    }
    return null;
}

type TaskDependencyValidationIssue = {
    code: 'INVALID_DEPENDENCY' | 'INVALID_DAG_CYCLE';
    message: string;
};

function validateTaskDependencies(tasks: z.infer<typeof submitTaskSchema>[]): TaskDependencyValidationIssue | null {
    const keyToTaskIndex = new Map<string, number>();
    for (let index = 0; index < tasks.length; index++) {
        const taskKey = tasks[index].taskKey;
        if (!taskKey) {
            continue;
        }
        keyToTaskIndex.set(taskKey, index + 1);
    }

    for (let index = 0; index < tasks.length; index++) {
        const task = tasks[index];
        const seq = index + 1;
        const dependsOn = task.dependsOn ?? [];
        const localSeen = new Set<string>();

        for (const dep of dependsOn) {
            if (localSeen.has(dep)) {
                return {
                    code: 'INVALID_DEPENDENCY',
                    message: `Task seq ${seq} has duplicate dependency: ${dep}`,
                };
            }
            localSeen.add(dep);

            if (task.taskKey && dep === task.taskKey) {
                return {
                    code: 'INVALID_DEPENDENCY',
                    message: `Task seq ${seq} depends on itself: ${dep}`,
                };
            }

            if (!keyToTaskIndex.has(dep)) {
                return {
                    code: 'INVALID_DEPENDENCY',
                    message: `Task seq ${seq} depends on unknown taskKey: ${dep}`,
                };
            }
        }
    }

    const keyedTasks = tasks
        .map((task, index) => ({ task, seq: index + 1 }))
        .filter((entry) => !!entry.task.taskKey);
    if (keyedTasks.length === 0) {
        return null;
    }

    const inDegree = new Map<string, number>();
    const outgoing = new Map<string, string[]>();
    for (const entry of keyedTasks) {
        const key = entry.task.taskKey!;
        inDegree.set(key, 0);
        outgoing.set(key, []);
    }

    for (const entry of keyedTasks) {
        const key = entry.task.taskKey!;
        for (const dep of entry.task.dependsOn ?? []) {
            outgoing.get(dep)!.push(key);
            inDegree.set(key, (inDegree.get(key) ?? 0) + 1);
        }
    }

    const queue = Array.from(inDegree.entries())
        .filter(([, degree]) => degree === 0)
        .map(([key]) => key);
    let processed = 0;

    while (queue.length > 0) {
        const current = queue.shift()!;
        processed += 1;
        for (const next of outgoing.get(current) ?? []) {
            const nextDegree = (inDegree.get(next) ?? 0) - 1;
            inDegree.set(next, nextDegree);
            if (nextDegree === 0) {
                queue.push(next);
            }
        }
    }

    if (processed !== keyedTasks.length) {
        const cyclicTaskKeys = Array.from(inDegree.entries())
            .filter(([, degree]) => degree > 0)
            .map(([key]) => key)
            .slice(0, 5);
        return {
            code: 'INVALID_DAG_CYCLE',
            message: `Task dependency cycle detected${cyclicTaskKeys.length > 0 ? `: ${cyclicTaskKeys.join(', ')}` : ''}`,
        };
    }

    return null;
}

async function markDependencyFailedTasksInCancelTx(tx: Prisma.TransactionClient, runId: string): Promise<void> {
    const keyedTasks = await tx.orchestratorTask.findMany({
        where: {
            runId,
            taskKey: { not: null },
        },
        select: {
            taskKey: true,
            status: true,
        },
    });
    const taskKeyToStatus = new Map<string, string>();
    for (const task of keyedTasks) {
        if (task.taskKey) {
            taskKeyToStatus.set(task.taskKey, task.status);
        }
    }

    let changed = true;
    while (changed) {
        changed = false;
        const candidateTasks = await tx.orchestratorTask.findMany({
            where: {
                runId,
                status: { in: ['queued', 'cancelled'] },
            },
            orderBy: { seq: 'asc' },
            select: {
                id: true,
                taskKey: true,
                status: true,
                dependsOnTaskKeys: true,
            },
        });

        for (const task of candidateTasks) {
            const dependencies = task.dependsOnTaskKeys ?? [];
            if (dependencies.length === 0) {
                continue;
            }

            let dependencyFailedKey: string | null = null;
            for (const dependencyKey of dependencies) {
                const dependencyStatus = taskKeyToStatus.get(dependencyKey);
                if (
                    dependencyStatus === 'failed'
                    || dependencyStatus === 'cancelled'
                    || dependencyStatus === 'dependency_failed'
                ) {
                    dependencyFailedKey = dependencyKey;
                    break;
                }
            }

            if (!dependencyFailedKey) {
                continue;
            }

            const updated = await tx.orchestratorTask.updateMany({
                where: {
                    id: task.id,
                    status: { in: ['queued', 'cancelled'] },
                },
                data: {
                    status: 'dependency_failed',
                    errorCode: 'DEPENDENCY_FAILED',
                    errorMessage: `Dependency failed: ${dependencyFailedKey}`,
                    nextAttemptAt: null,
                },
            });
            if (updated.count > 0) {
                changed = true;
                if (task.taskKey) {
                    taskKeyToStatus.set(task.taskKey, 'dependency_failed');
                }
            }
        }
    }
}

export function orchestratorRoutes(app: Fastify) {
    app.get('/v1/orchestrator/context', {
        preHandler: app.authenticate,
    }, async (request, reply) => {
        const userId = request.userId;

        const machineConnections = eventRouter.getConnections(userId);
        const onlineMachineIds = new Set<string>();
        for (const connection of machineConnections ?? []) {
            if (connection.connectionType === 'machine-scoped' && connection.socket.connected) {
                onlineMachineIds.add(connection.machineId);
            }
        }
        const dispatchReadyMachineIds = new Set<string>();
        for (const method of listConnectedUserRpcMethods(userId)) {
            if (method.endsWith(':orchestrator-sealed-dispatch')) {
                dispatchReadyMachineIds.add(method.slice(0, -':orchestrator-sealed-dispatch'.length));
            }
        }

        const machines = await db.machine.findMany({
            where: { accountId: userId },
            orderBy: { lastActiveAt: 'desc' },
            take: 50,
            select: {
                id: true,
                active: true,
                lastActiveAt: true,
            },
        });
        const shellReadyMachineIds = new Set(listShellReadyMachineIds(userId));
        const dispatchReadyIds = [...dispatchReadyMachineIds];
        const onlineIds = [...onlineMachineIds];
        const [detectedProviders, identities] = await Promise.all([
            detectMachineProviders(userId, dispatchReadyIds),
            fetchMachineIdentities(userId, onlineIds),
        ]);

        const machineList = machines.map((machine) => {
            const online = onlineMachineIds.has(machine.id);
            const dispatchReady = dispatchReadyMachineIds.has(machine.id);
            const detection = detectedProviders.get(machine.id);
            const providers = detection?.providers ?? [];
            const modelModes: Record<string, readonly string[]> = {};
            for (const provider of providers) {
                modelModes[provider] = getValidModelModesForAgent(provider);
            }
            const identity = identities.get(machine.id);
            const name = identity?.name ?? detection?.hostname;
            return {
                machineId: machine.id,
                ...(name ? { name } : {}),
                ...(identity?.platform ? { platform: identity.platform } : {}),
                ...(identity?.shell ? { shell: identity.shell } : {}),
                active: machine.active,
                online,
                dispatchReady,
                shellReady: shellReadyMachineIds.has(machine.id),
                lastActiveAt: machine.lastActiveAt.toISOString(),
                providers,
                modelModes,
            };
        }).sort((a, b) => {
            if (a.dispatchReady !== b.dispatchReady) {
                return a.dispatchReady ? -1 : 1;
            }
            if (a.online !== b.online) {
                return a.online ? -1 : 1;
            }
            return b.lastActiveAt.localeCompare(a.lastActiveAt);
        });

        return reply.send({
            ok: true,
            data: {
                providers: PROVIDERS,
                modelModes: {
                    claude: getValidModelModesForAgent('claude'),
                    codex: getValidModelModesForAgent('codex'),
                    gemini: getValidModelModesForAgent('gemini'),
                    qoder: getValidModelModesForAgent('qoder'),
                },
                defaults: {
                    mode: 'async',
                    maxConcurrency: DEFAULT_CONTEXT_MAX_CONCURRENCY,
                    waitTimeoutMs: DEFAULT_CONTEXT_WAIT_TIMEOUT_MS,
                    pollIntervalMs: DEFAULT_CONTEXT_POLL_INTERVAL_MS,
                    retryMaxAttempts: DEFAULT_CONTEXT_RETRY_MAX_ATTEMPTS,
                    retryBackoffMs: DEFAULT_CONTEXT_RETRY_BACKOFF_MS,
                },
                machines: machineList,
            },
        });
    });

    app.post('/v1/orchestrator/submit', {
        preHandler: app.authenticate,
        schema: {
            body: submitBodySchema,
        },
    }, async (request, reply) => {
        const userId = request.userId;
        const body = request.body;

        const duplicatedTaskKey = validateTaskKeyUniqueness(body.tasks);
        if (duplicatedTaskKey) {
            return sendError(reply, 400, 'INVALID_ARGUMENT', `Duplicate taskKey in request: ${duplicatedTaskKey}`);
        }
        const dependencyIssue = validateTaskDependencies(body.tasks);
        if (dependencyIssue) {
            return sendError(reply, 400, dependencyIssue.code, dependencyIssue.message);
        }
        const normalizedTaskModels: Array<string | undefined> = [];
        for (let index = 0; index < body.tasks.length; index++) {
            const task = body.tasks[index];
            const model = task.model;
            if (!model || model === MODEL_MODE_DEFAULT) {
                normalizedTaskModels.push(undefined);
                continue;
            }
            // Codex tasks may carry a `-fast` marker on top of any valid mode; validate the mode itself.
            const baseMode = task.provider === 'codex' ? splitFastModeSuffix(model).mode : model;
            if (isModelMode(baseMode) && !isModelModeForAgent(task.provider, baseMode)) {
                return sendError(reply, 400, 'INVALID_ARGUMENT', `Task seq ${index + 1} has invalid model "${model}" for provider "${task.provider}"`);
            }
            normalizedTaskModels.push(model);
        }

        const controllerMachineId: string | null = body.controllerMachineId ?? null;
        if (body.controllerSessionId) {
            const controllerSession = await db.session.findFirst({
                where: {
                    id: body.controllerSessionId,
                    accountId: userId,
                },
                select: { id: true },
            });
            if (!controllerSession) {
                return sendError(reply, 400, 'INVALID_ARGUMENT', 'controllerSessionId does not belong to current account');
            }
        }

        const loadExistingByIdempotency = async (): Promise<{ run: RunWithTasks; summary: RunSummary } | null> => {
            if (!body.idempotencyKey) {
                return null;
            }
            const existing = await db.orchestratorRun.findFirst({
                where: {
                    accountId: userId,
                    idempotencyKey: body.idempotencyKey,
                },
                select: { id: true },
            });
            if (!existing) {
                return null;
            }
            return loadRunForUser(userId, existing.id, true);
        };
        const loadExistingByIdempotencyWithRetry = async (): Promise<{ run: RunWithTasks; summary: RunSummary } | null> => {
            for (let attempt = 0; attempt <= IDEMPOTENCY_RETRY_TIMES; attempt++) {
                const existing = await loadExistingByIdempotency();
                if (existing) {
                    return existing;
                }
                if (attempt < IDEMPOTENCY_RETRY_TIMES) {
                    await delay(IDEMPOTENCY_RETRY_DELAY_MS);
                }
            }
            return null;
        };

        const existing = await loadExistingByIdempotency();
        if (existing) {
            return reply.send({
                ok: true,
                data: {
                    runId: existing.run.id,
                    mode: body.mode ?? 'async',
                    terminal: isRunTerminal(existing.run.status),
                    run: {
                        status: existing.run.status,
                        createdAt: existing.run.createdAt.toISOString(),
                        updatedAt: existing.run.updatedAt.toISOString(),
                        summary: existing.summary,
                    },
                    tasks: existing.run.tasks.map(mapTask),
                    next: isRunTerminal(existing.run.status) ? undefined : { hint: 'Await <orchestrator-callback>.', runId: existing.run.id },
                },
            });
        }

        try {
            const created = await createRunWithTasks(userId, {
                title: body.title,
                controllerSessionId: body.controllerSessionId,
                maxConcurrency: body.maxConcurrency ?? 2,
                idempotencyKey: body.idempotencyKey,
            }, body.tasks.map((task, index) => ({
                taskKey: task.taskKey,
                title: task.title,
                provider: task.provider,
                model: normalizedTaskModels[index] ?? null,
                prompt: task.prompt,
                workingDirectory: task.workingDirectory,
                timeoutMs: task.timeoutMs,
                targetMachineId: task.target?.type === 'machine_id'
                    ? task.target.machineId!
                    : controllerMachineId,
                dependsOnTaskKeys: task.dependsOn ?? [],
                retryMaxAttempts: task.retry?.maxAttempts ?? DEFAULT_CONTEXT_RETRY_MAX_ATTEMPTS,
                retryBackoffMs: task.retry?.backoffMs ?? DEFAULT_CONTEXT_RETRY_BACKOFF_MS,
            })));

            return reply.send({
                ok: true,
                data: {
                    runId: created.run.id,
                    mode: body.mode ?? 'async',
                    terminal: false,
                    run: {
                        status: created.run.status,
                        createdAt: created.run.createdAt.toISOString(),
                        updatedAt: created.run.updatedAt.toISOString(),
                        summary: created.summary,
                    },
                    tasks: created.run.tasks.map(mapTask),
                    next: { hint: 'Await <orchestrator-callback>.', runId: created.run.id },
                },
            });
        } catch (error) {
            request.log.error({ err: error }, 'orchestrator submit failed');
            if (body.idempotencyKey && isUniqueConstraintError(error)) {
                const duplicate = await loadExistingByIdempotencyWithRetry();
                if (duplicate) {
                    return reply.send({
                        ok: true,
                        data: {
                            runId: duplicate.run.id,
                            mode: body.mode ?? 'async',
                            terminal: isRunTerminal(duplicate.run.status),
                            run: {
                                status: duplicate.run.status,
                                createdAt: duplicate.run.createdAt.toISOString(),
                                updatedAt: duplicate.run.updatedAt.toISOString(),
                                summary: duplicate.summary,
                            },
                            tasks: duplicate.run.tasks.map(mapTask),
                            next: isRunTerminal(duplicate.run.status) ? undefined : { hint: 'Await <orchestrator-callback>.', runId: duplicate.run.id },
                        },
                    });
                }
            }
            return sendError(reply, 500, 'INTERNAL', 'Failed to submit orchestrator run');
        }
    });

    // Run a shell command on machines, as a run with one shell task per machine. Waits up to
    // `waitMs` for it to finish to return the output in the response; a run still going by then
    // reports through `<orchestrator-callback>` like any other.
    app.post('/v1/orchestrator/exec', {
        preHandler: app.authenticate,
        schema: {
            body: execBodySchema,
        },
    }, async (request, reply) => {
        const userId = request.userId;
        const body = request.body;

        if (body.controllerSessionId) {
            const controllerSession = await db.session.findFirst({
                where: {
                    id: body.controllerSessionId,
                    accountId: userId,
                },
                select: { id: true },
            });
            if (!controllerSession) {
                return sendError(reply, 400, 'INVALID_ARGUMENT', 'controllerSessionId does not belong to current account');
            }
        }

        const machineIds = body.machineIds === 'all_online'
            ? listShellReadyMachineIds(userId)
            : [...new Set(body.machineIds)];
        if (machineIds.length === 0) {
            return sendError(reply, 409, 'CONFLICT', 'No machine is online with remote shell turned on');
        }
        if (machineIds.length > RUN_MAX_TASKS) {
            return sendError(reply, 400, 'INVALID_ARGUMENT', `${machineIds.length} machines are online, more than the ${RUN_MAX_TASKS} one run takes; list machineIds instead`);
        }
        const knownMachines = await db.machine.findMany({
            where: { accountId: userId, id: { in: machineIds } },
            select: { id: true },
        });
        const knownMachineIds = new Set(knownMachines.map((machine) => machine.id));
        const unknownMachineIds = machineIds.filter((machineId) => !knownMachineIds.has(machineId));
        if (unknownMachineIds.length > 0) {
            return sendError(reply, 400, 'INVALID_ARGUMENT', `Unknown machineId: ${unknownMachineIds.join(', ')}`);
        }

        const created = await createRunWithTasks(userId, {
            title: body.title,
            controllerSessionId: body.controllerSessionId,
            maxConcurrency: body.maxConcurrency ?? machineIds.length,
        }, machineIds.map((machineId) => ({
            provider: 'shell' as const,
            model: null,
            prompt: body.prompt,
            workingDirectory: body.workingDirectory,
            timeoutMs: body.timeoutMs,
            targetMachineId: machineId,
            dependsOnTaskKeys: [],
            retryMaxAttempts: 1,
            retryBackoffMs: 0,
        })));
        const runId = created.run.id;

        const waitMs = body.waitMs ?? EXEC_DEFAULT_WAIT_MS;
        if (waitMs > 0) {
            // The caller giving up on the response must not take the run's callback with it
            const disconnected = new AbortController();
            reply.raw.once('close', () => disconnected.abort());
            await awaitOrchestratorRunTerminal(runId, waitMs, async () => {
                const run = await db.orchestratorRun.findUnique({ where: { id: runId }, select: { status: true } });
                return !!run && isRunTerminal(run.status);
            }, disconnected.signal);
        }

        const run = await db.orchestratorRun.findUniqueOrThrow({
            where: { id: runId },
            select: {
                status: true,
                createdAt: true,
                updatedAt: true,
                tasks: {
                    orderBy: { seq: 'asc' },
                    select: shellTaskSelect,
                },
            },
        });
        const terminal = isRunTerminal(run.status);

        return reply.send({
            ok: true,
            data: {
                runId,
                terminal,
                run: {
                    status: run.status,
                    createdAt: run.createdAt.toISOString(),
                    updatedAt: run.updatedAt.toISOString(),
                    summary: summarizeTasksByStatus(run.tasks),
                },
                tasks: run.tasks.map(mapShellTask),
                next: terminal ? undefined : { hint: 'Await <orchestrator-callback>.', runId },
            },
        });
    });

    // Copy a file or directory from one machine to others, as a run with one transfer task per
    // target machine. Each target's daemon pulls the source through `transfer-source` in encrypted
    // chunks. Waits up to `waitMs` like exec.
    app.post('/v1/orchestrator/transfer', {
        preHandler: app.authenticate,
        schema: {
            body: transferBodySchema,
        },
    }, async (request, reply) => {
        const userId = request.userId;
        const body = request.body;

        if (body.controllerSessionId) {
            const controllerSession = await db.session.findFirst({
                where: {
                    id: body.controllerSessionId,
                    accountId: userId,
                },
                select: { id: true },
            });
            if (!controllerSession) {
                return sendError(reply, 400, 'INVALID_ARGUMENT', 'controllerSessionId does not belong to current account');
            }
        }

        const sourceMachineId = body.fromMachineId;
        // all_online sends to every other machine: the source has the file already
        const machineIds = body.toMachineIds === 'all_online'
            ? listShellReadyMachineIds(userId, TRANSFER_DISPATCH_METHOD_SUFFIX).filter((machineId) => machineId !== sourceMachineId)
            : [...new Set(body.toMachineIds)];
        if (machineIds.length === 0) {
            return sendError(reply, 409, 'CONFLICT', 'No other machine is online with remote shell turned on');
        }
        if (machineIds.length > RUN_MAX_TASKS) {
            return sendError(reply, 400, 'INVALID_ARGUMENT', `${machineIds.length} machines are online, more than the ${RUN_MAX_TASKS} one run takes; list machineIds instead`);
        }
        const knownMachines = await db.machine.findMany({
            where: { accountId: userId, id: { in: [sourceMachineId, ...machineIds] } },
            select: { id: true },
        });
        const knownMachineIds = new Set(knownMachines.map((machine) => machine.id));
        const unknownMachineIds = [...new Set([sourceMachineId, ...machineIds])].filter((machineId) => !knownMachineIds.has(machineId));
        if (unknownMachineIds.length > 0) {
            return sendError(reply, 400, 'INVALID_ARGUMENT', `Unknown machineId: ${unknownMachineIds.join(', ')}`);
        }
        if (!hasUserRpcMethod(userId, `${sourceMachineId}:${TRANSFER_SOURCE_METHOD}`)) {
            return sendError(reply, 409, 'CONFLICT', `Source machine ${sourceMachineId} is offline, has remote shell turned off, or runs a Happy CLI too old to send files`);
        }

        const created = await createRunWithTasks(userId, {
            title: body.title,
            controllerSessionId: body.controllerSessionId,
            maxConcurrency: machineIds.length,
        }, machineIds.map((machineId) => ({
            provider: 'transfer' as const,
            model: null,
            prompt: body.prompt,
            timeoutMs: body.timeoutMs,
            targetMachineId: machineId,
            dependsOnTaskKeys: [],
            retryMaxAttempts: 1,
            retryBackoffMs: 0,
        })));
        const runId = created.run.id;

        const waitMs = body.waitMs ?? EXEC_DEFAULT_WAIT_MS;
        if (waitMs > 0) {
            // The caller giving up on the response must not take the run's callback with it
            const disconnected = new AbortController();
            reply.raw.once('close', () => disconnected.abort());
            await awaitOrchestratorRunTerminal(runId, waitMs, async () => {
                const run = await db.orchestratorRun.findUnique({ where: { id: runId }, select: { status: true } });
                return !!run && isRunTerminal(run.status);
            }, disconnected.signal);
        }

        const run = await db.orchestratorRun.findUniqueOrThrow({
            where: { id: runId },
            select: {
                status: true,
                createdAt: true,
                updatedAt: true,
                tasks: {
                    orderBy: { seq: 'asc' },
                    select: transferTaskSelect,
                },
            },
        });
        const terminal = isRunTerminal(run.status);

        return reply.send({
            ok: true,
            data: {
                runId,
                terminal,
                run: {
                    status: run.status,
                    createdAt: run.createdAt.toISOString(),
                    updatedAt: run.updatedAt.toISOString(),
                    summary: summarizeTasksByStatus(run.tasks),
                },
                tasks: run.tasks.map(mapTransferTask),
                next: terminal ? undefined : { hint: 'Await <orchestrator-callback>.', runId },
            },
        });
    });

    app.get('/v1/orchestrator/runs/:runId', {
        preHandler: app.authenticate,
        schema: {
            params: z.object({
                runId: z.string(),
            }),
            querystring: z.object({
                includeTasks: z.coerce.boolean().default(true),
                includeExecutions: z.coerce.boolean().default(false),
            }).optional(),
        },
    }, async (request, reply) => {
        const userId = request.userId;
        const { runId } = request.params;
        const includeTasks = request.query?.includeTasks ?? true;
        const includeExecutions = includeTasks && (request.query?.includeExecutions ?? false);

        const loaded = await loadRunForUser(userId, runId, includeTasks, includeExecutions);
        if (!loaded) {
            return sendError(reply, 404, 'NOT_FOUND', 'Run not found');
        }

        const machineSet = new Set<string>(includeExecutions ? mapRunMachinesFromTasks(loaded.run) : []);
        if (machineSet.size === 0) {
            const groupedMachines = await db.orchestratorExecution.groupBy({
                by: ['machineId'],
                where: { runId: loaded.run.id },
            });
            for (const row of groupedMachines) {
                machineSet.add(row.machineId);
            }
        }

        return reply.send({
            ok: true,
            data: mapRunResponse(loaded.run, loaded.summary, includeTasks, [...machineSet]),
        });
    });

    app.get('/v1/orchestrator/runs/:runId/tasks/:taskId', {
        preHandler: app.authenticate,
        schema: {
            params: z.object({
                runId: z.string(),
                taskId: z.string(),
            }),
            querystring: z.object({
                includeExecutions: z.coerce.boolean().default(false),
            }).optional(),
        },
    }, async (request, reply) => {
        const userId = request.userId;
        const { runId, taskId } = request.params;
        const includeExecutions = request.query?.includeExecutions ?? false;

        const loadedTask = await loadTaskForUser(userId, runId, taskId, includeExecutions);
        if (!loadedTask) {
            return sendError(reply, 404, 'NOT_FOUND', 'Task not found');
        }

        return reply.send({
            ok: true,
            data: {
                run: {
                    runId: loadedTask.run.id,
                    title: loadedTask.run.title,
                    status: loadedTask.run.status,
                    updatedAt: loadedTask.run.updatedAt.toISOString(),
                },
                task: mapTask(loadedTask),
            },
        });
    });

    app.post('/v1/orchestrator/tasks/:taskId/send-message', {
        preHandler: app.authenticate,
        schema: {
            params: z.object({
                taskId: z.string(),
            }),
            body: z.object({
                // Sealed: the message, with the task it is for, which the daemon checks
                message: sealedSchema(SEALED_TASK_MAX_LENGTH),
                controllerSessionId: z.string().min(1).max(128).optional(),
            }),
        },
    }, async (request, reply) => {
        const userId = request.userId;
        const { taskId } = request.params;
        const { message, controllerSessionId } = request.body;

        if (controllerSessionId) {
            const controllerSession = await db.session.findFirst({
                where: {
                    id: controllerSessionId,
                    accountId: userId,
                },
                select: { id: true },
            });
            if (!controllerSession) {
                return sendError(reply, 400, 'INVALID_ARGUMENT', 'controllerSessionId does not belong to current account');
            }
        }

        const result = await db.$transaction(async (tx: Prisma.TransactionClient) => {
            const task = await tx.orchestratorTask.findFirst({
                where: {
                    id: taskId,
                    run: {
                        accountId: userId,
                    },
                },
                select: {
                    id: true,
                    runId: true,
                    provider: true,
                    model: true,
                    timeoutMs: true,
                    status: true,
                    run: {
                        select: {
                            id: true,
                            status: true,
                        },
                    },
                },
            });

            if (!task) {
                return { kind: 'not_found' as const };
            }
            if (task.provider === 'shell' || task.provider === 'transfer') {
                return { kind: 'no_session' as const, provider: task.provider };
            }

            if (task.status !== 'completed' && task.status !== 'failed') {
                return { kind: 'invalid_state' as const, status: task.status };
            }

            const sourceExecution = await tx.orchestratorExecution.findFirst({
                where: {
                    taskId: task.id,
                    childSessionId: { not: null },
                },
                orderBy: {
                    attempt: 'desc',
                },
                select: {
                    childSessionId: true,
                    machineId: true,
                },
            });
            if (!sourceExecution?.childSessionId) {
                return { kind: 'missing_child_session' as const };
            }

            const latestExecution = await tx.orchestratorExecution.findFirst({
                where: {
                    taskId: task.id,
                },
                orderBy: {
                    attempt: 'desc',
                },
                select: {
                    attempt: true,
                },
            });
            const attempt = (latestExecution?.attempt ?? 0) + 1;

            const movedTask = await tx.orchestratorTask.updateMany({
                where: {
                    id: task.id,
                    status: { in: ['completed', 'failed'] },
                },
                data: {
                    status: 'queued',
                    nextAttemptAt: null,
                    errorCode: null,
                    errorMessage: null,
                },
            });
            if (movedTask.count === 0) {
                return { kind: 'conflict' as const };
            }

            const execution = await tx.orchestratorExecution.create({
                data: {
                    runId: task.runId,
                    taskId: task.id,
                    machineId: sourceExecution.machineId,
                    provider: task.provider,
                    model: task.model ?? null,
                    childSessionId: sourceExecution.childSessionId,
                    executionType: 'resume',
                    resumeMessage: message,
                    controllerSessionId: controllerSessionId ?? null,
                    status: 'queued',
                    attempt,
                    dispatchToken: randomUUID(),
                    timeoutMs: task.timeoutMs,
                },
                select: {
                    id: true,
                    createdAt: true,
                },
            });

            // A follow-up into a finished run starts a new round of it: the sessions told when it
            // finishes again are the ones whose work is in that round.
            await tx.orchestratorRun.updateMany({
                where: { id: task.runId },
                data: {
                    status: 'running',
                    completedAt: null,
                    cancelledBySessionId: null,
                    ...(isRunTerminal(task.run.status) ? { reopenedAt: execution.createdAt } : {}),
                },
            });

            return {
                kind: 'ok' as const,
                runId: task.runId,
                taskId: task.id,
                executionId: execution.id,
            };
        });

        if (result.kind === 'not_found') {
            return sendError(reply, 404, 'NOT_FOUND', 'Task not found');
        }
        if (result.kind === 'no_session') {
            return sendError(reply, 400, 'INVALID_ARGUMENT', result.provider === 'shell'
                ? `Task ${taskId} is a shell task, which has no session to message; run another command instead`
                : `Task ${taskId} is a file transfer, which has no session to message; start another transfer instead`);
        }
        if (result.kind === 'invalid_state') {
            return sendError(reply, 409, 'CONFLICT', `Task ${taskId} must be in completed/failed state to accept messages`);
        }
        if (result.kind === 'missing_child_session') {
            return sendError(reply, 409, 'CONFLICT', `Task ${taskId} has no child session id and cannot be resumed`);
        }
        if (result.kind === 'conflict') {
            return sendError(reply, 409, 'CONFLICT', `Task ${taskId} is no longer resumable`);
        }

        void emitOrchestratorRunActivity(userId, result.runId).catch(warn);

        return reply.send({
            ok: true,
            data: {
                accepted: true,
                runId: result.runId,
                taskId: result.taskId,
                executionId: result.executionId,
                next: { hint: 'Await <orchestrator-callback>.', runId: result.runId },
            },
        });
    });

    // The runs of one executor kind, of those dispatched to one machine, or both
    const runListFilterConditions = (kind: typeof LIST_RUN_KIND_FILTERS[number] | undefined, machineId: string | undefined): any[] => {
        const conditions: any[] = [];
        if (kind) {
            conditions.push({ tasks: { some: { provider: kind === 'agent' ? { in: [...PROVIDERS] } : kind } } });
        }
        if (machineId) {
            conditions.push({ executions: { some: { machineId } } });
        }
        return conditions;
    };

    app.get('/v1/orchestrator/runs', {
        preHandler: app.authenticate,
        schema: {
            querystring: z.object({
                status: z.enum(LIST_RUN_STATUS_FILTERS).optional(),
                kind: z.enum(LIST_RUN_KIND_FILTERS).optional(),
                machineId: z.string().min(1).max(128).optional(),
                controllerSessionId: z.string().min(1).max(128).optional(),
                limit: z.coerce.number().int().min(1).max(50).default(20),
                cursor: z.string().optional(),
            }).optional(),
        },
    }, async (request, reply) => {
        const userId = request.userId;
        const limit = request.query?.limit ?? 20;
        const statusFilter = request.query?.status;
        const controllerSessionId = request.query?.controllerSessionId;
        const cursor = request.query?.cursor;

        let cursorParts: { createdAt: Date; id: string } | null = null;
        if (cursor) {
            cursorParts = decodeListCursor(cursor);
            if (!cursorParts) {
                return sendError(reply, 400, 'INVALID_ARGUMENT', 'Invalid cursor');
            }
        }

        const resolvedStatuses = resolveRunStatusFilter(statusFilter);
        const where: any = {
            accountId: userId,
            ...(resolvedStatuses ? { status: { in: resolvedStatuses } } : {}),
        };
        const conditions: any[] = runListFilterConditions(request.query?.kind, request.query?.machineId);
        if (controllerSessionId) {
            conditions.push(runsOfSessionWhere(controllerSessionId));
        }

        if (cursorParts) {
            conditions.push({
                OR: [
                    { createdAt: { lt: cursorParts.createdAt } },
                    {
                        AND: [
                            { createdAt: cursorParts.createdAt },
                            { id: { lt: cursorParts.id } },
                        ],
                    },
                ],
            });
        }
        if (conditions.length > 0) {
            where.AND = conditions;
        }

        const runs = await db.orchestratorRun.findMany({
            where,
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: limit + 1,
            select: {
                id: true,
                title: true,
                status: true,
                createdAt: true,
                updatedAt: true,
            },
        });

        const hasNext = runs.length > limit;
        const page = hasNext ? runs.slice(0, limit) : runs;
        const runIds = page.map((run) => run.id);

        let summaryMap = new Map<string, RunSummary>();
        if (runIds.length > 0) {
            const grouped = await db.orchestratorTask.groupBy({
                by: ['runId', 'status'],
                where: { runId: { in: runIds } },
                _count: { _all: true },
            });
            summaryMap = summaryMapFromGrouped(grouped);
        }

        const machinesByRun = new Map<string, string[]>();
        if (runIds.length > 0) {
            const machineGroups = await db.orchestratorExecution.groupBy({
                by: ['runId', 'machineId'],
                where: { runId: { in: runIds } },
            });
            for (const row of machineGroups) {
                const existing = machinesByRun.get(row.runId) ?? [];
                existing.push(row.machineId);
                machinesByRun.set(row.runId, existing);
            }
        }

        // Which executors a run's tasks use, so a list can tell a shell run from an agent run at a glance
        const providersByRun = new Map<string, string[]>();
        if (runIds.length > 0) {
            const providerGroups = await db.orchestratorTask.groupBy({
                by: ['runId', 'provider'],
                where: { runId: { in: runIds } },
            });
            for (const row of providerGroups) {
                const existing = providersByRun.get(row.runId) ?? [];
                existing.push(row.provider);
                providersByRun.set(row.runId, existing);
            }
        }

        const items = page.map((run: any) => ({
            runId: run.id,
            title: run.title,
            status: run.status,
            createdAt: run.createdAt.toISOString(),
            updatedAt: run.updatedAt.toISOString(),
            summary: summaryMap.get(run.id) ?? {
                total: 0,
                queued: 0,
                running: 0,
                completed: 0,
                failed: 0,
                cancelled: 0,
            },
            machines: machinesByRun.get(run.id) ?? [],
            providers: providersByRun.get(run.id) ?? [],
        }));

        let nextCursor: string | undefined;
        if (hasNext && page.length > 0) {
            const last = page[page.length - 1];
            nextCursor = encodeListCursor(last.createdAt, last.id);
        }

        return reply.send({
            ok: true,
            data: {
                items,
                nextCursor,
            },
        });
    });

    // ── Run status counts ──────────────────────────────────────────────
    app.get('/v1/orchestrator/runs/counts', {
        preHandler: app.authenticate,
        schema: {
            querystring: z.object({
                controllerSessionId: z.string().min(1).max(128).optional(),
                kind: z.enum(LIST_RUN_KIND_FILTERS).optional(),
                machineId: z.string().min(1).max(128).optional(),
            }).optional(),
        },
    }, async (request, reply) => {
        const userId = request.userId;
        const controllerSessionId = request.query?.controllerSessionId;
        const conditions = runListFilterConditions(request.query?.kind, request.query?.machineId);

        const grouped = await db.orchestratorRun.groupBy({
            by: ['status'],
            where: {
                accountId: userId,
                ...(controllerSessionId ? runsOfSessionWhere(controllerSessionId) : {}),
                ...(conditions.length > 0 ? { AND: conditions } : {}),
            },
            _count: { _all: true },
        });

        const counts: Record<string, number> = {};
        for (const row of grouped) {
            counts[row.status] = row._count._all;
        }

        return reply.send({ ok: true, data: counts });
    });

    app.get('/v1/orchestrator/runs/:runId/pend', {
        preHandler: app.authenticate,
        schema: {
            params: z.object({
                runId: z.string(),
            }),
            querystring: z.object({
                cursor: z.string().optional(),
                waitFor: z.enum(['change', 'terminal']).default('change'),
                timeoutMs: z.coerce.number().int().min(0).max(120_000).default(30_000),
                include: z.enum(['summary', 'all_tasks']).default('summary'),
            }).optional(),
        },
    }, async (request, reply) => {
        const userId = request.userId;
        const { runId } = request.params;
        const waitFor = request.query?.waitFor ?? 'change';
        const timeoutMs = request.query?.timeoutMs ?? 30_000;
        const include = request.query?.include ?? 'summary';
        const previousCursor = request.query?.cursor;
        const includeTasks = include !== 'summary';

        const startedAtMs = Date.now();
        // v2.1 fallback: keep pend polling bounded and sparse to reduce DB pressure under concurrent long polls.
        // A future iteration should switch to event-driven wakeups.
        const maxPolls = Math.max(1, Math.ceil(timeoutMs / PEND_POLL_INTERVAL_MS) + 1);

        for (let pollIndex = 0; pollIndex < maxPolls; pollIndex += 1) {
            const loaded = await loadRunForUser(userId, runId, includeTasks);
            if (!loaded) {
                return sendError(reply, 404, 'NOT_FOUND', 'Run not found');
            }

            const terminal = isRunTerminal(loaded.run.status);
            const cursor = buildPendCursor({
                runId: loaded.run.id,
                updatedAt: loaded.run.updatedAt,
                status: loaded.run.status,
                summary: loaded.summary,
            });
            const changed = !previousCursor || previousCursor !== cursor;
            const waitSatisfied = waitFor === 'terminal' ? terminal : changed;
            const timeoutReached = Date.now() - startedAtMs >= timeoutMs;
            const isLastPoll = pollIndex >= maxPolls - 1;

            if (waitSatisfied || timeoutReached || isLastPoll) {
                // Shell and transfer tasks read as `/exec` and `/transfer` return them, for one shape
                // however the result is fetched
                const shellTasks = includeTasks && loaded.run.tasks.some((task) => task.provider === 'shell' || task.provider === 'transfer')
                    ? new Map<string, unknown>([
                        ...(await db.orchestratorTask.findMany({
                            where: { runId: loaded.run.id, provider: 'shell' },
                            select: shellTaskSelect,
                        })).map((task) => [task.id, mapShellTask(task)] as const),
                        ...(await db.orchestratorTask.findMany({
                            where: { runId: loaded.run.id, provider: 'transfer' },
                            select: transferTaskSelect,
                        })).map((task) => [task.id, mapTransferTask(task)] as const),
                    ])
                    : null;
                return reply.send({
                    ok: true,
                    data: {
                        runId: loaded.run.id,
                        terminal,
                        changed,
                        cursor,
                        run: {
                            status: loaded.run.status,
                            summary: loaded.summary,
                            updatedAt: loaded.run.updatedAt.toISOString(),
                        },
                        ...(includeTasks ? {
                            tasks: loaded.run.tasks.map((task) => shellTasks?.get(task.id) ?? mapTask(task)),
                        } : {}),
                    },
                });
            }

            const elapsedMs = Date.now() - startedAtMs;
            const remainingMs = timeoutMs - elapsedMs;
            await delay(Math.min(PEND_POLL_INTERVAL_MS, Math.max(0, remainingMs)));
        }

        return sendError(reply, 500, 'INTERNAL', 'Pend polling exhausted unexpectedly');
    });

    app.post('/v1/orchestrator/runs/:runId/cancel', {
        preHandler: app.authenticate,
        schema: {
            params: z.object({
                runId: z.string(),
            }),
            body: z.object({
                reason: z.string().max(512).optional(),
                // The session whose agent cancels the run: it is not owed a callback when the run ends
                controllerSessionId: z.string().min(1).max(128).optional(),
            }).optional(),
        },
    }, async (request, reply) => {
        const userId = request.userId;
        const { runId } = request.params;
        const controllerSessionId = request.body?.controllerSessionId;

        const result = await db.$transaction(async (tx: Prisma.TransactionClient) => {
            const run = await tx.orchestratorRun.findFirst({
                where: { id: runId, accountId: userId },
                select: { id: true, status: true },
            });
            if (!run) {
                return { kind: 'not_found' as const };
            }

            if (isRunTerminal(run.status)) {
                return { kind: 'ok' as const, status: run.status, ended: false };
            }

            if (run.status !== 'canceling' || controllerSessionId) {
                await tx.orchestratorRun.update({
                    where: { id: runId },
                    data: {
                        status: 'canceling',
                        cancelRequestedAt: run.status === 'canceling' ? undefined : new Date(),
                        cancelledBySessionId: controllerSessionId,
                    },
                });
            }

            await tx.orchestratorTask.updateMany({
                where: {
                    runId,
                    status: 'queued',
                },
                data: {
                    status: 'cancelled',
                    errorCode: 'RUN_CANCELLED',
                    errorMessage: 'Cancelled before dispatch',
                    nextAttemptAt: null,
                },
            });
            await markDependencyFailedTasksInCancelTx(tx, runId);

            const grouped = await tx.orchestratorTask.groupBy({
                by: ['status'],
                where: { runId },
                _count: { _all: true },
            });

            const internal = createEmptySummaryInternal();
            for (const row of grouped) {
                addTaskCount(internal, row.status, row._count._all);
            }
            const nextStatus = deriveRunStatus('canceling', internal);
            if (nextStatus === 'canceling') {
                return { kind: 'ok' as const, status: nextStatus, ended: false };
            }
            const ended = await tx.orchestratorRun.update({
                where: { id: runId },
                data: {
                    status: nextStatus,
                    completedAt: new Date(),
                },
                select: { updatedAt: true },
            });
            await orchestratorRunCallbacksRecordTx(tx, runId, ended.updatedAt);

            return { kind: 'ok' as const, status: nextStatus, ended: true };
        });

        if (result.kind === 'not_found') {
            return sendError(reply, 404, 'NOT_FOUND', 'Run not found');
        }

        void emitOrchestratorRunActivity(userId, runId).catch(warn);
        // A cancel from the app, or from another session, ends the run without those agents knowing
        if (result.ended) {
            void notifyOrchestratorRunTerminal(userId, runId).catch(warn);
        }

        return reply.send({
            ok: true,
            data: {
                runId,
                status: result.status,
                accepted: true,
            },
        });
    });

    app.post('/v1/orchestrator/executions/:id/start', {
        preHandler: app.authenticate,
        schema: {
            params: z.object({
                id: z.string(),
            }),
            body: z.object({
                dispatchToken: z.string().min(1),
                startedAt: z.string().datetime().optional(),
                pid: z.number().int().optional(),
            }),
        },
    }, async (request, reply) => {
        const userId = request.userId;
        const { id } = request.params;
        const { dispatchToken, startedAt, pid } = request.body;

        const result = await db.$transaction(async (tx: Prisma.TransactionClient) => {
            const execution = await tx.orchestratorExecution.findFirst({
                where: {
                    id,
                    run: {
                        accountId: userId,
                    },
                },
                select: {
                    id: true,
                    status: true,
                    dispatchToken: true,
                    taskId: true,
                    runId: true,
                    run: {
                        select: {
                            status: true,
                        },
                    },
                },
            });

            if (!execution) {
                return { kind: 'not_found' as const };
            }

            if (execution.dispatchToken !== dispatchToken) {
                return { kind: 'token_mismatch' as const };
            }

            if (isExecutionTerminal(execution.status)) {
                return { kind: 'duplicate' as const, status: execution.status };
            }

            if (execution.run.status === 'canceling' || execution.run.status === 'cancelled') {
                return { kind: 'ignored' as const, status: execution.status };
            }

            const startedAtDate = startedAt ? new Date(startedAt) : new Date();

            const updated = await tx.orchestratorExecution.updateMany({
                where: {
                    id,
                    status: 'dispatching',
                },
                data: {
                    status: 'running',
                    startedAt: startedAtDate,
                    pid,
                },
            });
            if (updated.count === 0) {
                return { kind: 'duplicate' as const };
            }

            await tx.orchestratorTask.updateMany({
                where: {
                    id: execution.taskId,
                    status: 'dispatching',
                },
                data: {
                    status: 'running',
                },
            });

            await tx.orchestratorRun.updateMany({
                where: {
                    id: execution.runId,
                    status: { in: ['queued', 'running'] },
                },
                data: {
                    status: 'running',
                },
            });

            return { kind: 'ok' as const, runId: execution.runId };
        });

        if (result.kind === 'not_found') {
            return sendError(reply, 404, 'NOT_FOUND', 'Execution not found');
        }
        if (result.kind === 'token_mismatch') {
            return sendError(reply, 409, 'CONFLICT', 'dispatchToken mismatch');
        }
        if (result.kind === 'duplicate') {
            return reply.send({ ok: true, data: { duplicate: true } });
        }
        if (result.kind === 'ignored') {
            return reply.send({ ok: true, data: { ignored: true } });
        }

        void emitOrchestratorRunActivity(userId, result.runId).catch(warn);

        return reply.send({
            ok: true,
            data: { started: true },
        });
    });

    // The daemon learns the provider session id while the execution is still running (Codex prints
    // it in its header). Recording it early lets clients read the live conversation of a task.
    app.post('/v1/orchestrator/executions/:id/child-session', {
        preHandler: app.authenticate,
        schema: {
            params: z.object({
                id: z.string(),
            }),
            body: z.object({
                dispatchToken: z.string().min(1),
                childSessionId: z.string().min(1).max(256),
            }),
        },
    }, async (request, reply) => {
        const userId = request.userId;
        const { id } = request.params;
        const { dispatchToken, childSessionId } = request.body;

        const execution = await db.orchestratorExecution.findFirst({
            where: {
                id,
                run: {
                    accountId: userId,
                },
            },
            select: {
                id: true,
                dispatchToken: true,
            },
        });
        if (!execution) {
            return sendError(reply, 404, 'NOT_FOUND', 'Execution not found');
        }
        if (execution.dispatchToken !== dispatchToken) {
            return sendError(reply, 409, 'CONFLICT', 'dispatchToken mismatch');
        }

        // Only a live execution without a session id yet: a finished one already got it from `finish`
        const updated = await db.orchestratorExecution.updateMany({
            where: {
                id,
                status: { in: ['dispatching', 'running'] },
                childSessionId: null,
            },
            data: { childSessionId },
        });

        return reply.send({
            ok: true,
            data: { recorded: updated.count > 0 },
        });
    });

    // A transfer's target daemon reads the source through this: each step is relayed to the source
    // machine's `orchestrator-sealed-transfer-source` as is. The server only passes the steps on: the
    // chunks are encrypted with a key the two machines agree on (from the public keys in `open`),
    // which it does not have. Only a live transfer execution's own target, holding its
    // dispatchToken, reaches the source, and only for the path of its task: each step carries the
    // task's sealed envelope, and the source serves only what that names, if it names the source.
    app.post('/v1/orchestrator/executions/:id/transfer-source', {
        preHandler: app.authenticate,
        schema: {
            params: z.object({
                id: z.string(),
            }),
            body: z.object({
                dispatchToken: z.string().min(1),
                op: z.enum(['open', 'read', 'close']),
                // From the task's sealed envelope, which the source opens to check it names itself
                sourceMachineId: z.string().min(1).max(128),
                // The target's half of the key exchange, sealed with the execution it is for
                publicKey: sealedSchema(SEALED_TITLE_MAX_LENGTH).optional(),
                index: z.number().int().min(0).optional(),
            }),
        },
    }, async (request, reply) => {
        const userId = request.userId;
        const { id } = request.params;
        const body = request.body;

        const execution = await db.orchestratorExecution.findFirst({
            where: {
                id,
                run: {
                    accountId: userId,
                },
            },
            select: {
                status: true,
                provider: true,
                dispatchToken: true,
                task: { select: { prompt: true } },
            },
        });
        if (!execution || execution.provider !== 'transfer') {
            return sendError(reply, 404, 'NOT_FOUND', 'Transfer execution not found');
        }
        if (execution.dispatchToken !== body.dispatchToken) {
            return sendError(reply, 409, 'CONFLICT', 'dispatchToken mismatch');
        }
        // Closing is cleanup, which may come after the transfer was reported finished
        if (body.op !== 'close' && execution.status !== 'dispatching' && execution.status !== 'running') {
            return sendError(reply, 409, 'CONFLICT', `Transfer is ${execution.status}`);
        }
        const sourceMachineId = body.sourceMachineId;

        let result: unknown;
        try {
            result = await invokeUserRpc(
                userId,
                `${sourceMachineId}:${TRANSFER_SOURCE_METHOD}`,
                {
                    transferId: id,
                    op: body.op,
                    spec: execution.task.prompt,
                    publicKey: body.publicKey,
                    index: body.index,
                },
                TRANSFER_SOURCE_RPC_TIMEOUT_MS,
            );
        } catch (error) {
            // Not reached, or no answer in time: the source may be back for a retry
            const message = error instanceof Error ? error.message : String(error);
            return sendError(reply, 502, 'SOURCE_UNREACHABLE', `Source machine ${sourceMachineId}: ${message}`);
        }
        // The source's handler failed (no such file, say): asking again gets the same answer
        const sourceError = (result as { error?: unknown } | null)?.error;
        if (typeof sourceError === 'string') {
            return sendError(reply, 422, 'SOURCE_FAILED', `Source machine ${sourceMachineId}: ${sourceError}`);
        }
        return reply.send({ ok: true, data: result });
    });

    app.post('/v1/orchestrator/executions/:id/finish', {
        preHandler: app.authenticate,
        schema: {
            params: z.object({
                id: z.string(),
            }),
            body: z.object({
                dispatchToken: z.string().min(1),
                status: z.enum(EXECUTION_FINAL_STATUSES),
                finishedAt: z.string().datetime().optional(),
                exitCode: z.number().int().nullable().optional(),
                signal: z.string().nullable().optional(),
                childSessionId: z.string().min(1).max(256).nullable().optional(),
                // Sealed: the output, files, transfer result and error message, with the task and
                // execution they belong to
                sealedResult: sealedSchema(SEALED_RESULT_MAX_LENGTH).nullable().optional(),
                errorCode: z.string().nullable().optional(),
            }),
        },
    }, async (request, reply) => {
        const userId = request.userId;
        const { id } = request.params;
        const body = request.body;

        const result = await db.$transaction(async (tx: Prisma.TransactionClient) => {
            const execution = await tx.orchestratorExecution.findFirst({
                where: {
                    id,
                    run: {
                        accountId: userId,
                    },
                },
                select: {
                    id: true,
                    status: true,
                    dispatchToken: true,
                    runId: true,
                    taskId: true,
                    attempt: true,
                    childSessionId: true,
                    run: {
                        select: {
                            status: true,
                        },
                    },
                    task: {
                        select: {
                            retryMaxAttempts: true,
                            retryBackoffMs: true,
                        },
                    },
                },
            });

            if (!execution) {
                return { kind: 'not_found' as const };
            }

            if (execution.dispatchToken !== body.dispatchToken) {
                return { kind: 'token_mismatch' as const };
            }

            if (isExecutionTerminal(execution.status)) {
                return { kind: 'duplicate' as const };
            }

            const finishedAt = body.finishedAt ? new Date(body.finishedAt) : new Date();
            const executionStatus = body.status;
            const shouldRetry = (executionStatus === 'failed' || executionStatus === 'timeout')
                && execution.run.status !== 'canceling'
                && execution.run.status !== 'cancelled'
                && execution.attempt < execution.task.retryMaxAttempts;
            const taskStatus = shouldRetry
                ? 'queued'
                : executionStatus === 'completed'
                ? 'completed'
                : executionStatus === 'cancelled'
                    ? 'cancelled'
                    : 'failed';
            const nextAttemptAt = shouldRetry
                ? new Date(finishedAt.getTime() + execution.task.retryBackoffMs)
                : null;

            const updated = await tx.orchestratorExecution.updateMany({
                where: {
                    id,
                    status: { in: ['dispatching', 'running'] },
                },
                data: {
                    status: executionStatus,
                    finishedAt,
                    exitCode: body.exitCode ?? null,
                    signal: body.signal ?? null,
                    ...(body.childSessionId
                        ? { childSessionId: body.childSessionId }
                        : {}),
                    outputSummary: null,
                    outputText: null,
                    stderrText: null,
                    stdoutFile: Prisma.DbNull,
                    stderrFile: Prisma.DbNull,
                    transferResult: Prisma.DbNull,
                    sealedResult: body.sealedResult ?? null,
                    errorCode: body.errorCode ?? null,
                    errorMessage: null,
                },
            });
            if (updated.count === 0) {
                return { kind: 'duplicate' as const };
            }

            await tx.orchestratorTask.updateMany({
                where: {
                    id: execution.taskId,
                    status: { in: ['dispatching', 'running'] },
                },
                data: {
                    status: taskStatus,
                    outputSummary: null,
                    outputText: null,
                    stderrText: null,
                    stdoutFile: Prisma.DbNull,
                    stderrFile: Prisma.DbNull,
                    transferResult: Prisma.DbNull,
                    sealedResult: body.sealedResult ?? null,
                    errorCode: body.errorCode ?? null,
                    errorMessage: null,
                    nextAttemptAt,
                },
            });

            const grouped = await tx.orchestratorTask.groupBy({
                by: ['status'],
                where: { runId: execution.runId },
                _count: { _all: true },
            });
            const internal = createEmptySummaryInternal();
            for (const row of grouped) {
                addTaskCount(internal, row.status, row._count._all);
            }

            const nextRunStatus = deriveRunStatus(execution.run.status, internal);
            const updatedRun = await tx.orchestratorRun.update({
                where: { id: execution.runId },
                data: {
                    status: nextRunStatus,
                    completedAt: isRunTerminal(nextRunStatus) ? finishedAt : null,
                },
                select: { updatedAt: true },
            });
            const finishedRun = !isRunTerminal(execution.run.status) && isRunTerminal(nextRunStatus);
            if (finishedRun) {
                await orchestratorRunCallbacksRecordTx(tx, execution.runId, updatedRun.updatedAt);
            }

            return {
                kind: 'ok' as const,
                runId: execution.runId,
                runStatus: nextRunStatus,
                finishedRun,
            };
        });

        if (result.kind === 'not_found') {
            return sendError(reply, 404, 'NOT_FOUND', 'Execution not found');
        }
        if (result.kind === 'token_mismatch') {
            return sendError(reply, 409, 'CONFLICT', 'dispatchToken mismatch');
        }
        if (result.kind === 'duplicate') {
            return reply.send({ ok: true, data: { duplicate: true } });
        }

        void emitOrchestratorRunActivity(userId, result.runId).catch(warn);
        if (result.finishedRun) {
            await notifyOrchestratorRunTerminal(userId, result.runId).catch(warn);
        }

        return reply.send({
            ok: true,
            data: {
                finished: true,
                runStatus: result.runStatus,
            },
        });
    });

    app.post('/v1/orchestrator/machines/:machineId/reconcile', {
        preHandler: app.authenticate,
        schema: {
            params: z.object({
                machineId: z.string(),
            }),
            body: z.object({
                liveExecutionIds: z.array(z.string().min(1).max(128)).max(10_000),
                daemonStartedAt: z.string().datetime(),
            }),
        },
    }, async (request, reply) => {
        await orchestratorMachineReconcile(
            request.userId,
            request.params.machineId,
            request.body.liveExecutionIds,
            new Date(request.body.daemonStartedAt),
        );
        return reply.send({ ok: true });
    });

    // A session's CLI pulls the callbacks its agent is owed: on connecting, when its agent's turn
    // ends, and when the server's terminal notice says one is waiting
    app.post('/v1/orchestrator/sessions/:sessionId/callbacks', {
        preHandler: app.authenticate,
        schema: {
            params: z.object({
                sessionId: z.string().min(1).max(128),
            }),
            body: z.object({
                predecessorSessionId: z.string().min(1).max(128).optional(),
            }).optional(),
        },
    }, async (request, reply) => {
        const callbacks = await orchestratorCallbacksPull(
            request.userId,
            request.params.sessionId,
            request.body?.predecessorSessionId,
        );
        return reply.send({ ok: true, data: { callbacks } });
    });

    app.post('/v1/orchestrator/sessions/:sessionId/callbacks/ack', {
        preHandler: app.authenticate,
        schema: {
            params: z.object({
                sessionId: z.string().min(1).max(128),
            }),
            body: z.object({
                runs: z.array(z.object({
                    runId: z.string().min(1).max(128),
                    knownAt: z.string().datetime(),
                })).min(1).max(100),
            }),
        },
    }, async (request, reply) => {
        await orchestratorCallbacksAck(
            request.userId,
            request.params.sessionId,
            request.body.runs.map((run) => ({ runId: run.runId, knownAt: new Date(run.knownAt) })),
        );
        return reply.send({ ok: true });
    });

    app.get('/v1/orchestrator/activity', {
        preHandler: app.authenticate,
        schema: {
            querystring: z.object({
                controllerSessionId: z.string().min(1),
            }),
        },
    }, async (request, reply) => {
        const userId = request.userId;
        const { controllerSessionId } = request.query;

        const [activity, totalRunCount] = await Promise.all([
            queryOrchestratorSessionActivity(userId, controllerSessionId),
            countOrchestratorSessionRuns(userId, controllerSessionId),
        ]);
        return reply.send({ ok: true, data: { activity, totalRunCount } });
    });

    app.get('/v1/orchestrator/activity/batch', {
        preHandler: app.authenticate,
    }, async (request, reply) => {
        const userId = request.userId;
        const { activity, totalRunCounts } = await queryOrchestratorActivityBatch(userId);
        return reply.send({ ok: true, data: { activity, totalRunCounts } });
    });
}
