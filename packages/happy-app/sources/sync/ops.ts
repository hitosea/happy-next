/**
 * Session operations for remote procedure calls
 * Provides strictly typed functions for all session-related RPC operations
 */

import { apiSocket } from './apiSocket';
import { sync } from './sync';
import { storage } from './storage';
import type { MachineMetadata, Metadata } from './storageTypes';
import type { OpenFilePreviewRequest, OpenFilePreviewResponse, FilePreviewChunkResponse } from 'happy-wire';
import type { OpenFileDownloadRequest, OpenFileDownloadResponse } from 'happy-wire';

export async function sessionOpenFileDownload(sessionId: string, request: OpenFileDownloadRequest) {
    return apiSocket.sessionRPC<OpenFileDownloadResponse, OpenFileDownloadRequest>(sessionId, 'openFileDownload', request, 65000);
}

export async function sessionReadFileDownloadChunk(sessionId: string, token: string, offset: number) {
    return apiSocket.sessionRPC<FilePreviewChunkResponse, { token: string; offset: number }>(sessionId, 'readFileDownloadChunk', { token, offset });
}

export async function sessionCloseFileDownload(sessionId: string, token: string) {
    return apiSocket.sessionRPC(sessionId, 'closeFileDownload', { token, offset: 0 });
}

export async function sessionOpenFilePreview(sessionId: string, request: OpenFilePreviewRequest) {
    return apiSocket.sessionRPC<OpenFilePreviewResponse, OpenFilePreviewRequest>(sessionId, 'openFilePreview', request, 65000);
}

export async function sessionReadFilePreviewChunk(sessionId: string, token: string, offset: number) {
    return apiSocket.sessionRPC<FilePreviewChunkResponse, { token: string; offset: number }>(sessionId, 'readFilePreviewChunk', { token, offset });
}

export async function sessionCloseFilePreview(sessionId: string, token: string) {
    return apiSocket.sessionRPC(sessionId, 'closeFilePreview', { token, offset: 0 });
}

// Strict type definitions for all operations

// Permission operation types
interface SessionPermissionRequest {
    id: string;
    approved: boolean;
    reason?: string;
    mode?: 'default' | 'acceptEdits' | 'auto' | 'bypassPermissions' | 'plan';
    allowTools?: string[];
    decision?: 'approved' | 'approved_for_session' | 'denied' | 'abort';
    answers?: Record<string, string>;
}

// Mode change operation types
interface SessionModeChangeRequest {
    to: 'remote' | 'local';
}

// Bash operation types
interface SessionBashRequest {
    command: string;
    cwd?: string;
    timeout?: number;
}

interface SessionBashResponse {
    success: boolean;
    stdout: string;
    stderr: string;
    exitCode: number;
    error?: string;
}

// Read file operation types
interface SessionReadFileRequest {
    path: string;
}

interface SessionReadFileResponse {
    success: boolean;
    content?: string; // base64 encoded
    error?: string;
}

// Write file operation types
interface SessionWriteFileRequest {
    path: string;
    content: string; // base64 encoded
    expectedHash?: string | null;
}

interface SessionWriteFileResponse {
    success: boolean;
    hash?: string;
    error?: string;
}

// List directory operation types
interface SessionListDirectoryRequest {
    path: string;
}

interface DirectoryEntry {
    name: string;
    type: 'file' | 'directory' | 'other';
    size?: number;
    modified?: number;
}

interface SessionListDirectoryResponse {
    success: boolean;
    entries?: DirectoryEntry[];
    error?: string;
}

export type MachineDirectoryEntry = DirectoryEntry;

export type MachineListDirectoryResponse = SessionListDirectoryResponse;

// Directory tree operation types
interface SessionGetDirectoryTreeRequest {
    path: string;
    maxDepth: number;
}

interface TreeNode {
    name: string;
    path: string;
    type: 'file' | 'directory';
    size?: number;
    modified?: number;
    children?: TreeNode[];
}

interface SessionGetDirectoryTreeResponse {
    success: boolean;
    tree?: TreeNode;
    error?: string;
}

// Ripgrep operation types
interface SessionRipgrepRequest {
    args: string[];
    cwd?: string;
}

interface SessionRipgrepResponse {
    success: boolean;
    exitCode?: number;
    stdout?: string;
    stderr?: string;
    error?: string;
}

// Kill session operation types
interface SessionKillRequest {
    // No parameters needed
}

interface SessionKillResponse {
    success: boolean;
    message: string;
}

// Response types for spawn session
export type SpawnSessionResult =
    | { type: 'success'; sessionId: string }
    | { type: 'requestToApproveDirectoryCreation'; directory: string }
    | { type: 'error'; errorMessage: string };

// Options for spawning a session
export interface SpawnSessionOptions {
    machineId: string;
    directory: string;
    approvedNewDirectoryCreation?: boolean;
    token?: string;
    agent?: 'codex' | 'claude' | 'gemini' | 'qoder';
    resumeSessionId?: string;
    sessionTitle?: string;
    skipForkSession?: boolean;
    // Environment variables from AI backend profile
    // Accepts any environment variables - daemon will pass them to the agent process
    // Common variables include:
    // - ANTHROPIC_BASE_URL, ANTHROPIC_AUTH_TOKEN, ANTHROPIC_MODEL, ANTHROPIC_SMALL_FAST_MODEL
    // - OPENAI_API_KEY, OPENAI_BASE_URL, OPENAI_MODEL, OPENAI_API_TIMEOUT_MS
    // - AZURE_OPENAI_API_KEY, AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_VERSION, AZURE_OPENAI_DEPLOYMENT_NAME
    // - TOGETHER_API_KEY, TOGETHER_MODEL
    // - TMUX_SESSION_NAME, TMUX_TMPDIR, TMUX_UPDATE_ENVIRONMENT
    // - API_TIMEOUT_MS, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC
    // - Custom variables (DEEPSEEK_*, Z_AI_*, etc.)
    environmentVariables?: Record<string, string>;
    // Worktree metadata - passed to CLI so it's included in initial metadata (avoids race condition)
    worktreeBasePath?: string;
    worktreeBranchName?: string;
    // Extra MCP servers to inject (e.g., DooTask MCP)
    mcpServers?: Array<{
        name: string;
        url: string;
        headers?: Record<string, string>;
    }>;
    // Multi-repo workspace
    workspaceRepos?: Array<{
        repoId?: string;
        path: string;
        basePath: string;
        branchName: string;
        targetBranch?: string;
        displayName?: string;
    }>;
    workspacePath?: string;
    repoScripts?: Array<{
        repoDisplayName: string;
        worktreePath: string;
        setupScript?: string;
        parallelSetup?: boolean;
        cleanupScript?: string;
        archiveScript?: string;
        devServerScript?: string;
    }>;
}

