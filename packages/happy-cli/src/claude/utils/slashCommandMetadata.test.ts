import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildClaudeSlashCommandMetadata, discoverClaudeSlashCommandMetadata } from './slashCommandMetadata';

const createdDirs: string[] = [];

function createTempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'claude-command-metadata-'));
    createdDirs.push(dir);
    return dir;
}

afterEach(() => {
    for (const dir of createdDirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true });
    }
});

describe('buildClaudeSlashCommandMetadata', () => {
    it('parses a multiline YAML skill description as a single-line summary', () => {
        const cwd = createTempDir();
        const homeDir = createTempDir();
        const skillDir = join(cwd, '.claude', 'skills', 'general-video');
        mkdirSync(skillDir, { recursive: true });
        writeFileSync(
            join(skillDir, 'SKILL.md'),
            '---\nname: general-video\ndescription: >\n  The fallback workflow for authoring custom\n  HyperFrames video compositions.\n---\n',
            'utf8',
        );

        const metadata = buildClaudeSlashCommandMetadata(
            { slashCommands: ['general-video'], skills: ['general-video'], cwd },
            { cwd, homeDir },
        );

        expect(metadata).toEqual([
            {
                name: 'general-video',
                description: 'The fallback workflow for authoring custom HyperFrames video compositions.',
                kind: 'skill',
                scope: 'REPO',
            },
        ]);
    });

    it('parses a multiline YAML slash-command description as a single-line summary', () => {
        const cwd = createTempDir();
        const homeDir = createTempDir();
        const commandDir = join(cwd, '.claude', 'commands');
        mkdirSync(commandDir, { recursive: true });
        writeFileSync(
            join(commandDir, 'review.md'),
            '---\ndescription: |\n  Review the current changes:\n  report correctness and test gaps.\n---\n',
            'utf8',
        );

        const metadata = buildClaudeSlashCommandMetadata(
            { slashCommands: ['review'], cwd },
            { cwd, homeDir },
        );

        expect(metadata).toEqual([
            {
                name: 'review',
                description: 'Review the current changes: report correctness and test gaps.',
                kind: 'command',
                scope: 'REPO',
            },
        ]);
    });

    it('fills in descriptions for built-in commands from the SDK initialize response', () => {
        const cwd = createTempDir();
        const homeDir = createTempDir();

        const metadata = buildClaudeSlashCommandMetadata(
            {
                slashCommands: ['verify', 'review', 'unknown'],
                skills: ['verify'],
                sdkCommands: [
                    { name: 'verify', description: 'Verify a change\n end-to-end', builtin: true },
                    { name: 'code-review', description: 'Review the diff', aliases: ['review'], builtin: true },
                ],
                cwd,
            },
            { cwd, homeDir },
        );

        expect(metadata).toEqual([
            { name: 'verify', description: 'Verify a change end-to-end', kind: 'skill', scope: 'SYSTEM' },
            { name: 'review', description: 'Review the diff', kind: 'command', scope: 'SYSTEM' },
            { name: 'unknown', kind: 'command', scope: 'SYSTEM' },
        ]);
    });

    it('prefers the on-disk description over the SDK one', () => {
        const cwd = createTempDir();
        const homeDir = createTempDir();
        const commandsDir = join(homeDir, '.claude', 'commands');
        mkdirSync(commandsDir, { recursive: true });
        writeFileSync(join(commandsDir, 'ship.md'), '---\ndescription: From disk\n---\n', 'utf8');

        const metadata = buildClaudeSlashCommandMetadata(
            {
                slashCommands: ['ship'],
                sdkCommands: [{ name: 'ship', description: 'From SDK (user)' }],
                cwd,
            },
            { cwd, homeDir },
        );

        expect(metadata).toEqual([
            { name: 'ship', description: 'From disk', kind: 'command', scope: 'USER' },
        ]);
    });
});

describe('discoverClaudeSlashCommandMetadata', () => {
    function writeSkill(root: string, name: string, description: string): void {
        mkdirSync(join(root, name), { recursive: true });
        writeFileSync(join(root, name, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n`, 'utf8');
    }

    function installPlugin(homeDir: string, source: string, enabled: boolean): string {
        const pluginRoot = join(homeDir, '.claude', 'plugins', 'cache', source);
        const pluginsDir = join(homeDir, '.claude', 'plugins');
        mkdirSync(pluginsDir, { recursive: true });
        writeFileSync(join(pluginsDir, 'installed_plugins.json'), JSON.stringify({
            version: 2,
            plugins: { [source]: [{ scope: 'user', installPath: pluginRoot }] },
        }), 'utf8');
        writeFileSync(join(homeDir, '.claude', 'settings.json'), JSON.stringify({
            enabledPlugins: { [source]: enabled },
        }), 'utf8');
        return pluginRoot;
    }

    it('lists repo, user and enabled plugin commands under the names Claude exposes', () => {
        const cwd = createTempDir();
        const homeDir = createTempDir();
        writeSkill(join(cwd, '.claude', 'skills'), 'release', 'Cut a release');
        mkdirSync(join(homeDir, '.claude', 'commands'), { recursive: true });
        writeFileSync(join(homeDir, '.claude', 'commands', 'ship.md'), '---\ndescription: Ship it\n---\n', 'utf8');
        const pluginRoot = installPlugin(homeDir, 'tools@market', true);
        writeSkill(join(pluginRoot, 'skills'), 'lint', 'Lint the code');

        expect(discoverClaudeSlashCommandMetadata(cwd, homeDir)).toEqual([
            { name: 'release', description: 'Cut a release', kind: 'skill', scope: 'REPO' },
            { name: 'ship', description: 'Ship it', kind: 'command', scope: 'USER' },
            { name: 'tools:lint', description: 'Lint the code', kind: 'skill', scope: 'PLUGIN' },
        ]);
    });

    it('skips installed plugins that are not enabled', () => {
        const cwd = createTempDir();
        const homeDir = createTempDir();
        const pluginRoot = installPlugin(homeDir, 'tools@market', false);
        writeSkill(join(pluginRoot, 'skills'), 'lint', 'Lint the code');

        expect(discoverClaudeSlashCommandMetadata(cwd, homeDir)).toEqual([]);
    });

    it('lets project settings enable a plugin', () => {
        const cwd = createTempDir();
        const homeDir = createTempDir();
        const pluginRoot = installPlugin(homeDir, 'tools@market', false);
        writeSkill(join(pluginRoot, 'skills'), 'lint', 'Lint the code');
        mkdirSync(join(cwd, '.claude'), { recursive: true });
        writeFileSync(join(cwd, '.claude', 'settings.local.json'), JSON.stringify({
            enabledPlugins: { 'tools@market': true },
        }), 'utf8');

        expect(discoverClaudeSlashCommandMetadata(cwd, homeDir).map((command) => command.name)).toEqual(['tools:lint']);
    });
});
