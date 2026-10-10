import { describe, expect, it } from 'vitest';
import {
    INPUT_HISTORY_LIMIT,
    addToInputHistory,
    initialInputHistoryCursor,
    shouldNavigateInputHistory,
    stepInputHistory,
} from './inputHistory';

const caret = (position: number) => ({ start: position, end: position });

describe('addToInputHistory', () => {
    it('prepends the newest entry', () => {
        expect(addToInputHistory(['a'], 'b')).toEqual(['b', 'a']);
    });

    it('ignores blank text and consecutive duplicates', () => {
        const history = ['a'];
        expect(addToInputHistory(history, '   ')).toBe(history);
        expect(addToInputHistory(history, 'a')).toBe(history);
    });

    it('keeps non-consecutive duplicates', () => {
        expect(addToInputHistory(['b', 'a'], 'a')).toEqual(['a', 'b', 'a']);
    });

    it('caps the history length', () => {
        const full = Array.from({ length: INPUT_HISTORY_LIMIT }, (_, i) => `m${i}`);
        const next = addToInputHistory(full, 'new');
        expect(next).toHaveLength(INPUT_HISTORY_LIMIT);
        expect(next[0]).toBe('new');
        expect(next[INPUT_HISTORY_LIMIT - 1]).toBe(`m${INPUT_HISTORY_LIMIT - 2}`);
    });
});

describe('shouldNavigateInputHistory', () => {
    it('navigates up only from the first line', () => {
        expect(shouldNavigateInputHistory('ArrowUp', 'one\ntwo', caret(2))).toBe(true);
        expect(shouldNavigateInputHistory('ArrowUp', 'one\ntwo', caret(5))).toBe(false);
    });

    it('navigates down only from the last line', () => {
        expect(shouldNavigateInputHistory('ArrowDown', 'one\ntwo', caret(5))).toBe(true);
        expect(shouldNavigateInputHistory('ArrowDown', 'one\ntwo', caret(2))).toBe(false);
    });

    it('does not navigate with a text selection', () => {
        expect(shouldNavigateInputHistory('ArrowUp', 'hello', { start: 0, end: 3 })).toBe(false);
    });

    it('works on an empty input and ignores other keys', () => {
        expect(shouldNavigateInputHistory('ArrowUp', '', caret(0))).toBe(true);
        expect(shouldNavigateInputHistory('Enter', '', caret(0))).toBe(false);
    });
});

describe('stepInputHistory', () => {
    const history = ['newest', 'middle', 'oldest'];

    it('does nothing without history', () => {
        expect(stepInputHistory(initialInputHistoryCursor, 'older', [], 'draft')).toBeNull();
    });

    it('does nothing on ArrowDown when not browsing', () => {
        expect(stepInputHistory(initialInputHistoryCursor, 'newer', history, 'draft')).toBeNull();
    });

    it('walks back and forth, restoring the stashed draft at the bottom', () => {
        const first = stepInputHistory(initialInputHistoryCursor, 'older', history, 'draft')!;
        expect(first.text).toBe('newest');
        expect(first.cursor).toEqual({ index: 0, stash: 'draft' });

        const second = stepInputHistory(first.cursor, 'older', history, first.text)!;
        expect(second.text).toBe('middle');

        const back = stepInputHistory(second.cursor, 'newer', history, second.text)!;
        expect(back.text).toBe('newest');

        const bottom = stepInputHistory(back.cursor, 'newer', history, back.text)!;
        expect(bottom.text).toBe('draft');
        expect(bottom.cursor.index).toBe(-1);

        expect(stepInputHistory(bottom.cursor, 'newer', history, bottom.text)).toBeNull();
    });

    it('stays on the oldest entry', () => {
        const cursor = { index: 2, stash: 'draft' };
        const step = stepInputHistory(cursor, 'older', history, 'oldest')!;
        expect(step.text).toBe('oldest');
        expect(step.cursor.index).toBe(2);
    });

    it('restores an empty draft', () => {
        const first = stepInputHistory(initialInputHistoryCursor, 'older', history, '')!;
        const bottom = stepInputHistory(first.cursor, 'newer', history, first.text)!;
        expect(bottom.text).toBe('');
    });

    it('starts over from the newest entry after the user edits the recalled text', () => {
        const first = stepInputHistory(initialInputHistoryCursor, 'older', history, '')!;
        const second = stepInputHistory(first.cursor, 'older', history, first.text)!;
        const edited = stepInputHistory(second.cursor, 'older', history, 'middle!')!;
        expect(edited.text).toBe('newest');
        expect(edited.cursor.stash).toBe('middle!');
    });

    it('starts over after the recalled text was sent and cleared', () => {
        const first = stepInputHistory(initialInputHistoryCursor, 'older', history, '')!;
        expect(stepInputHistory(first.cursor, 'newer', history, '')).toBeNull();
    });
});
