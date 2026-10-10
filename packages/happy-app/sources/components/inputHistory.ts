export const INPUT_HISTORY_LIMIT = 50;

/**
 * Where the user is while stepping through previously sent inputs with ArrowUp/ArrowDown.
 * `index` -1 means "not browsing"; `stash` holds what was typed before browsing started so
 * stepping back down to the newest position can restore it.
 */
export interface InputHistoryCursor {
    index: number;
    stash: string;
}

export const initialInputHistoryCursor: InputHistoryCursor = { index: -1, stash: '' };

export interface InputHistoryStep {
    cursor: InputHistoryCursor;
    text: string;
}

/** Prepends `text` to a newest-first history, skipping blanks and consecutive duplicates. */
export function addToInputHistory(history: string[], text: string): string[] {
    if (!text.trim() || history[0] === text) {
        return history;
    }
    return [text, ...history].slice(0, INPUT_HISTORY_LIMIT);
}

/**
 * Whether an arrow key should step through history instead of moving the caret.
 * Mirrors shells and chat apps: only with a collapsed caret, and only when the caret
 * is already on the first line (up) or the last line (down) of the input.
 */
export function shouldNavigateInputHistory(
    key: string,
    text: string,
    selection: { start: number; end: number },
): boolean {
    if (selection.start !== selection.end) {
        return false;
    }
    if (key === 'ArrowUp') {
        return !text.slice(0, selection.start).includes('\n');
    }
    if (key === 'ArrowDown') {
        return !text.slice(selection.end).includes('\n');
    }
    return false;
}

/**
 * Moves one entry through a newest-first history.
 * Returns null when the key has nothing to do (so the caller can leave it to the input);
 * otherwise the new cursor and the text to show. Hitting the oldest entry stays put.
 *
 * Browsing ends on its own when the input no longer equals the entry being shown (the user
 * edited it, or it was sent and cleared): the next ArrowUp then starts again from the
 * newest entry with the current text stashed.
 */
export function stepInputHistory(
    cursor: InputHistoryCursor,
    direction: 'older' | 'newer',
    history: string[],
    currentText: string,
): InputHistoryStep | null {
    const browsing = cursor.index >= 0 && history[cursor.index] === currentText;
    const base: InputHistoryCursor = browsing ? cursor : { index: -1, stash: currentText };

    if (direction === 'older') {
        if (history.length === 0) {
            return null;
        }
        const index = Math.min(base.index + 1, history.length - 1);
        return { cursor: { index, stash: base.stash }, text: history[index] };
    }

    if (!browsing) {
        return null;
    }
    const index = base.index - 1;
    return {
        cursor: { index, stash: base.stash },
        text: index < 0 ? base.stash : history[index],
    };
}
