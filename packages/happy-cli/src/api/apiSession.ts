import { recordSessionBinding } from '@/daemon/sessionBinding';
import { logger } from '@/ui/logger'
import { EventEmitter } from 'node:events'
import { io, Socket } from 'socket.io-client'
import { AgentState, ClientToServerEvents, MessageContent, Metadata, ServerToClientEvents, Session, SessionCapabilities, SessionCapabilitiesSchema, Update, UserMessage, UserMessageSchema, Usage } from './types'
import { decodeBase64, decrypt, encodeBase64, encrypt } from './encryption';
import { backoff } from '@/utils/time';
import { configuration } from '@/configuration';
import { RawJSONLines } from '@/claude/types';
import { randomUUID } from 'node:crypto';
import { AsyncLock } from '@/utils/lock';
import { InvalidateSync } from '@/utils/sync';
import axios from 'axios';
import { trimToolUseResult, trimToolResultContent, trimToolUseInput } from './trimToolUseResult';
import { RpcHandlerManager } from './rpc/RpcHandlerManager';

import { registerCommonHandlers } from '../modules/common/registerCommonHandlers';
import { appendAttachmentsToPrompt } from '../modules/common/fileUpload';
import type { ClaudeBackfillItem } from '@/claude/utils/claudeBackfill';
import { registerToolImageForCall } from '../modules/common/toolImageStore';
import { calculateCost } from '@/utils/pricing';
import { isDebug } from '@/utils/env';
import { MessageArchiveWriter } from '../modules/common/messageArchive';
import { extractSearchableMessage, isThinkingOnly, messageKind, messageLandmark, PENDING_STEER_HANDSHAKE_FLAG, PendingSteerRequestSchema, type MessageKind, type MessageLandmark, type MessageSearchRole, type PendingSteerAck } from 'happy-wire';
import { openOrchestratorResponse, openOrchestratorTitle, sealOrchestrator, sealTitle, type OrchestratorResumeEnvelope, type OrchestratorTaskEnvelope } from '@/orchestrator/seal';
import type { MessageQueueItemHooks } from '@/utils/MessageQueue2';


function stripCapabilitiesFromMetadata(metadata: Metadata): Metadata {
    const { tools, slashCommands, slashCommandMetadata, skills, ...rest } = metadata;
    return rest;
}

/** Tools whose tool_use.input should be trimmed and saved to diffStore */
const INPUT_TRIMMABLE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit']);

/** Max messages per outbox flush — must not exceed the server's v3 messages limit (200). */
const MAX_OUTBOX_BATCH_SIZE = 200;

/** Longest an idle heartbeat waits on the outbox before going out anyway (offline, server down). */
const IDLE_DRAIN_MAX_MS = 10_000;

/** Longest an agent text waits to learn whether it is the turn's last before going out unmarked. */
const TURN_END_HOLD_MAX_MS = 1_000;

/** A reply text from the agent itself: the message a turn ends on and the app hangs its action bar from. */
function isAgentText(content: any): boolean {
    const { type, data } = content?.role === 'agent' ? content.content ?? {} : {};
    if (type === 'acp' || type === 'codex') return data?.type === 'message';
    const blocks = type === 'output' && data?.type === 'assistant' && data.isSidechain !== true ? data.message?.content : null;
    return Array.isArray(blocks) && blocks.length > 0 && blocks.every((block: any) => block.type === 'text');
}

/** Usage and completion records sent after a turn's last text; they don't make it any less the last. */
function isTurnBookkeeping(content: any): boolean {
    const { type, data } = content?.content ?? {};
    return (type === 'acp' || type === 'codex') && (data?.type === 'token_count' || data?.type === 'task_complete');
}

/**
 * ACP (Agent Communication Protocol) message data types.
 * This is the unified format for all agent messages - CLI adapts each provider's format to ACP.
 */
export type ACPMessageData =
    // Core message types
    | { type: 'message'; message: string }
    | { type: 'reasoning'; message: string }
    | { type: 'thinking'; text: string }
    // Tool interactions
    | { type: 'tool-call'; callId: string; name: string; input: unknown; id: string }
    | { type: 'tool-result'; callId: string; output: unknown; id: string; isError?: boolean }
    // File operations
    | { type: 'file-edit'; description: string; filePath: string; diff?: string; oldContent?: string; newContent?: string; id: string }
    // Terminal/command output
    | { type: 'terminal-output'; data: string; callId: string }
    // Task lifecycle events
    | { type: 'task_started'; id: string }
    | { type: 'task_complete'; id: string }
    | { type: 'turn_aborted'; id: string }
    // Permissions
    | { type: 'permission-request'; permissionId: string; toolName: string; description: string; options?: unknown }
    // Usage/metrics
    | { type: 'token_count';[key: string]: unknown };

export type ACPProvider = 'gemini' | 'codex' | 'claude' | 'opencode' | 'qoder';

type OrchestratorProvider = 'claude' | 'codex' | 'gemini' | 'qoder';

type OrchestratorSubmitTask = {
    taskKey?: string;
    title?: string;
    provider: OrchestratorProvider;
    model?: string;
    prompt: string;
    workingDirectory?: string;
    timeoutMs?: number;
    dependsOn?: string[];
    retry?: {
        maxAttempts?: number;
        backoffMs?: number;
    };
    target?: {
        type: 'current_machine' | 'machine_id';
        machineId?: string;
    };
    metadata?: Record<string, string>;
};

type OrchestratorSubmitBody = {
    title: string;
    controllerSessionId?: string;
    tasks: OrchestratorSubmitTask[];
    maxConcurrency?: number;
    mode?: 'blocking' | 'async';
    waitTimeoutMs?: number;
    pollIntervalMs?: number;
    idempotencyKey?: string;
    metadata?: Record<string, unknown>;
};

type OrchestratorListQuery = {
    status?: 'active' | 'terminal' | 'queued' | 'running' | 'canceling' | 'completed' | 'failed' | 'cancelled';
    limit?: number;
    cursor?: string;
};

type OrchestratorExecBody = {
    command: string;
    machineIds: string[] | 'all_online';
    workingDirectory?: string;
    timeoutMs?: number;
    waitMs?: number;
    maxConcurrency?: number;
    title?: string;
    controllerSessionId?: string;
};

type OrchestratorTransferBody = {
    from: { machineId: string; path: string };
    to: { machineIds: string[] | 'all_online'; path: string };
    overwrite?: boolean;
    timeoutMs?: number;
    waitMs?: number;
    title?: string;
    controllerSessionId?: string;
};

type OrchestratorSendMessageBody = {
    taskId: string;
    message: string;
    controllerSessionId?: string;
};

export class ApiSessionClient extends EventEmitter {
    private readonly token: string;
    readonly sessionId: string;
    private metadata: Metadata | null;
    private metadataVersion: number;
    private capabilities: SessionCapabilities = {};
    private capabilitiesVersion: number = 0;
    private capabilitiesSeedPromise: Promise<void> | null = null;
    private capabilitiesSeeded = false;

