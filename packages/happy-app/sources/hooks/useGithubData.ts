import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/auth/AuthContext';
import type { AuthCredentials } from '@/auth/tokenStorage';
import {
    fetchGithubRepos,
    fetchGithubRepo,
    fetchGithubIssues,
    fetchGithubIssue,
    fetchGithubIssueComments,
    fetchGithubPulls,
    fetchGithubPull,
} from '@/sync/apiGithubData';
import type { PaginatedResponse } from '@/sync/apiGithubData';
import type {
    RepoInfo,
    RepoIssue,
    RepoIssueComment,
    RepoPR,
} from '@/data/mockRepos';

const MAX_CACHE_SIZE = 100;
const dataCache = new Map<string, unknown>();

function cacheSet(key: string, value: unknown): void {
    if (dataCache.has(key)) {
        dataCache.delete(key);
    } else if (dataCache.size >= MAX_CACHE_SIZE) {
        const firstKey = dataCache.keys().next().value!;
        dataCache.delete(firstKey);
    }
    dataCache.set(key, value);
}

function cacheKey(deps: unknown[]): string {
    return JSON.stringify(deps);
}

export function clearGithubCache(): void {
    dataCache.clear();
}

function useGithubFetch<T>(
    fetcher: () => Promise<T>,
    deps: unknown[],
    initial: T,
    enabled: boolean = true
): { data: T; loading: boolean; refresh: () => void; mutate: (updater: (prev: T) => T) => void; tokenExpired: boolean } {
    const key = cacheKey(deps);
    const [data, setData] = useState<T>(() => {
        const cached = dataCache.get(key);
        return cached !== undefined ? (cached as T) : initial;
    });
    const [loading, setLoading] = useState(() => enabled && !dataCache.has(key));
    const [tokenExpired, setTokenExpired] = useState(false);
    const mountedRef = useRef(true);
    const prevKeyRef = useRef(key);

    if (prevKeyRef.current !== key) {
        prevKeyRef.current = key;
        const cached = dataCache.get(key);
        if (cached !== undefined) {
            setData(cached as T);
            setLoading(false);
        } else {
            setData(initial);
            setLoading(enabled);
        }
    }

    const load = useCallback(async (force?: boolean) => {
        if (!enabled) return;
        if (force || !dataCache.has(key)) {
            setLoading(true);
        }
        try {
            const result = await fetcher();
            if (mountedRef.current) {
                setData(result);
                cacheSet(key, result);
                setTokenExpired(false);
            }
        } catch (e) {
            const code = (e as any)?.code;
            if (mountedRef.current && (code === 'github_token_expired' || code === 'github_not_connected')) {
                setTokenExpired(true);
            }
            console.warn('[useGithubFetch] fetch failed:', e);
        } finally {
            if (mountedRef.current) {
                setLoading(false);
            }
        }
    }, [key, enabled]);

    useEffect(() => {
        mountedRef.current = true;
        load();
        return () => { mountedRef.current = false; };
    }, [load]);

    const refresh = useCallback(() => { load(true); }, [load]);

    const keyRef = useRef(key);
    keyRef.current = key;
    const mutate = useCallback((updater: (prev: T) => T) => {
        setData((prev) => {
            const next = updater(prev);
            cacheSet(keyRef.current, next);
            return next;
        });
    }, []);

    return { data, loading, refresh, mutate, tokenExpired };
}

