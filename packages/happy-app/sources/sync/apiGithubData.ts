import { Platform } from 'react-native';
import { AuthCredentials } from '@/auth/tokenStorage';
import { getServerUrl } from './serverConfig';
import type {
    RepoInfo,
    RepoIssue,
    RepoIssueComment,
    RepoPR,
    RepoCommit,
    RepoContributor,
    RepoFileContent,
} from '@/data/mockRepos';

export interface PaginatedResponse<T> {
    items: T[];
    nextCursor: string | null;
    hasMore: boolean;
    totalCount?: number;
}

const API = () => getServerUrl();

function headers(credentials: AuthCredentials) {
    return {
        'Authorization': `Bearer ${credentials.token}`,
        'Content-Type': 'application/json',
    };
}

/** Errors that should NOT be retried by backoff */
class PermanentError extends Error {
    status: number;
    code: string;
    constructor(message: string, status: number, code: string) {
        super(message);
        this.status = status;
        this.code = code;
    }
}

async function fetchJson<T>(credentials: AuthCredentials, path: string): Promise<T> {
    const url = `${API()}${path}`;
    if (__DEV__) console.log('[github-api] GET', url);
    const res = await fetch(url, { headers: headers(credentials) });
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        console.warn('[github-api] Error', res.status, body.error, path);
        throw new PermanentError(body.error ?? `Request failed: ${res.status}`, res.status, body.error ?? '');
    }
    return (await res.json()) as T;
}

