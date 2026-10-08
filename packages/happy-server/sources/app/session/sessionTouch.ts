import type { Prisma } from "@prisma/client";
import { db } from "@/storage/db";
import { buildUpdateSessionUpdate, eventRouter } from "@/app/events/eventRouter";
import { allocateUserSeq } from "@/storage/seq";
import { randomKeyNaked } from "@/utils/randomKeyNaked";

/**
 * Bumps Session.updatedAt so incremental /v1/sessions?since= picks up
 * related-table changes (shares, public shares) that don't otherwise
 * write to the Session row. An empty Prisma update does not advance @updatedAt.
 */
export const touchSession = (tx: Prisma.TransactionClient, sessionId: string) =>
    tx.session.update({
        where: { id: sessionId },
        data: { updatedAt: new Date() }
    });

/** Notify the owner's clients to refresh sharing state after a direct share changes. */
export async function emitSessionSharingUpdate(sessionId: string) {
    const session = await db.session.findUnique({
        where: { id: sessionId },
        select: { accountId: true }
    });
    if (!session) return;

    const updateSeq = await allocateUserSeq(session.accountId);
    eventRouter.emitUpdate({
        userId: session.accountId,
        payload: buildUpdateSessionUpdate(sessionId, updateSeq, randomKeyNaked(12)),
        recipientFilter: { type: 'user-scoped-only' }
    });
}