function useGithubPaginatedFetch<T>(
    fetcher: (cursor?: string) => Promise<PaginatedResponse<T>>,
    deps: unknown[],
    enabled: boolean = true
): {
    data: T[];
    loading: boolean;
    loadingMore: boolean;
    hasMore: boolean;
    totalCount: number | undefined;
    loadMore: () => void;
    refresh: () => void;
    mutate: (updater: (prev: T[]) => T[]) => void;
    tokenExpired: boolean;
} {
    const key = cacheKey(deps);
    const [data, setData] = useState<T[]>(() => {
        const cached = dataCache.get(key);
        return cached !== undefined ? (cached as T[]) : [];
    });
    const [loading, setLoading] = useState(() => enabled && !dataCache.has(key));
    const [loadingMore, setLoadingMore] = useState(false);
    const [hasMore, setHasMore] = useState(false);
    const [totalCount, setTotalCount] = useState<number | undefined>(undefined);
    const [tokenExpired, setTokenExpired] = useState(false);
    const mountedRef = useRef(true);
    const cursorRef = useRef<string | null>(null);
    const prevKeyRef = useRef(key);
    const loadingMoreRef = useRef(false);

    if (prevKeyRef.current !== key) {
        prevKeyRef.current = key;
        cursorRef.current = null;
        const cached = dataCache.get(key);
        if (cached !== undefined) {
            setData(cached as T[]);
            setLoading(false);
        } else {
            setData([]);
            setLoading(enabled);
        }
        setHasMore(false);
    }

    const loadFirst = useCallback(async (force?: boolean) => {
        if (!enabled) return;
        cursorRef.current = null;
        if (force || !dataCache.has(key)) {
            setLoading(true);
        }
        try {
            const result = await fetcher(undefined);
            if (mountedRef.current) {
                setData(result.items);
                cacheSet(key, result.items);
                cursorRef.current = result.nextCursor;
                setHasMore(result.hasMore);
                if (result.totalCount !== undefined) setTotalCount(result.totalCount);
                setTokenExpired(false);
            }
        } catch (e) {
            const code = (e as any)?.code;
            if (mountedRef.current && (code === 'github_token_expired' || code === 'github_not_connected')) {
                setTokenExpired(true);
            }
            console.warn('[useGithubPaginatedFetch] fetch failed:', e);
        } finally {
            if (mountedRef.current) {
                setLoading(false);
            }
        }
    }, [key, enabled]);

    useEffect(() => {
        mountedRef.current = true;
        loadFirst();
        return () => { mountedRef.current = false; };
    }, [loadFirst]);

    const loadMore = useCallback(() => {
        if (loadingMoreRef.current || !cursorRef.current) return;
        loadingMoreRef.current = true;
        setLoadingMore(true);

        fetcher(cursorRef.current)
            .then((result) => {
                if (mountedRef.current) {
                    setData((prev) => {
                        const next = [...prev, ...result.items];
                        cacheSet(key, next);
                        return next;
                    });
                    cursorRef.current = result.nextCursor;
                    setHasMore(result.hasMore);
                }
            })
            .catch((e) => {
                console.warn('[useGithubPaginatedFetch] loadMore failed:', e);
            })
            .finally(() => {
                loadingMoreRef.current = false;
                if (mountedRef.current) {
                    setLoadingMore(false);
                }
            });
    }, [key, enabled, fetcher]);

    const refresh = useCallback(() => { loadFirst(true); }, [loadFirst]);

    const keyRef = useRef(key);
    keyRef.current = key;
    const mutate = useCallback((updater: (prev: T[]) => T[]) => {
        setData((prev) => {
            const next = updater(prev);
            cacheSet(keyRef.current, next);
            return next;
        });
    }, []);

    return { data, loading, loadingMore, hasMore, totalCount, loadMore, refresh, mutate, tokenExpired };
}

export function useGithubRepos(opts?: { sort?: string; search?: string }) {
    const { credentials } = useAuth();
    return useGithubPaginatedFetch<RepoInfo>(
        (cursor) => credentials
            ? fetchGithubRepos(credentials, { sort: opts?.sort, search: opts?.search, cursor })
            : Promise.resolve({ items: [], nextCursor: null, hasMore: false }),
        ['repos', credentials?.token, opts?.sort, opts?.search]
    );
}

