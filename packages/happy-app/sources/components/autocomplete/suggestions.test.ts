import { beforeEach, describe, expect, it, vi } from 'vitest';

const { searchCommands, searchSkills, getAllCommands, getSkillsFromSession, getCapabilityCommands, searchCapabilitySkills } = vi.hoisted(() => ({
    searchCommands: vi.fn(),
    searchSkills: vi.fn(),
    getAllCommands: vi.fn(),
    getSkillsFromSession: vi.fn(),
    getCapabilityCommands: vi.fn(),
    searchCapabilitySkills: vi.fn(),
}));

vi.mock('@/components/AgentInputSuggestionView', () => ({
    CommandSuggestion: () => null,
    FileMentionSuggestion: () => null,
    SkillSuggestion: () => null,
}));

vi.mock('@/sync/suggestionCommands', () => ({ searchCommands, getAllCommands, getCapabilityCommands }));
vi.mock('@/sync/suggestionSkills', () => ({ searchSkills, searchCapabilitySkills, getSkillsFromSession }));
vi.mock('@/sync/recentSuggestions', () => ({ getRecentSuggestions: () => [] }));
vi.mock('@/sync/suggestionFile', () => ({ searchFiles: vi.fn() }));
vi.mock('@/sync/sync', () => ({
    sync: { fetchSessionCapabilities: vi.fn() },
}));
vi.mock('@/sync/storage', () => ({
    getSession: () => ({ metadata: { flavor: 'codex' } }),
    storage: {
        getState: () => ({
            sessionCapabilities: {
                session: { capabilities: {} },
            },
        }),
    },
}));

import { getNewSessionSuggestions, getSuggestions } from './suggestions';

describe('getSuggestions', () => {
    beforeEach(() => {
        searchCommands.mockReset();
        searchSkills.mockReset();
        searchCommands.mockResolvedValue([]);
        searchSkills.mockReturnValue([]);
        getAllCommands.mockReset().mockReturnValue([]);
        getSkillsFromSession.mockReset().mockReturnValue([]);
    });

    it('includes commands and skills when completing a slash query', async () => {
        getAllCommands.mockReturnValue([
            { command: 'compact', description: 'Compact conversation' },
        ]);
        getSkillsFromSession.mockReturnValue([
            {
                name: 'imagegen',
                description: 'Generate images',
                scope: 'SYSTEM',
                path: '/skills/imagegen/SKILL.md',
            },
        ]);

        const suggestions = await getSuggestions('session', '/');

        expect(suggestions.map((suggestion) => suggestion.text)).toEqual([
            '/compact',
            '$imagegen',
        ]);

        const skillElement = (suggestions[1].component as unknown as () => { props: Record<string, unknown> })();
        expect(skillElement.props.showSkillCategory).toBe(true);
    });

    it('ranks slash commands and skills together as one list', async () => {
        getAllCommands.mockReturnValue([
            { command: 'review', description: 'Review changes' },
            { command: 'clear', description: 'Clear the conversation' },
        ]);
        getSkillsFromSession.mockReturnValue([
            { name: 'imagegen', description: 'Generate images', scope: 'SYSTEM', path: '/skills/imagegen/SKILL.md' },
            { name: 'debug-helper', description: 'Review crashes', scope: 'USER', path: '/skills/debug-helper/SKILL.md' },
        ]);

        expect((await getSuggestions('session', '/')).map((suggestion) => suggestion.text)).toEqual([
            '/clear',
            '$debug-helper',
            '$imagegen',
            '/review',
        ]);
        expect((await getSuggestions('session', '/rev')).map((suggestion) => suggestion.text)).toEqual([
            '/review',
            '$debug-helper',
        ]);
    });

    it('only shows subcommands after a slash command and space', async () => {
        searchCommands.mockResolvedValue([
            { command: 'review base', description: 'Review against a base branch' },
            { command: 'review commit', description: 'Review a commit' },
        ]);
        searchSkills.mockReturnValue([
            {
                name: 'review-helper',
                description: 'Help with reviews',
                scope: 'SYSTEM',
                path: '/skills/review-helper/SKILL.md',
            },
        ]);

        const suggestions = await getSuggestions('session', '/review ');

        expect(suggestions.map((suggestion) => suggestion.text)).toEqual([
            '/review base',
            '/review commit',
        ]);
        expect(getSkillsFromSession).not.toHaveBeenCalled();
    });

    it('shows no suggestions for free-form command arguments without subcommands', async () => {
        const suggestions = await getSuggestions('session', '/custom argument');

        expect(suggestions).toEqual([]);
        expect(searchCommands).toHaveBeenCalledWith('session', 'custom argument');
        expect(getSkillsFromSession).not.toHaveBeenCalled();
    });

    it('keeps dollar completion limited to skills with the scope label', async () => {
        searchSkills.mockReturnValue([
            {
                name: 'imagegen',
                description: 'Generate images',
                scope: 'SYSTEM',
                path: '/skills/imagegen/SKILL.md',
            },
        ]);

        const suggestions = await getSuggestions('session', '$image');

        expect(suggestions.map((suggestion) => suggestion.text)).toEqual(['$imagegen']);
        expect(searchCommands).not.toHaveBeenCalled();

        const skillElement = (suggestions[0].component as unknown as () => { props: Record<string, unknown> })();
        expect(skillElement.props.showSkillCategory).toBeUndefined();
    });
});

describe('getNewSessionSuggestions', () => {
    const capabilities = {
        slashCommandMetadata: [],
        skills: [{ name: 'imagegen', description: 'Generate images', scope: 'USER' as const, path: '/skills/imagegen/SKILL.md' }],
    };

    beforeEach(() => {
        getCapabilityCommands.mockReset();
        searchCapabilitySkills.mockReset();
        getCapabilityCommands.mockReturnValue([
            { command: 'release', description: 'Cut a release', scope: 'REPO', kind: 'skill' },
            { command: 'orchestrator:codex', description: 'Delegate work', scope: 'SYSTEM', kind: 'command' },
        ]);
        searchCapabilitySkills.mockReturnValue([
            { name: 'imagegen', description: 'Generate images', scope: 'USER', path: '/skills/imagegen/SKILL.md' },
        ]);
    });

    it('ranks discovered commands and skills together for a slash query', () => {
        expect(getNewSessionSuggestions(capabilities, 'codex', '/').map((suggestion) => suggestion.text))
            .toEqual(['$imagegen', '/orchestrator:codex', '/release']);
        expect(getNewSessionSuggestions(capabilities, 'codex', '/rel').map((suggestion) => suggestion.text))
            .toEqual(['/release']);
        expect(getCapabilityCommands).toHaveBeenCalledWith(capabilities);
    });

    it('shows nothing once a slash command is followed by arguments', () => {
        expect(getNewSessionSuggestions(capabilities, 'claude', '/release now')).toEqual([]);
        expect(getCapabilityCommands).not.toHaveBeenCalled();
    });

    it('limits dollar completion to skills', () => {
        const suggestions = getNewSessionSuggestions(capabilities, 'claude', '$img');

        expect(getCapabilityCommands).not.toHaveBeenCalled();
        expect(suggestions.map((suggestion) => suggestion.text)).toEqual(['$imagegen']);
    });
});
