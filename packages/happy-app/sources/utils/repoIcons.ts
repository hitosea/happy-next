import type { Ionicons } from '@expo/vector-icons';
import type { Theme } from '@/theme';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

const EXT_TO_ICON: Record<string, IoniconName> = {
    ts: 'logo-javascript',
    tsx: 'logo-react',
    js: 'logo-javascript',
    jsx: 'logo-react',
    json: 'code-slash-outline',
    md: 'document-text-outline',
    mdx: 'document-text-outline',
    css: 'color-palette-outline',
    scss: 'color-palette-outline',
    less: 'color-palette-outline',
    html: 'code-working-outline',
    xml: 'code-working-outline',
    yml: 'settings-outline',
    yaml: 'settings-outline',
    toml: 'settings-outline',
    png: 'image-outline',
    jpg: 'image-outline',
    jpeg: 'image-outline',
    gif: 'image-outline',
    webp: 'image-outline',
    svg: 'color-palette-outline',
    py: 'logo-python',
    go: 'code-slash-outline',
    rs: 'code-slash-outline',
    java: 'code-slash-outline',
    kt: 'code-slash-outline',
    swift: 'code-slash-outline',
    sh: 'terminal-outline',
    bash: 'terminal-outline',
    zsh: 'terminal-outline',
    lock: 'lock-closed-outline',
    env: 'key-outline',
    gitignore: 'git-branch-outline',
    dockerfile: 'cube-outline',
};

import * as React from 'react';

export interface FileIconInfo {
    name: IoniconName;
    color: string;
}

export function getFileIconInfo(theme: Theme, fileName: string, isDir: boolean): FileIconInfo {
    if (isDir) {
        return { name: 'folder', color: theme.colors.repo.folderIcon };
    }
    const lower = fileName.toLowerCase();
    if (lower === 'dockerfile') {
        return { name: 'cube-outline', color: theme.colors.textSecondary };
    }
    if (lower === '.gitignore' || lower === '.gitattributes') {
        return { name: 'git-branch-outline', color: theme.colors.textSecondary };
    }
    if (lower === 'readme' || lower === 'readme.md' || lower === 'license') {
        return { name: 'document-text-outline', color: theme.colors.textSecondary };
    }
    const ext = lower.split('.').pop() ?? '';
    const name = EXT_TO_ICON[ext] ?? 'document-outline';
    // Map by language for subtle colorization without emoji icons
    const langMap: Record<string, string> = {
        ts: theme.colors.repo.languages.TypeScript,
        tsx: theme.colors.repo.languages.TypeScript,
        js: theme.colors.repo.languages.JavaScript,
        jsx: theme.colors.repo.languages.JavaScript,
        py: theme.colors.repo.languages.Python,
        go: theme.colors.repo.languages.Go,
        rs: theme.colors.repo.languages.Rust,
        java: theme.colors.repo.languages.Java,
        kt: theme.colors.repo.languages.Kotlin,
        swift: theme.colors.repo.languages.Swift,
        md: theme.colors.repo.languages.MDX,
        mdx: theme.colors.repo.languages.MDX,
        css: theme.colors.repo.languages.CSS,
        scss: theme.colors.repo.languages.CSS,
        html: theme.colors.repo.languages.HTML,
    };
    const color = langMap[ext] ?? theme.colors.textSecondary;
    return { name, color };
}

export function getLanguageFromFileName(fileName: string): string | null {
    const ext = fileName.toLowerCase().split('.').pop() ?? '';
    const map: Record<string, string> = {
        ts: 'TypeScript', tsx: 'TypeScript',
        js: 'JavaScript', jsx: 'JavaScript',
        py: 'Python',
        go: 'Go',
        rs: 'Rust',
        java: 'Java',
        kt: 'Kotlin',
        swift: 'Swift',
        md: 'Markdown', mdx: 'MDX',
        css: 'CSS', scss: 'SCSS',
        html: 'HTML',
        json: 'JSON',
        yml: 'YAML', yaml: 'YAML',
        sh: 'Shell', bash: 'Shell',
    };
    return map[ext] ?? null;
}
