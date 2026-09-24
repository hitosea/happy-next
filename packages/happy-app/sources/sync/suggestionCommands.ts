/**
 * Suggestion commands functionality for slash commands
 * Reads commands directly from session metadata storage
 */

import Fuse from 'fuse.js';
import { getSession, storage } from './storage';
import { hasForkableNativeId } from '@/utils/sessionLifecycle';

export type CommandScope = 'REPO' | 'USER' | 'PLUGIN' | 'SYSTEM';
export type CommandKind = 'command' | 'skill';

export interface CommandItem {
    command: string;        // The command without slash (e.g., "compact")
    description?: string;   // Optional description of what the command does
    scope?: CommandScope;   // Where the command/skill came from
    kind?: CommandKind;     // Whether this is a plain slash command or a Claude skill
}

interface SearchOptions {
    limit?: number;
    threshold?: number;
}

// Commands to ignore/filter out
export const IGNORED_COMMANDS = [
    "add-dir",
    "agents",
    "config",
    "statusline",
    "bashes",
    "settings",
    "cost",
    "doctor",
    "exit",
    "help",
    "ide",
    "init",
    "install-github-app",
    "mcp",
    "memory",
    "migrate-installer",
    "model",
    "pr-comments",
    "release-notes",
    "resume",
    "status",
    "bug",
    "review",
    "security-review",
    "terminal-setup",
    "upgrade",
    "vim",
    "permissions",
    "hooks",
    "export",
    "logout",
    "login"
];

// Default commands always available for all session types
const DEFAULT_COMMANDS: CommandItem[] = [
    { command: 'clear', description: 'Clear the conversation', scope: 'SYSTEM', kind: 'command' },
];

// Commands only available for Claude sessions
const CLAUDE_COMMANDS: CommandItem[] = [
    { command: 'compact', description: 'Compact the conversation history', scope: 'SYSTEM', kind: 'command' },
];

// Commands implemented by Happy for Codex app-server sessions
const CODEX_COMMANDS: CommandItem[] = [
    { command: 'compact', description: 'Compact the conversation history', scope: 'SYSTEM', kind: 'command' },
    { command: 'review', description: 'Review current changes', scope: 'SYSTEM', kind: 'command' },
    { command: 'goal', description: 'Set or view the current goal', scope: 'SYSTEM', kind: 'command' },
];

const CODEX_SUBCOMMANDS: Record<string, CommandItem[]> = {
    goal: [
        { command: 'goal clear', description: 'Clear the current goal', scope: 'SYSTEM', kind: 'command' },
        { command: 'goal pause', description: 'Pause the current goal', scope: 'SYSTEM', kind: 'command' },
        { command: 'goal resume', description: 'Resume the current goal', scope: 'SYSTEM', kind: 'command' },
        { command: 'goal complete', description: 'Mark the current goal complete', scope: 'SYSTEM', kind: 'command' },
        { command: 'goal blocked', description: 'Mark the current goal blocked', scope: 'SYSTEM', kind: 'command' },
    ],
    review: [
        { command: 'review base', description: 'Review changes against a base branch', scope: 'SYSTEM', kind: 'command' },
        { command: 'review commit', description: 'Review a specific commit SHA', scope: 'SYSTEM', kind: 'command' },
        { command: 'review custom', description: 'Review using custom instructions', scope: 'SYSTEM', kind: 'command' },
    ],
};

// Commands available for sessions with forkable history (Claude, Gemini, Codex, Qoder)
const FORKABLE_COMMANDS: CommandItem[] = [
    { command: 'duplicate', description: 'Duplicate conversation from a specific point', scope: 'SYSTEM', kind: 'command' },
];

// Command descriptions for known tools/commands
const COMMAND_DESCRIPTIONS: Record<string, string> = {
    // Default commands
    compact: 'Compact the conversation history',
    duplicate: 'Duplicate conversation from a specific point',

    // Common tool commands
    help: 'Show available commands',
    clear: 'Clear the conversation',
    reset: 'Reset the session',
    export: 'Export conversation',
    debug: 'Show debug information',
    status: 'Show connection status',
    stop: 'Stop current operation',
    abort: 'Abort current operation',
    cancel: 'Cancel current operation',
    
    // Add more descriptions as needed
};

function shouldIgnoreCommand(item: CommandItem): boolean {
    return IGNORED_COMMANDS.includes(item.command) && (!item.scope || item.scope === 'SYSTEM');
}

