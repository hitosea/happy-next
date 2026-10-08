import { db } from "@/storage/db";
import { Prisma } from "@prisma/client";

/**
 * Which sessions a run works for. The session that submitted a run is its controller, but any
 * session can send one of its finished tasks a follow-up; that execution records the session that
 * sent it (`controllerSessionId`, null for the controller), and a retry keeps it. So a task works
 * for the session of its latest execution, and a run belongs to its controller and to every
 * session that sent a follow-up into it.
 */

const ACTIVE_RUN_STATUSES = ['queued', 'running', 'canceling'];
const ACTIVE_TASK_STATUSES = ['queued', 'dispatching', 'running'];

type Client = Prisma.TransactionClient | typeof db;

/** The runs a session submitted or sent a follow-up into. */
export function runsOfSessionWhere(sessionId: string): Prisma.OrchestratorRunWhereInput {
    return {
        OR: [
            { controllerSessionId: sessionId },
            { executions: { some: { controllerSessionId: sessionId } } },
        ],
    };
}

const taskSessionSelect = {
    id: true,
    runId: true,
    run: { select: { controllerSessionId: true } },
    executions: {
        orderBy: { attempt: 'desc' },
        take: 1,
        select: { controllerSessionId: true },
    },
} satisfies Prisma.OrchestratorTaskSelect;

type TaskSessionRow = Prisma.OrchestratorTaskGetPayload<{ select: typeof taskSessionSelect }>;

function taskSessionId(row: TaskSessionRow): string | null {
    return row.executions[0]?.controllerSessionId ?? row.run.controllerSessionId;
}

/** The active tasks working for a session, by run. */
export async function queryOrchestratorSessionActivity(
    userId: string,
    sessionId: string,
): Promise<Record<string, string[]>> {
    const rows = await db.orchestratorTask.findMany({
        where: {
            run: { accountId: userId, status: { in: ACTIVE_RUN_STATUSES }, ...runsOfSessionWhere(sessionId) },
            status: { in: ACTIVE_TASK_STATUSES },
        },
        select: taskSessionSelect,
    });

    const activity: Record<string, string[]> = {};
    for (const row of rows) {
        if (taskSessionId(row) !== sessionId) {
            continue;
        }
        (activity[row.runId] ??= []).push(row.id);
    }
    return activity;
}

export async function countOrchestratorSessionRuns(userId: string, sessionId: string): Promise<number> {
    return db.orchestratorRun.count({
        where: { accountId: userId, ...runsOfSessionWhere(sessionId) },
    });
}

/** The active tasks of every session, by session and run, and how many runs each session has. */
export async function queryOrchestratorActivityBatch(userId: string): Promise<{
    activity: Record<string, Record<string, string[]>>;
    totalRunCounts: Record<string, number>;
}> {
    const [rows, controlledRuns, followUps] = await Promise.all([
        db.orchestratorTask.findMany({
            where: {
                run: { accountId: userId, status: { in: ACTIVE_RUN_STATUSES } },
                status: { in: ACTIVE_TASK_STATUSES },
            },
            select: taskSessionSelect,
        }),
        db.orchestratorRun.groupBy({
            by: ['controllerSessionId'],
            where: {
                accountId: userId,
                controllerSessionId: { not: null },
            },
            _count: { _all: true },
        }),
        db.orchestratorExecution.findMany({
            where: {
                controllerSessionId: { not: null },
                run: { accountId: userId },
            },
            distinct: ['runId', 'controllerSessionId'],
            select: {
                controllerSessionId: true,
                run: { select: { controllerSessionId: true } },
            },
        }),
    ]);

    const totalRunCounts: Record<string, number> = {};
    for (const row of controlledRuns) {
        if (row.controllerSessionId) {
            totalRunCounts[row.controllerSessionId] = row._count._all;
        }
    }
    for (const row of followUps) {
        if (row.controllerSessionId && row.controllerSessionId !== row.run.controllerSessionId) {
            totalRunCounts[row.controllerSessionId] = (totalRunCounts[row.controllerSessionId] ?? 0) + 1;
        }
    }

    const activity: Record<string, Record<string, string[]>> = {};
    for (const row of rows) {
        const sessionId = taskSessionId(row);
        if (!sessionId) {
            continue;
        }
        const runs = (activity[sessionId] ??= {});
        (runs[row.runId] ??= []).push(row.id);
    }
    return { activity, totalRunCounts };
}

/** The run's controller and every session that sent a follow-up into it. */
export async function orchestratorRunSessionIds(client: Client, runId: string): Promise<string[]> {
    const [run, followUps] = await Promise.all([
        client.orchestratorRun.findUnique({
            where: { id: runId },
            select: { controllerSessionId: true },
        }),
        client.orchestratorExecution.findMany({
            where: { runId, controllerSessionId: { not: null } },
            distinct: ['controllerSessionId'],
            select: { controllerSessionId: true },
        }),
    ]);
    return uniqueSessionIds([run?.controllerSessionId, ...followUps.map((row) => row.controllerSessionId)]);
}

/**
 * The sessions waiting on a run that has just finished: those of the executions in its current
 * round, which is everything since a follow-up last reopened it, or the whole run if none has.
 */
export async function orchestratorRunCallbackSessionIds(
    client: Client,
    run: { id: string; controllerSessionId: string | null; reopenedAt: Date | null },
): Promise<string[]> {
    const executions = await client.orchestratorExecution.findMany({
        where: {
            runId: run.id,
            ...(run.reopenedAt ? { createdAt: { gte: run.reopenedAt } } : {}),
        },
        select: { controllerSessionId: true },
    });
    if (executions.length === 0) {
        return uniqueSessionIds([run.controllerSessionId]);
    }
    return uniqueSessionIds(executions.map((row) => row.controllerSessionId ?? run.controllerSessionId));
}

/**
 * Send each session its current orchestrator activity. Called after status-changing transactions
 * commit.
 */
export async function emitOrchestratorActivity(userId: string, sessionIds: Array<string | null | undefined>) {
    const ids = uniqueSessionIds(sessionIds);
    if (ids.length === 0) {
        return;
    }
    const { eventRouter, buildOrchestratorActivityEphemeral } = await import("@/app/events/eventRouter");
    await Promise.all(ids.map(async (sessionId) => {
        const [activity, totalRunCount] = await Promise.all([
            queryOrchestratorSessionActivity(userId, sessionId),
            countOrchestratorSessionRuns(userId, sessionId),
        ]);
        eventRouter.emitEphemeral({
            userId,
            payload: buildOrchestratorActivityEphemeral(sessionId, activity, totalRunCount),
        });
    }));
}

/** {@link emitOrchestratorActivity} for every session the run works for. */
export async function emitOrchestratorRunActivity(userId: string, runId: string) {
    await emitOrchestratorActivity(userId, await orchestratorRunSessionIds(db, runId));
}

function uniqueSessionIds(ids: Array<string | null | undefined>): string[] {
    return [...new Set(ids.filter((id): id is string => !!id))];
}
