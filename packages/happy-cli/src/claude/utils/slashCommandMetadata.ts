import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import os from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { parseMarkdownFrontmatter, readYamlString } from '@/utils/yaml';
import type { SDKCommandInfo } from '@/claude/sdk/types';

export type ClaudeSlashCommandKind = 'command' | 'skill';
export type ClaudeSlashCommandScope = 'REPO' | 'USER' | 'PLUGIN' | 'SYSTEM';

export interface ClaudePluginMetadata {
    name: string;
    path?: string;
    source?: string;
}

export interface ClaudeSlashCommandMetadata {
    name: string;
    description?: string;
    kind: ClaudeSlashCommandKind;
    scope: ClaudeSlashCommandScope;
}

export interface ClaudeInitCapabilities {
    slashCommands?: string[];
    skills?: string[];
    plugins?: ClaudePluginMetadata[];
    /** Commands from Claude's `initialize` control response; used for descriptions not found on disk. */
    sdkCommands?: SDKCommandInfo[];
    cwd?: string;
}

function normalizeCommandName(name: string): string {
    return name.trim().replace(/^\/+/, '');
}

function normalizePath(path: string): string {
    try {
        return realpathSync(path);
    } catch {
        return resolve(path);
    }
}

function findGitRoot(cwd: string): string {
    try {
        return execFileSync('git', ['rev-parse', '--show-toplevel'], {
            cwd,
            encoding: 'utf8',
            timeout: 1000,
            stdio: ['ignore', 'pipe', 'ignore'],
        }).trim() || cwd;
    } catch {
        return cwd;
    }
}

function collectAncestors(from: string, until: string): string[] {
    const result: string[] = [];
    let current = resolve(from);
    const stop = resolve(until);

    while (true) {
        result.push(current);
        if (current === stop) break;
        const parent = dirname(current);
        if (parent === current) break;
        current = parent;
    }

    return result;
}

function readFrontmatter(filePath: string): Record<string, unknown> | null {
    try {
        return parseMarkdownFrontmatter(readFileSync(filePath, 'utf8'));
    } catch {
        return null;
    }
}

/**
 * Receives each command/skill found on disk: `name` is the name Claude exposes it under, `aliases`
 * are every name a Claude init payload may use for it (e.g. a plugin skill with and without prefix).
 */
type CommandSink = (
    name: string,
    aliases: string[],
    metadata: Omit<ClaudeSlashCommandMetadata, 'name'>,
) => void;

function scanSkillRoot(
    root: string,
    scope: ClaudeSlashCommandScope,
    sink: CommandSink,
    pluginName?: string,
): void {
    try {
        for (const entry of readdirSync(root, { withFileTypes: true })) {
            if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
            const skillDir = join(root, entry.name);
            const skillPath = join(skillDir, 'SKILL.md');
            const frontmatter = readFrontmatter(skillPath);
            if (!frontmatter && !existsSync(skillPath)) continue;

            const skillName = readYamlString(frontmatter?.name) || entry.name;
            const description = readYamlString(frontmatter?.description, true);
            const name = pluginName ? `${pluginName}:${skillName}` : skillName;

            sink(name, [skillName, name], {
                kind: 'skill',
                scope,
                ...(description ? { description } : {}),
            });
        }
    } catch {
        // Root does not exist or is not readable.
    }
}

function scanCommandRoot(
    root: string,
    scope: ClaudeSlashCommandScope,
    sink: CommandSink,
    pluginName?: string,
): void {
    function visit(dir: string): void {
        let entries;
        try {
            entries = readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }

        for (const entry of entries) {
            const fullPath = join(dir, entry.name);
            if (entry.isDirectory()) {
                visit(fullPath);
                continue;
            }
            if (!entry.isFile() || !entry.name.endsWith('.md')) continue;

            const rel = relative(root, fullPath).replace(/\\/g, '/').replace(/\.md$/, '');
            const commandName = rel.split('/').join(':');
            const baseName = basename(entry.name, '.md');
            const aliases = commandName === baseName ? [commandName] : [commandName, baseName];
            if (pluginName) {
                aliases.push(...aliases.map(alias => `${pluginName}:${alias}`));
            }
            const frontmatter = readFrontmatter(fullPath);
            const description = readYamlString(frontmatter?.description, true);
            sink(pluginName ? `${pluginName}:${commandName}` : commandName, aliases, {
                kind: 'command',
                scope,
                ...(description ? { description } : {}),
            });
        }
    }

    visit(root);
}

function getPluginName(plugin: ClaudePluginMetadata): string | undefined {
    const explicit = plugin.name?.trim();
    if (explicit) return explicit;
    const sourceName = plugin.source?.split('@')[0]?.trim();
    return sourceName || undefined;
}