async function postJson<T>(credentials: AuthCredentials, path: string, body: unknown): Promise<T> {
    if (__DEV__) console.log('[github-api] POST', `${API()}${path}`);
    const res = await fetch(`${API()}${path}`, {
        method: 'POST',
        headers: headers(credentials),
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        console.warn('[github-api] Error', res.status, data.error, path);
        throw new PermanentError(data.error ?? `Request failed: ${res.status}`, res.status, data.error ?? '');
    }
    return (await res.json()) as T;
}

async function patchJson<T>(credentials: AuthCredentials, path: string, body: unknown): Promise<T> {
    if (__DEV__) console.log('[github-api] PATCH', `${API()}${path}`);
    const res = await fetch(`${API()}${path}`, {
        method: 'PATCH',
        headers: headers(credentials),
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        console.warn('[github-api] Error', res.status, data.error, path);
        throw new PermanentError(data.error ?? `Request failed: ${res.status}`, res.status, data.error ?? '');
    }
    return (await res.json()) as T;
}

async function deleteJson(credentials: AuthCredentials, path: string): Promise<void> {
    if (__DEV__) console.log('[github-api] DELETE', `${API()}${path}`);
    const res = await fetch(`${API()}${path}`, {
        method: 'DELETE',
        headers: headers(credentials),
    });
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new PermanentError(data.error ?? `Request failed: ${res.status}`, res.status, data.error ?? '');
    }
}

function repoPath(owner: string, repo: string): string {
    return `/v1/github/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

// Repos

export async function fetchGithubRepos(
    credentials: AuthCredentials,
    opts?: { sort?: string; cursor?: string; limit?: number; search?: string }
): Promise<PaginatedResponse<RepoInfo>> {
    const params = new URLSearchParams();
    if (opts?.sort) params.set('sort', opts.sort);
    if (opts?.cursor) params.set('cursor', opts.cursor);
    if (opts?.limit) params.set('limit', String(opts.limit));
    if (opts?.search) params.set('search', opts.search);
    const qs = params.toString();
    return fetchJson(credentials, `/v1/github/repos${qs ? `?${qs}` : ''}`);
}

export async function fetchGithubRepo(
    credentials: AuthCredentials,
    owner: string,
    repo: string,
    branch?: string
): Promise<RepoInfo> {
    const qs = branch ? `?branch=${encodeURIComponent(branch)}` : '';
    return fetchJson(credentials, `${repoPath(owner, repo)}${qs}`);
}

// Issues

export async function fetchGithubIssues(
    credentials: AuthCredentials,
    owner: string,
    repo: string,
    opts?: { state?: 'open' | 'closed' | 'all'; cursor?: string; limit?: number }
): Promise<PaginatedResponse<RepoIssue>> {
    const params = new URLSearchParams();
    if (opts?.state) params.set('state', opts.state);
    if (opts?.cursor) params.set('cursor', opts.cursor);
    if (opts?.limit) params.set('limit', String(opts.limit));
    const qs = params.toString();
    return fetchJson(credentials, `${repoPath(owner, repo)}/issues${qs ? `?${qs}` : ''}`);
}

export async function fetchGithubIssue(
    credentials: AuthCredentials,
    owner: string,
    repo: string,
    number: number
): Promise<RepoIssue> {
    return fetchJson(credentials, `${repoPath(owner, repo)}/issues/${number}`);
}

export async function createGithubIssue(
    credentials: AuthCredentials,
    owner: string,
    repo: string,
    data: { title: string; body?: string; labels?: string[] }
): Promise<RepoIssue> {
    return postJson(credentials, `${repoPath(owner, repo)}/issues`, data);
}

export async function updateGithubIssue(
    credentials: AuthCredentials,
    owner: string,
    repo: string,
    number: number,
    data: { state?: 'open' | 'closed'; title?: string; body?: string; labels?: string[] }
): Promise<RepoIssue> {
    return patchJson(credentials, `${repoPath(owner, repo)}/issues/${number}`, data);
}

export async function updateGithubPull(
    credentials: AuthCredentials,
    owner: string,
    repo: string,
    number: number,
    data: { state?: 'open' | 'closed'; title?: string; body?: string }
): Promise<RepoPR> {
    return patchJson(credentials, `${repoPath(owner, repo)}/pulls/${number}`, data);
}

// Issue / PR Comments

export async function fetchGithubIssueComments(
    credentials: AuthCredentials,
    owner: string,
    repo: string,
    number: number,
    opts?: { cursor?: string; limit?: number }
): Promise<PaginatedResponse<RepoIssueComment>> {
    const params = new URLSearchParams();
    if (opts?.cursor) params.set('cursor', opts.cursor);
    if (opts?.limit) params.set('limit', String(opts.limit));
    const qs = params.toString();
    return fetchJson(credentials, `${repoPath(owner, repo)}/issues/${number}/comments${qs ? `?${qs}` : ''}`);
}

export async function createGithubIssueComment(
    credentials: AuthCredentials,
    owner: string,
    repo: string,
    number: number,
    body: string
): Promise<RepoIssueComment> {
    return postJson(credentials, `${repoPath(owner, repo)}/issues/${number}/comments`, { body });
}

export async function updateGithubIssueComment(
    credentials: AuthCredentials,
    owner: string,
    repo: string,
    commentId: number,
    body: string
): Promise<RepoIssueComment> {
    return patchJson(credentials, `${repoPath(owner, repo)}/issues/comments/${commentId}`, { body });
}

export async function deleteGithubIssueComment(
    credentials: AuthCredentials,
    owner: string,
    repo: string,
    commentId: number
): Promise<void> {
    return deleteJson(credentials, `${repoPath(owner, repo)}/issues/comments/${commentId}`);
}

// Pull Requests

export async function fetchGithubPulls(
    credentials: AuthCredentials,
    owner: string,
    repo: string,
    opts?: { state?: 'open' | 'closed' | 'all'; cursor?: string; limit?: number }
): Promise<PaginatedResponse<RepoPR>> {
    const params = new URLSearchParams();
    if (opts?.state) params.set('state', opts.state);
    if (opts?.cursor) params.set('cursor', opts.cursor);
    if (opts?.limit) params.set('limit', String(opts.limit));
    const qs = params.toString();
    return fetchJson(credentials, `${repoPath(owner, repo)}/pulls${qs ? `?${qs}` : ''}`);
}

export async function createGithubPull(
    credentials: AuthCredentials,
    owner: string,
    repo: string,
    data: { title: string; body?: string; head: string; base: string }
): Promise<RepoPR> {
    return postJson(credentials, `${repoPath(owner, repo)}/pulls`, data);
}

export async function fetchGithubPull(
    credentials: AuthCredentials,
    owner: string,
    repo: string,
    number: number
): Promise<RepoPR> {
    return fetchJson(credentials, `${repoPath(owner, repo)}/pulls/${number}`);
}

// Token

export async function fetchGithubToken(credentials: AuthCredentials): Promise<string> {
    const { token } = await fetchJson<{ token: string }>(credentials, '/v1/connect/github/token');
    return token;
}

// Image Upload

export async function uploadGithubImage(
    credentials: AuthCredentials,
    owner: string,
    repo: string,
    imageUri: string,
    mimeType: string
): Promise<{ url: string; width: number; height: number }> {
    const formData = new FormData();
    const extension = mimeType === 'image/png' ? 'png' : 'jpg';
    const filename = `image.${extension}`;

    if (Platform.OS === 'web') {
        const response = await fetch(imageUri);
        const blob = await response.blob();
        formData.append('file', blob, filename);
    } else {
        formData.append('file', {
            uri: imageUri,
            name: filename,
            type: mimeType,
        } as any);
    }

    const url = `${API()}${repoPath(owner, repo)}/upload-image`;
    console.log('[github-api] POST', url);
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${credentials.token}` },
        body: formData,
    });

    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new PermanentError(data.error ?? `Upload failed: ${res.status}`, res.status, data.error ?? '');
    }

    const result = await res.json();
    if (!result.success) {
        throw new PermanentError(result.error || 'Upload failed', 500, '');
    }

    return result.data;
}
