import { beforeEach, describe, expect, it, vi } from 'vitest';

const { savedRecent } = vi.hoisted(() => ({ savedRecent: { current: {} as Record<string, string[]> } }));

vi.mock('./storage', () => ({ getSession: vi.fn(), storage: { getState: vi.fn() } }));
vi.mock('./persistence', () => ({
    loadRecentSuggestions: () => savedRecent.current,
    saveRecentSuggestions: (recent: Record<string, string[]>) => { savedRecent.current = recent; },
}));

import { getCapabilityCommands } from './suggestionCommands';
import { rankSuggestions } from './suggestionRanking';
import { getRecentSuggestions, rememberSentSuggestions } from './recentSuggestions';
import { searchCapabilitySkills } from './suggestionSkills';

const capabilities = {
    slashCommandMetadata: [
        { name: 'skill-creator', description: 'Guide for creating skills', kind: 'command' as const },
        { name: 'rewind', description: 'Rewind the conversation', kind: 'command' as const },
        { name: 'rename', description: 'Rename the conversation', kind: 'command' as const },
        { name: 'debug', description: 'Help rename nothing, just debug', kind: 'command' as const },
        { name: 'goal', description: 'Set a goal', kind: 'command' as const },
        { name: 're', description: 'Exact name', kind: 'command' as const },
        { name: 'batch', description: 'Batch changes', kind: 'command' as const },
        { name: 'verify', description: 'Verify a change', kind: 'command' as const },
        { name: '_draft', description: 'Internal draft', kind: 'command' as const },
        { name: '_rename-old', description: 'Old rename', kind: 'command' as const },
    ],
    skills: ['imagegen', 'pdf', '_scratch', 'image-edit'].map((name) => ({ name, description: `${name} skill`, scope: 'USER' as const, path: `/skills/${name}` })),
};

// Commands ranked the way searchCommands ranks a session's commands.
const names = (agent: string, query: string) => rankSuggestions(getCapabilityCommands(capabilities), query, {
    name: (item) => item.command,
    recentKey: (item) => `/${item.command}`,
    otherText: (item) => [item.description],
    fuzzyKeys: ['command', 'description'],
    recent: getRecentSuggestions(agent),
    threshold: 0.3,
}).map((item) => item.command);
const skillNames = (agent: string, query: string) => searchCapabilitySkills(capabilities, agent, query).map((item) => item.name);

describe('suggestion ranking', () => {
    beforeEach(() => {
        savedRecent.current = {};
    });

    it('lists everything alphabetically when nothing is typed and nothing was sent', () => {
        expect(names('fresh', '')).toEqual(['batch', 'debug', 'goal', 're', 'rename', 'rewind', 'skill-creator', 'verify', '_draft', '_rename-old']);
    });

    it('leads with up to three recently sent commands of the same agent', () => {
        for (const text of ['/verify', '/goal now', '/rename x', '/batch']) rememberSentSuggestions('qoder', text);
        expect(names('qoder', '')).toEqual(['batch', 'rename', 'goal', 'debug', 're', 'rewind', 'skill-creator', 'verify', '_draft', '_rename-old']);
        expect(names('codex', '')[0]).toBe('batch');
    });

    it('ranks exact, prefix, word, contains and description matches in that order', () => {
        expect(names('fresh', 're')).toEqual(['re', 'rename', 'rewind', '_rename-old', 'skill-creator', 'debug']);
        expect(names('fresh', 'creator')).toEqual(['skill-creator']);
    });

    it('prefers a recently sent command within the same match tier', () => {
        rememberSentSuggestions('qoder', '/rewind');
        expect(names('qoder', 're')).toEqual(['re', 'rewind', 'rename', '_rename-old', 'skill-creator', 'debug']);
    });

    it('puts typo matches after every direct match', () => {
        expect(names('fresh', 'veify')).toEqual(['verify']);
    });

    it('ranks $ skills by the same rules and remembers them wherever they appear', () => {
        expect(skillNames('codex', '')).toEqual(['image-edit', 'imagegen', 'pdf', '_scratch']);
        expect(skillNames('codex', 'image')).toEqual(['imagegen', 'image-edit']);
        rememberSentSuggestions('codex', 'make a chart with $pdf then $image-edit');
        expect(skillNames('codex', '')).toEqual(['image-edit', 'pdf', 'imagegen', '_scratch']);
        expect(skillNames('codex', 'image')).toEqual(['image-edit', 'imagegen']);
        expect(names('codex', '')[0]).toBe('batch');
    });
});
