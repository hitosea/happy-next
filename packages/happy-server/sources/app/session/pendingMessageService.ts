import { Prisma } from "@prisma/client";
import { db } from "@/storage/db";

export type PendingMessageContent = {
    t: "encrypted";
    c: string;
};

export type PendingMessageRecord = {
    id: string;
    sessionId: string;
    localId: string;
    content: PendingMessageContent;
    sentBy: string | null;
    sentByName: string | null;
    trackCliDelivery: boolean;
    pinnedAt: Date | null;
    pausedAt: Date | null;
    deliverAt: Date | null;
    steeringAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
};

const pendingMessageSelect = {
    id: true,
    sessionId: true,
    localId: true,
    content: true,
    sentBy: true,
    sentByName: true,
    trackCliDelivery: true,
    pinnedAt: true,
    pausedAt: true,
    deliverAt: true,
    steeringAt: true,
    createdAt: true,
    updatedAt: true,
} as const;

export async function listPendingMessages(sessionId: string): Promise<PendingMessageRecord[]> {
    const [pinned, normal] = await Promise.all([
        db.sessionPendingMessage.findMany({
            where: {
                sessionId,
                pinnedAt: { not: null },
            },
            orderBy: [
                { pinnedAt: "desc" },
                { createdAt: "asc" },
            ],
            select: pendingMessageSelect,
        }),
        db.sessionPendingMessage.findMany({
            where: {
                sessionId,
                pinnedAt: null,
            },
            orderBy: {
                createdAt: "asc",
            },
            select: pendingMessageSelect,
        }),
    ]);

    return [...pinned, ...normal] as PendingMessageRecord[];
}

export async function findPendingMessageBySessionLocalId(sessionId: string, localId: string): Promise<PendingMessageRecord | null> {
    const message = await db.sessionPendingMessage.findUnique({
        where: {
            sessionId_localId: {
                sessionId,
                localId,
            },
        },
        select: pendingMessageSelect,
    });

    return message as PendingMessageRecord | null;
}

export async function findPendingMessageById(sessionId: string, pendingId: string): Promise<PendingMessageRecord | null> {
    const message = await db.sessionPendingMessage.findUnique({
        where: {
            id: pendingId,
        },
        select: pendingMessageSelect,
    });

    if (!message || message.sessionId !== sessionId) {
        return null;
    }

    return message as PendingMessageRecord;
}

export async function enqueuePendingMessage(params: {
    sessionId: string;
    localId: string;
    content: string;
    sentBy: string | null;
    sentByName: string | null;
    trackCliDelivery: boolean;
    deliverAt?: Date | null;
}): Promise<{ message: PendingMessageRecord; created: boolean }> {
    const existing = await findPendingMessageBySessionLocalId(params.sessionId, params.localId);
    if (existing) {
        return { message: existing, created: false };
    }

    try {
        const created = await db.sessionPendingMessage.create({
            data: {
                sessionId: params.sessionId,
                localId: params.localId,
                content: {
                    t: "encrypted",
                    c: params.content,
                },
                sentBy: params.sentBy,
                sentByName: params.sentByName,
                trackCliDelivery: params.trackCliDelivery,
                deliverAt: params.deliverAt ?? null,
            },
            select: pendingMessageSelect,
        });

        return {
            message: created as PendingMessageRecord,
            created: true,
        };
    } catch (error) {
        // A concurrent request (e.g. hedged retries sharing one localId) may have
        // inserted the same (sessionId, localId) between our check and create.
        // Treat the unique-constraint violation as idempotent: return the row the
        // other request created instead of failing.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
            const winner = await findPendingMessageBySessionLocalId(params.sessionId, params.localId);
            if (winner) {
                return { message: winner, created: false };
            }
        }
        throw error;
    }
}

/** The result of changing a queued message: `steering` when it is steered and can no longer change. */
export type PendingMessageChange = PendingMessageRecord | "steering" | null;

// Change a queued message unless it is steering: by then it is the agent's, so it can only be read
// or dropped. The update is conditional, so one that races a steer start loses to it.
async function updateUnlessSteering(
    sessionId: string,
    pendingId: string,
    data: (message: PendingMessageRecord) => Prisma.SessionPendingMessageUpdateManyMutationInput,
): Promise<PendingMessageChange> {
    const message = await findPendingMessageById(sessionId, pendingId);
    if (!message) {
        return null;
    }
    if (message.steeringAt) {
        return "steering";
    }

    const updated = await db.sessionPendingMessage.updateMany({
        where: {
            id: pendingId,
            sessionId,
            steeringAt: null,
        },
        data: data(message),
    });
    if (updated.count === 0) {
        const current = await findPendingMessageById(sessionId, pendingId);
        return current?.steeringAt ? "steering" : null;
    }

    return findPendingMessageById(sessionId, pendingId);
}