export interface ClaudeSessionIndexEntry {
    sessionId: string;
    projectId: string;
    originalPath: string | null;
    title?: string | null;
    updatedAt?: number;
    messageCount?: number;
    gitBranch?: string | null;
}

export interface ClaudeSessionPreviewMessage {
    role: 'user' | 'assistant';
    content: string;
    timestamp?: string;
}

export interface UserMessageWithUuid {
    uuid: string;
    content: string;
    timestamp?: string;
    index: number;
}

export interface UserMessagePage {
    messages: UserMessageWithUuid[];
    hasMore: boolean;
    nextBeforeIndex: number | null;
}

export type ResolvedForkTarget = Pick<UserMessageWithUuid, 'uuid' | 'timestamp' | 'index'>;

/** @deprecated Use UserMessageWithUuid instead */
export type ClaudeUserMessageWithUuid = UserMessageWithUuid;

/** Unified session entry type for multi-agent history browser */
export interface AgentSessionIndexEntry {
    sessionId: string;
    agent: 'claude' | 'gemini' | 'codex' | 'qoder';
    originalPath: string | null;
    title?: string | null;
    updatedAt?: number;
    messageCount?: number;
    gitBranch?: string | null;
    projectId?: string; // Claude only
}

/** Agent-agnostic alias for preview messages */
export type SessionPreviewMessage = ClaudeSessionPreviewMessage;

// Exported session operation functions

/**
 * Spawn a new remote session on a specific machine
 */
export async function machineSpawnNewSession(options: SpawnSessionOptions): Promise<SpawnSessionResult> {

    const { machineId, directory, approvedNewDirectoryCreation = false, token, agent, resumeSessionId, sessionTitle, skipForkSession, environmentVariables, worktreeBasePath, worktreeBranchName, mcpServers, workspaceRepos, workspacePath, repoScripts } = options;

    try {
        const result = await apiSocket.machineSpawnHTTP<SpawnSessionResult>(
            machineId,
            { type: 'spawn-in-directory', directory, approvedNewDirectoryCreation, token, agent, resumeSessionId, sessionTitle, skipForkSession, environmentVariables, worktreeBasePath, worktreeBranchName, mcpServers, workspaceRepos, workspacePath, repoScripts }
        );
        return result;
    } catch (error) {
        // Handle RPC errors
        return {
            type: 'error',
            errorMessage: error instanceof Error ? error.message : 'Failed to spawn session'
        };
    }
}

/**
 * Stop the daemon on a specific machine
 */
export async function machineStopDaemon(machineId: string): Promise<{ message: string }> {
    const result = await apiSocket.machineRPC<{ message: string }, {}>(
        machineId,
        'stop-daemon',
        {}
    );
    return result;
}

/**
 * List Claude sessions from local Claude index on a machine
 */
export async function machineListClaudeSessions(
    machineId: string,
    options?: { offset?: number; limit?: number; query?: string; waitForRefresh?: boolean; timeoutMs?: number }
): Promise<{ sessions: ClaudeSessionIndexEntry[]; total: number; fromCache?: boolean }> {
    const timeoutMs = options?.timeoutMs ?? 30000;

    const rpcPromise = apiSocket.machineRPC<any, { offset?: number; limit?: number; query?: string; waitForRefresh?: boolean }>(
        machineId,
        'claude-list-sessions',
        {
            offset: options?.offset,
            limit: options?.limit,
            query: options?.query,
            waitForRefresh: options?.waitForRefresh,
        }
    );

    const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Request timed out')), timeoutMs);
    });

    const result = await Promise.race([rpcPromise, timeoutPromise]);

    if (!result) {
        throw new Error('RPC returned empty response');
    }
    if (result.error) {
        throw new Error(result.error);
    }
    if (!Array.isArray(result.sessions)) {
        return { sessions: [], total: 0 };
    }
    const total = typeof result.total === 'number' ? result.total : result.sessions.length;
    return { sessions: result.sessions, total, fromCache: result.fromCache };
}

/**
 * Get preview messages from a Claude session
 */
export async function machineGetClaudeSessionPreview(
    machineId: string,
    projectId: string,
    sessionId: string,
    options?: { limit?: number; timeoutMs?: number }
): Promise<{ messages: ClaudeSessionPreviewMessage[] }> {
    const timeoutMs = options?.timeoutMs ?? 10000;
    const limit = options?.limit ?? 10;

    const rpcPromise = apiSocket.machineRPC<any, { projectId: string; sessionId: string; limit: number }>(
        machineId,
        'claude-session-preview',
        { projectId, sessionId, limit }
    );

    const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Request timed out')), timeoutMs);
    });

    const result = await Promise.race([rpcPromise, timeoutPromise]);

    if (!result) {
        throw new Error('RPC returned empty response');
    }
    if (result.error) {
        throw new Error(result.error);
    }
    if (!Array.isArray(result.messages)) {
        return { messages: [] };
    }
    return { messages: result.messages };
}

