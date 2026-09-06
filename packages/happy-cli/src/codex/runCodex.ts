import { render } from "ink";
import React from "react";
import { ApiClient } from '@/api/api';
import { createCodexBackend } from '@/agent/factories/codex';
import type { CodexAppServerBackend } from './appserver/CodexAppServerBackend';
import type { ApprovalPolicy, SandboxMode } from './appserver/types';
import type { PermissionMode } from '@/api/types';
import { CodexPermissionHandler } from './utils/permissionHandler';
import { ReasoningProcessor } from './utils/reasoningProcessor';
import { DiffProcessor } from './utils/diffProcessor';
import { parseClear } from '@/parsers/specialCommands';
import { randomUUID } from 'node:crypto';
import { logger } from '@/ui/logger';
import { isDebug } from '@/utils/env';
import { Credentials, readSettings } from '@/persistence';
import { initialMachineMetadata } from '@/daemon/run';
// configuration and packageJson not currently used but kept for future use
import { MessageQueue2 } from '@/utils/MessageQueue2';
import { hashObject } from '@/utils/deterministicJson';
import { createMcpContext } from '@/agent/mcp';
import { createSessionMetadata } from '@/utils/createSessionMetadata';
import { discoverCodexSkills, getCodexSkillsSignature } from './utils/skillDiscovery';
import { syncOrchestratorAssets } from '@/orchestrator/skillSync';
import { addOrchestratorSlashCommands, expandOrchestratorSlashCommand } from '@/orchestrator/slashCommands';
import { addBuiltinSlashCommands, expandBuiltinSlashCommand, syncBuiltinCommands } from '@/commands/builtinCommands';
import { parseCodexSlashCommand, type CodexSlashCommand } from './slashCommands';
import { MessageBuffer } from "@/ui/ink/messageBuffer";
import { CodexDisplay } from "@/ui/ink/CodexDisplay";
// trimIdent not currently used
import { getFirstTurnInstruction } from '@/orchestrator/firstTurnInstruction';
import { notifyDaemonSessionStarted } from "@/daemon/controlClient";
import { registerKillSessionHandler } from "@/claude/registerKillSessionHandler";
import { inspect } from 'node:util';
// delay not currently used
import { stopCaffeinate } from "@/utils/caffeinate";
import { connectionState } from '@/utils/serverConnectionErrors';
import { setupOfflineReconnection } from '@/utils/setupOfflineReconnection';
import type { ApiSessionClient } from '@/api/apiSession';
import { backfillCodexSessionHistory } from './utils/codexBackfill';
import { downloadImage } from '@/utils/downloadImage';
import type { ImageContent } from '@/api/types';
import type { SendPromptOptions } from '@/agent/core';
import type { AgentMessage } from '@/agent/core';
import { handleConfigMetadataEvent } from '@/agent/acp/sessionUpdateHandlers';
import { findCodexSessionFile } from './utils/codexSessionReader';
import { summarizeBashToolOutput } from '@/modules/common/loadableToolOutput';

type ReadyEventOptions = {
    pending: unknown;
    queueSize: () => number;
    shouldExit: boolean;
    sendReady: () => void;
    notify?: () => void;
};

/**
 * Notify connected clients when Codex finishes processing and the queue is idle.
 * Returns true when a ready event was emitted.
 */
export function emitReadyIfIdle({ pending, queueSize, shouldExit, sendReady, notify }: ReadyEventOptions): boolean {
    if (shouldExit) {
        return false;
    }
    if (pending) {
        return false;
    }
    if (queueSize() > 0) {
        return false;
    }

    sendReady();
    notify?.();
    return true;
}

function formatUnknownCodexError(error: unknown): string {
    if (error instanceof Error) {
        return `${error.message}\n${error.stack ?? ''}`;
    }
    if (typeof error === 'string') {
        return error;
    }
    try {
        const json = JSON.stringify(error, null, 2);
        if (json && json !== '{}') {
            return json;
        }
    } catch {
        // Fall through to inspect fallback
    }
    try {
        return inspect(error, { depth: 5, breakLength: 120 });
    } catch {
        return String(error);
    }
}

export function formatCodexProcessExitMessage(error: unknown): string {
    const errorMessage = error instanceof Error
        ? error.message
        : (typeof error === 'string' ? error : null);

    if (errorMessage?.includes('already has an active writer')) {
        return [
            'Cannot resume this Codex session because it is still running in another process.',
            'Exit the original Codex or Happy session, then try again.',
            `Codex error: ${errorMessage}`,
        ].join('\n');
    }

    return `Process exited unexpectedly: ${formatUnknownCodexError(error)}`;
}

/**
 * Map Happy permission mode to Codex approval policy
 */
function mapApprovalPolicy(permissionMode: string): ApprovalPolicy {
    switch (permissionMode) {
        // Codex v0.98+: untrusted, on-failure, on-request, never
        case 'default': return 'on-request';
        case 'read-only': return 'untrusted';
        case 'on-failure': return 'on-failure';
        case 'full-auto': return 'never';
        default: return 'on-request';
    }
}

/**
 * Map Happy permission mode to Codex sandbox mode
 */
function mapSandbox(permissionMode: string): SandboxMode {
    switch (permissionMode) {
        case 'default': return 'workspace-write';
        case 'read-only': return 'read-only';
        case 'on-failure': return 'workspace-write';
        case 'full-auto': return 'danger-full-access';
        default: return 'workspace-write';
    }
}

/**
 * Main entry point for the codex command with ink UI
 */
