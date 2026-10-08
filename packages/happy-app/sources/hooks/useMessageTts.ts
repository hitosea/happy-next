import * as React from 'react';
import { getTtsQueueSnapshot, subscribeTtsQueue, toggleMessageTts } from '@/tts/messageTtsQueue';

export type MessageTtsState = 'idle' | 'loading' | 'playing' | 'queued';

/**
 * Per-message "read aloud" button, backed by the global TTS queue in @/tts
 * (playback survives leaving the screen; this hook is only a subscriber).
 * Toggle: idle → play now, or enqueue when something else is playing;
 * queued → remove from queue; loading/playing → stop this one, queue continues.
 */
/** `text` may be a function, read when the button is pressed rather than on every render. */
export function useMessageTts(messageId: string, sessionId: string, text: string | (() => string | null | undefined) | null | undefined) {
    const snap = React.useSyncExternalStore(subscribeTtsQueue, getTtsQueueSnapshot, getTtsQueueSnapshot);

    let state: MessageTtsState = 'idle';
    if (snap.current?.messageId === messageId) {
        state = snap.phase === 'playing' ? 'playing' : 'loading';
    } else if (snap.queue.some((q) => q.messageId === messageId)) {
        state = 'queued';
    }

    const toggle = React.useCallback(() => {
        const resolved = typeof text === 'function' ? text() : text;
        if (!resolved) return;
        toggleMessageTts({ messageId, sessionId, text: resolved });
    }, [messageId, sessionId, text]);

    return { state, toggle };
}
