import { AuthCredentials } from '@/auth/tokenStorage';
import { backoff } from '@/utils/time';
import { getServerUrl } from './serverConfig';
import type { Encryption } from './encryption/encryption';
import { openOrchestratorTask, openOrchestratorTasks, openOrchestratorTitle, type SealedTaskRecord } from './orchestratorOpen';

export type OrchestratorRunStatus = 'queued' | 'running' | 'canceling' | 'completed' | 'failed' | 'cancelled';
export type OrchestratorTaskStatus = 'queued' | 'dispatching' | 'running' | 'completed' | 'failed' | 'cancelled' | 'dependency_failed';
export type OrchestratorExecutionStatus = 'dispatching' | 'running' | 'completed' | 'failed' | 'cancelled' | 'timeout';
export type OrchestratorSessionActivity = Record<string, string[]>;

export type OrchestratorRunSummary = {
    total: number;
    queued: number;
    running: number;
    completed: number;
    failed: number;
    cancelled: number;
};

// `shell`: the task's prompt is a command the machine's daemon runs itself, with no AI session
// `qodercn` is Qoder CN, the China build of Qoder
export type OrchestratorProvider = 'claude' | 'codex' | 'gemini' | 'qoder' | 'qodercn' | 'antigravity' | 'shell' | 'transfer';

export type OrchestratorExecutionRecord = {
    executionId: string;
    attempt: number;
    status: OrchestratorExecutionStatus;
    machineId: string;
    provider: OrchestratorProvider;
    model: string | null;
    childSessionId: string | null;
    executionType: 'initial' | 'resume';
    resumeMessage: string | null;
    startedAt: string | null;
    finishedAt: string | null;
    exitCode: number | null;
    signal: string | null;
    errorCode: string | null;
    errorMessage: string | null;
    outputSummary: string | null;
    outputText: string | null;
    /** A shell task's stderr; AI tasks keep theirs out of the result */
    stderrText?: string | null;
    createdAt: string;
    updatedAt: string;
};

export type OrchestratorTaskRecord = {
    taskId: string;
    seq: number;
    taskKey: string | null;
    title: string | null;
    status: OrchestratorTaskStatus;
    provider: OrchestratorProvider;
    model: string | null;
    prompt?: string | null;
    workingDirectory: string | null;
    dependsOn: string[];
    retry: {
        maxAttempts: number;
        backoffMs: number;
    };
    nextAttemptAt: string | null;
    outputSummary: string | null;
    outputText: string | null;
    /** A shell task's stderr; AI tasks keep theirs out of the result */
    stderrText?: string | null;
    errorCode: string | null;
    errorMessage: string | null;
    createdAt: string;
    updatedAt: string;
    executions?: OrchestratorExecutionRecord[];
};

export type OrchestratorRunDetail = {
    runId: string;
    title: string;
    status: OrchestratorRunStatus;
    maxConcurrency: number;
    controllerSessionId: string | null;
    createdAt: string;
    updatedAt: string;
    completedAt: string | null;
    cancelRequestedAt: string | null;
    summary: OrchestratorRunSummary;
    machines?: string[];
    /** The providers its tasks use, given by the run list */
    providers?: OrchestratorProvider[];
    tasks?: OrchestratorTaskRecord[];
};

export type OrchestratorTaskDetail = {
    run: {
        runId: string;
        title: string;
        status: OrchestratorRunStatus;
        updatedAt: string;
    };
    task: OrchestratorTaskRecord;
};

type ApiErrorBody = {
    ok?: boolean;
    error?: {
        message?: string;
    };
};

function buildAuthHeaders(credentials: AuthCredentials): Record<string, string> {
    return {
        'Authorization': `Bearer ${credentials.token}`,
        'Content-Type': 'application/json',
    };
}

async function readErrorMessage(response: Response): Promise<string> {
    try {
        const body = await response.json() as ApiErrorBody;
        return body?.error?.message || `Request failed: ${response.status}`;
    } catch (_error) {
        return `Request failed: ${response.status}`;
    }
}