/**
 * List Gemini sessions from a machine
 */
export async function machineListGeminiSessions(
    machineId: string,
    options?: { offset?: number; limit?: number; query?: string; waitForRefresh?: boolean; timeoutMs?: number }
): Promise<{ sessions: AgentSessionIndexEntry[]; total: number; fromCache?: boolean }> {
    const timeoutMs = options?.timeoutMs ?? 30000;

    const rpcPromise = apiSocket.machineRPC<any, { offset?: number; limit?: number; query?: string; waitForRefresh?: boolean }>(
        machineId,
        'gemini-list-sessions',
        {
            offset: options?.offset,
            limit: options?.limit,
            query: options?.query,
            waitForRefresh: options?.waitForRefresh,
        }
    );

    const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Request timed out')), timeoutMs);
    });

    const result = await Promise.race([rpcPromise, timeoutPromise]);

    if (!result) throw new Error('RPC returned empty response');
    if (result.error) throw new Error(result.error);
    if (!Array.isArray(result.sessions)) return { sessions: [], total: 0 };

    const sessions: AgentSessionIndexEntry[] = result.sessions.map((s: any) => ({
        ...s,
        agent: 'gemini' as const,
    }));
    const total = typeof result.total === 'number' ? result.total : sessions.length;
    return { sessions, total, fromCache: result.fromCache };
}

/**
 * List Qoder's own sessions for one directory.
 *
 * Unlike the Claude/Gemini/Codex listings, this is per-directory on purpose: Qoder's
 * `session/list` filters by the working directory of the CLI process, so the daemon cannot
 * answer a machine-wide question. Callers must pass the session's directory.
 */
export async function machineListQoderSessions(
    machineId: string,
    options: { directory: string; offset?: number; limit?: number; query?: string; waitForRefresh?: boolean; timeoutMs?: number }
): Promise<{ sessions: AgentSessionIndexEntry[]; total: number }> {
    const timeoutMs = options.timeoutMs ?? 60000;

    const rpcPromise = apiSocket.machineRPC<any, { directory: string; offset?: number; limit?: number; query?: string; waitForRefresh?: boolean }>(
        machineId,
        'qoder-list-sessions',
        {
            directory: options.directory,
            offset: options.offset,
            limit: options.limit,
            query: options.query,
            waitForRefresh: options.waitForRefresh,
        }
    );

    // Each listing spawns a short-lived `qoder --acp`, so this is slower than reading an
    // index file and gets its own longer default timeout.
    const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Request timed out')), timeoutMs);
    });

    const result = await Promise.race([rpcPromise, timeoutPromise]);

    if (!result) throw new Error('RPC returned empty response');
    if (result.error) throw new Error(result.error);
    if (!Array.isArray(result.sessions)) return { sessions: [], total: 0 };

    const sessions: AgentSessionIndexEntry[] = result.sessions.map((session: any) => ({
        ...session,
        agent: 'qoder' as const,
    }));

    return { sessions, total: typeof result.total === 'number' ? result.total : sessions.length };
}

/**
 * Fork a Qoder session so a duplicated Happy session gets its own native conversation.
 * Without this the copy would resume the same native id and keep writing into the
 * original session's history.
 */
export async function machineForkQoderSession(
    machineId: string,
    sessionId: string,
    directory: string
): Promise<{ success: boolean; newSessionId?: string; error?: string }> {
    const result = await apiSocket.machineRPC<any, { sessionId: string; directory: string }>(
        machineId,
        'qoder-fork-session',
        { sessionId, directory }
    );

    if (!result) return { success: false, error: 'RPC returned empty response' };
    return {
        success: result.success === true,
        newSessionId: typeof result.newSessionId === 'string' ? result.newSessionId : undefined,
        error: typeof result.error === 'string' ? result.error : undefined,
    };
}
/**
 * Get preview messages from a Gemini session
 */
export async function machineGetGeminiSessionPreview(
    machineId: string,
    sessionId: string,
    options?: { limit?: number; timeoutMs?: number }
): Promise<{ messages: SessionPreviewMessage[] }> {
    const timeoutMs = options?.timeoutMs ?? 10000;
    const limit = options?.limit ?? 10;

    const rpcPromise = apiSocket.machineRPC<any, { sessionId: string; limit: number }>(
        machineId,
        'gemini-session-preview',
        { sessionId, limit }
    );

    const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Request timed out')), timeoutMs);
    });

    const result = await Promise.race([rpcPromise, timeoutPromise]);

    if (!result) throw new Error('RPC returned empty response');
    if (result.error) throw new Error(result.error);
    return { messages: Array.isArray(result.messages) ? result.messages : [] };
}

/**
 * List Codex sessions from a machine
 */
export async function machineListCodexSessions(
    machineId: string,
    options?: { offset?: number; limit?: number; query?: string; waitForRefresh?: boolean; timeoutMs?: number }
): Promise<{ sessions: AgentSessionIndexEntry[]; total: number; fromCache?: boolean }> {
    const timeoutMs = options?.timeoutMs ?? 30000;

    const rpcPromise = apiSocket.machineRPC<any, { offset?: number; limit?: number; query?: string; waitForRefresh?: boolean }>(
        machineId,
        'codex-list-sessions',
        {
            offset: options?.offset,
            limit: options?.limit,
            query: options?.query,
            waitForRefresh: options?.waitForRefresh,
        }
    );

    const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Request timed out')), timeoutMs);
    });

    const result = await Promise.race([rpcPromise, timeoutPromise]);

    if (!result) throw new Error('RPC returned empty response');
    if (result.error) throw new Error(result.error);
    if (!Array.isArray(result.sessions)) return { sessions: [], total: 0 };

    const sessions: AgentSessionIndexEntry[] = result.sessions.map((s: any) => ({
        ...s,
        agent: 'codex' as const,
    }));
    const total = typeof result.total === 'number' ? result.total : sessions.length;
    return { sessions, total, fromCache: result.fromCache };
}

