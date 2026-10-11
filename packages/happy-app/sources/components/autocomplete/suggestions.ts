import { CommandSuggestion, FileMentionSuggestion, SkillSuggestion } from '@/components/AgentInputSuggestionView';
import * as React from 'react';
import { searchFiles, FileItem } from '@/sync/suggestionFile';
import { searchCommands, getAllCommands, getCapabilityCommands, CommandItem } from '@/sync/suggestionCommands';
import { searchSkills, searchCapabilitySkills, getSkillsFromSession, SkillItem } from '@/sync/suggestionSkills';
import { getRecentSuggestions } from '@/sync/recentSuggestions';
import { rankSuggestions } from '@/sync/suggestionRanking';
import type { SessionCapabilities } from '@/sync/storageTypes';
import { sync } from '@/sync/sync';
import { getSession, storage } from '@/sync/storage';


const capabilitiesFetches = new Map<string, Promise<void>>();

async function ensureSessionCapabilities(sessionId: string): Promise<void> {
    if (storage.getState().sessionCapabilities[sessionId]) {
        return;
    }

    const existing = capabilitiesFetches.get(sessionId);
    if (existing) {
        return existing;
    }

    const fetchPromise = sync.fetchSessionCapabilities(sessionId)
        .then(() => undefined)
        .catch((error) => {
            console.error('Error fetching session capabilities:', error);
        })
        .finally(() => {
            capabilitiesFetches.delete(sessionId);
        });
    capabilitiesFetches.set(sessionId, fetchPromise);
    return fetchPromise;
}

type Suggestion = {
    key: string;
    text: string;
    component: React.ComponentType;
};

function toCommandSuggestions(commands: CommandItem[]): Suggestion[] {
    return commands.map((cmd) => ({
        key: `cmd-${cmd.command}`,
        text: `/${cmd.command}`,
        component: () => React.createElement(CommandSuggestion, {
            command: cmd.command,
            description: cmd.description,
            scope: cmd.scope,
            kind: cmd.kind
        })
    }));
}

function toSkillSuggestions(skills: SkillItem[], options: { showSkillCategory?: boolean }): Suggestion[] {
    return skills.map((skill) => ({
        key: `skill-${skill.scope}-${skill.path}`,
        text: `$${skill.name}`,
        component: () => React.createElement(SkillSuggestion, {
            name: skill.name,
            description: skill.shortDescription || skill.description,
            scope: skill.scope,
            displayName: skill.displayName,
            showSkillCategory: options.showSkillCategory,
        })
    }));
}

type SlashEntry = {
    name: string;
    recentKey: string;
    otherText: (string | undefined)[];
    suggestion: Suggestion;
};

/**
 * What `/` offers: commands and skills ranked together as one list, so neither kind is pushed
 * below the other wholesale and recently sent ones of either kind can lead.
 */
function rankSlashSuggestions(commands: CommandItem[], skills: SkillItem[], agent: string, searchTerm: string): Suggestion[] {
    const commandSuggestions = toCommandSuggestions(commands);
    const skillSuggestions = toSkillSuggestions(skills, { showSkillCategory: true });
    const entries: SlashEntry[] = [
        ...commands.map((cmd, i) => ({
            name: cmd.command,
            recentKey: `/${cmd.command}`,
            otherText: [cmd.description],
            suggestion: commandSuggestions[i],
        })),
        ...skills.map((skill, i) => ({
            name: skill.name,
            recentKey: `$${skill.name}`,
            otherText: [skill.displayName, skill.shortDescription, skill.description],
            suggestion: skillSuggestions[i],
        })),
    ];
    return rankSuggestions(entries, searchTerm, {
        name: (entry) => entry.name,
        recentKey: (entry) => entry.recentKey,
        otherText: (entry) => entry.otherText,
        fuzzyKeys: [
            { name: 'name', weight: 0.7 },
            { name: 'otherText', weight: 0.3 },
        ],
        recent: getRecentSuggestions(agent),
        threshold: 0.3,
    }).map((entry) => entry.suggestion);
}

export async function getCommandSuggestions(sessionId: string, query: string): Promise<{
    key: string;
    text: string;
    component: React.ComponentType;
}[]> {
    const searchTerm = query.slice(1);

    try {
        await ensureSessionCapabilities(sessionId);
        return toCommandSuggestions(await searchCommands(sessionId, searchTerm));
    } catch (error) {
        console.error('Error fetching command suggestions:', error);
        return [];
    }
}

export async function getSkillSuggestions(
    sessionId: string,
    query: string,
    options: { showSkillCategory?: boolean } = {},
): Promise<{
    key: string;
    text: string;
    component: React.ComponentType;
}[]> {
    const searchTerm = query.slice(1);

    try {
        await ensureSessionCapabilities(sessionId);
        return toSkillSuggestions(searchSkills(sessionId, searchTerm), options);
    } catch (error) {
        console.error('Error fetching skill suggestions:', error);
        return [];
    }
}

export async function getFileMentionSuggestions(sessionId: string, query: string): Promise<{
    key: string;
    text: string;
    component: React.ComponentType;
}[]> {
    const searchTerm = query.slice(1);

    try {
        const files = await searchFiles(sessionId, searchTerm, { limit: 50 });

        return files.map((file: FileItem) => ({
            key: `file-${file.fullPath}`,
            text: `@${file.fullPath}`,
            component: () => React.createElement(FileMentionSuggestion, {
                fileName: file.fileName,
                filePath: file.filePath,
                fileType: file.fileType
            })
        }));
    } catch (error) {
        console.error('Error fetching file suggestions:', error);
        return [];
    }
}

export async function getSuggestions(sessionId: string, query: string): Promise<{
    key: string;
    text: string;
    component: React.ComponentType;
}[]> {
    if (!query || query.length === 0) {
        return [];
    }

    if (query.startsWith('/')) {
        // Once a root command has been followed by whitespace, command search owns
        // the rest of the query: it may return that command's subcommands, or no
        // suggestions when the command only accepts free-form arguments.
        if (/\s/.test(query)) {
            return getCommandSuggestions(sessionId, query);
        }

        try {
            await ensureSessionCapabilities(sessionId);
            const agent = getSession(sessionId)?.metadata?.flavor ?? 'claude';
            return rankSlashSuggestions(getAllCommands(sessionId), getSkillsFromSession(sessionId), agent, query.slice(1));
        } catch (error) {
            console.error('Error fetching slash suggestions:', error);
            return [];
        }
    }

    if (query.startsWith('$')) {
        return getSkillSuggestions(sessionId, query);
    }

    if (query.startsWith('@')) {
        return getFileMentionSuggestions(sessionId, query);
    }

    return [];
}

/**
 * Suggestions for the new-session screen, where no session exists yet: commands and skills come
 * from capabilities the daemon discovered for the chosen directory and agent.
 */
export function getNewSessionSuggestions(capabilities: SessionCapabilities, agent: string, query: string): Suggestion[] {
    const searchTerm = query.slice(1);

    if (query.startsWith('/')) {
        // Discovered commands take free-form arguments only, so nothing to complete after a space
        if (/\s/.test(query)) {
            return [];
        }
        return rankSlashSuggestions(getCapabilityCommands(capabilities), capabilities.skills ?? [], agent, searchTerm);
    }

    if (query.startsWith('$')) {
        return toSkillSuggestions(searchCapabilitySkills(capabilities, agent, searchTerm), {});
    }

    return [];
}
