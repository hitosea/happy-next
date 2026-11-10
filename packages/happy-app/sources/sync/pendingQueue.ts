import type { PendingMessage } from './storageTypes';

// Messages being steered into the running turn first, then active messages, then scheduled ones
// waiting for their time, then paused drafts, so the list reads top-to-bottom as "going in now" ->
// "what goes out next" -> "later" -> "parked".
function queueRank(message: PendingMessage): number {
    if (message.steeringAt !== null) return -1;
    if (message.pausedAt !== null) return 2;
    if (message.deliverAt !== null) return 1;
    return 0;
}

function comparePendingQueue(a: PendingMessage, b: PendingMessage): number {
    const rankDelta = queueRank(a) - queueRank(b);
    if (rankDelta !== 0) {
        return rankDelta;
    }

    if (a.deliverAt !== null && b.deliverAt !== null && a.deliverAt !== b.deliverAt && a.pausedAt === null && b.pausedAt === null) {
        return a.deliverAt - b.deliverAt;
    }

    if (a.pinnedAt !== null || b.pinnedAt !== null) {
        if (a.pinnedAt === null) return 1;
        if (b.pinnedAt === null) return -1;
        if (a.pinnedAt !== b.pinnedAt) {
            return b.pinnedAt - a.pinnedAt;
        }
    }

    if (a.createdAt !== b.createdAt) {
        return a.createdAt - b.createdAt;
    }

    return a.id.localeCompare(b.id);
}

export function sortPendingQueue(queue: PendingMessage[]): PendingMessage[] {
    return [...queue].sort(comparePendingQueue);
}

export function upsertPendingMessageInQueue(queue: PendingMessage[], pending: PendingMessage): PendingMessage[] {
    const next = queue.filter((item) => item.id !== pending.id);
    next.push(pending);
    return sortPendingQueue(next);
}

export function removePendingMessageFromQueue(queue: PendingMessage[], pendingId: string): PendingMessage[] {
    return queue.filter((item) => item.id !== pendingId);
}
