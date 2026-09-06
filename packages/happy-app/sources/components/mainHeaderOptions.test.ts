import { describe, expect, it } from 'vitest';
import { shouldProvideMainHeaderRight } from './mainHeaderOptions';

describe('shouldProvideMainHeaderRight', () => {
    it('does not provide a headerRight option on the GitHub tab', () => {
        expect(shouldProvideMainHeaderRight('github')).toBe(false);
    });

    it('continues to provide headerRight for tabs that use actions or centering placeholders', () => {
        expect(shouldProvideMainHeaderRight('sessions')).toBe(true);
        expect(shouldProvideMainHeaderRight('inbox')).toBe(true);
        expect(shouldProvideMainHeaderRight('dootask')).toBe(true);
        expect(shouldProvideMainHeaderRight('settings')).toBe(true);
    });

    it('does not provide headerRight for tabs that have no menu actions', () => {
        expect(shouldProvideMainHeaderRight('github')).toBe(false);
    });
});