    get isTitlePinned(): boolean {
        return this.metadata?.summaryPinned === true;
    }
    private agentState: AgentState | null;
    private agentStateVersion: number;
    private socket: Socket<ServerToClientEvents, ClientToServerEvents>;
    private pendingMessages: Array<{ message: UserMessage; hooks?: MessageQueueItemHooks }> = [];
    private pendingMessageCallback: ((message: UserMessage, hooks?: MessageQueueItemHooks) => void) | null = null;
    /** Takes a queued message into the running turn ("插话"); null while the agent cannot */
    private pendingSteerHandler: ((message: UserMessage, pendingId: string) => Promise<PendingSteerAck>) | null = null;
    /** Steer reports on their way out; the idle heartbeat goes after them */
    private steerReports = new Set<Promise<void>>();
    readonly rpcHandlerManager: RpcHandlerManager;
    private agentStateLock = new AsyncLock();
    private metadataLock = new AsyncLock();
    private capabilitiesLock = new AsyncLock();
    private syncedModel: string | null;
    private encryptionKey: Uint8Array;
    private encryptionVariant: 'legacy' | 'dataKey';
    /** Maps tool_use_id → tool name for trimming tool results before sending to App */
    private toolIdToName = new Map<string, string>();
    /** Outbox of encrypted messages awaiting reliable HTTP delivery via v3 API */
    private pendingOutbox: Array<{ content: string; localId: string; kind: MessageKind; landmark: MessageLandmark | null }> = [];
    /** Searchable text of outbox messages by localId, archived once the server has given them an id and seq */
    private pendingArchive = new Map<string, { role: MessageSearchRole; text: string }>();
    private messageArchive: MessageArchiveWriter;
    /** Coalescing sync that flushes the HTTP outbox */
    private sendSync: InvalidateSync;
    /** Whether the "first user message → title" seeding has already fired (idempotent guard). */
    private initialTitleSet = false;
    /** Whether the app was last told the agent is thinking. */
    private reportedThinking = false;
    /** Whether the agent is in a turn, as its launcher last said */
    private thinking = false;
    /**
     * What the agent knows of the runs whose callbacks the server has not settled yet: run id → the
     * time it knows the run as of (the endedAt of a callback handed to its queue, or the updatedAt
     * of a tool result showing the run ended). A pull meanwhile hands over only rounds ending later.
     */
    private handedCallbacks = new Map<string, string>();
    /** Pulls and acks of orchestrator callbacks, in order, so a pull comes after every ack before it */
    private callbackSync: Promise<void> = Promise.resolve();
    /** The outbox drain a pending idle heartbeat waits on; null when none is pending. */
    private idleDrain: Promise<unknown> | null = null;
    /**
     * The latest agent text, held back until we know whether the turn ends on it, with the
     * bookkeeping records sent after it.
     */
    private heldText: { content: any; trailing: unknown[]; timer: NodeJS.Timeout } | null = null;
    /**
     * The turn the agent's messages go out under, stamped on each as `meta.turn` so the app can tell
     * a turn the agent starts on its own — a background task reporting in, with no prompt to open it —
     * from the one before it. Drawn by the first message after `endTurn`, which Claude's launcher calls
     * on its SDK's `result` and `sendAgentMessage` on an ACP agent's `task_complete` or `turn_aborted`.
     */
    private turn: string | null = null;
    /**
     * Whether the turn in flight keeps its thinking off the server. Set by the user message that
     * opened the turn (or steered into it) and cleared with it, so a turn nobody asked about
     * uploads — an old app, an orchestrator callback or a local prompt never loses thinking.
     */
    private suppressThinkingUpload = false;
    /** The account's orchestrator key, which seals the tasks this session sends and opens what comes back */
    private readonly loadOrchestratorKey: () => Promise<Uint8Array>;

    constructor(token: string, session: Session, loadOrchestratorKey: () => Promise<Uint8Array>) {
        super()
        this.token = token;
        this.loadOrchestratorKey = loadOrchestratorKey;
        this.sessionId = session.id;
        this.metadata = session.metadata;
        recordSessionBinding(session.id, session.metadata);
        this.metadataVersion = session.metadataVersion;
        this.agentState = session.agentState;
        this.agentStateVersion = session.agentStateVersion;
        this.syncedModel = session.metadata?.model?.trim() || null;
        this.encryptionKey = session.encryptionKey;
        this.encryptionVariant = session.encryptionVariant;

        // Initialize RPC handler manager
        this.rpcHandlerManager = new RpcHandlerManager({
            scopePrefix: this.sessionId,
            encryptionKey: this.encryptionKey,
            encryptionVariant: this.encryptionVariant,
            logger: (msg, data) => logger.debug(msg, data)
        });
        registerCommonHandlers(this.rpcHandlerManager, this.metadata.path, this.sessionId);

        // Initialize HTTP outbox sync for reliable message delivery
        this.sendSync = new InvalidateSync(() => this.flushOutbox());
        this.messageArchive = new MessageArchiveWriter(() => ({
            sessionId: this.sessionId,
            machineId: this.metadata?.machineId ?? null,
            agent: this.metadata?.flavor ?? null,
            path: this.metadata?.path ?? '',
            host: this.metadata?.host ?? '',
        }));

        //
        // Create socket
        //

        this.socket = io(configuration.serverUrl, {
            auth: {
                token: this.token,
                clientType: 'session-scoped' as const,
                sessionId: this.sessionId,
                supportsMessageReceipt: true,
                supportsCallbackLedger: true,
                [PENDING_STEER_HANDSHAKE_FLAG]: true
            },
            path: '/v1/updates',
            reconnection: true,
            reconnectionAttempts: Infinity,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000,
            transports: ['websocket'],
            withCredentials: true,
            autoConnect: false
        });

        //
        // Handlers
        //

        this.socket.on('connect', () => {
            logger.debug('Socket connected successfully');
            this.rpcHandlerManager.onSocketConnect(this.socket);
            // A run that ended while the session was offline, or before it started (a copy's)
            this.pullOrchestratorCallbacks();
            // An archive written while it was offline: the update that carried it is gone
            void this.pullMetadata();
        })

        // Set up global RPC request handler
        this.socket.on('rpc-request', async (data: { method: string, params: string }, callback: (response: string) => void) => {
            callback(await this.rpcHandlerManager.handleRequest(data));
        })

        this.socket.on('disconnect', (reason) => {
            logger.debug('[API] Socket disconnected:', reason);
            this.rpcHandlerManager.onSocketDisconnect();
        })

        this.socket.on('connect_error', (error) => {
            logger.debug('[API] Socket connection error:', error);
            this.rpcHandlerManager.onSocketDisconnect();
        })

        // The server's word that a run has ended: its callback is in the ledger
        this.socket.on('ephemeral', (payload: any) => {
            if (payload?.type === 'orchestrator-run-terminal') {
                this.pullOrchestratorCallbacks();
            }
        });

        // A queued message to take into the running turn; it stays queued until `reportPendingSteer`
        this.socket.on('pending-steer', async (data, callback) => {
            const answer = (ack: PendingSteerAck) => typeof callback === 'function' && callback(ack);
            const request = PendingSteerRequestSchema.safeParse(data);
            if (!request.success || request.data.sid !== this.sessionId) return answer({ accepted: false, reason: 'invalid_request' });
            if (!this.pendingSteerHandler) return answer({ accepted: false, reason: 'unsupported' });
            try {
                const message = UserMessageSchema.parse(decrypt(this.encryptionKey, this.encryptionVariant, decodeBase64(request.data.content)));
                const attachments = message.meta?.attachments;
                if (attachments?.length) {
                    message.content.text = appendAttachmentsToPrompt(message.content.text, attachments);
                }
                // A steer takes the preference into the running turn from here on
                this.applyThinkingPolicy(message);
                answer(await this.pendingSteerHandler(message, request.data.pendingId));
            } catch (error) {
                logger.debug('[API] pending-steer failed:', error);
                answer({ accepted: false, reason: error instanceof Error ? error.message : String(error) });
            }
        });

        // Server events
        this.socket.on('update', (data: Update) => {
            const emitMessageReceipt = (params: { sid: string; messageId: string; localId: string | null; ok: boolean; error?: string }) => {
                this.socket.emit('message-receipt', {
                    sid: params.sid,
                    messageId: params.messageId,
                    localId: params.localId,
                    ok: params.ok,
                    ...(params.error ? { error: params.error } : {}),
                });
            };

            try {
                logger.debugLargeJson('[SOCKET] [UPDATE] Received update:', data);

                if (!data.body) {
                    logger.debug('[SOCKET] [UPDATE] [ERROR] No body in update!');
                    return;
                }

                if (data.body.t === 'new-message' && data.body.message.content.t === 'encrypted') {
                    const body = decrypt(this.encryptionKey, this.encryptionVariant, decodeBase64(data.body.message.content.c));

                    logger.debugLargeJson('[SOCKET] [UPDATE] Received update:', body)

                    // Try to parse as user message first
                    const userResult = UserMessageSchema.safeParse(body);
                    if (userResult.success) {
                        const typedText = userResult.data.content.text;
                        // Attached files reach the agent as paths after the text; every flavor reads them itself
                        const attachments = userResult.data.meta?.attachments;
                        if (attachments?.length) {
                            userResult.data.content.text = appendAttachmentsToPrompt(typedText, attachments);
                        }
                        // Skip echoes of our own messages — the scanner sends user
                        // messages to the server and the server broadcasts them back.
                        // Without this check the CLI would treat its own echo as an
                        // incoming app message and switch from local to remote mode.
                        if (userResult.data.meta?.sentFrom === 'cli') {
                            logger.debug('[SOCKET] [UPDATE] Ignoring echo of CLI-originated user message');
                            return;
                        }
                        // Sent from the app, so it never passed through the outbox — archive it here
                        const searchable = extractSearchableMessage(body);
                        if (searchable) {
                            const { id, seq, localId, createdAt } = data.body.message;
                            this.messageArchive.append([{ type: 'message', ...searchable, id, seq, localId: localId ?? null, createdAt }]);
                        }
                        if (this.pendingMessageCallback) {
                            // Title seed for Codex/Gemini remote mode — their user messages don't re-echo through buildMessageContent
                            this.maybeSetInitialTitleFromUserText(typedText);
                            this.pendingMessageCallback(userResult.data);
                            emitMessageReceipt({
                                sid: data.body.sid,
                                messageId: data.body.message.id,
                                localId: data.body.message.localId ?? null,
                                ok: true,
                            });
                        } else {
                            this.maybeSetInitialTitleFromUserText(typedText);
                            this.pendingMessages.push({ message: userResult.data });
                            emitMessageReceipt({
                                sid: data.body.sid,
                                messageId: data.body.message.id,
                                localId: data.body.message.localId ?? null,
                                ok: true,
                            });
                        }
                    } else {
                        // If not a user message, it might be a permission response or other message type
                        this.emit('message', body);
                    }
                } else if (data.body.t === 'update-session') {
                    if (data.body.metadata) {
                        this.adoptServerMetadata(data.body.metadata.value, data.body.metadata.version);
                    }
                    if (data.body.agentState && data.body.agentState.version > this.agentStateVersion) {
                        this.agentState = data.body.agentState.value ? decrypt(this.encryptionKey, this.encryptionVariant, decodeBase64(data.body.agentState.value)) : null;
                        this.agentStateVersion = data.body.agentState.version;
                    }
                    if (data.body.capabilities && data.body.capabilities.version > this.capabilitiesVersion) {
                        this.capabilities = this.decodeCapabilitiesPayload(data.body.capabilities.value);
                        this.capabilitiesVersion = data.body.capabilities.version;
                        this.capabilitiesSeeded = true;
                    }
                } else if (data.body.t === 'update-machine') {
                    // Session clients shouldn't receive machine updates - log warning
                    logger.debug(`[SOCKET] WARNING: Session client received unexpected machine update - ignoring`);
                } else {
                    // If not a user message, it might be a permission response or other message type
                    this.emit('message', data.body);
                }
            } catch (error) {
                logger.debug('[SOCKET] [UPDATE] [ERROR] Error handling update', { error });
                if (data?.body?.t === 'new-message') {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    emitMessageReceipt({
                        sid: data.body.sid,
                        messageId: data.body.message.id,
                        localId: data.body.message.localId ?? null,
                        ok: false,
                        error: errorMessage,
                    });
                }
            }
        });

        // DEATH
        this.socket.on('error', (error) => {
            logger.debug('[API] Socket error:', error);
        });

        //
        // Connect (after short delay to give a time to add handlers)
        //

        this.socket.connect();
    }