export async function pinPendingMessage(sessionId: string, pendingId: string): Promise<PendingMessageChange> {
    return updateUnlessSteering(sessionId, pendingId, (message) => ({
        pinnedAt: message.pinnedAt ? null : new Date(),
    }));
}

// Toggle the paused state of a pending message. A paused message stays in the
// session (and is still listed/synced) but is excluded from auto-dispatch — it
// behaves as a draft until resumed. Mirrors pinPendingMessage's toggle shape.
export async function pausePendingMessage(sessionId: string, pendingId: string): Promise<PendingMessageChange> {
    return updateUnlessSteering(sessionId, pendingId, (message) => ({
        pausedAt: message.pausedAt ? null : new Date(),
    }));
}

// Replace the (client-encrypted) content of a pending message. The server only
// stores ciphertext: `content` is the already-encrypted string produced by the
// client, wrapped the same way as enqueue.
export async function updatePendingMessageContent(sessionId: string, pendingId: string, content: string): Promise<PendingMessageChange> {
    return updateUnlessSteering(sessionId, pendingId, () => ({
        content: {
            t: "encrypted",
            c: content,
        },
    }));
}

// Set or clear the scheduled delivery time. Independent of content updates so a
// reschedule never touches the ciphertext.
export async function updatePendingMessageDeliverAt(sessionId: string, pendingId: string, deliverAt: Date | null): Promise<PendingMessageChange> {
    return updateUnlessSteering(sessionId, pendingId, () => ({
        deliverAt,
    }));
}

// Make a pending message the next one to dispatch: resume it, drop any schedule
// and pin it. Sets state instead of toggling, so retries are idempotent.
export async function releasePendingMessageForSendNow(sessionId: string, pendingId: string): Promise<PendingMessageChange> {
    return updateUnlessSteering(sessionId, pendingId, (message) => ({
        pausedAt: null,
        deliverAt: null,
        pinnedAt: message.pinnedAt ?? new Date(),
    }));
}

// A pending message is dispatchable when it is not a paused draft and its
// scheduled time (if any) has arrived.
function dispatchableWhere(now: Date) {
    return {
        pausedAt: null,
        OR: [
            { deliverAt: null },
            { deliverAt: { lte: now } },
        ],
    };
}

// Whether the session has a message that is ready to go out. Paused drafts and
// not-yet-due scheduled messages must not gate new sends into the queue.
export async function hasDispatchablePendingMessage(sessionId: string): Promise<boolean> {
    const found = await db.sessionPendingMessage.findFirst({
        where: {
            sessionId,
            ...dispatchableWhere(new Date()),
        },
        select: {
            id: true,
        },
    });

    return !!found;
}

// Sessions that have at least one scheduled message whose time has arrived.
export async function listSessionIdsWithDueScheduledMessages(limit = 100): Promise<string[]> {
    const rows = await db.sessionPendingMessage.findMany({
        where: {
            pausedAt: null,
            deliverAt: { lte: new Date() },
        },
        orderBy: {
            deliverAt: "asc",
        },
        distinct: ["sessionId"],
        take: limit,
        select: {
            sessionId: true,
        },
    });

    return rows.map((row) => row.sessionId);
}

// Owned sessions that still have a scheduled message waiting to go out, with the earliest
// delivery time — paused ones won't fire on their own, so they don't count. Feeds the
// session list's schedule icon and the hover card's countdown.
export async function listScheduledSessions(accountId: string): Promise<{ sessionId: string; nextDeliverAt: number }[]> {
    const rows = await db.sessionPendingMessage.groupBy({
        by: ["sessionId"],
        where: {
            pausedAt: null,
            deliverAt: { not: null },
            session: { accountId },
        },
        _min: {
            deliverAt: true,
        },
    });

    return rows.flatMap((row) => row._min.deliverAt
        ? [{ sessionId: row.sessionId, nextDeliverAt: row._min.deliverAt.getTime() }]
        : []);
}

export async function deletePendingMessage(sessionId: string, pendingId: string): Promise<PendingMessageChange> {
    return db.$transaction(async (tx) => {
        const message = await tx.sessionPendingMessage.findUnique({
            where: {
                id: pendingId,
            },
            select: pendingMessageSelect,
        });

        if (!message || message.sessionId !== sessionId) {
            return null;
        }
        if (message.steeringAt) {
            return "steering";
        }

        const deleted = await tx.sessionPendingMessage.deleteMany({
            where: {
                id: pendingId,
                sessionId,
                steeringAt: null,
            },
        });

        if (deleted.count === 0) {
            return null;
        }

        return message as PendingMessageRecord;
    });
}

