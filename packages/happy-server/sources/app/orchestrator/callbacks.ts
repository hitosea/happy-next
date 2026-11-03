import { Prisma } from "@prisma/client";
import { db } from "@/storage/db";
import type { SessionScopedConnection } from "@/app/events/eventRouter";
import { orchestratorRunCallbackSessionIds } from "./sessions";
import { RUN_TERMINAL_STATUSES } from "./state";

/**
 * The callback ledger: which sessions are still owed the news that a run has ended. A run that
 * ends writes one callback for each session of its current round, in the same transaction, and a
 * session's CLI pulls what it is owed and acks what its agent has. The notice sent after commit
 * (see terminal.ts) only prompts a CLI to pull, so a CLI that misses it — offline, restarting,
 * busy — still gets the callback the next time it pulls.
 *
 * A session that continues another (a restart, resume or copy) takes that one's callbacks while
 * it is offline, so a run started before a restart reaches the session after it.
 */

/** How many sessions back a chain of sessions continuing one another is followed */
const MAX_SUCCESSION_DEPTH = 16;

/** The most callbacks one pull returns; the rest come with the next */
const MAX_PULLED_CALLBACKS = 50;

/**
 * Owe each session of the run's current round a callback for the round this transaction ends,
 * with `endedAt` the run's updatedAt as it ends. A callback still owed from an earlier round
 * becomes this one: the agent hears of the run once, as it is now.
 */
export async function orchestratorRunCallbacksRecordTx(
    tx: Prisma.TransactionClient,
    runId: string,
    endedAt: Date,
): Promise<void> {
    const run = await tx.orchestratorRun.findUniqueOrThrow({
        where: { id: runId },
        select: { id: true, controllerSessionId: true, reopenedAt: true, cancelledBySessionId: true },
    });
    for (const sessionId of await orchestratorRunCallbackSessionIds(tx, run)) {
        await tx.orchestratorRunCallback.upsert({
            where: { runId_sessionId: { runId, sessionId } },
            create: { runId, sessionId, endedAt },
            update: { endedAt },
        });
    }
}

/** The CLIs connected for each session of the account right now */
export async function orchestratorSessionConnections(userId: string): Promise<Map<string, SessionScopedConnection[]>> {
    const { eventRouter } = await import("@/app/events/eventRouter");
    const bySession = new Map<string, SessionScopedConnection[]>();
    for (const connection of eventRouter.getConnections(userId) ?? []) {
        if (connection.connectionType === 'session-scoped') {
            bySession.set(connection.sessionId, [...(bySession.get(connection.sessionId) ?? []), connection]);
        }
    }
    return bySession;
}

/**
 * The sessions whose callbacks a session takes: itself, and the sessions it continues while they
 * are offline. The walk stops at one that is online, which takes its own: the original a copy
 * was made from, or one restarted again later.
 */
async function orchestratorCallbackScope(userId: string, sessionId: string): Promise<string[]> {
    const online = await orchestratorSessionConnections(userId);
    const scope = [sessionId];
    for (let depth = 0; depth < MAX_SUCCESSION_DEPTH; depth += 1) {
        const session = await db.session.findFirst({
            where: { id: scope[scope.length - 1], accountId: userId },
            select: { predecessorSessionId: true },
        });
        const predecessor = session?.predecessorSessionId;
        if (!predecessor || scope.includes(predecessor) || online.has(predecessor)) {
            break;
        }
        scope.push(predecessor);
    }
    return scope;
}

/**
 * The sessions to prompt when a run ends: each session owed its callback, and for one that is
 * offline, the sessions continuing it (and theirs, while those are offline too).
 */
export async function orchestratorCallbackRecipients(
    userId: string,
    sessionIds: string[],
    online: Map<string, unknown>,
): Promise<string[]> {
    const recipients = [...sessionIds];
    let offline = sessionIds.filter((id) => !online.has(id));
    for (let depth = 0; depth < MAX_SUCCESSION_DEPTH && offline.length > 0; depth += 1) {
        const successors = await db.session.findMany({
            where: { accountId: userId, predecessorSessionId: { in: offline } },
            select: { id: true },
        });
        const added = successors.map((row) => row.id).filter((id) => !recipients.includes(id));
        recipients.push(...added);
        offline = added.filter((id) => !online.has(id));
    }
    return recipients;
}

/**
 * The callbacks a session's agent is owed, oldest first: the runs that ended without it being
 * told, for it and for the offline sessions it continues. A run reopened since is left out until
 * it ends again. The CLI names the session it continues, `predecessorSessionId`, on each pull; it
 * is recorded the first time.
 */
export async function orchestratorCallbacksPull(
    userId: string,
    sessionId: string,
    predecessorSessionId: string | undefined,
): Promise<Array<{ runId: string; title: string; status: string; endedAt: string }>> {
    if (predecessorSessionId) {
        await db.session.updateMany({
            where: { id: sessionId, accountId: userId, predecessorSessionId: null },
            data: { predecessorSessionId },
        });
    }
    const rows = await db.orchestratorRunCallback.findMany({
        where: {
            sessionId: { in: await orchestratorCallbackScope(userId, sessionId) },
            run: { accountId: userId, status: { in: [...RUN_TERMINAL_STATUSES] } },
        },
        orderBy: { endedAt: 'asc' },
        take: MAX_PULLED_CALLBACKS,
        select: {
            runId: true,
            endedAt: true,
            run: { select: { title: true, status: true } },
        },
    });
    // A run owed to the session and to one it continues is one callback
    const callbacks = new Map(rows.map((row) => [row.runId, {
        runId: row.runId,
        title: row.run.title,
        status: row.run.status,
        endedAt: row.endedAt.toISOString(),
    }]));
    return [...callbacks.values()];
}

/**
 * Settle callbacks the session's agent has had: it knows each run as of `knownAt` — the endedAt
 * of a callback it was given, or the updatedAt of a run a tool showed it ended. A round that
 * ended after that is still owed. Idempotent.
 */
export async function orchestratorCallbacksAck(
    userId: string,
    sessionId: string,
    runs: Array<{ runId: string; knownAt: Date }>,
): Promise<void> {
    await db.orchestratorRunCallback.deleteMany({
        where: {
            sessionId: { in: await orchestratorCallbackScope(userId, sessionId) },
            run: { accountId: userId },
            OR: runs.map(({ runId, knownAt }) => ({ runId, endedAt: { lte: knownAt } })),
        },
    });
}