    /**
     * Take metadata the server holds when it is newer than ours. Seeing it turn archived by someone
     * else (the app archiving a session whose process it could not reach) emits 'archived' once,
     * so the session stops as a kill would have stopped it. Our own archive (archivedBy 'cli') and
     * one already in place when the session started are not a transition and stop nothing.
     */
    private adoptServerMetadata(value: string, version: number) {
        if (version <= this.metadataVersion) return;
        const wasArchived = this.metadata?.lifecycleState === 'archived';
        this.metadata = decrypt(this.encryptionKey, this.encryptionVariant, decodeBase64(value));
        this.metadataVersion = version;
        this.syncedModel = this.metadata?.model?.trim() || null;
        if (wasArchived || this.metadata?.lifecycleState !== 'archived' || this.metadata.archivedBy === 'cli') return;
        logger.debug('[API] Session archived elsewhere, stopping');
        this.emit('archived');
    }

    private async pullMetadata() {
        try {
            const response = await axios.get(
                `${configuration.serverUrl}/v1/sessions/${encodeURIComponent(this.sessionId)}/metadata`,
                { headers: this.orchestratorHeaders(), timeout: 30_000 }
            );
            const { metadata, metadataVersion } = response.data ?? {};
            if (typeof metadata === 'string' && typeof metadataVersion === 'number') {
                this.adoptServerMetadata(metadata, metadataVersion);
            }
        } catch (error: any) {
            // A server without the endpoint (404) leaves it to the next update, as before
            if (error?.response?.status !== 404) {
                logger.debug('[API] Failed to pull session metadata', { error });
            }
        }
    }

    private orchestratorHeaders() {
        return {
            'Authorization': `Bearer ${this.token}`,
            'Content-Type': 'application/json'
        } as const;
    }

    private decodeCapabilitiesPayload(payload: string): SessionCapabilities {
        const decrypted = decrypt(this.encryptionKey, this.encryptionVariant, decodeBase64(payload));
        const parsed = SessionCapabilitiesSchema.safeParse(decrypted);
        if (!parsed.success) {
            throw new Error(`Invalid session capabilities payload: ${parsed.error.message}`);
        }
        return parsed.data;
    }

    private async ensureCapabilitiesSeeded() {
        if (this.capabilitiesSeeded) {
            return;
        }
        if (this.capabilitiesSeedPromise) {
            return this.capabilitiesSeedPromise;
        }

        this.capabilitiesSeedPromise = (async () => {
            try {
                const response = await axios.get(
                    `${configuration.serverUrl}/v1/sessions/${encodeURIComponent(this.sessionId)}/capabilities`,
                    {
                        headers: this.orchestratorHeaders(),
                        timeout: 30_000,
                    }
                );
                const capabilities = response.data?.capabilities;
                if (capabilities?.payload && typeof capabilities.version === 'number') {
                    this.capabilities = this.decodeCapabilitiesPayload(capabilities.payload);
                    this.capabilitiesVersion = capabilities.version;
                }
            } catch (error: any) {
                if (error?.response?.status !== 404) {
                    logger.debug('[API] Failed to seed session capabilities', { error });
                }
            } finally {
                this.capabilitiesSeeded = true;
                this.capabilitiesSeedPromise = null;
            }
        })();

        return this.capabilitiesSeedPromise;
    }

    getMetadataSnapshot(): Metadata | null {
        return this.metadata ? JSON.parse(JSON.stringify(this.metadata)) : null;
    }

    /**
     * Each task's title and what it is to do go sealed (see orchestrator/seal.ts), with the machine
     * it may run on and how often; the run's title carries the run's metadata.
     */
    async orchestratorSubmit(body: OrchestratorSubmitBody): Promise<any> {
        const key = await this.loadOrchestratorKey();
        const { metadata, ...rest } = body;
        const response = await axios.post(
            `${configuration.serverUrl}/v1/orchestrator/submit`,
            {
                ...rest,
                title: sealTitle(body.title, metadata, key),
                tasks: body.tasks.map(({ title, metadata, workingDirectory, ...task }) => ({
                    ...task,
                    title: sealTitle(title, metadata, key),
                    workingDirectory: workingDirectory === undefined ? undefined : sealOrchestrator(workingDirectory, key),
                    prompt: sealOrchestrator({
                        kind: 'task',
                        sealId: randomUUID(),
                        createdAt: Date.now(),
                        machineIds: [task.target?.machineId ?? this.metadata?.machineId ?? ''],
                        maxAttempts: task.retry?.maxAttempts ?? 1,
                        provider: task.provider,
                        // The server runs 'default' as the provider's own default
                        model: task.model === 'default' ? undefined : task.model,
                        prompt: task.prompt,
                        workingDirectory,
                    } satisfies OrchestratorTaskEnvelope, key),
                })),
            },
            {
                headers: this.orchestratorHeaders(),
                timeout: 60_000,
            }
        );
        return openOrchestratorResponse(response.data, key);
    }