export async function takeNextPendingMessageForDispatch(sessionId: string): Promise<PendingMessageRecord | null> {
    return db.$transaction(async (tx) => {
        // A steered message the agent has not read yet goes before everything queued after it:
        // nothing is sent until it is read (and on the wall) or dropped back into the queue.
        const steering = await tx.sessionPendingMessage.findFirst({
            where: {
                sessionId,
                steeringAt: { not: null },
            },
            select: { id: true },
        });
        if (steering) {
            return null;
        }

        const candidate = await tx.sessionPendingMessage.findFirst({
            where: {
                sessionId,
                // Paused messages are drafts: never auto-dispatched, never block
                // the queue. Scheduled messages wait for their time. Dispatch
                // always picks the next non-paused, due message.
                ...dispatchableWhere(new Date()),
            },
            orderBy: [
                { pinnedAt: { sort: "desc", nulls: "last" } },
                { createdAt: "asc" },
            ],
            select: pendingMessageSelect,
        });

        if (!candidate) {
            return null;
        }

        const deleted = await tx.sessionPendingMessage.deleteMany({
            where: {
                id: candidate.id,
                sessionId,
            },
        });

        if (deleted.count === 0) {
            return null;
        }

        return candidate as PendingMessageRecord;
    });
}

/**
 * Mark a queued message as steering. Only a message that would go out on its own can be steered —
 * not a paused draft, not one scheduled for later. Steering one already steering changes nothing.
 */
export async function startSteeringPendingMessage(sessionId: string, pendingId: string): Promise<
    | { status: "started"; message: PendingMessageRecord }
    | { status: "already"; message: PendingMessageRecord }
    | { status: "not_found" }
    | { status: "not_ready" }
> {
    const message = await findPendingMessageById(sessionId, pendingId);
    if (!message) {
        return { status: "not_found" };
    }
    if (message.steeringAt) {
        return { status: "already", message };
    }
    if (message.pausedAt || message.deliverAt) {
        return { status: "not_ready" };
    }

    const updated = await db.sessionPendingMessage.updateMany({
        where: {
            id: pendingId,
            sessionId,
            steeringAt: null,
            pausedAt: null,
            deliverAt: null,
        },
        data: {
            steeringAt: new Date(),
        },
    });
    const current = await findPendingMessageById(sessionId, pendingId);
    if (!current) {
        return { status: "not_found" };
    }
    if (updated.count === 0) {
        return current.steeringAt ? { status: "already", message: current } : { status: "not_ready" };
    }
    return { status: "started", message: current };
}

/**
 * Put a steering message back in the queue, where it was. `steeringAt` names the steer being undone,
 * so undoing a steer that failed never clears a later one of the same message.
 */
export async function stopSteeringPendingMessage(sessionId: string, pendingId: string, steeringAt?: Date): Promise<PendingMessageRecord | null> {
    const updated = await db.sessionPendingMessage.updateMany({
        where: {
            id: pendingId,
            sessionId,
            steeringAt: steeringAt ?? { not: null },
        },
        data: {
            steeringAt: null,
        },
    });
    if (updated.count === 0) {
        return null;
    }
    return findPendingMessageById(sessionId, pendingId);
}

/**
 * Put the steering messages of a session back in the queue — with `steeredBefore`, only those
 * steered before then; returns them as they now are.
 */
export async function stopSteeringAllPendingMessages(sessionId: string, steeredBefore?: Date): Promise<PendingMessageRecord[]> {
    const steering = await db.sessionPendingMessage.findMany({
        where: {
            sessionId,
            steeringAt: steeredBefore ? { not: null, lt: steeredBefore } : { not: null },
        },
        select: { id: true, steeringAt: true },
    });

    const released: PendingMessageRecord[] = [];
    for (const message of steering) {
        const record = await stopSteeringPendingMessage(sessionId, message.id, message.steeringAt!);
        if (record) {
            released.push(record);
        }
    }
    return released;
}

/**
 * Take a message the agent has read out of the queue. Taken even when it is no longer marked
 * steering (it went back when the CLI's connection dropped): the agent has it either way.
 */
export async function takeSteeredPendingMessage(sessionId: string, pendingId: string): Promise<PendingMessageRecord | null> {
    return db.$transaction(async (tx) => {
        const message = await tx.sessionPendingMessage.findUnique({
            where: {
                id: pendingId,
            },
            select: pendingMessageSelect,
        });
        if (!message || message.sessionId !== sessionId) {
            return null;
        }

        const deleted = await tx.sessionPendingMessage.deleteMany({
            where: {
                id: pendingId,
                sessionId,
            },
        });
        if (deleted.count === 0) {
            return null;
        }

        return message as PendingMessageRecord;
    });
}
