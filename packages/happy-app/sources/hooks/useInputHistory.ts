import * as React from 'react';
import { loadInputHistory, saveInputHistory } from '@/sync/persistence';
import { addToInputHistory } from '@/components/inputHistory';

/**
 * Sent-input history (newest first) behind ArrowUp/ArrowDown recall in the composer.
 *
 * One history is shared by every session and the new-session page. The list lives in a
 * module-level store (lazily loaded from MMKV) so a session screen that stays mounted under
 * the new-session page still sees what was sent there once it comes back into view.
 */
let history: string[] | null = null;
const listeners = new Set<() => void>();

function getHistory(): string[] {
    if (history === null) {
        history = loadInputHistory();
    }
    return history;
}

function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

function remember(text: string) {
    const next = addToInputHistory(getHistory(), text);
    if (next === history) return;
    history = next;
    saveInputHistory(next);
    listeners.forEach(listener => listener());
}

export function useInputHistory(): { inputHistory: string[]; rememberSentInput: (text: string) => void } {
    const inputHistory = React.useSyncExternalStore(subscribe, getHistory, getHistory);
    return { inputHistory, rememberSentInput: remember };
}