    async orchestratorExec(body: OrchestratorExecBody): Promise<any> {
        const key = await this.loadOrchestratorKey();
        const { command, workingDirectory, title, ...rest } = body;
        const firstLine = command.trim().split('\n')[0];
        const response = await axios.post(
            `${configuration.serverUrl}/v1/orchestrator/exec`,
            {
                ...rest,
                title: sealTitle(title ?? `$ ${firstLine.length > 120 ? `${firstLine.slice(0, 120)}…` : firstLine}`, undefined, key),
                workingDirectory: workingDirectory === undefined ? undefined : sealOrchestrator(workingDirectory, key),
                prompt: sealOrchestrator({
                    kind: 'shell',
                    sealId: randomUUID(),
                    createdAt: Date.now(),
                    machineIds: body.machineIds === 'all_online' ? 'all' : body.machineIds,
                    maxAttempts: 1,
                    command,
                    workingDirectory,
                } satisfies OrchestratorTaskEnvelope, key),
            },
            {
                headers: this.orchestratorHeaders(),
                // The server holds the request open for up to waitMs
                timeout: (body.waitMs ?? 30_000) + 30_000,
            }
        );
        return openOrchestratorResponse(response.data, key);
    }

    async orchestratorTransfer(body: OrchestratorTransferBody): Promise<any> {
        const key = await this.loadOrchestratorKey();
        const { from, to, overwrite, title, ...rest } = body;
        const short = (path: string) => path.length > 60 ? `…${path.slice(-60)}` : path;
        const response = await axios.post(
            `${configuration.serverUrl}/v1/orchestrator/transfer`,
            {
                ...rest,
                title: sealTitle(title ?? `Transfer ${short(from.path)} → ${short(to.path)}`, undefined, key),
                fromMachineId: from.machineId,
                toMachineIds: to.machineIds,
                prompt: sealOrchestrator({
                    kind: 'transfer',
                    sealId: randomUUID(),
                    createdAt: Date.now(),
                    machineIds: to.machineIds === 'all_online' ? 'all' : to.machineIds,
                    maxAttempts: 1,
                    sourceMachineId: from.machineId,
                    sourcePath: from.path,
                    targetPath: to.path,
                    overwrite: overwrite ?? false,
                } satisfies OrchestratorTaskEnvelope, key),
            },
            {
                headers: this.orchestratorHeaders(),
                // The server holds the request open for up to waitMs
                timeout: (body.waitMs ?? 30_000) + 30_000,
            }
        );
        return openOrchestratorResponse(response.data, key);
    }

    async orchestratorGetContext(): Promise<any> {
        const response = await axios.get(
            `${configuration.serverUrl}/v1/orchestrator/context`,
            {
                headers: this.orchestratorHeaders(),
                timeout: 30_000,
            }
        );
        return response.data;
    }

    /** Call an RPC method another machine's daemon registered (`<machineId>:<method>`), in plaintext. */
    async callMachineRpc(method: string, params: Record<string, unknown>, timeoutMs: number): Promise<unknown> {
        const response = await this.socket.timeout(timeoutMs).emitWithAck('rpc-call', { method, params });
        if (!response?.ok) {
            throw new Error(response?.error || `RPC call failed: ${method}`);
        }
        return response.result;
    }

    async orchestratorGetRun(runId: string, includeTasks: boolean = true): Promise<any> {
        const key = await this.loadOrchestratorKey();
        const response = await axios.get(
            `${configuration.serverUrl}/v1/orchestrator/runs/${encodeURIComponent(runId)}`,
            {
                headers: this.orchestratorHeaders(),
                params: { includeTasks },
                timeout: 30_000,
            }
        );
        return openOrchestratorResponse(response.data, key);
    }

    async orchestratorListRuns(query: OrchestratorListQuery = {}): Promise<any> {
        const key = await this.loadOrchestratorKey();
        const response = await axios.get(
            `${configuration.serverUrl}/v1/orchestrator/runs`,
            {
                headers: this.orchestratorHeaders(),
                params: query,
                timeout: 30_000,
            }
        );
        return openOrchestratorResponse(response.data, key);
    }

    /** A run's status and every one of its tasks, as they are now */
    async orchestratorPend(runId: string): Promise<any> {
        const key = await this.loadOrchestratorKey();
        const response = await axios.get(
            `${configuration.serverUrl}/v1/orchestrator/runs/${encodeURIComponent(runId)}/pend`,
            {
                headers: this.orchestratorHeaders(),
                params: { include: 'all_tasks', timeoutMs: 0 },
                timeout: 30_000,
            }
        );
        return openOrchestratorResponse(response.data, key);
    }

    /** The message goes sealed with the task it is for, so the server can neither read nor redirect it */
    async orchestratorSendMessage(body: OrchestratorSendMessageBody): Promise<any> {
        const key = await this.loadOrchestratorKey();
        const response = await axios.post(
            `${configuration.serverUrl}/v1/orchestrator/tasks/${encodeURIComponent(body.taskId)}/send-message`,
            {
                message: sealOrchestrator({
                    kind: 'resume',
                    sealId: randomUUID(),
                    taskId: body.taskId,
                    message: body.message,
                    createdAt: Date.now(),
                } satisfies OrchestratorResumeEnvelope, key),
                controllerSessionId: body.controllerSessionId,
            },
            {
                headers: this.orchestratorHeaders(),
                timeout: 60_000,
            }
        );
        return openOrchestratorResponse(response.data, key);
    }

    /** Cancel a run for the agent, which so knows how it ends: the server owes this session no callback for it */
    async orchestratorCancel(runId: string, body?: { reason?: string }): Promise<any> {
        const response = await axios.post(
            `${configuration.serverUrl}/v1/orchestrator/runs/${encodeURIComponent(runId)}/cancel`,
            { ...body, controllerSessionId: this.sessionId },
            {
                headers: this.orchestratorHeaders(),
                timeout: 30_000,
            }
        );
        return response.data;
    }

    /**
     * Where queued messages go to be taken into the running turn ("插话"). The handler accepts one
     * only when the agent has it now, and then reports it through `reportPendingSteer`.
     */
    /** Runs once when the session is archived by someone else: see adoptServerMetadata. */
    onArchived(handler: () => void) {
        this.once('archived', handler);
    }

    onPendingSteer(handler: (message: UserMessage, pendingId: string) => Promise<PendingSteerAck>) {
        this.pendingSteerHandler = handler;
    }

    /**
     * A steered message's fate: `read` once the agent has taken it in, which goes out after
     * everything the agent produced before it; `dropped` when the turn ended without it. Either goes
     * out before the idle heartbeat of the turn it was steered into.
     */
    reportPendingSteer(pendingId: string, outcome: 'read' | 'dropped') {
        if (outcome === 'read') this.releaseHeldText(false);
        const report = (outcome === 'read' ? this.sendSync.invalidateAndAwait().catch(() => {}) : Promise.resolve())
            .then(() => {
                this.socket.emit('pending-steer-result', { sid: this.sessionId, pendingId, outcome });
            })
            .finally(() => this.steerReports.delete(report));
        this.steerReports.add(report);
    }

    /**
     * Where the session's user messages go: the app's, and the orchestrator callbacks the agent is
     * owed, whose `hooks` the agent's queue calls when it hands the message over or drops it.
     */
    onUserMessage(callback: (data: UserMessage, hooks?: MessageQueueItemHooks) => void) {
        // Every message handed to the agent passes through here, so the turn's upload preference
        // follows the message that opened it no matter how long it waited in the queue.
        this.pendingMessageCallback = (message, hooks) => {
            this.applyThinkingPolicy(message);
            callback(message, hooks);
        };
        while (this.pendingMessages.length > 0) {
            const { message, hooks } = this.pendingMessages.shift()!;
            this.pendingMessageCallback(message, hooks);
        }
    }

