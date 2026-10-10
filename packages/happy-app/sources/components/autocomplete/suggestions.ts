import { CommandSuggestion, FileMentionSuggestion, SkillSuggestion } from '@/components/AgentInputSuggestionView';
import * as React from 'react';
import { searchFiles, FileItem } from '@/sync/suggestionFile';
import { searchCommands, searchCapabilityCommands, CommandItem } from '@/sync/suggestionCommands';
import { searchSkills, searchCapabilitySkills, SkillItem } from '@/sync/suggestionSkills';
import type { SessionCapabilities } from '@/sync/storageTypes';
import { sync } from '@/sync/sync';
import { storage } from '@/sync/storage';


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
        const commands = await getCommandSuggestions(sessionId, query);

        // Once a root command has been followed by whitespace, command search owns
        // the rest of the query: it may return that command's subcommands, or no
        // suggestions when the command only accepts free-form arguments.
        if (/\s/.test(query)) {
            return commands;
        }

        const skills = await getSkillSuggestions(sessionId, query, { showSkillCategory: true });
        return [...commands, ...skills];
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
export function getNewSessionSuggestions(capabilities: SessionCapabilities, query: string): Suggestion[] {
    const searchTerm = query.slice(1);

    if (query.startsWith('/')) {
        // Discovered commands take free-form arguments only, so nothing to complete after a space
        if (/\s/.test(query)) {
            return [];
        }
        return [
            ...toCommandSuggestions(searchCapabilityCommands(capabilities, searchTerm)),
            ...toSkillSuggestions(searchCapabilitySkills(capabilities, searchTerm), { showSkillCategory: true }),
        ];
    }

    if (query.startsWith('$')) {
        return toSkillSuggestions(searchCapabilitySkills(capabilities, searchTerm), {});
    }

    return [];
}