/** The runs of one kind of executor: AI agents, shell commands or file transfers */
export type OrchestratorRunKindFilter = 'agent' | 'shell' | 'transfer';

/** What narrows both the run list and its counts */
export type OrchestratorRunListFilters = {
    controllerSessionId?: string;
    kind?: OrchestratorRunKindFilter;
    machineId?: string;
};

export type ListOrchestratorRunsQuery = OrchestratorRunListFilters & {
    status?: 'active' | 'terminal' | OrchestratorRunStatus;
    limit?: number;
    cursor?: string;
};

type OrchestratorRunListItem = Pick<OrchestratorRunDetail, 'runId' | 'title' | 'status' | 'createdAt' | 'updatedAt' | 'summary' | 'machines' | 'providers'>;

// One page of runs as the server sends it, titles still sealed
async function fetchOrchestratorRunsPage(
    credentials: AuthCredentials,
    query: ListOrchestratorRunsQuery,
): Promise<{ items: OrchestratorRunListItem[]; nextCursor?: string; }> {
    const API_ENDPOINT = getServerUrl();
    const params = new URLSearchParams();
    if (query.status) params.set('status', query.status);
    if (query.limit) params.set('limit', String(query.limit));
    if (query.cursor) params.set('cursor', query.cursor);
    if (query.controllerSessionId) params.set('controllerSessionId', query.controllerSessionId);
    if (query.kind) params.set('kind', query.kind);
    if (query.machineId) params.set('machineId', query.machineId);
    const queryString = params.toString();

    return backoff(async () => {
        const response = await fetch(`${API_ENDPOINT}/v1/orchestrator/runs${queryString ? `?${queryString}` : ''}`, {
            headers: buildAuthHeaders(credentials),
        });
        if (!response.ok) {
            throw new Error(await readErrorMessage(response));
        }
        const body = await response.json() as {
            ok: true;
            data: {
                items: OrchestratorRunListItem[];
                nextCursor?: string;
            };
        };
        return body.data;
    });
}

export async function listOrchestratorRuns(
    credentials: AuthCredentials,
    encryption: Encryption,
    query: ListOrchestratorRunsQuery = {},
): Promise<{ items: OrchestratorRunListItem[]; nextCursor?: string; }> {
    const page = await fetchOrchestratorRunsPage(credentials, query);
    return {
        ...page,
        items: await Promise.all(page.items.map(async (item) => ({ ...item, title: await openOrchestratorTitle(item.title, encryption) }))),
    };
}

/** The kind filter a task's provider falls under: every provider but a shell command or a file transfer is an AI agent */
export function orchestratorProviderKind(provider: string): OrchestratorRunKindFilter {
    return provider === 'shell' || provider === 'transfer' ? provider : 'agent';
}

/** The machines and executor kinds a set of runs used: what the run list's filters can narrow them by */
export type OrchestratorRunFacets = {
    machineIds: string[];
    kinds: OrchestratorRunKindFilter[];
};

export function collectOrchestratorRunFacets(runs: Array<Pick<OrchestratorRunListItem, 'machines' | 'providers'>>): OrchestratorRunFacets {
    return {
        machineIds: [...new Set(runs.flatMap((run) => run.machines ?? []))],
        kinds: [...new Set(runs.flatMap((run) => (run.providers ?? []).map(orchestratorProviderKind)))],
    };
}

/** Both sets of facets together; `a` itself when `b` adds nothing to it */
export function mergeOrchestratorRunFacets(a: OrchestratorRunFacets, b: OrchestratorRunFacets): OrchestratorRunFacets {
    const machineIds = [...new Set([...a.machineIds, ...b.machineIds])];
    const kinds = [...new Set([...a.kinds, ...b.kinds])];
    return machineIds.length === a.machineIds.length && kinds.length === a.kinds.length ? a : { machineIds, kinds };
}

const FACETS_PAGE_LIMIT = 50;
const FACETS_MAX_PAGES = 10;

/**
 * The machines and kinds one conversation's runs used, read from its run list with no other
 * filter: page by page, up to the first 500 runs, newest first. Titles stay sealed, the scan
 * does not show them.
 */
