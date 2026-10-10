import { describe, expect, it } from 'vitest';
import { beginSessionFork, endSessionFork } from './sessionForkProgress';

describe('sessionForkProgress', () => {
    it('refuses a second fork of the same session until the first ends', () => {
        expect(beginSessionFork('a')).toBe(true);
        expect(beginSessionFork('a')).toBe(false);
        expect(beginSessionFork('b')).toBe(true);
        endSessionFork('a');
        expect(beginSessionFork('a')).toBe(true);
        endSessionFork('a');
        endSessionFork('b');
    });

    it('ignores ending a session that is not being forked', () => {
        expect(() => endSessionFork('never-started')).not.toThrow();
    });
});