/**
 * Get preview messages from a Codex session
 */
export async function machineGetCodexSessionPreview(
    machineId: string,
    codexSessionId: string,
    options?: { limit?: number; timeoutMs?: number }
): Promise<{ messages: SessionPreviewMessage[] }> {
    const timeoutMs = options?.timeoutMs ?? 10000;
    const limit = options?.limit ?? 10;

    const rpcPromise = apiSocket.machineRPC<any, { codexSessionId: string; limit: number }>(
        machineId,
        'codex-session-preview',
        { codexSessionId, limit }
    );

    const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Request timed out')), timeoutMs);
    });

    const result = await Promise.race([rpcPromise, timeoutPromise]);

    if (!result) throw new Error('RPC returned empty response');
    if (result.error) throw new Error(result.error);
    return { messages: Array.isArray(result.messages) ? result.messages : [] };
}

/**
 * Execute a bash command on a specific machine
 */
export async function machineBash(
    machineId: string,
    command: string,
    cwd: string
): Promise<{
    success: boolean;
    stdout: string;
    stderr: string;
    exitCode: number;
}> {
    try {
        const result = await apiSocket.machineRPC<{
            success: boolean;
            stdout: string;
            stderr: string;
            exitCode: number;
        }, {
            command: string;
            cwd: string;
        }>(
            machineId,
            'bash',
            { command, cwd }
        );
        return result;
    } catch (error) {
        return {
            success: false,
            stdout: '',
            stderr: error instanceof Error ? error.message : 'Unknown error',
            exitCode: -1
        };
    }
}

/**
 * List directory contents on a machine. Machine-scoped common handlers validate
 * paths relative to the daemon user's home directory.
 */
export async function machineListDirectory(
    machineId: string,
    path: string
): Promise<MachineListDirectoryResponse> {
    try {
        const result = await apiSocket.machineRPC<MachineListDirectoryResponse, SessionListDirectoryRequest>(
            machineId,
            'listDirectory',
            { path }
        );
        return result;
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to list directory'
        };
    }
}

/**
 * Update machine metadata with optimistic concurrency control and automatic retry
 */
export async function machineUpdateMetadata(
    machineId: string,
    metadata: MachineMetadata,
    expectedVersion: number,
    maxRetries: number = 3
): Promise<{ version: number; metadata: string }> {
    let currentVersion = expectedVersion;
    let currentMetadata = { ...metadata };
    let retryCount = 0;

    const machineEncryption = sync.encryption.getMachineEncryption(machineId);
    if (!machineEncryption) {
        throw new Error(`Machine encryption not found for ${machineId}`);
    }

    while (retryCount < maxRetries) {
        const encryptedMetadata = await machineEncryption.encryptRaw(currentMetadata);

        const result = await apiSocket.emitWithAck<{
            result: 'success' | 'version-mismatch' | 'error';
            version?: number;
            metadata?: string;
            message?: string;
        }>('machine-update-metadata', {
            machineId,
            metadata: encryptedMetadata,
            expectedVersion: currentVersion
        });

        if (result.result === 'success') {
            return {
                version: result.version!,
                metadata: result.metadata!
            };
        } else if (result.result === 'version-mismatch') {
            // Get the latest version and metadata from the response
            currentVersion = result.version!;
            const latestMetadata = await machineEncryption.decryptRaw(result.metadata!) as MachineMetadata;

            // Merge our changes with the latest metadata
            // Preserve the displayName we're trying to set, but use latest values for other fields
            currentMetadata = {
                ...latestMetadata,
                displayName: metadata.displayName // Keep our intended displayName change
            };

            retryCount++;

            // If we've exhausted retries, throw error
            if (retryCount >= maxRetries) {
                throw new Error(`Failed to update after ${maxRetries} retries due to version conflicts`);
            }

            // Otherwise, loop will retry with updated version and merged metadata
        } else {
            throw new Error(result.message || 'Failed to update machine metadata');
        }
    }

    throw new Error('Unexpected error in machineUpdateMetadata');
}

/**
 * Update session summary (title) by updating session metadata
 */
export async function sessionUpdateSummary(
    sessionId: string,
    currentMetadata: Metadata,
    newSummaryText: string,
    expectedVersion: number,
    pinned?: boolean,
    maxRetries: number = 3
): Promise<{ version: number }> {
    let currentVersion = expectedVersion;

    const sessionEncryption = sync.encryption.getSessionEncryption(sessionId);
    if (!sessionEncryption) {
        throw new Error(`Session encryption not found for ${sessionId}`);
    }

    let metadataToSend: Metadata = {
        ...currentMetadata,
        summary: {
            text: newSummaryText,
            updatedAt: Date.now()
        },
        summaryPinned: pinned
    };

    for (let retryCount = 0; retryCount < maxRetries; retryCount++) {
        const encryptedMetadata = await sessionEncryption.encryptRaw(metadataToSend);

        const result = await apiSocket.emitWithAck<{
            result: 'success' | 'version-mismatch' | 'error';
            version?: number;
            metadata?: string;
            message?: string;
        }>('update-metadata', {
            sid: sessionId,
            metadata: encryptedMetadata,
            expectedVersion: currentVersion
        });

        if (result.result === 'success') {
            return { version: result.version! };
        } else if (result.result === 'version-mismatch') {
            currentVersion = result.version!;
            // Decrypt latest metadata and re-apply our summary change
            const latestMetadata = await sessionEncryption.decryptRaw(result.metadata!) as Metadata;
            metadataToSend = {
                ...latestMetadata,
                summary: {
                    text: newSummaryText,
                    updatedAt: Date.now()
                },
                summaryPinned: pinned
            };
        } else {
            throw new Error(result.message || 'Failed to update session metadata');
        }
    }

    throw new Error(`Failed to update after ${maxRetries} retries due to version conflicts`);
}

