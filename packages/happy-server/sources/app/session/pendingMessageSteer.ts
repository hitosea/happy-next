import { Prisma } from "@prisma/client";
import { PendingSteerAckSchema, type PendingSteerRequest, type PendingSteerResult } from "happy-wire";
import {
    buildPendingMessageDeleteEphemeral,
    buildPendingMessageUpsertEphemeral,
    eventRouter,
    type ClientConnection,
    type SessionScopedConnection,
} from "@/app/events/eventRouter";
import { isSessionThinking } from "@/app/presence/sessionTurnRuntime";
import { dispatchNextPendingIfPossible, extractEncryptedText } from "@/app/session/pendingMessageAutoDispatch";
import {
    findPendingMessageById,
    startSteeringPendingMessage,
    stopSteeringAllPendingMessages,
    stopSteeringPendingMessage,
    takeSteeredPendingMessage,
    type PendingMessageRecord,
} from "@/app/session/pendingMessageService";
import { dispatchSessionMessage } from "@/app/session/sessionMessageDispatch";

// Steering ("插话"): a queued message handed to the running turn without interrupting it. It stays
// in the queue, marked steering, until the CLI says the agent read it — only then does it go on the
// wall, where it entered the conversation — or that it was dropped, and it is queued again. While a
// message steers, nothing queued is sent (`takeNextPendingMessageForDispatch`), so the queue keeps
// its order. The protocol is happy-wire's `pendingSteer`.

const STEER_ACK_TIMEOUT_MS = 10_000;

export type SteerPendingMessageResult =
    | { status: "steering"; message: PendingMessageRecord }
    | { status: "not_found" }
    /** Paused or scheduled: steer only what would go out on its own */
    | { status: "not_ready" }
    /** No turn is running, so there is nothing to steer into; send it instead */
    | { status: "not_running" }
    /** No connected CLI of this session takes steered messages */
    | { status: "unsupported" }
    /** The CLI turned it down, or did not answer; the message is queued as before */
    | { status: "rejected"; reason: string };

function findSteerCapableCli(ownerId: string, sessionId: string): SessionScopedConnection | null {
    const connections = eventRouter.getConnections(ownerId);
    if (!connections) {
        return null;
    }
    for (const connection of connections) {
        if (connection.connectionType === "session-scoped" && connection.sessionId === sessionId && connection.supportsPendingSteer) {
            return connection;
        }
    }
    return null;
}

async function emitPendingUpsert(ownerId: string, sessionId: string, message: PendingMessageRecord) {
    await eventRouter.emitEphemeralToSessionSubscribers({
        ownerId,
        sessionId,
        payload: buildPendingMessageUpsertEphemeral(sessionId, message),
        recipientFilter: { type: "all-interested-in-session", sessionId },
    });
}

/**
 * Steer a queued message into the session's running turn: mark it steering, tell the app, and hand
 * it to the CLI. A CLI that turns it down (this agent cannot steer, or not now) or does not answer
 * leaves it queued as before. Steering one that already steers just reports it steering.
 */
export async function steerPendingMessage(params: {
    ownerId: string;
    sessionId: string;
    pendingId: string;
}): Promise<SteerPendingMessageResult> {
    const { ownerId, sessionId, pendingId } = params;
    // A retry of a steer that went through answers the same, whatever has happened since
    const current = await findPendingMessageById(sessionId, pendingId);
    if (!current) {
        return { status: "not_found" };
    }
    if (current.steeringAt) {
        return { status: "steering", message: current };
    }

    const cli = findSteerCapableCli(ownerId, sessionId);
    if (!cli) {
        return { status: "unsupported" };
    }
    if (!isSessionThinking(sessionId)) {
        return { status: "not_running" };
    }

    const started = await startSteeringPendingMessage(sessionId, pendingId);
    if (started.status === "not_found" || started.status === "not_ready") {
        return started;
    }
    if (started.status === "already") {
        return { status: "steering", message: started.message };
    }

    const message = started.message;
    await emitPendingUpsert(ownerId, sessionId, message);

    const request: PendingSteerRequest = {
        sid: sessionId,
        pendingId,
        localId: message.localId,
        content: extractEncryptedText(message.content),
    };
    let reason: string;
    try {
        const ack = PendingSteerAckSchema.safeParse(
            await cli.socket.timeout(STEER_ACK_TIMEOUT_MS).emitWithAck("pending-steer", request),
        );
        if (ack.success && ack.data.accepted) {
            return { status: "steering", message };
        }
        reason = ack.success ? ack.data.reason ?? "rejected" : "invalid_ack";
    } catch {
        reason = "no_answer";
    }

    // Undo this steer only: the CLI may already have reported the message read (and it is gone)
    const restored = await stopSteeringPendingMessage(sessionId, pendingId, message.steeringAt!);
    if (restored) {
        await emitPendingUpsert(ownerId, sessionId, restored);
        // The turn may have ended while the CLI was asked, with the queue held for this message
        await dispatchNextPendingIfPossible({ ownerId, sessionId, delayMs: 0 });
    }
    return { status: "rejected", reason };
}

/**
 * What the CLI says became of a steered message. Read: it leaves the queue and goes on the wall,
 * to everyone but the CLI that already gave it to the agent. Dropped: it is queued again where it
 * was, and goes out like any queued message. Repeats change nothing.
 */
export async function handlePendingSteerResult(params: {
    ownerId: string;
    connection: ClientConnection;
    result: PendingSteerResult;
}): Promise<void> {
    const { ownerId, connection, result } = params;
    const sessionId = result.sid;

    if (result.outcome === "dropped") {
        const restored = await stopSteeringPendingMessage(sessionId, result.pendingId);
        if (restored) {
            await emitPendingUpsert(ownerId, sessionId, restored);
            await dispatchNextPendingIfPossible({ ownerId, sessionId, delayMs: 0 });
        }
        return;
    }

    const message = await takeSteeredPendingMessage(sessionId, result.pendingId);
    if (!message) {
        return;
    }

    await eventRouter.emitEphemeralToSessionSubscribers({
        ownerId,
        sessionId,
        payload: buildPendingMessageDeleteEphemeral(sessionId, message.id),
        recipientFilter: { type: "all-interested-in-session", sessionId },
    });

    try {
        await dispatchSessionMessage({
            ownerId,
            sessionId,
            content: extractEncryptedText(message.content),
            localId: message.localId,
            sentBy: message.sentBy,
            sentByName: message.sentByName,
            // The CLI has it already: there is no delivery to track
            trackCliDelivery: false,
            kind: "text",
            landmark: "prompt",
            skipSenderConnection: connection,
        });
    } catch (error) {
        // Already on the wall under this localId
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) {
            throw error;
        }
    }

    // The queue waited for this one; the turn may be over by now
    await dispatchNextPendingIfPossible({ ownerId, sessionId, delayMs: 0 });
}

/**
 * Queue the steering messages of a session again: its CLI is gone (`all`), or its turn ended
 * without saying what became of them (`settled`). A CLI reports each one before it reports the turn
 * over, so those left then are lost — except one still being handed over, whose answer is awaited
 * by `steerPendingMessage` and settles it either way.
 */
export async function releaseSteeringPendingMessages(ownerId: string, sessionId: string, which: "all" | "settled"): Promise<void> {
    const released = await stopSteeringAllPendingMessages(
        sessionId,
        which === "settled" ? new Date(Date.now() - STEER_ACK_TIMEOUT_MS) : undefined,
    );
    for (const message of released) {
        await emitPendingUpsert(ownerId, sessionId, message);
    }
}