function mergeCommand(commands: CommandItem[], item: CommandItem): void {
    if (shouldIgnoreCommand(item)) return;

    const existing = commands.find(c => c.command === item.command);
    if (!existing) {
        commands.push(item);
        return;
    }

    existing.description = existing.description || item.description;
    existing.scope = existing.scope || item.scope;
    existing.kind = existing.kind || item.kind;
}

// Get commands from session metadata
function getCommandsFromSession(sessionId: string): CommandItem[] {
    const session = getSession(sessionId);
    if (!session || !session.metadata) {
        return DEFAULT_COMMANDS;
    }

    const commands: CommandItem[] = [...DEFAULT_COMMANDS];

    // Add Claude-specific commands
    if (session.metadata.claudeSessionId) {
        commands.push(...CLAUDE_COMMANDS);
    }

    // Add Codex commands that Happy implements through the app-server RPC API.
    if (session.metadata.flavor === 'codex') {
        commands.push(...CODEX_COMMANDS);
    }

    // Add forkable commands for sessions with session history (Claude, Gemini, Codex, Qoder)
    if (hasForkableNativeId(session)) {
        commands.push(...FORKABLE_COMMANDS);
    }

    const capabilities = storage.getState().sessionCapabilities[sessionId]?.capabilities;

    const slashCommandMetadata = capabilities?.slashCommandMetadata || session.metadata.slashCommandMetadata;

    // Prefer structured command metadata when available so autocomplete can display scope labels.
    if (slashCommandMetadata) {
        for (const cmd of slashCommandMetadata) {
            mergeCommand(commands, {
                command: cmd.name,
                description: cmd.description || COMMAND_DESCRIPTIONS[cmd.name],
                scope: cmd.scope,
                kind: cmd.kind,
            });
        }
    }
    
    // Add commands from metadata.slashCommands (filter with ignore list). This remains as a
    // backward-compatible fallback for older CLIs and non-Claude backends.
    const slashCommands = capabilities?.slashCommands || session.metadata.slashCommands;
    if (slashCommands) {
        for (const cmd of slashCommands) {
            mergeCommand(commands, {
                command: cmd,
                description: COMMAND_DESCRIPTIONS[cmd],
                scope: session.metadata.claudeSessionId ? 'SYSTEM' : undefined,
                kind: session.metadata.claudeSessionId ? 'command' : undefined,
            });
        }
    }
    
    return commands;
}

// Main export: search commands with fuzzy matching
export async function searchCommands(
    sessionId: string,
    query: string,
    options: SearchOptions = {}
): Promise<CommandItem[]> {
    const { limit, threshold = 0.3 } = options;
    const session = getSession(sessionId);
    const commands = getCommandsFromSession(sessionId);

    const subcommandMatch = query.match(/^(\S+)\s+([\s\S]*)$/);
    if (subcommandMatch) {
        const [, command, subQuery] = subcommandMatch;
        const subcommands = session?.metadata?.flavor === 'codex'
            ? CODEX_SUBCOMMANDS[command]
            : undefined;
        if (!subcommands) {
            return [];
        }
        const normalizedSubQuery = subQuery.trim().toLowerCase();
        const normalizedQuery = query.trim().toLowerCase();
        const queryEndsWithSpace = /\s$/.test(query);
        const exactSubcommandMatch = subcommands.some((item) => item.command.toLowerCase() === normalizedQuery);
        if (queryEndsWithSpace && exactSubcommandMatch) {
            return [];
        }
        const filtered = normalizedSubQuery
            ? subcommands.filter((item) => item.command.toLowerCase().startsWith(`${command} ${normalizedSubQuery}`))
            : subcommands;
        return limit ? filtered.slice(0, limit) : filtered;
    }

    if (!query || query.trim().length === 0) {
        return limit ? commands.slice(0, limit) : commands;
    }

    const fuseOptions = {
        keys: [
            { name: 'command', weight: 0.7 },
            { name: 'description', weight: 0.3 }
        ],
        threshold,
        includeScore: true,
        shouldSort: true,
        minMatchCharLength: 1,
        ignoreLocation: true,
        useExtendedSearch: true
    };

    const fuse = new Fuse(commands, fuseOptions);
    const results = limit
        ? fuse.search(query, { limit })
        : fuse.search(query);

    return results.map(result => result.item);
}

// Get all available commands for a session
export function getAllCommands(sessionId: string): CommandItem[] {
    return getCommandsFromSession(sessionId);
}
