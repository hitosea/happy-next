import * as React from 'react';
import { useRouter } from 'expo-router';
import { sync } from '@/sync/sync';

/**
 * Returns to the home screen from anywhere in the stack, so the session list is read on its own.
 *
 * Marking the open session unread needs it: nothing can read as unread while its own screen is
 * open, so the screen is left rather than leaving someone staring at it.
 */
export function useDismissToHome() {
    const router = useRouter();
    return React.useCallback(() => {
        // On the home screen itself there is nothing to pop. `dismissAll` is a no-op there, but
        // React Navigation still reports the unhandled `POP_TO_TOP` in development.
        if (!router.canDismiss()) return;
        router.dismissAll();
    }, [router]);
}

/**
 * Returns to the home screen only when the session's own screen is open.
 *
 * Archiving needs it: the archived session's screen is still on the stack and its composer empties
 * once the session goes inactive, so it is left first. Archiving any other session from the list
 * leaves the current screen alone.
 */
export function useDismissToHomeIfViewing(sessionId: string) {
    const dismissToHome = useDismissToHome();
    return React.useCallback(() => {
        if (sync.isViewingSession(sessionId)) dismissToHome();
    }, [dismissToHome, sessionId]);
}
