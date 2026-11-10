import * as z from 'zod';

// Steering a queued message into the running turn ("插话"). The server hands the message to the
// session's CLI, which passes it to the agent without interrupting; the message stays in the queue,
// marked as steering, until the agent has read it, and only then goes on the wall.
//
//   server → CLI  `pending-steer` (with ack): here is a queued message, steer it in
//   CLI → server  `pending-steer-result`: the agent read it, or it was dropped and goes back

/** The socket handshake flag a CLI sets when it handles `pending-steer`. */
export const PENDING_STEER_HANDSHAKE_FLAG = 'supportsPendingSteer';

export const PendingSteerRequestSchema = z.object({
    sid: z.string(),
    pendingId: z.string(),
    localId: z.string(),
    /** The message's ciphertext, as stored in the queue */
    content: z.string(),
});
export type PendingSteerRequest = z.infer<typeof PendingSteerRequestSchema>;

/**
 * The CLI's answer to `pending-steer`. `accepted: false` when this agent cannot steer, or not now
 * (no turn running, or one that cannot take input, like Codex's review); the message stays queued.
 */
export const PendingSteerAckSchema = z.object({
    accepted: z.boolean(),
    reason: z.string().optional(),
});
export type PendingSteerAck = z.infer<typeof PendingSteerAckSchema>;

/**
 * `read`: the agent has the message now, so it goes on the wall where it entered the conversation;
 * the CLI sends this once everything the agent produced before it has been sent. Each steered
 * message is reported before the CLI reports the turn over: one still steering then goes back to
 * the queue.
 * `dropped`: the turn ended or was interrupted before the agent took it, and the message is queued
 * again where it was.
 */
export const PendingSteerResultSchema = z.object({
    sid: z.string(),
    pendingId: z.string(),
    outcome: z.enum(['read', 'dropped']),
});
export type PendingSteerResult = z.infer<typeof PendingSteerResultSchema>;