    /** A message that states the preference sets it for its turn; one that stays silent (an old
     *  app, an orchestrator callback) leaves the turn as it is. */
    private applyThinkingPolicy(message: UserMessage) {
        const suppress = message.meta?.suppressThinking;
        if (typeof suppress === 'boolean') this.suppressThinkingUpload = suppress;
    }

    /**
     * Hand the agent the orchestrator callbacks it is owed (the server's ledger keeps each until it
     * is acked), while it is between turns: on connecting, when its turn ends, and when the server
     * says a run has ended. One owed while the agent is busy waits for its turn to end. Each is
     * acked once the agent's queue hands it over; one the queue drops (an abort) is pulled again.
     */
    private pullOrchestratorCallbacks() {
        this.callbackSync = this.callbackSync.then(async () => {
            const response = await axios.post(
                `${configuration.serverUrl}/v1/orchestrator/sessions/${encodeURIComponent(this.sessionId)}/callbacks`,
                // The session this one was copied or resumed from, whose callbacks it takes while that one is offline
                { predecessorSessionId: process.env.HAPPY_FORKED_FROM_SESSION_ID?.trim() || undefined },
                { headers: this.orchestratorHeaders(), timeout: 30_000 },
            );
            const callbacks: Array<{ runId: string; title: string; status: string; endedAt: string }> = response.data.data.callbacks;
            const due = callbacks.filter((callback) => !this.thinking
                && !(Date.parse(callback.endedAt) <= Date.parse(this.handedCallbacks.get(callback.runId) ?? '')));
            const key = await this.loadOrchestratorKey();
            for (const callback of due) {
                const title = openOrchestratorTitle(callback.title, key);
                const text = [
                    '<orchestrator-callback>',
                    `Run "${title}" (${callback.runId}) reached terminal state: ${callback.status}.`,
                    'Use orchestrator_list or orchestrator_pend to fetch its results.',
                    '</orchestrator-callback>',
                ].join('\n');
                const message = { role: 'user' as const, content: { type: 'text' as const, text }, meta: {} };
                const hooks: MessageQueueItemHooks = {
                    taken: () => void this.orchestratorCallbacksAck([{ runId: callback.runId, knownAt: callback.endedAt }]),
                    dropped: () => {
                        this.handedCallbacks.delete(callback.runId);
                        this.pullOrchestratorCallbacks();
                    },
                };
                this.handedCallbacks.set(callback.runId, callback.endedAt);
                logger.debug(`[API] Handing the agent the callback of run ${callback.runId}`);
                if (this.pendingMessageCallback) {
                    this.pendingMessageCallback(message, hooks);
                } else {
                    this.pendingMessages.push({ message, hooks });
                }
            }
        }).catch((error) => logger.debug('[API] Pulling orchestrator callbacks failed:', error));
    }

    /**
     * Tell the server the agent knows these runs as of `knownAt` — the end of a callback it was
     * handed, or a tool result that showed the run ended — settling the callbacks of rounds that
     * ended by then. It counts at once here, so a pull already under way does not hand them over;
     * one whose ack fails is not handed over again by this process.
     */
    orchestratorCallbacksAck(runs: Array<{ runId: string; knownAt: string }>): Promise<void> {
        for (const { runId, knownAt } of runs) {
            const known = this.handedCallbacks.get(runId) ?? knownAt;
            this.handedCallbacks.set(runId, Date.parse(known) > Date.parse(knownAt) ? known : knownAt);
        }
        this.callbackSync = this.callbackSync.then(async () => {
            await axios.post(
                `${configuration.serverUrl}/v1/orchestrator/sessions/${encodeURIComponent(this.sessionId)}/callbacks/ack`,
                { runs },
                { headers: this.orchestratorHeaders(), timeout: 30_000 },
            );
            const settled = runs.filter(({ runId, knownAt }) => Date.parse(this.handedCallbacks.get(runId) ?? knownAt) <= Date.parse(knownAt));
            for (const { runId } of settled) {
                this.handedCallbacks.delete(runId);
            }
        }).catch((error) => logger.debug('[API] Acking orchestrator callbacks failed:', error));
        return this.callbackSync;
    }

    isConnected(): boolean {
        return this.socket.connected;
    }

    private rememberToolName(id: string, name: string) {
        this.toolIdToName.set(id, name);
        // Bound map size for long sessions
        if (this.toolIdToName.size > 1000) {
            const iter = this.toolIdToName.keys();
            for (let i = 0; i < 500; i++) {
                const key = iter.next().value;
                if (key) this.toolIdToName.delete(key);
            }
        }
    }

    private buildMessageContent(body: RawJSONLines): MessageContent {
        // Track tool_use_id → tool name from assistant messages, and trim Edit/Write/MultiEdit inputs
        if (body.type === 'assistant' && body.message?.content && Array.isArray(body.message.content)) {
            let needsInputTrim = false;
            for (const block of body.message.content) {
                if (block.type === 'tool_use' && block.id && block.name) {
                    this.rememberToolName(block.id, block.name);
                    // Claude tool calls never pass through sendAgentMessage — register here so the
                    // app can preview images it reads, subagents included.
                    registerToolImageForCall(this.sessionId, this.metadata?.path, block.name, block.id, block.input);
                    if (INPUT_TRIMMABLE_TOOLS.has(block.name)) {
                        needsInputTrim = true;
                    }
                }
            }
            // Trim large tool_use inputs (Edit/Write/MultiEdit) and save to diffStore
            if (needsInputTrim) {
                body = this.trimToolUseInputs(body);
            }
        }

        // Trim tool result payloads before sending to App
        if (body.type === 'user') {
            body = this.trimToolResultPayload(body);
        }

        // Claude Code records the post-compaction summary as a user message carrying
        // isCompactSummary. It is not something the user typed, so the flag rides along in meta and
        // the app leaves it off the conversation minimap while the list keeps showing it.
        const isCompactSummary = body.type === 'user' && body.isCompactSummary === true;

        // Check if body is a user message (not sidechain or meta)
        if (body.type === 'user' && body.isSidechain !== true && body.isMeta !== true) {
            // Handle string content directly
            if (typeof body.message.content === 'string') {
                if (this.isSyntheticTaskNotification(body.message.content)) {
                    return {
                        role: 'agent',
                        content: {
                            type: 'output',
                            data: body
                        },
                        meta: {
                            sentFrom: 'cli'
                        }
                    };
                }
                if (!isCompactSummary) {
                    this.maybeSetInitialTitleFromUserText(body.message.content);
                }
                return {
                    role: 'user',
                    content: {
                        type: 'text',
                        text: body.message.content
                    },
                    meta: {
                        sentFrom: 'cli',
                        ...(isCompactSummary ? { isCompactSummary: true } : {})
                    }
                };
            }
            // Handle array content - extract text from text items (Claude sometimes converts string to array)
            else if (Array.isArray(body.message.content)) {
                const textParts: string[] = [];
                for (const item of body.message.content) {
                    if (item && typeof item === 'object' && item.type === 'text' && typeof item.text === 'string') {
                        textParts.push(item.text);
                    }
                }
                // Only treat as user message if we extracted some text (not just tool_results)
                if (textParts.length > 0) {
                    const joined = textParts.join('\n');
                    if (!isCompactSummary) {
                        this.maybeSetInitialTitleFromUserText(joined);
                    }
                    return {
                        role: 'user',
                        content: {
                            type: 'text',
                            text: joined
                        },
                        meta: {
                            sentFrom: 'cli',
                            ...(isCompactSummary ? { isCompactSummary: true } : {})
                        }
                    };
                }
                // Fallback to agent message for tool results
                return {
                    role: 'agent',
                    content: {
                        type: 'output',
                        data: body
                    },
                    meta: {
                        sentFrom: 'cli'
                    }
                };
            }
            // Unknown content type, wrap as agent message
            return {
                role: 'agent',
                content: {
                    type: 'output',
                    data: body
                },
                meta: {
                    sentFrom: 'cli'
                }
            };
        }
        // Wrap Claude messages in the expected format
        return {
            role: 'agent',
            content: {
                type: 'output',
                data: body  // This wraps the entire Claude message
            },
            meta: {
                sentFrom: 'cli'
            }
        };
    }

