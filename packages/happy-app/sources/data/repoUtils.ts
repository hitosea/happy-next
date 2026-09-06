import type { Theme } from '@/theme';
import type { RepoIssue, RepoPR } from './mockRepos';

export type IssueFilter = 'all' | 'open' | 'closed';
export type PRFilter = 'all' | 'open' | 'merged' | 'closed';

export const ISSUE_FILTERS: Array<{ key: IssueFilter; label: string }> = [
    { key: 'all', label: 'All' },
    { key: 'open', label: 'Open' },
    { key: 'closed', label: 'Closed' },
];

export const PR_FILTERS: Array<{ key: PRFilter; label: string }> = [
    { key: 'all', label: 'All' },
    { key: 'open', label: 'Open' },
    { key: 'merged', label: 'Merged' },
    { key: 'closed', label: 'Closed' },
];

export function getLanguageColor(theme: Theme, language: string | undefined | null): string {
    if (!language) return theme.colors.repo.languages.Default;
    return theme.colors.repo.languages[language] ?? theme.colors.repo.languages.Default;
}

export function formatTimeAgo(dateStr: string): string {
    const now = Date.now();
    const then = new Date(dateStr).getTime();
    const diffMs = now - then;
    const diffH = Math.floor(diffMs / (1000 * 60 * 60));
    if (diffH < 1) return 'just now';
    if (diffH < 24) return `${diffH}h ago`;
    const diffD = Math.floor(diffH / 24);
    if (diffD < 30) return `${diffD}d ago`;
    return `${Math.floor(diffD / 30)}mo ago`;
}

export function formatAbsoluteTime(dateStr: string): string {
    const d = new Date(dateStr);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatSessionAge(ts: number): string {
    const sec = Math.floor((Date.now() - ts) / 1000);
    if (sec < 60) return '<1m';
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h`;
    const day = Math.floor(hr / 24);
    return `${day}d`;
}

export function formatBytes(kb: number): string {
    if (kb < 1024) return `${kb} KB`;
    return `${(kb / 1024).toFixed(1)} MB`;
}

export function formatNumber(n: number): string {
    return n.toLocaleString('en-US');
}

export function filterIssues(issues: RepoIssue[], filter: IssueFilter): RepoIssue[] {
    switch (filter) {
        case 'open': return issues.filter((i) => i.state === 'open');
        case 'closed': return issues.filter((i) => i.state === 'closed');
        default: return issues;
    }
}

export function filterPRs(pulls: RepoPR[], filter: PRFilter): RepoPR[] {
    switch (filter) {
        case 'open': return pulls.filter((p) => p.status === 'open');
        case 'merged': return pulls.filter((p) => p.status === 'merged');
        case 'closed': return pulls.filter((p) => p.status === 'closed');
        default: return pulls;
    }
}

export function labelColors(hex: string): { bg: string; text: string } {
    const r = parseInt(hex.substring(0, 2), 16) || 0;
    const g = parseInt(hex.substring(2, 4), 16) || 0;
    const b = parseInt(hex.substring(4, 6), 16) || 0;
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return { bg: `#${hex}`, text: luminance > 0.5 ? '#24292f' : '#ffffff' };
}