function scanClaudeCommands(
    plugins: ClaudePluginMetadata[],
    cwd: string,
    homeDir: string,
    sink: CommandSink,
): void {
    const repoRoot = findGitRoot(cwd);

    for (const ancestor of collectAncestors(cwd, repoRoot)) {
        scanSkillRoot(join(ancestor, '.claude', 'skills'), 'REPO', sink);
        scanCommandRoot(join(ancestor, '.claude', 'commands'), 'REPO', sink);
    }

    scanSkillRoot(join(homeDir, '.claude', 'skills'), 'USER', sink);
    scanCommandRoot(join(homeDir, '.claude', 'commands'), 'USER', sink);

    for (const plugin of plugins) {
        if (!plugin.path) continue;
        const pluginRoot = normalizePath(plugin.path);
        const pluginName = getPluginName(plugin);
        scanSkillRoot(join(pluginRoot, 'skills'), 'PLUGIN', sink, pluginName);
        scanSkillRoot(join(pluginRoot, '.claude', 'skills'), 'PLUGIN', sink, pluginName);
        scanCommandRoot(join(pluginRoot, 'commands'), 'PLUGIN', sink, pluginName);
        scanCommandRoot(join(pluginRoot, '.claude', 'commands'), 'PLUGIN', sink, pluginName);
    }
}

function buildKnownCommandMetadata(
    capabilities: ClaudeInitCapabilities,
    cwd: string,
    homeDir: string,
): Map<string, ClaudeSlashCommandMetadata> {
    const map = new Map<string, ClaudeSlashCommandMetadata>();
    scanClaudeCommands(capabilities.plugins ?? [], cwd, homeDir, (_name, aliases, metadata) => {
        for (const alias of aliases) {
            const name = normalizeCommandName(alias);
            if (!name || map.has(name)) continue;
            map.set(name, { name, ...metadata });
        }
    });
    return map;
}

function readJsonFile(filePath: string): unknown {
    try {
        return JSON.parse(readFileSync(filePath, 'utf8'));
    } catch {
        return null;
    }
}

/**
 * Plugins Claude would load in `cwd`: installed (`~/.claude/plugins/installed_plugins.json`) and
 * enabled by the user, project or local settings, with later files overriding earlier ones.
 */
function readEnabledClaudePlugins(cwd: string, homeDir: string): ClaudePluginMetadata[] {
    const repoRoot = findGitRoot(cwd);
    const enabled: Record<string, unknown> = {};
    for (const settingsPath of [
        join(homeDir, '.claude', 'settings.json'),
        join(repoRoot, '.claude', 'settings.json'),
        join(repoRoot, '.claude', 'settings.local.json'),
    ]) {
        const settings = readJsonFile(settingsPath) as { enabledPlugins?: Record<string, unknown> } | null;
        Object.assign(enabled, settings?.enabledPlugins);
    }

    const installed = readJsonFile(join(homeDir, '.claude', 'plugins', 'installed_plugins.json')) as {
        plugins?: Record<string, Array<{ installPath?: string; projectPath?: string }>>;
    } | null;
    const normalizedRepoRoot = normalizePath(repoRoot);

    return Object.entries(installed?.plugins ?? {}).flatMap(([source, installs]) => {
        if (enabled[source] !== true || !Array.isArray(installs)) return [];
        const install = installs.find((entry) => !entry.projectPath || normalizePath(entry.projectPath) === normalizedRepoRoot);
        return install?.installPath ? [{ name: source.split('@')[0], source, path: install.installPath }] : [];
    });
}

/**
 * Lists the commands and skills Claude will expose in `cwd`, read from disk before any Claude
 * process runs. Unlike `buildClaudeSlashCommandMetadata` this has no init payload to start from,
 * so Claude's own built-in commands and MCP prompts are not included.
 */
export function discoverClaudeSlashCommandMetadata(
    cwd: string,
    homeDir = os.homedir(),
): ClaudeSlashCommandMetadata[] {
    const commands = new Map<string, ClaudeSlashCommandMetadata>();
    scanClaudeCommands(readEnabledClaudePlugins(cwd, homeDir), cwd, homeDir, (rawName, _aliases, metadata) => {
        const name = normalizeCommandName(rawName);
        if (!name || commands.has(name)) return;
        commands.set(name, { name, ...metadata });
    });
    return Array.from(commands.values());
}

export function buildClaudeSlashCommandMetadata(
    capabilities: ClaudeInitCapabilities,
    opts: { cwd?: string; homeDir?: string } = {},
): ClaudeSlashCommandMetadata[] | undefined {
    if (!capabilities.slashCommands || capabilities.slashCommands.length === 0) {
        return undefined;
    }

    const cwd = opts.cwd || capabilities.cwd || process.cwd();
    const homeDir = opts.homeDir || os.homedir();
    const knownMetadata = buildKnownCommandMetadata(capabilities, cwd, homeDir);
    const skillCommands = new Set((capabilities.skills ?? []).map(normalizeCommandName));
    const sdkDescriptions = new Map<string, string>();
    for (const command of capabilities.sdkCommands ?? []) {
        const description = readYamlString(command.description, true);
        if (!description) continue;
        for (const alias of [command.name, ...(command.aliases ?? [])]) {
            sdkDescriptions.set(normalizeCommandName(alias), description);
        }
    }

    return capabilities.slashCommands.map((rawName) => {
        const name = normalizeCommandName(rawName);
        const sdkDescription = sdkDescriptions.get(name);
        const known = knownMetadata.get(name);
        if (known) {
            return { ...known, name, ...(!known.description && sdkDescription ? { description: sdkDescription } : {}) };
        }
        return {
            name,
            kind: skillCommands.has(name) ? 'skill' : 'command',
            scope: 'SYSTEM',
            ...(sdkDescription ? { description: sdkDescription } : {}),
        };
    });
}