    /**
     * Claude can emit background task completion payloads as synthetic user strings.
     * These are internal notifications, not real human input.
     */
    private isSyntheticTaskNotification(content: string): boolean {
        const text = content.trim();
        return text.startsWith('<task-notification>') && text.includes('</task-notification>');
    }

    /**
     * Trim large, unused fields from tool_result messages before sending to App.
     * Returns a shallow copy with trimmed toolUseResult and message.content.
     */
    private trimToolResultPayload(body: RawJSONLines): RawJSONLines {
        if (body.type !== 'user') return body;

        const content = body.message?.content;
        if (!Array.isArray(content)) return body;

        // Find tool_result items and resolve tool names
        let needsTrim = false;
        for (const block of content) {
            if (block.type === 'tool_result' && block.tool_use_id && this.toolIdToName.has(block.tool_use_id)) {
                needsTrim = true;
                break;
            }
        }
        if (!needsTrim) return body;

        // Shallow-copy to avoid mutating the original
        const trimmedContent = content.map((block: any) => {
            if (block.type !== 'tool_result' || !block.tool_use_id) return block;
            const toolName = this.toolIdToName.get(block.tool_use_id);
            if (!toolName) return block;
            return {
                ...block,
                content: trimToolResultContent(toolName, block.content),
            };
        });

        // Trim toolUseResult (the primary data source for App's tool.result).
        // sdkToLogConverter's 'tool_result' path produces exactly one tool_result
        // block per message, so using find() is safe here.
        const anyBody = body as any;
        let trimmedTUR = anyBody.toolUseResult ?? anyBody.tool_use_result;
        const firstToolResult = content.find((b: any) => b.type === 'tool_result' && b.tool_use_id);
        if (firstToolResult && trimmedTUR !== undefined) {
            const toolName = this.toolIdToName.get(firstToolResult.tool_use_id);
            if (toolName) {
                trimmedTUR = trimToolUseResult(toolName, trimmedTUR, this.sessionId, firstToolResult.tool_use_id);
            }
        }

        return {
            ...anyBody,
            message: {
                ...body.message,
                content: trimmedContent,
            },
            ...(trimmedTUR !== undefined ? { toolUseResult: trimmedTUR } : {}),
        };
    }

    /**
     * Trim large tool_use inputs (Edit/Write/MultiEdit) from assistant messages.
     * Saves full content to diffStore, replaces input with lightweight metadata.
     */
    private trimToolUseInputs(body: RawJSONLines): RawJSONLines {
        const content = (body as any).message?.content;
        if (!Array.isArray(content)) return body;

        const trimmedContent = content.map((block: any) => {
            if (block.type !== 'tool_use' || !INPUT_TRIMMABLE_TOOLS.has(block.name)) return block;
            return trimToolUseInput(block, this.sessionId);
        });

        return {
            ...(body as any),
            message: {
                ...(body as any).message,
                content: trimmedContent,
            },
        };
    }

    /**
     * Flush pending outbox messages to the v3 HTTP API.
     * Called by sendSync (InvalidateSync) which provides coalescing and retry with backoff.
     */
    private async flushOutbox() {
        if (this.pendingOutbox.length === 0) {
            return;
        }

        // Cap each request at the server's per-request limit (v3 messages route
        // rejects >200 with a 400). Sending the whole outbox unbounded would make
        // an oversized backlog fail validation forever, since we only clear on
        // success — the request would retry the same rejected batch indefinitely.
        const batch = this.pendingOutbox.slice(0, MAX_OUTBOX_BATCH_SIZE);
        const response = await axios.post<{ messages?: Array<{ id: string; seq: number; localId: string; createdAt: number }> }>(
            `${configuration.serverUrl}/v3/sessions/${encodeURIComponent(this.sessionId)}/messages`,
            {
                messages: batch
            },
            {
                headers: {
                    'Authorization': `Bearer ${this.token}`,
                    'Content-Type': 'application/json',
                },
                timeout: 60000
            }
        );

        // Only clear after successful response
        this.pendingOutbox.splice(0, batch.length);

        this.messageArchive.append((response.data?.messages ?? []).flatMap(({ id, seq, localId, createdAt }) => {
            const searchable = this.pendingArchive.get(localId);
            return searchable ? [{ type: 'message' as const, ...searchable, id, seq, localId, createdAt }] : [];
        }));
        batch.forEach((item) => this.pendingArchive.delete(item.localId));

        // More than one batch was queued — keep draining the remainder.
        if (this.pendingOutbox.length > 0) {
            this.sendSync.invalidate();
        }
    }

    /**
     * Enqueue a message for reliable delivery via the v3 HTTP outbox.
     *
     * An agent text is held back until the next message shows it isn't the turn's last,
     * the turn ends (it then goes out marked `turnEnd`, so the app settles the turn
     * together with it instead of on a later heartbeat), or TURN_END_HOLD_MAX_MS passes.
     */
    private enqueueMessage(content: unknown) {
        // The turn's reader said it doesn't show thinking, so don't spend the upload on it
        if (this.suppressThinkingUpload && isThinkingOnly(content)) {
            return;
        }
        if (this.heldText && isTurnBookkeeping(content)) {
            this.heldText.trailing.push(content);
            return;
        }
        this.releaseHeldText(false);
        if (isAgentText(content)) {
            const timer = setTimeout(() => this.releaseHeldText(false), TURN_END_HOLD_MAX_MS).unref();
            this.heldText = { content, trailing: [], timer };
            return;
        }
        this.pushOutbox(content);
    }

    private releaseHeldText(turnEnd: boolean) {
        const held = this.heldText;
        if (!held) return;
        this.heldText = null;
        clearTimeout(held.timer);
        this.pushOutbox(turnEnd ? { ...held.content, meta: { ...held.content.meta, turnEnd: true } } : held.content);
        held.trailing.forEach((content) => this.pushOutbox(content));
    }

    /** Encrypt a message and put it on the v3 HTTP outbox. */
    private pushOutbox(content: unknown) {
        const encrypted = encodeBase64(encrypt(this.encryptionKey, this.encryptionVariant, content));
        const localId = randomUUID();
        const searchable = extractSearchableMessage(content);
        if (searchable) this.pendingArchive.set(localId, searchable);
        this.pendingOutbox.push({
            content: encrypted,
            localId,
            kind: messageKind(content),
            landmark: messageLandmark(content, this.toolIdToName),
        });
        this.sendSync.invalidate();
    }

    private postSendProcessing(body: RawJSONLines) {
        // Track usage from assistant messages
        if (body.type === 'assistant' && body.message?.usage) {
            try {
                // Don't update model metadata from subagent messages (e.g. Explore uses Haiku)
                // to avoid misleading the user into thinking the main session switched models
                const isSidechain = (body as any).isSidechain === true;
                this.sendUsageData(body.message.usage, isSidechain ? undefined : body.message.model);
            } catch (error) {
                logger.debug('[SOCKET] Failed to send usage data:', error);
            }
        }

        // Update metadata with summary if this is a summary message
        if (body.type === 'summary' && 'summary' in body && 'leafUuid' in body) {
            this.updateMetadata((metadata) => {
                // Skip auto-update if user has pinned the title
                if (metadata.summaryPinned) {
                    logger.debug('[SOCKET] Skipping summary update: title is pinned by user');
                    return metadata;
                }

                const newSummary = body.summary as string;
                const currentSummary = metadata.summary?.text;

                // Check if new summary is just the directory name
                const dirName = metadata.path?.split(/[\\/]/).filter(Boolean).pop();
                const isNewSummaryDirName = dirName && newSummary === dirName;

                // If new summary is directory name and we already have a better title, keep the current one
                if (isNewSummaryDirName && currentSummary && currentSummary !== dirName) {
                    logger.debug('[SOCKET] Skipping summary update: new summary is directory name but current title is better', {
                        newSummary,
                        currentSummary,
                        dirName
                    });
                    return metadata;
                }

                return {
                    ...metadata,
                    summary: {
                        text: newSummary,
                        updatedAt: Date.now()
                    }
                };
            });
        }
    }

