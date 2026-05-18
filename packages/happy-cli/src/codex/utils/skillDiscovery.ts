import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, realpathSync } from 'node:fs';
import os from 'node:os';
import { dirname, join, resolve } from 'node:path';

export type CodexSkillScope = 'REPO' | 'USER' | 'ADMIN' | 'SYSTEM';

export interface CodexSkillMetadata {
    name: string;
    description: string;
    scope: CodexSkillScope;
    path: string;
    displayName?: string;
    shortDescription?: string;
}

export function getCodexSkillsSignature(skills: CodexSkillMetadata[]): string {
    return JSON.stringify(
        skills
            .map(skill => ({
                name: skill.name,
                description: skill.description,
                scope: skill.scope,
                path: normalizePath(skill.path),
                displayName: skill.displayName ?? null,
                shortDescription: skill.shortDescription ?? null,
            }))
            .sort((a, b) => {
                const scopeCompare = a.scope.localeCompare(b.scope);
                if (scopeCompare !== 0) return scopeCompare;
                const pathCompare = a.path.localeCompare(b.path);
                if (pathCompare !== 0) return pathCompare;
                return a.name.localeCompare(b.name);
            })
    );
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

function parseFrontmatter(markdown: string): Record<string, string> | null {
    const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!match) return null;

    const values: Record<string, string> = {};
    for (const line of match[1].split(/\r?\n/)) {
        const colonIndex = line.indexOf(':');
        if (colonIndex <= 0) continue;
        const key = line.slice(0, colonIndex).trim();
        let value = line.slice(colonIndex + 1).trim();
        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }
        values[key] = value;
    }
    return values;
}

function parseOpenAiYaml(skillDir: string): Pick<CodexSkillMetadata, 'displayName' | 'shortDescription'> {
    const metadataPath = join(skillDir, 'agents', 'openai.yaml');

    try {
        const yaml = readFileSync(metadataPath, 'utf8');
        const displayName = yaml.match(/^\s*display_name:\s*["']?(.+?)["']?\s*$/m)?.[1];
        const shortDescription = yaml.match(/^\s*short_description:\s*["']?(.+?)["']?\s*$/m)?.[1];
        const result: Pick<CodexSkillMetadata, 'displayName' | 'shortDescription'> = {};
        if (displayName) result.displayName = displayName;
        if (shortDescription) result.shortDescription = shortDescription;
        return result;
    } catch {
        return {};
    }
}

function readSkill(skillDir: string, scope: CodexSkillScope): CodexSkillMetadata | null {
    const skillPath = join(skillDir, 'SKILL.md');

    try {
        const markdown = readFileSync(skillPath, 'utf8');
        const frontmatter = parseFrontmatter(markdown);
        const name = frontmatter?.name?.trim();
        const description = frontmatter?.description?.trim();
        if (!name || !description) return null;

        const uiMetadata = parseOpenAiYaml(skillDir);
        return {
            name,
            description,
            scope,
            path: skillPath,
            ...uiMetadata,
        };
    } catch {
        return null;
    }
}

function scanSkillRoot(root: string, scope: CodexSkillScope, includeDotDirs = true): CodexSkillMetadata[] {
    const skills: CodexSkillMetadata[] = [];
    try {
        for (const entry of readdirSync(root, { withFileTypes: true })) {
            if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
            if (!includeDotDirs && entry.name.startsWith('.')) continue;

            const skillDir = join(root, entry.name);
            const skill = readSkill(skillDir, scope);
            if (skill) {
                skills.push(skill);
            }
        }
    } catch {
        // Ignore unreadable skill roots.
    }

    return skills;
}

function normalizePath(path: string): string {
    try {
        return realpathSync(path);
    } catch {
        return resolve(path);
    }
}

function readDisabledSkillPaths(homeDir: string): Set<string> {
    const disabled = new Set<string>();
    const configPath = join(homeDir, '.codex', 'config.toml');

    try {
        const config = readFileSync(configPath, 'utf8');
        const blocks = config.split(/\[\[skills\.config\]\]/g).slice(1);
        for (const block of blocks) {
            const path = block.match(/^\s*path\s*=\s*["'](.+?)["']\s*$/m)?.[1];
            const enabled = block.match(/^\s*enabled\s*=\s*(true|false)\s*$/m)?.[1];
            if (path && enabled === 'false') {
                disabled.add(normalizePath(path));
            }
        }
    } catch {
        // Ignore malformed or unreadable config.
    }

    return disabled;
}

function pushUniqueRoot(roots: string[], root: string): void {
    try {
        const normalized = realpathSync(root);
        if (!roots.includes(normalized)) roots.push(normalized);
    } catch {
        const normalized = resolve(root);
        if (!roots.includes(normalized)) roots.push(normalized);
    }
}

export function discoverCodexSkills(cwd = process.cwd(), homeDir = os.homedir()): CodexSkillMetadata[] {
    const skills: CodexSkillMetadata[] = [];
    const disabledSkillPaths = readDisabledSkillPaths(homeDir);

    const repoRoot = findGitRoot(cwd);
    const repoSkillRoots: string[] = [];
    for (const ancestor of collectAncestors(cwd, repoRoot)) {
        // Codex docs use .agents/skills for repo skills. Team Config also exposes .codex/skills,
        // so scan both and label both as REPO in the UI.
        pushUniqueRoot(repoSkillRoots, join(ancestor, '.agents', 'skills'));
        pushUniqueRoot(repoSkillRoots, join(ancestor, '.codex', 'skills'));
    }
    for (const root of repoSkillRoots) {
        skills.push(...scanSkillRoot(root, 'REPO'));
    }

    // Official Codex location is ~/.agents/skills. Keep ~/.codex/skills for compatibility
    // with older local setups, excluding dot folders so ~/.codex/skills/.system stays SYSTEM.
    skills.push(...scanSkillRoot(join(homeDir, '.agents', 'skills'), 'USER'));
    skills.push(...scanSkillRoot(join(homeDir, '.codex', 'skills'), 'USER', false));

    skills.push(...scanSkillRoot('/etc/codex/skills', 'ADMIN'));
    skills.push(...scanSkillRoot(join(homeDir, '.codex', 'skills', '.system'), 'SYSTEM'));

    return skills.filter(skill => !disabledSkillPaths.has(normalizePath(dirname(skill.path))));
}