export async function listOrchestratorSessionRunFacets(
    credentials: AuthCredentials,
    controllerSessionId: string,
): Promise<OrchestratorRunFacets> {
    let facets: OrchestratorRunFacets = { machineIds: [], kinds: [] };
    let cursor: string | undefined;
    for (let page = 0; page < FACETS_MAX_PAGES; page++) {
        const result = await fetchOrchestratorRunsPage(credentials, { controllerSessionId, limit: FACETS_PAGE_LIMIT, cursor });
        facets = mergeOrchestratorRunFacets(facets, collectOrchestratorRunFacets(result.items));
        if (!result.nextCursor) {
            break;
        }
        cursor = result.nextCursor;
    }
    return facets;
}

export type OrchestratorRunCounts = Record<string, number>;

export async function getOrchestratorRunCounts(
    credentials: AuthCredentials,
    filters: OrchestratorRunListFilters = {},
): Promise<OrchestratorRunCounts> {
    const API_ENDPOINT = getServerUrl();
    const params = new URLSearchParams();
    if (filters.controllerSessionId) params.set('controllerSessionId', filters.controllerSessionId);
    if (filters.kind) params.set('kind', filters.kind);
    if (filters.machineId) params.set('machineId', filters.machineId);
    const queryString = params.toString();

    return backoff(async () => {
        const response = await fetch(`${API_ENDPOINT}/v1/orchestrator/runs/counts${queryString ? `?${queryString}` : ''}`, {
            headers: buildAuthHeaders(credentials),
        });
        if (!response.ok) {
            throw new Error(await readErrorMessage(response));
        }
        const body = await response.json() as { ok: true; data: OrchestratorRunCounts };
        return body.data;
    });
}

export type GetOrchestratorRunQuery = {
    includeTasks?: boolean;
    includeExecutions?: boolean;
};

export async function getOrchestratorRun(
    credentials: AuthCredentials,
    encryption: Encryption,
    runId: string,
    query: GetOrchestratorRunQuery = {},
): Promise<OrchestratorRunDetail> {
    const API_ENDPOINT = getServerUrl();
    const params = new URLSearchParams();
    params.set('includeTasks', String(query.includeTasks ?? true));
    if ((query.includeTasks ?? true) && query.includeExecutions) {
        params.set('includeExecutions', 'true');
    }

    return backoff(async () => {
        const response = await fetch(`${API_ENDPOINT}/v1/orchestrator/runs/${encodeURIComponent(runId)}?${params.toString()}`, {
            headers: buildAuthHeaders(credentials),
        });
        if (!response.ok) {
            throw new Error(await readErrorMessage(response));
        }
        const body = await response.json() as { ok: true; data: OrchestratorRunDetail & { tasks?: SealedTaskRecord[] } };
        return {
            ...body.data,
            title: await openOrchestratorTitle(body.data.title, encryption),
            tasks: await openOrchestratorTasks(body.data.tasks, encryption),
        };
    });
}

export async function pendOrchestratorRun(
    credentials: AuthCredentials,
    encryption: Encryption,
    runId: string,
    query: {
        cursor?: string;
        waitFor?: 'change' | 'terminal';
        timeoutMs?: number;
        include?: 'summary' | 'all_tasks';
    } = {},
    options?: {
        signal?: AbortSignal;
    },
): Promise<{
    runId: string;
    terminal: boolean;
    changed: boolean;
    cursor: string;
    run: {
        status: OrchestratorRunStatus;
        summary: OrchestratorRunSummary;
        updatedAt: string;
    };
    tasks?: OrchestratorTaskRecord[];
}> {
    const API_ENDPOINT = getServerUrl();
    const params = new URLSearchParams();
    if (query.cursor) params.set('cursor', query.cursor);
    if (query.waitFor) params.set('waitFor', query.waitFor);
    if (typeof query.timeoutMs === 'number') params.set('timeoutMs', String(query.timeoutMs));
    if (query.include) params.set('include', query.include);

    const response = await fetch(`${API_ENDPOINT}/v1/orchestrator/runs/${encodeURIComponent(runId)}/pend?${params.toString()}`, {
        headers: buildAuthHeaders(credentials),
        signal: options?.signal,
    });
    if (!response.ok) {
        throw new Error(await readErrorMessage(response));
    }
    const body = await response.json() as {
        ok: true;
        data: {
            runId: string;
            terminal: boolean;
            changed: boolean;
            cursor: string;
            run: {
                status: OrchestratorRunStatus;
                summary: OrchestratorRunSummary;
                updatedAt: string;
            };
            tasks?: SealedTaskRecord[];
        };
    };
    return { ...body.data, tasks: await openOrchestratorTasks(body.data.tasks, encryption) };
}

