import { describe, expect, test } from 'vitest';
import { getGithubCommentFallbackRoute } from './githubCommentNavigation';

describe('getGithubCommentFallbackRoute', () => {
    test('returns issue detail route for issue comments', () => {
        expect(getGithubCommentFallbackRoute('issue', 'openai', 'codex', 123)).toBe('/repos/openai/codex/issue/123');
    });

    test('returns PR detail route for PR comments', () => {
        expect(getGithubCommentFallbackRoute('pull', 'openai', 'codex', 456)).toBe('/repos/openai/codex/pulls/456');
    });

    test('encodes owner and repo segments used in fallback routes', () => {
        expect(getGithubCommentFallbackRoute('issue', 'owner name', 'repo/name', 7)).toBe('/repos/owner%20name/repo%2Fname/issue/7');
    });
});
