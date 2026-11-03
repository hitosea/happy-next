import { db } from "@/storage/db";
import { inTx } from "@/storage/inTx";
import { Context } from "@/context";
import { orchestratorRunCallbackSessionIds } from "./sessions";
import { orchestratorCallbackRecipients, orchestratorSessionConnections } from "./callbacks";
import { addTaskCount, createEmptySummaryInternal, isRunTerminal, toPublicSummary } from "./state";

/**
 * Requests holding a run open to return its result themselves (`/exec` with `waitMs`), by run id.
 * While one waits, the run's end is not announced to the sessions: the caller is still in the tool
 * call that started the run, and its CLI settles the callback once the agent has the result. A
 * callback the agent never got (the call was aborted) is still in the ledger for the next pull.
 */
const runTerminalWaiters = new Map<string, () => void>();

/**
 * Wait up to `timeoutMs` for a run to finish. `isTerminal` is checked once the waiter is in place,
 * so a run that finished before is not missed. Resolves false on timeout or when `signal` aborts
 * (the caller went away), after which the run's terminal callback goes to its sessions as usual.
 */
export async function awaitOrchestratorRunTerminal(
    runId: string,
    timeoutMs: number,
    isTerminal: () => Promise<boolean>,
    signal: AbortSignal,
): Promise<boolean> {
    let timer: NodeJS.Timeout | undefined;
    let abort: (() => void) | undefined;
    const finished = new Promise<boolean>((resolve) => {
        runTerminalWaiters.set(runId, () => resolve(true));
        timer = setTimeout(() => resolve(false), timeoutMs);
        abort = () => {
            runTerminalWaiters.delete(runId);
            resolve(false);
        };
        signal.addEventListener('abort', abort);
    });
    try {
        if (signal.aborted) {
            return false;
        }
        if (await isTerminal()) {
            return true;
        }
        return await finished;
    } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort!);
        runTerminalWaiters.delete(runId);
    }
}

/**
 * Tell whoever is waiting on a run that it has finished. Called once, after the transaction that
 * made the run terminal (and wrote its callbacks, see callbacks.ts) commits. A request waiting on
 * the run gets it. Otherwise each session owed the callback gets an `orchestrator-run-terminal`
 * ephemeral, which prompts its CLI to pull it — as does each session continuing one that is
 * offline — and if none of them is connected, the user gets a notice in their feed.
 *
 * A CLI older than the ledger takes the callback from the ephemeral or the waiting request and
 * never acks it, so its session's callback is settled here.
 */
export async function notifyOrchestratorRunTerminal(userId: string, runId: string): Promise<void> {
    const waiter = runTerminalWaiters.get(runId);
    runTerminalWaiters.delete(runId);
    waiter?.();

    const run = await db.orchestratorRun.findUnique({
        where: { id: runId },
        select: { id: true, title: true, status: true, controllerSessionId: true, reopenedAt: true, cancelledBySessionId: true },
    });
    if (!run || !isRunTerminal(run.status)) {
        return;
    }
    const callbackSessionIds = await orchestratorRunCallbackSessionIds(db, run);
    if (callbackSessionIds.length === 0) {
        return;
    }
    const online = await orchestratorSessionConnections(userId);
    await db.orchestratorRunCallback.deleteMany({
        where: {
            runId,
            sessionId: {
                in: callbackSessionIds.filter((id) => online.get(id)?.some((connection) => !connection.supportsCallbackLedger)),
            },
        },
    });
    if (waiter) {
        return;
    }

    const { eventRouter, buildOrchestratorRunTerminalEphemeral } = await import("@/app/events/eventRouter");
    let delivered = 0;
    for (const sessionId of await orchestratorCallbackRecipients(userId, callbackSessionIds, online)) {
        const delivery = eventRouter.emitEphemeral({
            userId,
            payload: buildOrchestratorRunTerminalEphemeral(run.id, run.status, run.title),
            recipientFilter: {
                type: 'all-interested-in-session',
                sessionId,
            },
        });
        delivered += delivery.sessionScoped;
    }
    if (delivered > 0) {
        return;
    }

    const grouped = await db.orchestratorTask.groupBy({
        by: ['status'],
        where: { runId: run.id },
        _count: { _all: true },
    });
    const internal = createEmptySummaryInternal();
    for (const row of grouped) {
        addTaskCount(internal, row.status, row._count._all);
    }
    const s = toPublicSummary(internal);
    const { feedPost } = await import("@/app/feed/feedPost");
    await inTx(async (tx) => {
        await feedPost(tx, Context.create(userId), {
            kind: 'notice',
            // The run's own title is sealed for the app and the sessions, not readable here
            title: `Orchestrator run ${run.status}`,
            text: [
                `Status: ${run.status}`,
                `Tasks: ${s.total} total — ${s.completed} completed, ${s.failed} failed, ${s.cancelled} cancelled`,
                `Run ID: ${run.id}`,
            ].join('\n'),
        }, null, true, {
            links: [{ label: 'Run Details', url: `/orchestrator/${run.id}` }],
        });
    });
}
