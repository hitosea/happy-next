import type { ApiSessionClient } from "@/api/apiSession";
import { logger } from "@/lib";

interface KillSessionRequest {
    // No parameters needed
}

interface KillSessionResponse {
    success: boolean;
    message: string;
}

/**
 * Stop this happy process when the app kills the session, or when the session turns up archived
 * by someone else — an archive the app wrote while it could not reach this process (a dropped
 * connection), seen as an update or after reconnecting.
 */
export function registerKillSessionHandler(
    session: ApiSessionClient,
    killThisHappy: () => Promise<void>
) {
    session.rpcHandlerManager.registerHandler<KillSessionRequest, KillSessionResponse>('killSession', async () => {
        logger.debug('Kill session request received');

        // This will start the cleanup process
        void killThisHappy();

        // We should still be able to respond the the client, though they
        // should optimistically assume the session is dead.
        return {
            success: true,
            message: 'Killing happy-cli process'
        };
    });
    session.onArchived(() => {
        logger.debug('Session archived elsewhere, killing');
        void killThisHappy();
    });
}