/**
 * Update arbitrary metadata fields on a session (with encryption and version-conflict retry)
 */
export async function sessionUpdateMetadataFields(
    sessionId: string,
    currentMetadata: Metadata,
    updates: Partial<Metadata>,
    expectedVersion: number,
    maxRetries: number = 3
): Promise<{ version: number }> {
    let currentVersion = expectedVersion;

    const sessionEncryption = sync.encryption.getSessionEncryption(sessionId);
    if (!sessionEncryption) {
        throw new Error(`Session encryption not found for ${sessionId}`);
    }

    let metadataToSend: Metadata = { ...currentMetadata, ...updates };

    for (let retryCount = 0; retryCount < maxRetries; retryCount++) {
        const encryptedMetadata = await sessionEncryption.encryptRaw(metadataToSend);

        const result = await apiSocket.emitWithAck<{
            result: 'success' | 'version-mismatch' | 'error';
            version?: number;
            metadata?: string;
            message?: string;
        }>('update-metadata', {
            sid: sessionId,
            metadata: encryptedMetadata,
            expectedVersion: currentVersion
        });

        if (result.result === 'success') {
            return { version: result.version! };
        } else if (result.result === 'version-mismatch') {
            currentVersion = result.version!;
            const latestMetadata = await sessionEncryption.decryptRaw(result.metadata!) as Metadata;
            metadataToSend = { ...latestMetadata, ...updates };
        } else {
            throw new Error(result.message || 'Failed to update session metadata');
        }
    }

    throw new Error(`Failed to update after ${maxRetries} retries due to version conflicts`);
}

/**
 * Abort the current session operation
 */
export async function sessionAbort(sessionId: string): Promise<void> {
    await apiSocket.sessionRPC(sessionId, 'abort', {
        reason: `The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed.`
    });
}

/**
 * Allow a permission request
 */
export async function sessionAllow(sessionId: string, id: string, mode?: 'default' | 'acceptEdits' | 'auto' | 'bypassPermissions' | 'plan', allowedTools?: string[], decision?: 'approved' | 'approved_for_session', answers?: Record<string, string>): Promise<void> {
    const request: SessionPermissionRequest = { id, approved: true, mode, allowTools: allowedTools, decision, answers };
    await apiSocket.sessionRPC(sessionId, 'permission', request);
}

/**
 * Deny a permission request
 */
export async function sessionDeny(sessionId: string, id: string, mode?: 'default' | 'acceptEdits' | 'auto' | 'bypassPermissions' | 'plan', allowedTools?: string[], decision?: 'denied' | 'abort'): Promise<void> {
    const request: SessionPermissionRequest = { id, approved: false, mode, allowTools: allowedTools, decision };
    await apiSocket.sessionRPC(sessionId, 'permission', request);
}

/**
 * Request mode change for a session
 */
export async function sessionSwitch(sessionId: string, to: 'remote' | 'local'): Promise<boolean> {
    const request: SessionModeChangeRequest = { to };
    const response = await apiSocket.sessionRPC<boolean, SessionModeChangeRequest>(
        sessionId,
        'switch',
        request,
    );
    return response;
}

/**
 * Execute a bash command in the session
 */