export type GetOrchestratorTaskQuery = {
    includeExecutions?: boolean;
};

export async function getOrchestratorTask(
    credentials: AuthCredentials,
    encryption: Encryption,
    runId: string,
    taskId: string,
    query: GetOrchestratorTaskQuery = {},
): Promise<OrchestratorTaskDetail> {
    const API_ENDPOINT = getServerUrl();
    const params = new URLSearchParams();
    if (query.includeExecutions) {
        params.set('includeExecutions', 'true');
    }
    const queryString = params.toString();

    return backoff(async () => {
        const response = await fetch(
            `${API_ENDPOINT}/v1/orchestrator/runs/${encodeURIComponent(runId)}/tasks/${encodeURIComponent(taskId)}${queryString ? `?${queryString}` : ''}`,
            {
                headers: buildAuthHeaders(credentials),
            },
        );
        if (!response.ok) {
            throw new Error(await readErrorMessage(response));
        }
        const body = await response.json() as { ok: true; data: OrchestratorTaskDetail & { task: SealedTaskRecord } };
        return {
            run: { ...body.data.run, title: await openOrchestratorTitle(body.data.run.title, encryption) },
            task: await openOrchestratorTask(body.data.task, encryption),
        };
    });
}

export async function cancelOrchestratorRun(
    credentials: AuthCredentials,
    runId: string,
    reason?: string,
): Promise<{ runId: string; status: OrchestratorRunStatus; accepted: boolean; }> {
    const API_ENDPOINT = getServerUrl();
    return backoff(async () => {
        const response = await fetch(`${API_ENDPOINT}/v1/orchestrator/runs/${encodeURIComponent(runId)}/cancel`, {
            method: 'POST',
            headers: buildAuthHeaders(credentials),
            body: JSON.stringify(reason ? { reason } : {}),
        });
        if (!response.ok) {
            throw new Error(await readErrorMessage(response));
        }
        const body = await response.json() as {
            ok: true;
            data: {
                runId: string;
                status: OrchestratorRunStatus;
                accepted: boolean;
            };
        };
        return body.data;
    });
}

export async function getOrchestratorActivity(
    credentials: AuthCredentials,
    controllerSessionId: string,
): Promise<{ activity: OrchestratorSessionActivity; totalRunCount?: number }> {
    const API_ENDPOINT = getServerUrl();
    const params = new URLSearchParams({ controllerSessionId });

    const response = await fetch(`${API_ENDPOINT}/v1/orchestrator/activity?${params.toString()}`, {
        headers: buildAuthHeaders(credentials),
    });
    if (!response.ok) {
        throw new Error(await readErrorMessage(response));
    }
    const body = await response.json() as { ok: true; data: { activity: OrchestratorSessionActivity; totalRunCount?: number } };
    return body.data;
}

export async function getOrchestratorActivityBatch(
    credentials: AuthCredentials,
): Promise<{ activity: Record<string, OrchestratorSessionActivity>; totalRunCounts?: Record<string, number> }> {
    const API_ENDPOINT = getServerUrl();
    const response = await fetch(`${API_ENDPOINT}/v1/orchestrator/activity/batch`, {
        headers: buildAuthHeaders(credentials),
    });
    if (!response.ok) {
        throw new Error(await readErrorMessage(response));
    }
    const body = await response.json() as { ok: true; data: { activity: Record<string, OrchestratorSessionActivity>; totalRunCounts?: Record<string, number> } };
    return body.data;
}