    /**
     * Send message to session
     * @param body - Message body (can be MessageContent or raw content for agent messages)
     */
    sendClaudeSessionMessage(body: RawJSONLines) {
        const content = this.buildMessageContent(body);
        if (content.role === 'agent') {
            this.turn ??= randomUUID();
            content.meta = { ...content.meta, turn: this.turn };
        }

        logger.debugLargeJson('[SOCKET] Sending message through socket:', content)

        // Deliver via v3 HTTP outbox (sole delivery path — no socket emit to avoid duplicates)
        this.enqueueMessage(content);

        this.postSendProcessing(body);
    }

    /** The agent has ended its turn: the next message it sends opens a new one. */
    endTurn() {
        this.turn = null;
        // A turn nobody has opened yet starts from the default: thinking goes out
        this.suppressThinkingUpload = false;
    }

    async sendClaudeSessionMessageBatch(messages: ClaudeBackfillItem[], mode: 'replace' | 'append' = 'append') {
        if (!this.socket.connected) {
            logger.debug('[API] Socket not connected, cannot send Claude session message batch. Messages will be lost:', { count: messages.length });
            return { result: 'error' as const };
        }

        const payload = messages.map((item) => {
            const content = 'message' in item ? this.buildMessageContent(item.message) : item.content;
            const encrypted = encodeBase64(encrypt(this.encryptionKey, this.encryptionVariant, content));
            return {
                message: encrypted,
                localId: item.localId
            };
        });

        const response = await this.socket.emitWithAck('message-batch', {
            sid: this.sessionId,
            messages: payload,
            mode
        });

        if (response?.result === 'success') {
            for (const item of messages) {
                if ('message' in item) {
                    this.postSendProcessing(item.message);
                }
            }
        }

        return response;
    }

    sendCodexMessage(body: any) {
        if (body?.type === 'tool-call' && typeof body.callId === 'string' && typeof body.name === 'string') {
            this.rememberToolName(body.callId, body.name);
        }
        let content = {
            role: 'agent',
            content: {
                type: 'codex',
                data: body  // This wraps the entire Claude message
            },
            meta: {
                sentFrom: 'cli'
            }
        };

        // Deliver via v3 HTTP outbox (sole delivery path — no socket emit to avoid duplicates)
        this.enqueueMessage(content);
    }

    /**
     * Send a generic agent message to the session using ACP (Agent Communication Protocol) format.
     * Works for any agent type (Gemini, Codex, Claude, etc.) - CLI normalizes to unified ACP format.
     * 
     * @param provider - The agent provider sending the message (e.g., 'gemini', 'codex', 'claude')
     * @param body - The message payload (type: 'message' | 'reasoning' | 'tool-call' | 'tool-result')
     */
    sendAgentMessage(provider: ACPProvider, body: ACPMessageData) {
        if (body.type === 'tool-call') {
            registerToolImageForCall(this.sessionId, this.metadata?.path, body.name, body.callId, body.input);
            // A minimap landmark is decided at send time, and its result names a callId, not a tool
            this.rememberToolName(body.callId, body.name);
        }
        if (body.type === 'token_count' && typeof body.model === 'string') {
            this.updateModelMetadata(body.model);
        }

        this.turn ??= randomUUID();
        let content = {
            role: 'agent',
            content: {
                type: 'acp',
                provider,
                data: body
            },
            meta: {
                sentFrom: 'cli',
                turn: this.turn
            }
        };

        logger.debug(`[SOCKET] Sending ACP message from ${provider}:`, { type: body.type, hasMessage: 'message' in body });

        // Deliver via v3 HTTP outbox (sole delivery path — no socket emit to avoid duplicates)
        this.enqueueMessage(content);

        // The turn's own end goes out under it; whatever the agent sends next opens a new one.
        if (body.type === 'task_complete' || body.type === 'turn_aborted') {
            this.endTurn();
        }
    }

    /**
     * Send a batch of pre-built message content objects for backfill (session resume/copy).
     * Each item.content should be a complete message object (role + content) ready to encrypt.
     * Works for any agent type (Codex, Gemini, etc.) — caller builds the message format.
     */
    async sendBackfillBatch(
        messages: { content: unknown; localId: string }[],
        mode: 'replace' | 'append' = 'append',
    ) {
        if (!this.socket.connected) {
            logger.debug(`[API] Socket not connected, cannot send backfill batch (${messages.length} messages)`);
            return { result: 'error' as const };
        }

        const toolNames = new Map<string, string>();
        const payload = messages.map((item) => {
            const encrypted = encodeBase64(encrypt(this.encryptionKey, this.encryptionVariant, item.content));
            return {
                message: encrypted,
                localId: item.localId,
                kind: messageKind(item.content),
                landmark: messageLandmark(item.content, toolNames),
            };
        });

        logger.debug(`[SOCKET] Sending backfill batch: ${messages.length} messages, mode=${mode}`);

        const response = await this.socket.emitWithAck('message-batch', {
            sid: this.sessionId,
            messages: payload,
            mode,
        });

        return response;
    }

    sendSessionEvent(event: {
        type: 'switch', mode: 'local' | 'remote'
    } | {
        type: 'message', message: string
    } | {
        type: 'permission-mode-changed', mode: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan'
    } | {
        type: 'ready'
    }, id?: string) {
        let content = {
            role: 'agent',
            content: {
                id: id ?? randomUUID(),
                type: 'event',
                data: event
            }
        };
        const encrypted = encodeBase64(encrypt(this.encryptionKey, this.encryptionVariant, content));
        this.socket.emit('message', {
            sid: this.sessionId,
            message: encrypted
        });
    }

    /**
     * Send a ping message to keep the connection alive.
     *
     * Going idle waits for the outbox: messages travel over HTTP and the
     * heartbeat over the socket, so an idle sent right away reaches the app
     * before the turn's last message, and the server dispatches a queued prompt
     * ahead of it. The held text goes out first, marked as ending the turn, which
     * the app settles on. Until the drain settles no heartbeat goes out, as a
     * thinking one would undo that; going busy again drops the pending idle.
     *
     * A turn's end is when an orchestrator callback owed meanwhile can be handed over.
     */
    keepAlive(thinking: boolean, mode: 'local' | 'remote') {
        const turnEnded = this.thinking && !thinking;
        this.thinking = thinking;
        if (turnEnded) {
            this.pullOrchestratorCallbacks();
        }
        if (thinking || !this.reportedThinking) {
            this.idleDrain = null;
            this.reportedThinking = thinking;
            this.emitAlive(thinking, mode);
            return;
        }
        if (this.idleDrain) return;
        this.releaseHeldText(true);
        const drain = Promise.race([
            Promise.all([this.sendSync.invalidateAndAwait(), ...this.steerReports]),
            new Promise((resolve) => setTimeout(resolve, IDLE_DRAIN_MAX_MS).unref()),
        ]);
        this.idleDrain = drain;
        void drain.then(() => {
            if (this.idleDrain !== drain) return;
            this.idleDrain = null;
            this.reportedThinking = false;
            this.emitAlive(false, mode);
        });
    }

    private emitAlive(thinking: boolean, mode: 'local' | 'remote') {
        if (isDebug()) {
            logger.debug(`[API] Sending keep alive message: ${thinking}`);
        }
        this.socket.volatile.emit('session-alive', {
            sid: this.sessionId,
            time: Date.now(),
            thinking,
            mode
        });
    }

    /**
     * Send session death message
     */
    sendSessionDeath() {
        this.socket.emit('session-end', { sid: this.sessionId, time: Date.now() });
    }