export async function sessionBash(sessionId: string, request: SessionBashRequest): Promise<SessionBashResponse> {
    try {
        // RPC timeout = command timeout + 5s buffer for network round-trip
        const rpcTimeout = (request.timeout || 30000) + 5000;
        const response = await apiSocket.sessionRPC<SessionBashResponse, SessionBashRequest>(
            sessionId,
            'bash',
            request,
            rpcTimeout
        );
        return response;
    } catch (error) {
        return {
            success: false,
            stdout: '',
            stderr: error instanceof Error ? error.message : 'Unknown error',
            exitCode: -1,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
}

/**
 * Read a file from the session
 */
export async function sessionReadFile(sessionId: string, path: string): Promise<SessionReadFileResponse> {
    try {
        const request: SessionReadFileRequest = { path };
        const response = await apiSocket.sessionRPC<SessionReadFileResponse, SessionReadFileRequest>(
            sessionId,
            'readFile',
            request
        );
        return response;
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
}

/**
 * Write a file to the session
 */
export async function sessionWriteFile(
    sessionId: string,
    path: string,
    content: string,
    expectedHash?: string | null
): Promise<SessionWriteFileResponse> {
    try {
        const request: SessionWriteFileRequest = { path, content, expectedHash };
        const response = await apiSocket.sessionRPC<SessionWriteFileResponse, SessionWriteFileRequest>(
            sessionId,
            'writeFile',
            request
        );
        return response;
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
}

/**
 * List directory contents in the session
 */
export async function sessionListDirectory(sessionId: string, path: string): Promise<SessionListDirectoryResponse> {
    try {
        const request: SessionListDirectoryRequest = { path };
        const response = await apiSocket.sessionRPC<SessionListDirectoryResponse, SessionListDirectoryRequest>(
            sessionId,
            'listDirectory',
            request
        );
        return response;
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
}

/**
 * Get directory tree from the session
 */
export async function sessionGetDirectoryTree(
    sessionId: string,
    path: string,
    maxDepth: number
): Promise<SessionGetDirectoryTreeResponse> {
    try {
        const request: SessionGetDirectoryTreeRequest = { path, maxDepth };
        const response = await apiSocket.sessionRPC<SessionGetDirectoryTreeResponse, SessionGetDirectoryTreeRequest>(
            sessionId,
            'getDirectoryTree',
            request
        );
        return response;
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
}

/**
 * Run ripgrep in the session
 */
export async function sessionRipgrep(
    sessionId: string,
    args: string[],
    cwd?: string
): Promise<SessionRipgrepResponse> {
    try {
        const request: SessionRipgrepRequest = { args, cwd };
        const response = await apiSocket.sessionRPC<SessionRipgrepResponse, SessionRipgrepRequest>(
            sessionId,
            'ripgrep',
            request
        );
        return response;
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
}

/**
 * Kill the session process immediately
 */
export async function sessionKill(sessionId: string): Promise<SessionKillResponse> {
    try {
        const response = await apiSocket.sessionRPC<SessionKillResponse, {}>(
            sessionId,
            'killSession',
            {}
        );
        return response;
    } catch (error) {
        return {
            success: false,
            message: error instanceof Error ? error.message : 'Unknown error'
        };
    }
}

/** Keep Happy's stop-based archive behavior, then synchronize Codex's native history. */
export async function sessionArchive(sessionId: string): Promise<{ success: boolean; message?: string; nativeArchiveError?: string }> {
    const metadata = storage.getState().sessions[sessionId]?.metadata;
    const stopped = await sessionKill(sessionId);
    if (metadata?.flavor !== 'codex') return stopped;
    if (!stopped.success && !/RPC method not available/i.test(stopped.message ?? '')) return stopped;

    // Native failures must not roll back Happy's stop or be mistaken for a missing session RPC.
    try {
        if (!metadata.machineId) throw new Error('machine-id-unavailable');
        const result = await apiSocket.machineRPC<{ success: boolean; stopped?: boolean; error?: string }, { sessionId: string; nativeSessionId?: string }>(
            metadata.machineId, 'codex-archive-session',
            { sessionId, nativeSessionId: metadata.codexSessionId ?? undefined }, 120_000,
        );
        // Missing native identity prevents daemon archival, not an acknowledged session stop.
        if (stopped.success && !result?.success && [
            'session-identity-unavailable', 'session-provider-mismatch', 'native-session-id-unavailable',
        ].includes(result?.error ?? '')) {
            return { success: true, nativeArchiveError: result?.error };
        }
        if (result?.stopped === false || (!stopped.success && result?.stopped !== true)) {
            return { success: false, message: result?.error ?? 'stop-not-confirmed' };
        }
        if (!result?.success) return { success: true, nativeArchiveError: result?.error ?? 'native-archive-failed' };
        try {
            const session = storage.getState().sessions[sessionId];
            if (!session?.metadata) throw new Error('session-metadata-unavailable');
            await sessionUpdateMetadataFields(sessionId, session.metadata, { lifecycleState: 'archived' }, session.metadataVersion);
        } catch (error) {
            // Native history has moved and the stop is confirmed; do not restore active state.
            const message = error instanceof Error ? error.message : 'unknown-error';
            return { success: true, nativeArchiveError: `archive-metadata-update-failed: ${message}` };
        }
        return { success: true };
    } catch (error) {
        const rawMessage = error instanceof Error ? error.message : 'native-archive-failed';
        // Archive callers tolerate missing session RPCs, but not an unavailable daemon.
        const message = !stopped.success && /RPC method not available/i.test(rawMessage) ? 'daemon-rpc-unavailable' : rawMessage;
        return stopped.success ? { success: true, nativeArchiveError: message } : { success: false, message };
    }
}

/**
 * Permanently delete a session from the server
 * This will remove the session and all its associated data (messages, usage reports, access keys)
 * The session should be inactive/archived before deletion
 */
export async function sessionDelete(sessionId: string): Promise<{ success: boolean; message?: string }> {
    try {
        const response = await apiSocket.request(`/v1/sessions/${sessionId}`, {
            method: 'DELETE'
        });

        if (response.ok) {
            const result = await response.json();
            return { success: true };
        } else {
            const error = await response.text();
            return {
                success: false,
                message: error || 'Failed to delete session'
            };
        }
    } catch (error) {
        return {
            success: false,
            message: error instanceof Error ? error.message : 'Unknown error'
        };
    }
}

/**
 * Get user messages with UUIDs from a Claude session
 * Used for the duplicate/fork feature to let users select a point to fork from
 */
export async function machineGetClaudeSessionUserMessages(
    machineId: string,
    claudeSessionId: string,
    options?: { limit?: number; beforeIndex?: number; timeoutMs?: number }
): Promise<UserMessagePage & { projectId: string }> {
    const timeoutMs = options?.timeoutMs ?? 15000;
    const limit = options?.limit ?? 100;

    const rpcPromise = apiSocket.machineRPC<any, { sessionId: string; limit: number; beforeIndex?: number; preview: boolean }>(
        machineId,
        'claude-session-user-messages',
        { sessionId: claudeSessionId, limit, beforeIndex: options?.beforeIndex, preview: true }
    );

    const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Request timed out')), timeoutMs);
    });

    const result = await Promise.race([rpcPromise, timeoutPromise]);

    if (!result) {
        throw new Error('RPC returned empty response');
    }
    if (result.error) {
        throw new Error(result.error);
    }
    if (!Array.isArray(result.messages)) {
        return { messages: [], hasMore: false, nextBeforeIndex: null, projectId: result.projectId || '' };
    }
    return {
        messages: result.messages,
        hasMore: result.hasMore === true,
        nextBeforeIndex: typeof result.nextBeforeIndex === 'number' ? result.nextBeforeIndex : null,
        projectId: result.projectId,
    };
}

export async function machineResolveClaudeForkTarget(machineId: string, claudeSessionId: string, text: string, createdAt: number): Promise<ResolvedForkTarget | null> {
    const result = await apiSocket.machineRPC<any, { sessionId: string; text: string; createdAt: number }>(machineId, 'claude-resolve-fork-target', { sessionId: claudeSessionId, text, createdAt });
    if (result?.error) throw new Error(result.error);
    return result?.message ?? null;
}

export async function machineGetClaudeSessionUserMessage(machineId: string, claudeSessionId: string, uuid: string): Promise<UserMessageWithUuid | null> {
    const result = await apiSocket.machineRPC<any, { sessionId: string; uuid: string }>(machineId, 'claude-session-user-message', { sessionId: claudeSessionId, uuid });
    if (result?.error) throw new Error(result.error);
    return result?.message ?? null;
}

/**
 * Duplicate (fork and truncate) a Claude session
 * Creates a new session that is a copy of the original up to the specified point
 */
export async function machineDuplicateClaudeSession(
    machineId: string,
    claudeSessionId: string,
    truncateBeforeUuid: string,
    options?: { timeoutMs?: number }
): Promise<{ success: boolean; newSessionId?: string; errorMessage?: string }> {
    const timeoutMs = options?.timeoutMs ?? 90000; // Longer timeout for fork + truncate operation

    try {
        const rpcPromise = apiSocket.machineRPC<any, { sessionId: string; truncateBeforeUuid: string }>(
            machineId,
            'claude-duplicate-session',
            { sessionId: claudeSessionId, truncateBeforeUuid }
        );

        const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error('Request timed out')), timeoutMs);
        });

        const result = await Promise.race([rpcPromise, timeoutPromise]);

        if (!result) {
            return { success: false, errorMessage: 'RPC returned empty response' };
        }
        if (result.error) {
            return { success: false, errorMessage: result.error };
        }
        return {
            success: result.success ?? false,
            newSessionId: result.newSessionId,
            errorMessage: result.errorMessage
        };
    } catch (error) {
        // Catch RPC errors (method not found, timeout, etc.)
        return {
            success: false,
            errorMessage: error instanceof Error ? error.message : 'Unknown RPC error'
        };
    }
}

/**
 * Fork a Claude session without truncation
 * Creates a new session that is a full copy of the original
 */
export async function machineForkClaudeSession(
    machineId: string,
    claudeSessionId: string,
    options?: { timeoutMs?: number }
): Promise<{ success: boolean; newSessionId?: string; errorMessage?: string }> {
    const timeoutMs = options?.timeoutMs ?? 90000;

    try {
        const rpcPromise = apiSocket.machineRPC<any, { sessionId: string }>(
            machineId,
            'claude-fork-session',
            { sessionId: claudeSessionId }
        );

        const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error('Request timed out')), timeoutMs);
        });

        const result = await Promise.race([rpcPromise, timeoutPromise]);

        if (!result) {
            return { success: false, errorMessage: 'RPC returned empty response' };
        }
        if (result.error) {
            return { success: false, errorMessage: result.error };
        }
        return {
            success: result.success ?? false,
            newSessionId: result.newSessionId,
            errorMessage: result.errorMessage
        };
    } catch (error) {
        return {
            success: false,
            errorMessage: error instanceof Error ? error.message : 'Unknown RPC error'
        };
    }
}