export function useGithubRepo(owner: string, repo: string, branch?: string) {
    const { credentials } = useAuth();
    return useGithubFetch<RepoInfo | null>(
        () => credentials ? fetchGithubRepo(credentials, owner, repo, branch) : Promise.resolve(null),
        ['repo', credentials?.token, owner, repo, branch],
        null
    );
}

export function useGithubIssues(owner: string, repo: string, state?: 'open' | 'closed' | 'all', enabled: boolean = true) {
    const { credentials } = useAuth();
    return useGithubPaginatedFetch<RepoIssue>(
        (cursor) => credentials
            ? fetchGithubIssues(credentials, owner, repo, { state, cursor })
            : Promise.resolve({ items: [], nextCursor: null, hasMore: false }),
        ['issues', credentials?.token, owner, repo, state],
        enabled
    );
}

export function useGithubIssue(owner: string, repo: string, number: number) {
    const { credentials } = useAuth();
    return useGithubFetch<RepoIssue | null>(
        () => credentials ? fetchGithubIssue(credentials, owner, repo, number) : Promise.resolve(null),
        ['issue', credentials?.token, owner, repo, number],
        null
    );
}

export function useGithubIssueComments(owner: string, repo: string, number: number) {
    const { credentials } = useAuth();
    return useGithubPaginatedFetch<RepoIssueComment>(
        (cursor) => credentials
            ? fetchGithubIssueComments(credentials, owner, repo, number, { cursor })
            : Promise.resolve({ items: [], nextCursor: null, hasMore: false }),
        ['issue-comments', credentials?.token, owner, repo, number]
    );
}

export function useGithubPulls(owner: string, repo: string, state?: 'open' | 'closed' | 'all', enabled: boolean = true) {
    const { credentials } = useAuth();
    return useGithubPaginatedFetch<RepoPR>(
        (cursor) => credentials
            ? fetchGithubPulls(credentials, owner, repo, { state, cursor })
            : Promise.resolve({ items: [], nextCursor: null, hasMore: false }),
        ['pulls', credentials?.token, owner, repo, state],
        enabled
    );
}

export function useGithubPull(owner: string, repo: string, number: number) {
    const { credentials } = useAuth();
    return useGithubFetch<RepoPR | null>(
        () => credentials ? fetchGithubPull(credentials, owner, repo, number) : Promise.resolve(null),
        ['pull', credentials?.token, owner, repo, number],
        null
    );
}

// Prefetch repos + open issues/PRs for the first repo to warm the cache
// before the GitHub tab is opened. Called from MainView on mount.

let prefetchInFlight = false;

export async function prefetchGithubData(credentials: AuthCredentials): Promise<void> {
    if (prefetchInFlight) return;
    prefetchInFlight = true;
    try {
        const reposKey = cacheKey(['repos', credentials.token, undefined, undefined]);
        if (!dataCache.has(reposKey)) {
            const result = await fetchGithubRepos(credentials);
            cacheSet(reposKey, result.items);
        }
        const repos = dataCache.get(reposKey) as RepoInfo[];

        if (repos && repos.length > 0) {
            const { fullName } = repos[0];
            const [owner, repo] = fullName.split('/');
            const issuesKey = cacheKey(['issues', credentials.token, owner, repo, 'open']);
            const pullsKey = cacheKey(['pulls', credentials.token, owner, repo, 'open']);
            const pending: Promise<void>[] = [];
            if (!dataCache.has(issuesKey)) {
                pending.push(
                    fetchGithubIssues(credentials, owner, repo, { state: 'open' })
                        .then((d) => { cacheSet(issuesKey, d.items); })
                );
            }
            if (!dataCache.has(pullsKey)) {
                pending.push(
                    fetchGithubPulls(credentials, owner, repo, { state: 'open' })
                        .then((d) => { cacheSet(pullsKey, d.items); })
                );
            }
            await Promise.all(pending);
        }
    } catch (e) {
        console.warn('[prefetchGithubData] failed:', e);
    } finally {
        prefetchInFlight = false;
    }
}