export async function runCodex(opts: {
    credentials: Credentials;
    startedBy?: 'daemon' | 'terminal';
    resumeFile?: string;
}): Promise<void> {
    // Use shared PermissionMode type for cross-agent compatibility
    interface EnhancedMode {
        permissionMode: PermissionMode;
        model?: string;
        reasoningEffort?: string;
        images?: ImageContent[];
    }

    //
    // Define session
    //

    const sessionTag = randomUUID();

    // Set backend for offline warnings (before any API calls)
    connectionState.setBackend('Codex');

    const api = await ApiClient.create(opts.credentials);

    // Log startup options
    logger.debug(`[codex] Starting with options: startedBy=${opts.startedBy || 'terminal'}, resume=${opts.resumeFile ? 'yes' : 'no'}`);

    //
    // Machine
    //

    const settings = await readSettings();
    let machineId = settings?.machineId;
    if (!machineId) {
        console.error(`[START] No machine ID found in settings, which is unexpected since authAndSetupMachineIfNeeded should have created it. Please report this issue on https://github.com/hitosea/happy-next/issues`);
        process.exit(1);
    }
    logger.debug(`Using machineId: ${machineId}`);
    await api.getOrCreateMachine({
        machineId,
        metadata: initialMachineMetadata
    });

    //
    // Create session
    //

    // Install the orchestrator skill for this controller session before discovering skills
    // (no-op for worker sessions and idempotent across runs).
    syncOrchestratorAssets();
    syncBuiltinCommands();
    let skills = discoverCodexSkills();
    const { state, metadata } = createSessionMetadata({
        flavor: 'codex',
        machineId,
        startedBy: opts.startedBy,
    });
    const response = await api.getOrCreateSession({ tag: sessionTag, metadata, state });

    // Handle server unreachable case - create offline stub with hot reconnection
    let session: ApiSessionClient;
    let permissionHandler: CodexPermissionHandler;
    const { session: initialSession, reconnectionHandle } = setupOfflineReconnection({
        api,
        sessionTag,
        metadata,
        state,
        response,
        onSessionSwap: (newSession) => {
            session = newSession;
            const currentSkills = skills;
            session.updateCapabilities((currentCapabilities) => addBuiltinSlashCommands(addOrchestratorSlashCommands({
                ...currentCapabilities,
                skills: currentSkills,
            })));
            if (permissionHandler) {
                permissionHandler.updateSession(newSession);
            }
        }
    });
    session = initialSession;

    const initialSkills = skills;
    session.updateCapabilities((currentCapabilities) => addBuiltinSlashCommands(addOrchestratorSlashCommands({
        ...currentCapabilities,
        skills: initialSkills,
    })));

    let lastSkillsSignature = getCodexSkillsSignature(skills);
    const skillRefreshInterval = setInterval(() => {
        try {
            const nextSkills = discoverCodexSkills();
            const nextSignature = getCodexSkillsSignature(nextSkills);
            if (nextSignature === lastSkillsSignature) {
                return;
            }

            skills = nextSkills;
            lastSkillsSignature = nextSignature;
            session.updateCapabilities((currentCapabilities) => addBuiltinSlashCommands(addOrchestratorSlashCommands({
                ...currentCapabilities,
                skills: nextSkills,
            })));
        } catch (error) {
            logger.debug('[codex] Failed to refresh skills capabilities:', error);
        }
    }, 30_000);
    skillRefreshInterval.unref();

    // Set initial session title if provided (e.g. review sessions)
    const sessionTitle = process.env.HAPPY_SESSION_TITLE?.trim();
    if (sessionTitle) {
        session.updateMetadata((currentMetadata) => ({
            ...currentMetadata,
            summary: {
                text: sessionTitle,
                updatedAt: Date.now()
            }
        }));
    }

    // Always report to daemon if it exists (skip if offline)
    if (response) {
        try {
            logger.debug(`[START] Reporting session ${response.id} to daemon`);
            const result = await notifyDaemonSessionStarted(response.id, metadata);
            if (result.error) {
                logger.debug(`[START] Failed to report to daemon (may not be running):`, result.error);
            } else {
                logger.debug(`[START] Reported session ${response.id} to daemon`);
            }
        } catch (error) {
            logger.debug('[START] Failed to report to daemon (may not be running):', error);
        }
    }

    const messageQueue = new MessageQueue2<EnhancedMode>((mode) => hashObject({
        permissionMode: mode.permissionMode,
        model: mode.model,
        reasoningEffort: mode.reasoningEffort,
    }));

    // Track current overrides to apply per message
    let currentPermissionMode: PermissionMode | undefined = undefined;
    let currentModel: string | undefined = undefined;
    let sessionSystemPrompt: string | undefined = undefined;
    const firstTurnInstruction = getFirstTurnInstruction();
    let currentSessionModel: string | undefined = undefined;
    let currentSessionReasoningEffort: string | undefined = undefined;

    const normalizeModel = (model: unknown): string | undefined => {
        if (typeof model !== 'string') {
            return undefined;
        }
        const trimmed = model.trim();
        return trimmed.length > 0 ? trimmed : undefined;
    };

    const normalizeReasoningEffort = (reasoningEffort: unknown): string | undefined => {
        if (typeof reasoningEffort !== 'string') {
            return undefined;
        }
        const trimmed = reasoningEffort.trim();
        return trimmed.length > 0 ? trimmed : undefined;
    };

    const syncSessionModelInfo = (opts: { model: unknown; reasoningEffort?: unknown }): void => {
        const normalizedModel = normalizeModel(opts.model);
        if (!normalizedModel) {
            return;
        }

        const hasReasoningEffort = Object.prototype.hasOwnProperty.call(opts, 'reasoningEffort');
        const normalizedEffort = hasReasoningEffort
            ? normalizeReasoningEffort(opts.reasoningEffort)
            : currentSessionReasoningEffort;

        if (normalizedModel === currentSessionModel && normalizedEffort === currentSessionReasoningEffort) {
            return;
        }

        currentSessionModel = normalizedModel;
        currentSessionReasoningEffort = normalizedEffort;
        session.updateMetadata((currentMetadata) => {
            const currentModelValue = normalizeModel(currentMetadata.model);
            const currentEffortValue = normalizeReasoningEffort(currentMetadata.reasoningEffort);
            const targetEffortValue = hasReasoningEffort ? normalizedEffort : currentEffortValue;
            if (currentModelValue === normalizedModel && currentEffortValue === targetEffortValue) {
                return currentMetadata;
            }
            return {
                ...currentMetadata,
                model: normalizedModel,
                ...(targetEffortValue ? { reasoningEffort: targetEffortValue } : {}),
            };
        });
    };

    session.onUserMessage((message) => {
        // Resolve permission mode
        let messagePermissionMode = currentPermissionMode;
        if (message.meta?.permissionMode) {
            messagePermissionMode = message.meta.permissionMode as PermissionMode;
            currentPermissionMode = messagePermissionMode;
            logger.debug(`[Codex] Permission mode updated from user message to: ${currentPermissionMode}`);
        } else {
            logger.debug(`[Codex] User message received with no permission mode override, using current: ${currentPermissionMode ?? 'default (effective)'}`);
        }

        // Resolve model; explicit null resets to default (undefined)
        let messageModel = currentModel;
        if (message.meta?.hasOwnProperty('model')) {
            messageModel = message.meta.model || undefined;
            currentModel = messageModel;
            logger.debug(`[Codex] Model updated from user message: ${messageModel || 'reset to default'}`);
        } else {
            logger.debug(`[Codex] User message received with no model override, using current: ${currentModel || 'default'}`);
        }

        // Resolve reasoning effort; explicit null resets to default (undefined)
        let messageReasoningEffort = currentSessionReasoningEffort;
        if (message.meta?.hasOwnProperty('reasoningEffort')) {
            messageReasoningEffort = message.meta.reasoningEffort || undefined;
            logger.debug(`[Codex] Reasoning effort updated from user message: ${messageReasoningEffort || 'reset to default'}`);
        } else {
            logger.debug(`[Codex] User message received with no reasoning effort override, using current: ${currentSessionReasoningEffort || 'default'}`);
        }
        syncSessionModelInfo({ model: messageModel, reasoningEffort: messageReasoningEffort });

        // Capture session-level system prompt from first message.
        // Combines appendSystemPrompt (Options, DooTask) with first-turn tooling instructions
        // (change_title for controller sessions; codex discovers orchestrator via the synced skill).
        // Both are passed as baseInstructions to Codex (true system prompt).
        if (sessionSystemPrompt === undefined) {
            const parts: string[] = [];
            if (message.meta?.appendSystemPrompt) parts.push(message.meta.appendSystemPrompt);
            if (firstTurnInstruction) parts.push(firstTurnInstruction);
            sessionSystemPrompt = parts.join('\n\n');
        }

        // Extract text and images based on content type (text-only or mixed)
        const isMixedContent = message.content.type === 'mixed';
        const messageText = message.content.text;
        const images: ImageContent[] = isMixedContent && 'images' in message.content
            ? message.content.images
            : [];

        if (images.length > 0) {
            logger.debug(`[Codex] Received mixed message with ${images.length} image(s)`);
        }

        const enhancedMode: EnhancedMode = {
            permissionMode: messagePermissionMode || 'default',
            model: messageModel,
            reasoningEffort: messageReasoningEffort,
            images: images.length > 0 ? images : undefined,
        };
        messageQueue.push(messageText, enhancedMode);
    });
    let thinking = false;
    let isTerminating = false;
    let killInProgress = false;
    const sendRemoteKeepAlive = (currentThinking: boolean) => {
        if (isTerminating) {
            return;
        }
        session.keepAlive(currentThinking, 'remote');
    };
    sendRemoteKeepAlive(thinking);
    const keepAliveInterval = setInterval(() => {
        sendRemoteKeepAlive(thinking);
    }, 2000);

    const sendReady = () => {
        session.sendSessionEvent({ type: 'ready' });
        try {
            api.push().sendCompletionToAllDevices(
                "It's ready!",
                'Codex is waiting for your command',
                { sessionId: session.sessionId }
            );
        } catch (pushError) {
            logger.debug('[Codex] Failed to send ready push', pushError);
        }
        // Flush outbox before setting taskCompleted so tool_result
        // messages arrive at the app before the agentState update.
        session.flush().finally(() => {
            session.updateAgentState((state) => ({
                ...state,
                taskCompleted: Date.now()
            }));
        });
    };

    // Debug helper
    function logActiveHandles(tag: string) {
        if (!isDebug()) return;
        const anyProc: any = process as any;
        const handles = typeof anyProc._getActiveHandles === 'function' ? anyProc._getActiveHandles() : [];
        const requests = typeof anyProc._getActiveRequests === 'function' ? anyProc._getActiveRequests() : [];
        logger.debug(`[codex][handles] ${tag}: handles=${handles.length} requests=${requests.length}`);
        try {
            const kinds = handles.map((h: any) => (h && h.constructor ? h.constructor.name : typeof h));
            logger.debug(`[codex][handles] kinds=${JSON.stringify(kinds)}`);
        } catch { }
    }

    //
    // Abort handling
    //

    let shouldExit = false;
    let abortRequested = false;
    let abortFeedbackSent = false;
    let storedSessionIdForResume: string | null = null;

    // Resume file from the CLI or App-side resume/duplicate (passed via daemon env var)
    const initialResumeFile = opts.resumeFile || process.env.HAPPY_CODEX_RESUME_FILE || null;
    // Current backend instance (re-created on mode change)
    // Typed as any to prevent TS narrowing issues (assigned inside createBackend())
    let backend: any = null;

    // graceful: interrupt the current turn but keep the app-server process warm so
    // the next message reuses it (stop button) instead of respawning Codex from a
    // resume file. The hard path (default) tears the process down — for switch / exit.
    async function handleAbort(opts?: { graceful?: boolean }) {
        logger.debug('[Codex] Abort requested - stopping current task');
        abortRequested = true;
        try {
            // Capture local reference — the global `backend` may be replaced by the
            // main loop while we await dispose(), so we must not blindly null it later.
            const b = backend;
            if (b?.isAlive) {
                const convId = b.getConversationId();

                // Graceful: turn/interrupt and keep the backend alive. On ack Codex
                // emits turn/completed{interrupted}, which resolves the main loop's
                // waitForResponseComplete(); it then reuses this warm backend for the
                // next message. Fall through to the hard path if the interrupt fails.
                if (opts?.graceful && convId && await b.cancel(convId) && backend === b && b.isAlive) {
                    reasoningProcessor.abort();
                    logger.debug('[Codex] Graceful interrupt acked, keeping backend warm');
                    return;
                }

                const sid = b.getSessionId();
                if (sid) storedSessionIdForResume = sid;
                logger.debug('[Codex] Stored session for resume:', storedSessionIdForResume);

                // Fire-and-forget: polite turn/interrupt (don't await — may hang)
                if (convId) {
                    b.cancel(convId).catch(() => {});
                }

                // Immediately dispose — resolves waitForResponseComplete() and
                // kills the process group (SIGTERM → SIGKILL) so bash children die too
                try { await b.dispose(); } catch {}

                // Only null out if no new backend was created during dispose
                if (backend === b) backend = null;
            }
            reasoningProcessor.abort();
            logger.debug('[Codex] Abort completed');
        } catch (error) {
            logger.debug('[Codex] Error during abort:', error);
        }
    }

    // Start MCP servers with per-agent adapter (STDIO bridge for Codex)
    const mcp = await createMcpContext(session);
    const mcpServers = mcp.configForStdio();

    const handleKillSession = async () => {
        if (killInProgress) {
            logger.debug('[Codex] Kill session already in progress');
            return;
        }
        killInProgress = true;

        logger.debug('[Codex] Kill session requested - terminating process');
        isTerminating = true;
        shouldExit = true;
        thinking = false;
        clearInterval(keepAliveInterval);
        messageQueue.reset();

        try {
            if (session) {
                session.updateMetadata((currentMetadata) => ({
                    ...currentMetadata,
                    lifecycleState: 'archived',
                    lifecycleStateSince: Date.now(),
                    archivedBy: 'cli',
                    archiveReason: 'User terminated'
                }));
                session.sendSessionDeath();
                await session.flush();
                await session.close();
            }
        } catch (error) {
            logger.debug('[Codex] Error while ending session during termination', error);
        }

        try {
            await handleAbort();
            logger.debug('[Codex] Abort completed, proceeding with backend disposal');
        } catch (error) {
            logger.debug('[Codex] Error during abort in termination flow', error);
        }

        try {
            try {
                await backend?.dispose();
            } catch (e) {
                logger.debug('[Codex] Error while disposing backend during termination', e);
            }

            stopCaffeinate();
            mcp.stop();

            logger.debug('[Codex] Session termination complete, exiting');
            process.exit(0);
        } catch (error) {
            logger.debug('[Codex] Error during session termination:', error);
            process.exit(1);
        }
    };

    // Register abort handler
    session.rpcHandlerManager.registerHandler('abort', () => handleAbort({ graceful: true }));
    registerKillSessionHandler(session.rpcHandlerManager, handleKillSession);

    //
    // Initialize Ink UI
    //

    const messageBuffer = new MessageBuffer();
    const hasTTY = process.stdout.isTTY && process.stdin.isTTY;
    let inkInstance: any = null;

    if (hasTTY) {
        console.clear();
        inkInstance = render(React.createElement(CodexDisplay, {
            messageBuffer,
            logPath: isDebug() ? logger.getLogPath() : undefined,
            onExit: async () => {
                logger.debug('[codex]: Exiting agent via Ctrl-C');
                shouldExit = true;
                await handleAbort();
            }
        }), {
            exitOnCtrlC: false,
            patchConsole: false
        });
    }

    if (hasTTY) {
        process.stdin.resume();
        if (process.stdin.isTTY) {
            process.stdin.setRawMode(true);
        }
        process.stdin.setEncoding("utf8");
    }

    //
    // Set up processors and permission handler
    //

    permissionHandler = new CodexPermissionHandler(session, api.push());

    const validPermissionModes: PermissionMode[] = ['default', 'read-only', 'on-failure', 'full-auto'];
    session.rpcHandlerManager.registerHandler<{ mode?: PermissionMode }, boolean>(
        'permission-mode-changed',
        async (payload) => {
            const mode = payload?.mode;
            if (!mode || !validPermissionModes.includes(mode)) {
                logger.debug('[Codex] Invalid permission mode via rpc', { mode });
                return false;
            }
            currentPermissionMode = mode;
            permissionHandler.setPermissionMode(mode);
            logger.debug(`[Codex] Permission mode updated via rpc to ${mode}`);
            return true;
        }
    );

    let messageSentThisTurn = false;

    const reasoningProcessor = new ReasoningProcessor((message) => {
        session.sendAgentMessage('codex', message);
        messageSentThisTurn = true;
    });
    const diffProcessor = new DiffProcessor((message) => {
        session.sendAgentMessage('codex', message);
        messageSentThisTurn = true;
    });
    diffProcessor.setSessionId(session.sessionId);

    /**
     * Handle AgentMessage from the backend.
     * Maps to UI updates + sends to Happy server via sendAgentMessage.
     */
    function handleAgentMessage(msg: AgentMessage): void {
        // Skip logging high-frequency streaming deltas
        if (msg.type !== 'model-output' && msg.type !== 'terminal-output' && msg.type !== 'event') {
            logger.debug(`[Codex] AgentMessage: ${msg.type}`);
        }

        switch (msg.type) {
            case 'model-output': {
                if (msg.fullText) {
                    messageBuffer.addMessage(msg.fullText, 'assistant');
                    session.sendAgentMessage('codex', {
                        type: 'message',
                        message: msg.fullText,
                    });
                    messageSentThisTurn = true;
                }
                // textDelta is streaming - we can accumulate or skip for UI
                break;
            }

            case 'status': {
                if (msg.status === 'running') {
                    messageBuffer.addMessage('Starting task...', 'status');
                    messageSentThisTurn = false;
                    if (!thinking) {
                        thinking = true;
                        sendRemoteKeepAlive(thinking);
                    }
                    session.sendAgentMessage('codex', { type: 'task_started', id: randomUUID() });
                } else if (msg.status === 'idle') {
                    const isAborted = msg.detail === 'aborted';
                    messageBuffer.addMessage(isAborted ? 'Turn aborted' : 'Task completed', 'status');

                    if (isAborted) {
                        // Always surface an interrupt marker (mirrors Claude's
                        // "[Request interrupted by user]"), even when Codex had
                        // already streamed text this turn.
                        session.sendAgentMessage('codex', {
                            type: 'message',
                            message: '[Request interrupted by user]',
                        });
                    } else if (!messageSentThisTurn) {
                        session.sendAgentMessage('codex', {
                            type: 'message',
                            message: '[Codex completed without response]',
                        });
                    }

                    if (isAborted) abortFeedbackSent = true;
                    session.sendAgentMessage('codex', {
                        type: isAborted ? 'turn_aborted' : 'task_complete',
                        id: randomUUID(),
                    });

                    if (thinking) {
                        thinking = false;
                        sendRemoteKeepAlive(thinking);
                    }
                    diffProcessor.reset();
                    // Note: sendReady() is called by emitReadyIfIdle() in the finally block
                    // to avoid sending duplicate push notifications
                } else if (msg.status === 'error') {
                    messageBuffer.addMessage(`Error: ${msg.detail ?? 'Unknown error'}`, 'status');
                    session.sendAgentMessage('codex', {
                        type: 'message',
                        message: `[Codex Error] ${msg.detail ?? 'Unknown error'}`,
                    });
                    messageSentThisTurn = true;
                }
                break;
            }

            case 'tool-call': {
                messageBuffer.addMessage(`Executing: ${msg.toolName}`, 'tool');
                session.sendAgentMessage('codex', {
                    type: 'tool-call',
                    callId: msg.callId,
                    name: msg.toolName,
                    input: msg.args,
                    id: randomUUID(),
                });
                messageSentThisTurn = true;
                break;
            }

            case 'tool-result': {
                const output = typeof msg.result === 'string'
                    ? msg.result
                    : JSON.stringify(msg.result);
                const truncated = output.substring(0, 200);
                messageBuffer.addMessage(
                    `Result: ${truncated}${output.length > 200 ? '...' : ''}`,
                    'result'
                );

                // Trim large payloads for CodexBash — app only needs exit_code
                let trimmedResult = msg.result;
                if (msg.toolName === 'CodexBash' && typeof msg.result === 'object' && msg.result !== null) {
                    trimmedResult = summarizeBashToolOutput({
                        sessionId: session.sessionId,
                        callId: msg.callId,
                        toolName: 'CodexBash',
                        agent: 'codex',
                        result: msg.result,
                    });
                }

                session.sendAgentMessage('codex', {
                    type: 'tool-result',
                    callId: msg.callId,
                    output: trimmedResult,
                    id: randomUUID(),
                });
                messageSentThisTurn = true;
                break;
            }

            case 'terminal-output': {
                // Streaming command output - skip for now (noisy in mobile UI)
                break;
            }

            case 'exec-approval-request': {
                session.sendAgentMessage('codex', {
                    type: 'tool-call',
                    callId: msg.call_id,
                    name: 'CodexBash',
                    input: msg,
                    id: randomUUID(),
                });
                messageSentThisTurn = true;
                break;
            }

            case 'patch-apply-begin': {
                const changeCount = Object.keys(msg.changes).length;
                const filesMsg = changeCount === 1 ? '1 file' : `${changeCount} files`;
                messageBuffer.addMessage(`Modifying ${filesMsg}...`, 'tool');

                // Trim file contents — app only needs file paths + operation types
                const trimmedChanges: Record<string, Record<string, boolean>> = {};
                for (const [filePath, change] of Object.entries(msg.changes as Record<string, any>)) {
                    const ops: Record<string, boolean> = {};
                    if (change.add) ops.add = true;
                    if (change.modify) ops.modify = true;
                    if (change.delete) ops.delete = true;
                    trimmedChanges[filePath] = ops;
                }

                session.sendAgentMessage('codex', {
                    type: 'tool-call',
                    callId: msg.call_id,
                    name: 'CodexPatch',
                    input: { auto_approved: msg.auto_approved, changes: trimmedChanges },
                    id: randomUUID(),
                });
                messageSentThisTurn = true;
                break;
            }

            case 'patch-apply-end': {
                if (msg.success) {
                    const text = msg.stdout || 'Files modified successfully';
                    messageBuffer.addMessage(text.substring(0, 200), 'result');
                } else {
                    const errMsg = msg.stderr || 'Failed to modify files';
                    messageBuffer.addMessage(`Error: ${errMsg.substring(0, 200)}`, 'result');
                }
                session.sendAgentMessage('codex', {
                    type: 'tool-result',
                    callId: msg.call_id,
                    output: { stdout: msg.stdout, stderr: msg.stderr, success: msg.success },
                    id: randomUUID(),
                });
                messageSentThisTurn = true;
                break;
            }

            case 'token-count': {
                const { type: _type, ...tokenData } = msg as any;
                const lastUsage = tokenData.last_token_usage;
                session.sendAgentMessage('codex', {
                    type: 'token_count',
                    ...tokenData,
                    ...(currentSessionModel ? { model: currentSessionModel } : {}),
                    // Unified context fields for app consumption
                    ...(lastUsage ? {
                        context_used_tokens: lastUsage.input_tokens,
                        context_window_size: tokenData.model_context_window,
                    } : {}),
                });

                // Persist token usage to server for statistics
                // Codex (OpenAI) token_count event structure:
                //   { total_token_usage: TokenUsage, last_token_usage: TokenUsage, model_context_window }
                // where TokenUsage = { input_tokens, cached_input_tokens, output_tokens, reasoning_output_tokens, total_tokens }
                //
                // Key semantic differences from Claude:
                //   - OpenAI input_tokens INCLUDES cached_input_tokens (Claude's excludes them)
                //   - OpenAI output_tokens INCLUDES reasoning_output_tokens
                //   - We normalize to Claude-style breakdown for consistent display
                const usage = (lastUsage && typeof lastUsage === 'object')
                    ? lastUsage as Record<string, unknown>
                    : {};
                const toTokenCount = (value: unknown): number => {
                    return (typeof value === 'number' && Number.isFinite(value) && value > 0) ? value : 0;
                };

                // Extract OpenAI-style fields from last_token_usage (per-request values)
                const rawInputTokens = toTokenCount(usage.input_tokens);
                const cachedInputTokens = toTokenCount(usage.cached_input_tokens);
                const rawOutputTokens = toTokenCount(usage.output_tokens);
                const reasoningOutputTokens = toTokenCount(usage.reasoning_output_tokens);

                // Normalize to Claude-style breakdown:
                // - input = uncached input only (for display parity with Claude)
                // - cache_read = cached input tokens
                // - output = non-reasoning output
                // - reasoning = reasoning output tokens
                // Total remains unchanged: rawInput + rawOutput (no double-counting)
                const inputTokens = rawInputTokens - cachedInputTokens;
                const outputTokens = rawOutputTokens - reasoningOutputTokens;
                const totalTokens = rawInputTokens + rawOutputTokens;

                if (totalTokens > 0) {
                    session.sendUsageReport({
                        key: 'codex-session',
                        tokens: {
                            total: totalTokens,
                            input: inputTokens,
                            output: outputTokens,
                            reasoning: reasoningOutputTokens,
                            cache_creation: 0,
                            cache_read: cachedInputTokens,
                        },
                        cost: { total: 0 },
                    });
                }
                break;
            }

            case 'event': {
                // Handle ACP config metadata events (mode, model, thought level switching)
                if (handleConfigMetadataEvent(msg.name, msg.payload, session.updateMetadata.bind(session), session.updateCapabilities.bind(session))) {
                    break;
                }
                // Handle reasoning events through processors
                if (msg.name === 'reasoning_delta') {
                    const payload = msg.payload as { delta: string };
                    reasoningProcessor.processDelta(payload.delta);
                } else if (msg.name === 'reasoning') {
                    const payload = msg.payload as { text: string };
                    messageBuffer.addMessage(`[Thinking] ${payload.text.substring(0, 100)}...`, 'system');
                    reasoningProcessor.complete(payload.text);
                } else if (msg.name === 'reasoning_section_break') {
                    reasoningProcessor.handleSectionBreak();
                } else if (msg.name === 'turn_diff') {
                    const payload = msg.payload as { unified_diff?: string };
                    if (payload.unified_diff) {
                        diffProcessor.processDiff(payload.unified_diff);
                    }
                } else if (msg.name === 'plan_update') {
                    // Forward plan updates to mobile
                    session.sendAgentMessage('codex', {
                        type: 'message',
                        message: `[Plan Update] ${JSON.stringify(msg.payload)}`,
                    });
                } else if (msg.name === 'context_compacted') {
                    messageBuffer.addMessage('Context compacted', 'status');
                    session.sendSessionEvent({ type: 'message', message: 'Context compacted' });
                } else if (msg.name === 'goal_updated') {
                    logger.debug('[Codex] Goal updated', msg.payload);
                } else if (msg.name === 'goal_cleared') {
                    logger.debug('[Codex] Goal cleared');
                } else if (msg.name === 'session_configured') {
                    const payload = msg.payload as { model?: string; reasoningEffort?: string };
                    if (payload.reasoningEffort !== undefined) {
                        syncSessionModelInfo({ model: payload.model, reasoningEffort: payload.reasoningEffort });
                    } else {
                        syncSessionModelInfo({ model: payload.model });
                    }
                }
                break;
            }

            case 'permission-request':
            case 'permission-response':
            case 'fs-edit':
                // Handled by permission handler or backend internally
                break;
        }
    }

    // Helper: find Codex session transcript — delegates to codexSessionReader
    function findCodexResumeFile(sessionId: string | null): string | null {
        if (!sessionId) return null;
        return findCodexSessionFile(sessionId);
    }

    /**
     * Create a new backend instance with the given configuration.
     * Disposes any existing backend first.
     */
    async function createBackend(opts: {
        model?: string;
        reasoningEffort?: string;
        approvalPolicy: ApprovalPolicy;
        sandbox: SandboxMode;
        resumeFile?: string | null;
        baseInstructions?: string;
    }): Promise<CodexAppServerBackend> {
        // Dispose previous backend if exists
        if (backend?.isAlive) {
            try { await backend.dispose(); } catch { }
        }

        const { backend: newBackend } = createCodexBackend({
            cwd: process.cwd(),
            model: opts.model,
            reasoningEffort: opts.reasoningEffort,
            approvalPolicy: opts.approvalPolicy,
            sandbox: opts.sandbox,
            baseInstructions: opts.baseInstructions,
            mcpServers,
            permissionHandler,
            resumeFile: opts.resumeFile,
        });

        backend = newBackend as unknown as CodexAppServerBackend;
        backend.onMessage(handleAgentMessage);
        return backend;
    }

    let first = true;

    function formatGoalStatus(status: string): string {
        switch (status) {
            case 'active': return 'active';
            case 'paused': return 'paused';
            case 'blocked': return 'blocked';
            case 'complete': return 'complete';
            case 'usageLimited': return 'usage limited';
            case 'budgetLimited': return 'budget limited';
            default: return status;
        }
    }

    async function ensureBackendStartedForCommand(message: { mode: EnhancedMode }, resumeFile: string | null): Promise<CodexAppServerBackend> {
        if (backend?.isAlive) {
            return backend as CodexAppServerBackend;
        }

        const approvalPolicy = mapApprovalPolicy(message.mode.permissionMode);
        const sandbox = mapSandbox(message.mode.permissionMode);
        await createBackend({
            model: message.mode.model,
            reasoningEffort: message.mode.reasoningEffort,
            approvalPolicy,
            sandbox,
            resumeFile,
            baseInstructions: sessionSystemPrompt,
        });
        await backend!.startSession();
        const codexConvId = backend!.getSessionId?.();
        if (codexConvId) {
            session.updateMetadata((m: any) => ({ ...m, codexSessionId: codexConvId }));
        }
        return backend as CodexAppServerBackend;
    }

    async function executeCodexSlashCommand(command: CodexSlashCommand, codexBackend: CodexAppServerBackend): Promise<{ waitForTurn?: boolean }> {
        switch (command.type) {
            case 'compact': {
                messageBuffer.addMessage('Compacting context…', 'status');
                session.sendSessionEvent({ type: 'message', message: 'Compacting context…' });
                await codexBackend.compactThread();
                messageBuffer.addMessage('Context compaction requested', 'status');
                session.sendSessionEvent({ type: 'message', message: 'Context compaction requested' });
                return {};
            }
            case 'review': {
                messageBuffer.addMessage('Starting code review…', 'status');
                session.sendSessionEvent({ type: 'message', message: 'Starting code review…' });
                await codexBackend.startReview(command.target as any);
                return { waitForTurn: true };
            }
            case 'goal': {
                if (command.action === 'get') {
                    const result = await codexBackend.getGoal();
                    const goal = result.goal;
                    const text = goal
                        ? `Goal: ${goal.objective}
Status: ${formatGoalStatus(goal.status)}
Tokens used: ${goal.tokensUsed}${goal.tokenBudget ? ` / ${goal.tokenBudget}` : ''}`
                        : 'No goal is currently set.';
                    messageBuffer.addMessage(text, 'status');
                    session.sendSessionEvent({ type: 'message', message: text });
                    return {};
                }
                if (command.action === 'clear') {
                    await codexBackend.clearGoal();
                    messageBuffer.addMessage('Goal cleared', 'status');
                    session.sendSessionEvent({ type: 'message', message: 'Goal cleared' });
                    return {};
                }
                if (command.action === 'set') {
                    await codexBackend.setGoal({ objective: command.objective, status: 'active' });
                    const text = `Goal set: ${command.objective}`;
                    messageBuffer.addMessage(text, 'status');
                    session.sendSessionEvent({ type: 'message', message: text });
                    return {};
                }
                await codexBackend.setGoal({ status: command.status });
                const text = `Goal status: ${formatGoalStatus(command.status)}`;
                messageBuffer.addMessage(text, 'status');
                session.sendSessionEvent({ type: 'message', message: text });
                return {};
            }
        }
    }

    // Backfill history from previous session (if resuming/copying)
    // Awaited so that replace-mode batch completes before the main loop processes new messages
    const shouldBackfillResume = !!opts.resumeFile
        || ['1', 'true', 'yes'].includes(String(process.env.HAPPY_CODEX_BACKFILL).toLowerCase());
    if (initialResumeFile && shouldBackfillResume) {
        try {
            // Wait briefly for socket connection to avoid dropping backfill messages
            for (let i = 0; i < 15 && !session.isConnected(); i++) {
                await new Promise((resolve) => setTimeout(resolve, 200));
            }
            if (session.isConnected()) {
                await backfillCodexSessionHistory({
                    sessionIdOrPath: initialResumeFile,
                    sendBatch: async (messages) => {
                        await session.sendBackfillBatch(messages, 'replace');
                    },
                });
            } else {
                logger.debug('[Codex] Backfill skipped: socket not connected');
            }
        } catch (error) {
            logger.debug('[Codex] Backfill failed:', error);
        }
    }

    try {
        let wasCreated = false;
        let currentModeHash: string | null = null;
        let pending: { message: string; mode: EnhancedMode; isolate: boolean; hash: string } | null = null;
        let nextResumeFile: string | null = null;

        while (!shouldExit) {
            logActiveHandles('loop-top');

            // Get next message (check pending first from mode change)
            let message: { message: string; mode: EnhancedMode; isolate: boolean; hash: string } | null = pending;
            pending = null;
            if (!message) {
                const batch = await messageQueue.waitForMessagesAndGetAsString();
                if (!batch) {
                    if (!shouldExit) {
                        logger.debug('[codex]: Wait returned null while not exiting; continuing');
                        continue;
                    }
                    logger.debug(`[codex]: batch=${!!batch}, shouldExit=${shouldExit}`);
                    break;
                }
                message = batch;
            }

            if (!message) break;

            // Handle /clear command - reset session
            if (parseClear(message.message).isClear) {
                logger.debug('[Codex] /clear command detected - resetting session');
                messageBuffer.addMessage('Context was reset', 'status');
                session.sendSessionEvent({ type: 'message', message: 'Context was reset' });

                // Dispose current backend
                if (backend) { try { await backend.dispose(); } catch { } }
                backend = null;
                wasCreated = false;
                currentModeHash = null;
                nextResumeFile = null; // Don't resume - start fresh
                storedSessionIdForResume = null;

                // Reset processors
                permissionHandler.reset();
                reasoningProcessor.abort();
                diffProcessor.reset();
                thinking = false;
                sendRemoteKeepAlive(thinking);

                // Send ready
                sendReady();
                continue;
            }

            // If mode changed, restart with new backend
            if (wasCreated && currentModeHash && message.hash !== currentModeHash) {
                logger.debug('[Codex] Mode changed – restarting Codex session');
                messageBuffer.addMessage('═'.repeat(40), 'status');
                messageBuffer.addMessage('Starting new Codex session (mode changed)...', 'status');

                // Try to find resume file from previous session
                try {
                    const prevSessionId = backend ? backend.getSessionId() : null;
                    nextResumeFile = findCodexResumeFile(prevSessionId);
                    if (nextResumeFile) {
                        logger.debug(`[Codex] Found resume file: ${nextResumeFile}`);
                        messageBuffer.addMessage('Resuming previous context…', 'status');
                    }
                } catch (e) {
                    logger.debug('[Codex] Error searching resume file', e);
                }

                // Dispose old backend
                if (backend) { try { await backend.dispose(); } catch { } }
                backend = null;
                wasCreated = false;
                currentModeHash = null;
                pending = message;

                // Reset processors/permissions
                permissionHandler.reset();
                reasoningProcessor.abort();
                diffProcessor.reset();
                thinking = false;
                sendRemoteKeepAlive(thinking);
                continue;
            }

            const codexSlashCommand = parseCodexSlashCommand(message.message);
            if (codexSlashCommand.matched) {
                messageBuffer.addMessage(message.message, 'user');
                currentModeHash = message.hash;

                if ('error' in codexSlashCommand) {
                    messageBuffer.addMessage(codexSlashCommand.error, 'status');
                    session.sendSessionEvent({ type: 'message', message: codexSlashCommand.error });
                    sendReady();
                    continue;
                }

                try {
                    let commandResumeFile: string | null = null;
                    if (nextResumeFile) {
                        commandResumeFile = nextResumeFile;
                        nextResumeFile = null;
                    } else if (first && initialResumeFile) {
                        commandResumeFile = initialResumeFile;
                        messageBuffer.addMessage('Resuming from previous session...', 'status');
                    } else if (storedSessionIdForResume) {
                        commandResumeFile = findCodexResumeFile(storedSessionIdForResume);
                        storedSessionIdForResume = null;
                    }
                    thinking = true;
                    sendRemoteKeepAlive(thinking);
                    const codexBackend = await ensureBackendStartedForCommand(message, commandResumeFile);
                    wasCreated = true;
                    first = false;
                    const result = await executeCodexSlashCommand(codexSlashCommand.command, codexBackend);
                    if (result.waitForTurn) {
                        await codexBackend.waitForResponseComplete!();
                    }
                } catch (error) {
                    const errorMessage = formatUnknownCodexError(error);
                    logger.debug('[Codex] Slash command failed:', error);
                    messageBuffer.addMessage(`Command failed: ${errorMessage}`, 'status');
                    session.sendSessionEvent({ type: 'message', message: `Command failed: ${errorMessage}` });
                } finally {
                    thinking = false;
                    sendRemoteKeepAlive(thinking);
                    sendReady();
                }
                continue;
            }

            const expandedOrchestratorCommand = expandOrchestratorSlashCommand(message.message);
            const expandedBuiltinCommand = expandedOrchestratorCommand ? null : expandBuiltinSlashCommand(message.message);
            const promptText = expandedOrchestratorCommand?.prompt ?? expandedBuiltinCommand?.prompt ?? message.message;
            if (expandedOrchestratorCommand) {
                logger.debug(`[Codex] Expanded /orchestrator:${expandedOrchestratorCommand.provider} command`);
            } else if (expandedBuiltinCommand) {
                logger.debug(`[Codex] Expanded /${expandedBuiltinCommand.name} command`);
            }

            messageBuffer.addMessage(message.message, 'user');
            currentModeHash = message.hash;

            // Reset abort state at turn start — prevents idle-time aborts from
            // leaking into the next turn (HIGH fix: sticky abortRequested flag)
            abortRequested = false;
            abortFeedbackSent = false;

            try {
                const approvalPolicy = mapApprovalPolicy(message.mode.permissionMode);
                const sandbox = mapSandbox(message.mode.permissionMode);

                // Download images from URLs to base64 if present
                let promptOptions: SendPromptOptions | undefined;
                if (message.mode.images?.length) {
                    logger.debug(`[Codex] Downloading ${message.mode.images.length} image(s)...`);
                    const images = await Promise.all(
                        message.mode.images.map(async (img) => {
                            const downloaded = await downloadImage(img.url);
                            return {
                                data: downloaded.base64,
                                mimeType: downloaded.mimeType,
                            };
                        })
                    );
                    promptOptions = { images };
                    logger.debug(`[Codex] Downloaded ${images.length} image(s)`);
                }

                if (!wasCreated || !backend?.isAlive) {
                    // Reset if backend was killed by abort
                    wasCreated = false;
                    // System prompt (Options, DooTask, change_title) is passed via baseInstructions

                    // Determine resume file
                    let resumeFile: string | null = null;
                    if (nextResumeFile) {
                        resumeFile = nextResumeFile;
                        nextResumeFile = null;
                        logger.debug('[Codex] Using resume file from mode change:', resumeFile);
                    } else if (first && initialResumeFile) {
                        resumeFile = initialResumeFile;
                        logger.debug('[Codex] Using resume file from App-side resume:', resumeFile);
                        messageBuffer.addMessage('Resuming from previous session...', 'status');
                    } else if (storedSessionIdForResume) {
                        const abortResumeFile = findCodexResumeFile(storedSessionIdForResume);
                        if (abortResumeFile) {
                            resumeFile = abortResumeFile;
                            logger.debug('[Codex] Using resume file from aborted session:', resumeFile);
                            messageBuffer.addMessage('Resuming from aborted session...', 'status');
                        }
                        storedSessionIdForResume = null;
                    }

                    // Notify frontend that the session is starting (npx download + init can be slow)
                    thinking = true;
                    sendRemoteKeepAlive(thinking);
                    session.sendAgentMessage('codex', { type: 'task_started', id: randomUUID() });

                    // Create backend with the new configuration
                    await createBackend({
                        model: message.mode.model,
                        reasoningEffort: message.mode.reasoningEffort,
                        approvalPolicy,
                        sandbox,
                        resumeFile,
                        baseInstructions: sessionSystemPrompt,
                    });

                    // Start session — if images present, start without prompt
                    // then send prompt+images via sendPrompt
                    if (promptOptions) {
                        await backend!.startSession();
                        wasCreated = true;
                        first = false;

                        await backend!.sendPrompt(
                            backend!.getConversationId()!,
                            promptText,
                            promptOptions
                        );
                    } else {
                        await backend!.startSession(promptText);
                        wasCreated = true;
                        first = false;
                    }

                    // Store Codex conversation ID in Happy metadata for App-side resume/duplicate
                    const codexConvId = backend!.getSessionId?.();
                    if (codexConvId) {
                        session.updateMetadata((m: any) => ({ ...m, codexSessionId: codexConvId }));
                    }

                    // Wait for this turn to complete
                    await backend!.waitForResponseComplete!();
                } else {
                    // Continue existing session with new prompt
                    await backend!.sendPrompt(
                        backend!.getConversationId()!,
                        promptText,
                        promptOptions
                    );

                    // Wait for this turn to complete
                    await backend!.waitForResponseComplete!();
                }

                // dispose() resolves waitForResponseComplete() normally (not throw),
                // so the catch block won't run. Send abort feedback here as fallback,
                // but only if the notification handler hasn't already sent it.
                if (abortRequested && !abortFeedbackSent) {
                    abortFeedbackSent = true;
                    messageBuffer.addMessage('Aborted by user', 'status');
                    session.sendSessionEvent({ type: 'message', message: 'Aborted by user' });
                    session.sendAgentMessage('codex', {
                        type: 'turn_aborted',
                        id: randomUUID(),
                    });
                }
            } catch (error) {
                const errMsg = formatUnknownCodexError(error);
                const processExitMessage = formatCodexProcessExitMessage(error);
                logger.warn('Error in codex session:', errMsg);
                const isAbortError = error instanceof Error && error.name === 'AbortError';
                const isUserAbort = isAbortError || abortRequested;

                if (isUserAbort && !abortFeedbackSent) {
                    abortFeedbackSent = true;
                    messageBuffer.addMessage('Aborted by user', 'status');
                    session.sendSessionEvent({ type: 'message', message: 'Aborted by user' });
                    session.sendAgentMessage('codex', {
                        type: 'turn_aborted',
                        id: randomUUID(),
                    });
                } else if (!isUserAbort) {
                    messageBuffer.addMessage(processExitMessage, 'status');
                    session.sendSessionEvent({ type: 'message', message: processExitMessage });
                    // Store session for potential recovery
                    if (backend && backend.isAlive) {
                        storedSessionIdForResume = backend.getSessionId();
                        logger.debug('[Codex] Stored session after unexpected error:', storedSessionIdForResume);
                    }
                    session.sendAgentMessage('codex', {
                        type: 'task_complete',
                        id: randomUUID(),
                    });
                }
            } finally {
                abortRequested = false;
                abortFeedbackSent = false;
                permissionHandler.reset();
                reasoningProcessor.abort();
                diffProcessor.reset();
                thinking = false;
                sendRemoteKeepAlive(thinking);
                emitReadyIfIdle({
                    pending,
                    queueSize: () => messageQueue.size(),
                    shouldExit,
                    sendReady,
                });
                logActiveHandles('after-turn');
            }
        }

    } finally {
        logger.debug('[codex]: Final cleanup start');
        logActiveHandles('cleanup-start');

        if (reconnectionHandle) {
            logger.debug('[codex]: Cancelling offline reconnection');
            reconnectionHandle.cancel();
        }

        try {
            logger.debug('[codex]: sendSessionDeath');
            session.sendSessionDeath();
            logger.debug('[codex]: flush begin');
            await session.flush();
            logger.debug('[codex]: flush done');
            logger.debug('[codex]: session.close begin');
            await session.close();
            logger.debug('[codex]: session.close done');
        } catch (e) {
            logger.debug('[codex]: Error while closing session', e);
        }

        logger.debug('[codex]: backend.dispose begin');
        try { await backend?.dispose(); } catch { }
        logger.debug('[codex]: backend.dispose done');

        // Stop Happy MCP server
        logger.debug('[codex]: mcp.stop');
        mcp.stop();

        // Clean up ink UI
        if (process.stdin.isTTY) {
            logger.debug('[codex]: setRawMode(false)');
            try { process.stdin.setRawMode(false); } catch { }
        }
        if (hasTTY) {
            logger.debug('[codex]: stdin.pause()');
            try { process.stdin.pause(); } catch { }
        }
        logger.debug('[codex]: clearInterval(keepAlive)');
        clearInterval(keepAliveInterval);
        clearInterval(skillRefreshInterval);
        if (inkInstance) {
            logger.debug('[codex]: inkInstance.unmount()');
            inkInstance.unmount();
        }
        messageBuffer.clear();

        logActiveHandles('cleanup-end');
        logger.debug('[codex]: Final cleanup completed');
    }
}