// --- Gemini session operations ---

/**
 * Get user messages from a Gemini session
 */
export async function machineGetGeminiSessionUserMessages(
    machineId: string,
    sessionId: string,
    options?: { limit?: number; beforeIndex?: number; timeoutMs?: number }
): Promise<UserMessagePage> {
    const timeoutMs = options?.timeoutMs ?? 15000;
    const limit = options?.limit ?? 100;

    const rpcPromise = apiSocket.machineRPC<any, { sessionId: string; limit: number; beforeIndex?: number; preview: boolean }>(
        machineId,
        'gemini-session-user-messages',
        { sessionId, limit, beforeIndex: options?.beforeIndex, preview: true }
    );

    const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Request timed out')), timeoutMs);
    });

    const result = await Promise.race([rpcPromise, timeoutPromise]);

    if (!result) {
        throw new Error('RPC returned empty response');
    }
    if (result.error) {
        throw new Error(result.error);
    }
    return {
        messages: Array.isArray(result.messages) ? result.messages : [],
        hasMore: result.hasMore === true,
        nextBeforeIndex: typeof result.nextBeforeIndex === 'number' ? result.nextBeforeIndex : null,
    };
}

export async function machineResolveGeminiForkTarget(machineId: string, sessionId: string, text: string, createdAt: number): Promise<ResolvedForkTarget | null> {
    const result = await apiSocket.machineRPC<any, { sessionId: string; text: string; createdAt: number }>(machineId, 'gemini-resolve-fork-target', { sessionId, text, createdAt });
    if (result?.error) throw new Error(result.error);
    return result?.message ?? null;
}

export async function machineGetGeminiSessionUserMessage(machineId: string, sessionId: string, uuid: string): Promise<UserMessageWithUuid | null> {
    const result = await apiSocket.machineRPC<any, { sessionId: string; uuid: string }>(machineId, 'gemini-session-user-message', { sessionId, uuid });
    if (result?.error) throw new Error(result.error);
    return result?.message ?? null;
}

/**
 * Duplicate (fork and truncate) a Gemini session
 */
export async function machineDuplicateGeminiSession(
    machineId: string,
    sessionId: string,
    truncateBeforeUuid: string,
    options?: { timeoutMs?: number }
): Promise<{ success: boolean; newSessionId?: string; errorMessage?: string }> {
    const timeoutMs = options?.timeoutMs ?? 90000;

    try {
        const rpcPromise = apiSocket.machineRPC<any, { sessionId: string; truncateBeforeUuid: string }>(
            machineId,
            'gemini-duplicate-session',
            { sessionId, truncateBeforeUuid }
        );

        const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error('Request timed out')), timeoutMs);
        });

        const result = await Promise.race([rpcPromise, timeoutPromise]);

        if (!result) {
            return { success: false, errorMessage: 'RPC returned empty response' };
        }
        if (result.error) {
            return { success: false, errorMessage: result.error };
        }
        return {
            success: result.success ?? false,
            newSessionId: result.newSessionId,
            errorMessage: result.errorMessage
        };
    } catch (error) {
        return {
            success: false,
            errorMessage: error instanceof Error ? error.message : 'Unknown RPC error'
        };
    }
}