    /**
     * Send a generic usage report to the server for any provider
     */
    sendUsageReport(report: { key: string; tokens: { total: number; [key: string]: number }; cost: { total: number; [key: string]: number } }) {
        logger.debugLargeJson('[SOCKET] Sending usage report:', report);
        this.socket.emit('usage-report', {
            key: report.key,
            sessionId: this.sessionId,
            tokens: report.tokens,
            cost: report.cost,
        }, (response) => {
            if (!response?.success) {
                logger.debug('[SOCKET] Usage report rejected by server', {
                    key: report.key,
                    sessionId: this.sessionId,
                    error: response?.error || 'unknown error',
                });
            }
        });
    }

    /**
     * Send usage data to the server
     */
    sendUsageData(usage: Usage, model?: string) {
        this.updateModelMetadata(model);

        const totalTokens = usage.input_tokens + usage.output_tokens + (usage.cache_creation_input_tokens || 0) + (usage.cache_read_input_tokens || 0);
        const costs = calculateCost(usage, model);

        this.sendUsageReport({
            key: 'claude-session',
            tokens: {
                total: totalTokens,
                input: usage.input_tokens,
                output: usage.output_tokens,
                cache_creation: usage.cache_creation_input_tokens || 0,
                cache_read: usage.cache_read_input_tokens || 0
            },
            cost: {
                total: costs.total,
                input: costs.input,
                output: costs.output
            }
        });
    }

    private updateModelMetadata(model?: string | null): void {
        const normalized = typeof model === 'string' ? model.trim() : '';
        if (!normalized) {
            return;
        }

        const currentModel = this.metadata?.model?.trim() ?? '';
        if (normalized === this.syncedModel && currentModel === normalized) {
            return;
        }

        this.syncedModel = normalized;
        this.updateMetadata((currentMetadata) => {
            if (currentMetadata.model === normalized) {
                return currentMetadata;
            }
            return {
                ...currentMetadata,
                model: normalized,
            };
        });
    }

    /**
     * Seed the session title from the first user message when no custom title exists.
     * Runs at most once per session; skipped when HAPPY_SESSION_TITLE was set at spawn
     * (copy/resume/DooTask), when a summary is already present, or when the user has
     * pinned the title. Subsequent AI-generated summaries still replace this seed.
     */
    private maybeSetInitialTitleFromUserText(text: string): void {
        if (this.initialTitleSet) return;

        const hasCustomTitle = !!this.metadata?.summary
            || !!this.metadata?.summaryPinned
            || !!process.env.HAPPY_SESSION_TITLE?.trim();
        if (hasCustomTitle) {
            this.initialTitleSet = true;
            return;
        }

        const normalized = text.trim().replace(/\s+/g, ' ');
        if (!normalized) return;

        const chars = [...normalized];
        const MAX_CODEPOINTS = 50;
        const title = chars.length <= MAX_CODEPOINTS
            ? normalized
            : chars.slice(0, MAX_CODEPOINTS).join('') + '…';

        this.initialTitleSet = true;
        this.updateMetadata((metadata) => {
            if (metadata.summary || metadata.summaryPinned) return metadata;
            return { ...metadata, summary: { text: title, updatedAt: Date.now() } };
        });
    }

    /**
     * Update session metadata
     * @param handler - Handler function that returns the updated metadata
     */
    updateMetadata(handler: (metadata: Metadata) => Metadata) {
        this.metadataLock.inLock(async () => {
            await backoff(async () => {
                const next = handler(this.metadata!); // Weird state if metadata is null - should never happen but here we are
                // A handler that changes nothing returns the metadata as it is: skip the round trip, so a
                // run of no-op updates (one per backfilled message) doesn't hold up the ones behind it
                if (next === this.metadata) {
                    return;
                }
                let updated = stripCapabilitiesFromMetadata(next);
                recordSessionBinding(this.sessionId, updated);
                const answer = await this.socket.emitWithAck('update-metadata', { sid: this.sessionId, expectedVersion: this.metadataVersion, metadata: encodeBase64(encrypt(this.encryptionKey, this.encryptionVariant, updated)) });
                if (answer.result === 'success') {
                    this.metadata = decrypt(this.encryptionKey, this.encryptionVariant, decodeBase64(answer.metadata));
                    this.metadataVersion = answer.version;
                    this.syncedModel = this.metadata?.model?.trim() || null;
                } else if (answer.result === 'version-mismatch') {
                    this.adoptServerMetadata(answer.metadata, answer.version);
                    throw new Error('Metadata version mismatch');
                } else if (answer.result === 'error') {
                    // Hard error - ignore
                }
            });
        });
    }


    /**
     * Update large session capability/autocomplete data stored separately from metadata.
     */
    updateCapabilities(handler: (capabilities: SessionCapabilities) => SessionCapabilities) {
        this.capabilitiesLock.inLock(async () => {
            await this.ensureCapabilitiesSeeded();
            await backoff(async () => {
                const updated = SessionCapabilitiesSchema.parse(handler(this.capabilities || {}));
                const answer = await this.socket.emitWithAck('update-capabilities', {
                    sid: this.sessionId,
                    expectedVersion: this.capabilitiesVersion,
                    payload: encodeBase64(encrypt(this.encryptionKey, this.encryptionVariant, updated))
                });
                if (answer.result === 'success') {
                    this.capabilities = this.decodeCapabilitiesPayload(answer.payload);
                    this.capabilitiesVersion = answer.version;
                } else if (answer.result === 'version-mismatch') {
                    if (answer.version > this.capabilitiesVersion && answer.payload) {
                        this.capabilitiesVersion = answer.version;
                        this.capabilities = this.decodeCapabilitiesPayload(answer.payload);
                    }
                    throw new Error('Capabilities version mismatch');
                } else if (answer.result === 'error') {
                    throw new Error('Capabilities update failed');
                }
            });
        });
    }

    /**
     * Update session agent state
     * @param handler - Handler function that returns the updated agent state
     */
    updateAgentState(handler: (metadata: AgentState) => AgentState) {
        logger.debugLargeJson('Updating agent state', this.agentState);
        this.agentStateLock.inLock(async () => {
            await backoff(async () => {
                let updated = handler(this.agentState || {});
                const answer = await this.socket.emitWithAck('update-state', { sid: this.sessionId, expectedVersion: this.agentStateVersion, agentState: updated ? encodeBase64(encrypt(this.encryptionKey, this.encryptionVariant, updated)) : null });
                if (answer.result === 'success') {
                    this.agentState = answer.agentState ? decrypt(this.encryptionKey, this.encryptionVariant, decodeBase64(answer.agentState)) : null;
                    this.agentStateVersion = answer.version;
                    logger.debug('Agent state updated', this.agentState);
                } else if (answer.result === 'version-mismatch') {
                    if (answer.version > this.agentStateVersion) {
                        this.agentStateVersion = answer.version;
                        this.agentState = answer.agentState ? decrypt(this.encryptionKey, this.encryptionVariant, decodeBase64(answer.agentState)) : null;
                    }
                    throw new Error('Agent state version mismatch');
                } else if (answer.result === 'error') {
                    // console.error('Agent state update error', answer);
                    // Hard error - ignore
                }
            });
        });
    }

    /**
     * Wait for both the HTTP outbox and socket buffer to flush.
     * Routes through sendSync to avoid concurrent flushOutbox() calls.
     */
    async flush(): Promise<void> {
        this.releaseHeldText(false);
        // Drain HTTP outbox through sendSync (serialized, no concurrent splice races)
        try {
            await this.sendSync.invalidateAndAwait();
        } catch (error) {
            logger.debug('[API] flush: outbox flush failed, some messages may be lost:', error);
        }

        // Then wait for socket buffer
        if (!this.socket.connected) {
            return;
        }
        return new Promise((resolve) => {
            this.socket.emit('ping', () => {
                resolve();
            });
            setTimeout(() => {
                resolve();
            }, 10000);
        });
    }

    async close() {
        logger.debug('[API] socket.close() called');
        this.releaseHeldText(false);
        // Drain pending outbox through sendSync (serialized — avoids concurrent
        // flushOutbox() calls that could splice the wrong messages).
        try {
            await this.sendSync.invalidateAndAwait();
        } catch (error) {
            logger.debug('[API] close: final outbox flush failed:', error);
        }
        this.sendSync.stop();
        this.socket.close();
    }
}
