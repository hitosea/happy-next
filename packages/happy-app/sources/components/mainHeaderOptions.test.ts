import { describe, expect, it } from 'vitest';
import { shouldProvideMainHeaderRight } from './mainHeaderOptions';

describe('shouldProvideMainHeaderRight', () => {
    it('provides a headerRight option on the GitHub tab for the repo picker', () => {
        expect(shouldProvideMainHeaderRight('github')).toBe(true);
    });

    it('continues to provide headerRight for tabs that use actions or centering placeholders', () => {
        expect(shouldProvideMainHeaderRight('sessions')).toBe(true);
        expect(shouldProvideMainHeaderRight('inbox')).toBe(true);
        expect(shouldProvideMainHeaderRight('dootask')).toBe(true);
        expect(shouldProvideMainHeaderRight('settings')).toBe(true);
    });
});
