import { beforeEach, describe, expect, it, vi } from 'vitest';

const { searchCommands, searchSkills, searchCapabilityCommands, searchCapabilitySkills } = vi.hoisted(() => ({
    searchCommands: vi.fn(),
    searchSkills: vi.fn(),
    searchCapabilityCommands: vi.fn(),
    searchCapabilitySkills: vi.fn(),
}));

vi.mock('@/components/AgentInputSuggestionView', () => ({
    CommandSuggestion: () => null,
    FileMentionSuggestion: () => null,
    SkillSuggestion: () => null,
}));

vi.mock('@/sync/suggestionCommands', () => ({ searchCommands, searchCapabilityCommands }));
vi.mock('@/sync/suggestionSkills', () => ({ searchSkills, searchCapabilitySkills }));
vi.mock('@/sync/suggestionFile', () => ({ searchFiles: vi.fn() }));
vi.mock('@/sync/sync', () => ({
    sync: { fetchSessionCapabilities: vi.fn() },
}));
vi.mock('@/sync/storage', () => ({
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
    });

    it('includes commands and skills when completing a slash query', async () => {
        searchCommands.mockResolvedValue([
            { command: 'compact', description: 'Compact conversation' },
        ]);
        searchSkills.mockReturnValue([
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
        expect(searchSkills).not.toHaveBeenCalled();
    });

    it('shows no suggestions for free-form command arguments without subcommands', async () => {
        const suggestions = await getSuggestions('session', '/custom argument');

        expect(suggestions).toEqual([]);
        expect(searchCommands).toHaveBeenCalledWith('session', 'custom argument');
        expect(searchSkills).not.toHaveBeenCalled();
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
    const capabilities = { slashCommandMetadata: [], skills: [] };

    beforeEach(() => {
        searchCapabilityCommands.mockReset();
        searchCapabilitySkills.mockReset();
        searchCapabilityCommands.mockReturnValue([
            { command: 'release', description: 'Cut a release', scope: 'REPO', kind: 'skill' },
        ]);
        searchCapabilitySkills.mockReturnValue([
            { name: 'imagegen', description: 'Generate images', scope: 'USER', path: '/skills/imagegen/SKILL.md' },
        ]);
    });

    it('searches discovered commands and skills for a slash query', () => {
        const suggestions = getNewSessionSuggestions(capabilities, '/rel');

        expect(searchCapabilityCommands).toHaveBeenCalledWith(capabilities, 'rel');
        expect(searchCapabilitySkills).toHaveBeenCalledWith(capabilities, 'rel');
        expect(suggestions.map((suggestion) => suggestion.text)).toEqual(['/release', '$imagegen']);
    });

    it('shows nothing once a slash command is followed by arguments', () => {
        expect(getNewSessionSuggestions(capabilities, '/release now')).toEqual([]);
        expect(searchCapabilityCommands).not.toHaveBeenCalled();
    });

    it('limits dollar completion to skills', () => {
        const suggestions = getNewSessionSuggestions(capabilities, '$img');

        expect(searchCapabilityCommands).not.toHaveBeenCalled();
        expect(suggestions.map((suggestion) => suggestion.text)).toEqual(['$imagegen']);
    });
});
