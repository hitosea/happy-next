import { CommandSuggestion, FileMentionSuggestion, SkillSuggestion } from '@/components/AgentInputSuggestionView';
import * as React from 'react';
import { searchFiles, FileItem } from '@/sync/suggestionFile';
import { searchCommands, CommandItem } from '@/sync/suggestionCommands';
import { searchSkills, SkillItem } from '@/sync/suggestionSkills';

export async function getCommandSuggestions(sessionId: string, query: string): Promise<{
    key: string;
    text: string;
    component: React.ComponentType;
}[]> {
    const searchTerm = query.slice(1);

    try {
        const commands = await searchCommands(sessionId, searchTerm, { limit: 5 });

        return commands.map((cmd: CommandItem) => ({
            key: `cmd-${cmd.command}`,
            text: `/${cmd.command}`,
            component: () => React.createElement(CommandSuggestion, {
                command: cmd.command,
                description: cmd.description
            })
        }));
    } catch (error) {
        console.error('Error fetching command suggestions:', error);
        return [];
    }
}

export async function getSkillSuggestions(sessionId: string, query: string): Promise<{
    key: string;
    text: string;
    component: React.ComponentType;
}[]> {
    const searchTerm = query.slice(1);

    try {
        const skills = await searchSkills(sessionId, searchTerm);

        return skills.map((skill: SkillItem) => ({
            key: `skill-${skill.scope}-${skill.path}`,
            text: `$${skill.name}`,
            component: () => React.createElement(SkillSuggestion, {
                name: skill.name,
                description: skill.shortDescription || skill.description,
                scope: skill.scope,
                displayName: skill.displayName,
            })
        }));
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
        const files = await searchFiles(sessionId, searchTerm, { limit: 5 });

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
        return getCommandSuggestions(sessionId, query);
    }

    if (query.startsWith('$')) {
        return getSkillSuggestions(sessionId, query);
    }

    if (query.startsWith('@')) {
        return getFileMentionSuggestions(sessionId, query);
    }

    return [];
}