/**
 * Fork a Gemini session without truncation (resume)
 */
export async function machineForkGeminiSession(
    machineId: string,
    sessionId: string,
    options?: { timeoutMs?: number }
): Promise<{ success: boolean; newSessionId?: string; errorMessage?: string }> {
    const timeoutMs = options?.timeoutMs ?? 90000;

    try {
        const rpcPromise = apiSocket.machineRPC<any, { sessionId: string }>(
            machineId,
            'gemini-fork-session',
            { sessionId }
        );

        const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error('Request timed out')), timeoutMs);
        });

        const result = await Promise.race([rpcPromise, timeoutPromise]);

        if (!result) {
            return { success: false, errorMessage: 'RPC returned empty response' };
        }
        if (result.error) {
            return { success: false, errorMessage: result.error };
        }
        return {
            success: result.success ?? false,
            newSessionId: result.newSessionId,
            errorMessage: result.errorMessage
        };
    } catch (error) {
        return {
            success: false,
            errorMessage: error instanceof Error ? error.message : 'Unknown RPC error'
        };
    }
}

// --- Codex session operations ---

/**
 * Get user messages from a Codex session
 */
export async function machineGetCodexSessionUserMessages(
    machineId: string,
    codexSessionId: string,
    options?: { limit?: number; beforeIndex?: number; timeoutMs?: number }
): Promise<UserMessagePage> {
    const timeoutMs = options?.timeoutMs ?? 15000;
    const limit = options?.limit ?? 100;

    const rpcPromise = apiSocket.machineRPC<any, { codexSessionId: string; limit: number; beforeIndex?: number; preview: boolean }>(
        machineId,
        'codex-session-user-messages',
        { codexSessionId, limit, beforeIndex: options?.beforeIndex, preview: true }
    );

    const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Request timed out')), timeoutMs);
    });

    const result = await Promise.race([rpcPromise, timeoutPromise]);

    if (!result) {
        throw new Error('RPC returned empty response');
    }
    if (result.error) {
        throw new Error(result.error);
    }
    return {
        messages: Array.isArray(result.messages) ? result.messages : [],
        hasMore: result.hasMore === true,
        nextBeforeIndex: typeof result.nextBeforeIndex === 'number' ? result.nextBeforeIndex : null,
    };
}

export async function machineResolveCodexForkTarget(machineId: string, codexSessionId: string, text: string, createdAt: number): Promise<ResolvedForkTarget | null> {
    const result = await apiSocket.machineRPC<any, { codexSessionId: string; text: string; createdAt: number }>(machineId, 'codex-resolve-fork-target', { codexSessionId, text, createdAt });
    if (result?.error) throw new Error(result.error);
    return result?.message ?? null;
}

export async function machineGetCodexSessionUserMessage(machineId: string, codexSessionId: string, uuid: string): Promise<UserMessageWithUuid | null> {
    const result = await apiSocket.machineRPC<any, { codexSessionId: string; uuid: string }>(machineId, 'codex-session-user-message', { codexSessionId, uuid });
    if (result?.error) throw new Error(result.error);
    return result?.message ?? null;
}

/**
 * Duplicate (fork and truncate) a Codex session
 */
export async function machineDuplicateCodexSession(
    machineId: string,
    codexSessionId: string,
    truncateBeforeUuid: string,
    options?: { timeoutMs?: number }
): Promise<{ success: boolean; newFilePath?: string; errorMessage?: string }> {
    const timeoutMs = options?.timeoutMs ?? 120000;

    try {
        const result = await apiSocket.machineRPC<any, { codexSessionId: string; truncateBeforeUuid: string }>(
            machineId,
            'codex-duplicate-session',
            { codexSessionId, truncateBeforeUuid },
            timeoutMs
        );

        if (!result) {
            return { success: false, errorMessage: 'RPC returned empty response' };
        }
        if (result.error) {
            return { success: false, errorMessage: result.error };
        }
        return {
            success: result.success ?? false,
            newFilePath: result.newFilePath,
            errorMessage: result.errorMessage
        };
    } catch (error) {
        return {
            success: false,
            errorMessage: error instanceof Error ? error.message : 'Unknown RPC error'
        };
    }
}

/**
 * Fork a Codex session without truncation (resume)
 */
export async function machineForkCodexSession(
    machineId: string,
    codexSessionId: string,
    options?: { timeoutMs?: number; restoreArchived?: boolean }
): Promise<{ success: boolean; newFilePath?: string; errorMessage?: string }> {
    const timeoutMs = options?.timeoutMs ?? 120000;

    try {
        const result = await apiSocket.machineRPC<any, { codexSessionId: string; restoreArchived?: boolean }>(
            machineId,
            'codex-fork-session',
            { codexSessionId, restoreArchived: options?.restoreArchived },
            timeoutMs
        );

        if (!result) {
            return { success: false, errorMessage: 'RPC returned empty response' };
        }
        if (result.error) {
            return { success: false, errorMessage: result.error };
        }
        return {
            success: result.success ?? false,
            newFilePath: result.newFilePath,
            errorMessage: result.errorMessage
        };
    } catch (error) {
        return {
            success: false,
            errorMessage: error instanceof Error ? error.message : 'Unknown RPC error'
        };
    }
}

// Export types for external use
export type {
    SessionBashRequest,
    SessionBashResponse,
    SessionReadFileResponse,
    SessionWriteFileResponse,
    SessionListDirectoryResponse,
    DirectoryEntry,
    SessionGetDirectoryTreeResponse,
    TreeNode,
    SessionRipgrepResponse,
    SessionKillResponse
};
