import { render } from "ink";
import { Session } from "./session";
import { MessageBuffer } from "@/ui/ink/messageBuffer";
import { RemoteModeDisplay } from "@/ui/ink/RemoteModeDisplay";
import React from "react";
import { claudeRemote } from "./claudeRemote";
import { PermissionHandler } from "./utils/permissionHandler";
import { Future } from "@/utils/future";
import { cleanupStdinAfterInk } from "@/utils/terminalStdinCleanup";
import { Query, SDKAssistantMessage, SDKMessage, SDKResultMessage, SDKSystemMessage, SDKUserMessage } from "./sdk";
import type { SDKCommandInfo } from "./sdk/types";
import { formatClaudeMessageForInk } from "@/ui/messageFormatterInk";
import { isDebug } from "@/utils/env";
import { logger } from "@/ui/logger";
import { SDKToLogConverter } from "./utils/sdkToLogConverter";
import { PLAN_FAKE_REJECT } from "./sdk/prompts";
import { EnhancedMode } from "./loop";
import { RawJSONLines } from "@/claude/types";
import { OutgoingMessageQueue } from "./utils/OutgoingMessageQueue";
import { getToolName } from "./utils/getToolName";
import type { PermissionMode } from "@/api/types";
import type { QueueMessageContent } from "./runClaude";
import { buildClaudeSlashCommandMetadata } from "./utils/slashCommandMetadata";
import { enhancedModeRestartHash } from "./utils/enhancedModeHash";
import { inlinePreviewHtmlFileArgs } from "@/utils/previewHtmlFile";

interface PermissionsField {
    date: number;
    result: 'approved' | 'denied';
    mode?: 'default' | 'acceptEdits' | 'auto' | 'bypassPermissions' | 'plan';
    allowedTools?: string[];
}

export async function claudeRemoteLauncher(session: Session): Promise<'switch' | 'exit'> {
    logger.debug('[claudeRemoteLauncher] Starting remote launcher');

    // Check if we have a TTY for UI rendering
    const hasTTY = process.stdout.isTTY && process.stdin.isTTY;
    logger.debug(`[claudeRemoteLauncher] TTY available: ${hasTTY}`);

    // Configure terminal
    let messageBuffer = new MessageBuffer();
    let inkInstance: any = null;

    if (hasTTY) {
        console.clear();
        inkInstance = render(React.createElement(RemoteModeDisplay, {
            messageBuffer,
            logPath: isDebug() ? session.logPath : undefined,
            onExit: async () => {
                // Exit the entire client
                logger.debug('[remote]: Exiting client via Ctrl-C');
                if (!exitReason) {
                    exitReason = 'exit';
                }
                await abort();
            },
            onSwitchToLocal: () => {
                // Switch to local mode
                logger.debug('[remote]: Switching to local mode via double space');
                doSwitch();
            }
        }), {
            exitOnCtrlC: false,
            patchConsole: false
        });
    }

    // Handle abort
    let exitReason: 'switch' | 'exit' | null = null;
    let abortController: AbortController | null = null;
    let abortFuture: Future<void> | null = null;
    let currentQuery: Query | null = null;

    // graceful: stop the current turn but keep the subprocess warm for the next
    // message (stop button / ESC / pending "send now"). Default hard path tears
    // the process down — for switch / exit / interrupt fallback.
    async function abort(opts?: { graceful?: boolean }) {
        // Capture locally so a new query round can't overwrite mid-abort.
        const query = currentQuery;
        const controller = abortController;
        const future = abortFuture;

        // Idempotent: a hard abort already fired, just wait for completion.
        if (controller?.signal.aborted) {
            await future?.promise;
            return;
        }

        // Interrupt the current turn. The SDK also cancels in-flight can_use_tool
        // requests, rejecting pending permission prompts so Claude isn't blocked.
        let interrupted = false;
        if (query) {
            try {
                await Promise.race([
                    query.interrupt(),
                    new Promise<void>((_, reject) =>
                        setTimeout(() => reject(new Error('interrupt timeout')), 3000)
                    ),
                ]);
                interrupted = true;
                logger.debug('[remote]: interrupt() succeeded');
            } catch (e) {
                logger.debug('[remote]: interrupt() failed or timed out, falling back to SIGTERM', e);
            }
        }

        // Graceful: leave the process running — claudeRemote() handles the result,
        // calls onReady(), and waits on nextMessage() on the same warm process.
        if (interrupted && opts?.graceful) {
            return;
        }

        // Hard: SIGTERM (→ SIGKILL after 3s via query.ts cleanup) and unblock the
        // queue/stdin so claudeRemote() can return.
        if (controller && !controller.signal.aborted) {
            controller.abort();
        }

        await future?.promise;
    }

    async function doAbort() {
        logger.debug('[remote]: doAbort');
        await abort({ graceful: true });
    }

    async function doSwitch() {
        logger.debug('[remote]: doSwitch');
        if (!exitReason) {
            exitReason = 'switch';
        }
        await abort();
    }

    // When to abort
    session.client.rpcHandlerManager.registerHandler('abort', doAbort); // When abort clicked
    session.client.rpcHandlerManager.registerHandler('switch', doSwitch); // When switch clicked
    // Removed catch-all stdin handler - now handled by RemoteModeDisplay keyboard handlers

    // Create permission handler
    const permissionHandler = new PermissionHandler(session);
    const claudeModes = ['default', 'acceptEdits', 'plan', 'auto', 'bypassPermissions'] as const;
    const isClaudeMode = (m: PermissionMode | undefined): m is typeof claudeModes[number] =>
        !!m && (claudeModes as readonly string[]).includes(m);

    session.client.rpcHandlerManager.registerHandler<{ mode?: PermissionMode }, boolean>(
        'permission-mode-changed',
        async (payload) => {
            const mode = payload?.mode;
            if (!isClaudeMode(mode)) {
                logger.debug('[remote]: invalid permission mode via rpc', { mode });
                return false;
            }
            permissionHandler.handleModeChange(mode);
            logger.debug(`[remote]: permission mode updated via rpc to ${mode}`);
            return true;
        }
    );

    // Create outgoing message queue
    const messageQueue = new OutgoingMessageQueue(
        (logMessage) => session.client.sendClaudeSessionMessage(logMessage)
    );

    // Set up callback to release delayed messages when permission is requested
    permissionHandler.setOnPermissionRequest((toolCallId: string) => {
        messageQueue.releaseToolCall(toolCallId);
    });

    // Create SDK to Log converter (pass responses from permissions)
    const sdkToLogConverter = new SDKToLogConverter({
        sessionId: session.sessionId || 'unknown',
        cwd: session.path,
        version: process.env.npm_package_version
    }, permissionHandler.getResponses());


    // Sync model & reasoning effort into session metadata (mirrors Codex's syncSessionModelInfo)
    let currentSyncedModel: string | undefined;
    let currentSyncedEffort: string | undefined;
    // Tracks tools/slash commands already synced from system/init so we skip redundant updates
    let currentSyncedToolsSig: string | undefined;
    let currentSyncedSlashCommandsSig: string | undefined;
    let currentSyncedSlashCommandMetadataSig: string | undefined;
    function syncModelMetadata(mode: EnhancedMode) {
        const model = mode.model;
        const effort = mode.reasoningEffort;
        if (model === currentSyncedModel && effort === currentSyncedEffort) return;
        currentSyncedModel = model;
        currentSyncedEffort = effort;
        session.client.updateMetadata((m) => ({
            ...m,
            ...(model ? { model } : {}),
            ...(effort ? { reasoningEffort: effort } : {}),
        }));
    }

    // Handle messages
    let planModeToolCalls = new Set<string>();
    let ongoingToolCalls = new Map<string, { parentToolCallId: string | null }>();
    // Tracks whether the current turn produced any assistant message. Reset when a
    // new user prompt (not a tool_result) arrives — NOT on result, because the SDK
    // can keep emitting late-arriving assistant messages after `result` which would
    // otherwise poison the next turn's detection.
    // Used to surface result.result text when Claude Code emits only a result
    // (e.g. unknown slash command like `/foo` → result.result = "Unknown command: /foo").
    let hadAssistantMessage = false;

    // Effective context window as Claude Code sees it — honours /autocompact, --autocompact and
    // autoCompactWindow settings, so the app's usage bar matches when Claude will actually compact.
    // Lives in agentState rather than metadata: only the CLI writes agentState, so an app that
    // predates the field can't drop it by rewriting.
    let currentSyncedContextWindowSize: number | undefined;
    function syncContextWindowSize(query: Query) {
        query.getContextUsage()
            .then((usage) => {
                const size = usage?.maxTokens;
                if (!size || size <= 0 || size === currentSyncedContextWindowSize) return;
                currentSyncedContextWindowSize = size;
                session.client.updateAgentState((state) => ({ ...state, contextWindowSize: size }));
            })
            .catch((error) => logger.debug('[remote]: failed to sync context window size', error));
    }

    function syncInitCapabilities(init: SDKSystemMessage, sdkCommands: SDKCommandInfo[]) {
        const nextModel = init.model && init.model !== currentSyncedModel ? init.model : undefined;
        const toolsSig = init.tools ? JSON.stringify(init.tools) : undefined;
        const slashCommandsSig = init.slash_commands ? JSON.stringify(init.slash_commands) : undefined;
        const slashCommandMetadata = buildClaudeSlashCommandMetadata({
            slashCommands: init.slash_commands,
            skills: init.skills,
            plugins: init.plugins,
            sdkCommands,
            cwd: init.cwd,
        });
        const slashCommandMetadataSig = slashCommandMetadata ? JSON.stringify(slashCommandMetadata) : undefined;
        const toolsChanged = toolsSig !== undefined && toolsSig !== currentSyncedToolsSig;
        const slashCommandsChanged = slashCommandsSig !== undefined && slashCommandsSig !== currentSyncedSlashCommandsSig;
        const slashCommandMetadataChanged = slashCommandMetadataSig !== undefined && slashCommandMetadataSig !== currentSyncedSlashCommandMetadataSig;
        if (nextModel || toolsChanged || slashCommandsChanged || slashCommandMetadataChanged) {
            if (nextModel) currentSyncedModel = nextModel;
            if (toolsChanged) currentSyncedToolsSig = toolsSig;
            if (slashCommandsChanged) currentSyncedSlashCommandsSig = slashCommandsSig;
            if (slashCommandMetadataChanged) currentSyncedSlashCommandMetadataSig = slashCommandMetadataSig;
            if (nextModel) {
                session.client.updateMetadata((m) => ({
                    ...m,
                    model: nextModel,
                }));
            }
            if (toolsChanged || slashCommandsChanged || slashCommandMetadataChanged) {
                session.client.updateCapabilities((currentCapabilities) => ({
                    ...currentCapabilities,
                    ...(toolsChanged ? { tools: init.tools } : {}),
                    ...(slashCommandsChanged ? { slashCommands: init.slash_commands } : {}),
                    ...(slashCommandMetadataChanged ? { slashCommandMetadata } : {}),
                }));
            }
        }
    }

    function onMessage(message: SDKMessage) {

        // Write to message log
        formatClaudeMessageForInk(message, messageBuffer);

        // Sync capabilities from system/init: the actual model ID (e.g. "claude-opus-4-8[1m]",
        // lets the app pick the right context window) plus tools and slash commands for
        // autocomplete. The eager probe in runClaude populates these before the first message;
        // this keeps them correct/refreshed from the real session (and covers cases the probe misses).
        if (message.type === 'system' && (message as SDKSystemMessage).subtype === 'init') {
            const init = message as SDKSystemMessage;
            // system/init only carries command names. Ask Claude for descriptions too (built-in skills
            // have no file on disk to scan) before syncing; falls back to [] on error/timeout.
            const sdkCommands = currentQuery?.supportedCommands() ?? Promise.resolve([]);
            sdkCommands
                .then((commands) => syncInitCapabilities(init, commands))
                .catch((error) => logger.debug('[remote]: failed to sync init capabilities', error));
        }

        // Re-read after every turn: /autocompact or a model switch may have changed the window.
        if (currentQuery && (message.type === 'result' || (message.type === 'system' && (message as SDKSystemMessage).subtype === 'init'))) {
            syncContextWindowSize(currentQuery);
        }

        // Handle result messages with errors - send as session event
        if (message.type === 'result') {
            const resultMsg = message as SDKResultMessage;
            if (resultMsg.subtype === 'error_during_execution') {
                const terminalReason = (resultMsg as any).terminal_reason as string | undefined;
                // [ede_diagnostic] lines are Claude Code's internal post-abort noise,
                // never user-actionable. Drop them so the noise is never shown on its
                // own, yet a real error is never masked even if an abort coincided.
                const errors = ((resultMsg as any).errors as string[] | undefined ?? [])
                    .filter((e) => !e.includes('[ede_diagnostic]'));
                if (errors.length > 0) {
                    const errorText = errors.join('\n');
                    session.client.sendSessionEvent({ type: 'message', message: `Error: ${errorText}` });
                    logger.debug('[remote]: sent error_during_execution as session event', { errorCount: errors.length });
                } else if (abortController?.signal.aborted || terminalReason?.startsWith('aborted')) {
                    // Nothing left but abort noise — log only, don't show in UI.
                    logger.debug('[remote]: suppressing post-abort diagnostic', { terminalReason });
                } else {
                    session.client.sendSessionEvent({ type: 'message', message: 'An error occurred during execution' });
                }
            } else if (!hadAssistantMessage && typeof resultMsg.result === 'string' && resultMsg.result.length > 0) {
                // Unknown slash command path: Claude Code returns only a result with text
                // and no assistant stream, leaving the chat blank. Surface the text.
                session.client.sendSessionEvent({ type: 'message', message: resultMsg.result });
                logger.debug('[remote]: forwarded result text as session event (no assistant output this turn)');
            }
            // Result messages don't need further processing (not part of conversation log)
            return;
        }

        // Write to permission handler for tool id resolving
        permissionHandler.onMessage(message);

        if (message.type === 'assistant') {
            hadAssistantMessage = true;
        }

        // Detect plan mode tool call
        if (message.type === 'assistant') {
            let umessage = message as SDKAssistantMessage;
            if (umessage.message.content && Array.isArray(umessage.message.content)) {
                for (let c of umessage.message.content) {
                    if (c.type === 'tool_use' && (c.name === 'exit_plan_mode' || c.name === 'ExitPlanMode')) {
                        logger.debug('[remote]: detected plan mode tool call ' + c.id!);
                        planModeToolCalls.add(c.id! as string);
                    }
                }
            }
        }

        // Track active tool calls
        if (message.type === 'assistant') {
            let umessage = message as SDKAssistantMessage;
            if (umessage.message.content && Array.isArray(umessage.message.content)) {
                for (let c of umessage.message.content) {
                    if (c.type === 'tool_use') {
                        logger.debug('[remote]: detected tool use ' + c.id! + ' parent: ' + umessage.parent_tool_use_id);
                        ongoingToolCalls.set(c.id!, { parentToolCallId: umessage.parent_tool_use_id ?? null });
                    }
                }
            }
        }
        if (message.type === 'user') {
            let umessage = message as SDKUserMessage;
            const content = umessage.message.content;
            if (typeof content === 'string') {
                // Fresh user prompt (string form) — starts a new turn.
                hadAssistantMessage = false;
            } else if (Array.isArray(content)) {
                let hasToolResult = false;
                let hasNonToolResult = false;
                for (let c of content) {
                    if (c.type === 'tool_result' && c.tool_use_id) {
                        hasToolResult = true;
                        ongoingToolCalls.delete(c.tool_use_id);

                        // When tool result received, release any delayed messages for this tool call
                        messageQueue.releaseToolCall(c.tool_use_id);
                    } else {
                        hasNonToolResult = true;
                    }
                }
                // If this user message has any non-tool-result content (text/image/etc.)
                // and no tool_result, it's a fresh user prompt — reset per-turn tracking.
                if (hasNonToolResult && !hasToolResult) {
                    hadAssistantMessage = false;
                }
            }
        }

        // Convert SDK message to log format and send to client
        let msg = message;

        // Hack plan mode exit
        if (message.type === 'user') {
            let umessage = message as SDKUserMessage;
            if (umessage.message.content && Array.isArray(umessage.message.content)) {
                msg = {
                    ...umessage,
                    message: {
                        ...umessage.message,
                        content: umessage.message.content.map((c) => {
                            if (c.type === 'tool_result' && c.tool_use_id && planModeToolCalls.has(c.tool_use_id!)) {
                                if (c.content === PLAN_FAKE_REJECT) {
                                    logger.debug('[remote]: hack plan mode exit');
                                    logger.debugLargeJson('[remote]: hack plan mode exit', c);
                                    return {
                                        ...c,
                                        is_error: false,
                                        content: 'Plan approved',
                                        mode: c.mode
                                    }
                                } else {
                                    return c;
                                }
                            }
                            return c;
                        })
                    }
                }
            }
        }

        // Inline preview_html documents that were passed as a file path, so the client receives
        // the document itself instead of a path it has no way to read.
        if (msg.type === 'assistant') {
            const amessage = msg as SDKAssistantMessage;
            if (Array.isArray(amessage.message.content)) {
                let inlined = false;
                const content = amessage.message.content.map((c) => {
                    if (c.type !== 'tool_use') return c;
                    const input = inlinePreviewHtmlFileArgs(c.name, c.input as Record<string, unknown> | undefined);
                    if (input === c.input) return c;
                    inlined = true;
                    return { ...c, input };
                });
                if (inlined) {
                    msg = { ...amessage, message: { ...amessage.message, content } };
                }
            }
        }

        const logMessage = sdkToLogConverter.convert(msg);
        if (logMessage) {
            // Add permissions field to tool result content
            if (logMessage.type === 'user' && logMessage.message?.content) {
                const content = Array.isArray(logMessage.message.content)
                    ? logMessage.message.content
                    : [];

                // Modify the content array to add permissions to each tool_result
                for (let i = 0; i < content.length; i++) {
                    const c = content[i];
                    if (c.type === 'tool_result' && c.tool_use_id) {
                        const responses = permissionHandler.getResponses();
                        const response = responses.get(c.tool_use_id);

                        if (response) {
                            const permissions: PermissionsField = {
                                date: response.receivedAt || Date.now(),
                                result: response.approved ? 'approved' : 'denied'
                            };

                            // Add optional fields if they exist
                            if (response.mode) {
                                permissions.mode = response.mode;
                            }

                            if (response.allowTools && response.allowTools.length > 0) {
                                permissions.allowedTools = response.allowTools;
                            }

                            // Add permissions directly to the tool_result content object
                            content[i] = {
                                ...c,
                                permissions
                            };
                        }
                    }
                }
            }

            // Queue message with optional delay for tool calls
            if (logMessage.type === 'assistant' && message.type === 'assistant') {
                const assistantMsg = message as SDKAssistantMessage;
                const toolCallIds: string[] = [];

                if (assistantMsg.message.content && Array.isArray(assistantMsg.message.content)) {
                    for (const block of assistantMsg.message.content) {
                        if (block.type === 'tool_use' && block.id) {
                            toolCallIds.push(block.id);
                        }
                    }
                }

                if (toolCallIds.length > 0) {
                    // Check if this is a sidechain tool call (has parent_tool_use_id)
                    const isSidechain = assistantMsg.parent_tool_use_id !== undefined;

                    if (!isSidechain) {
                        // Top-level tool call - queue with delay
                        messageQueue.enqueue(logMessage, {
                            delay: 250,
                            toolCallIds
                        });
                        return; // Don't queue again below
                    }
                }
            }

            // Queue all other messages immediately (no delay)
            messageQueue.enqueue(logMessage);
        }

        // Insert a fake message to start the sidechain
        if (message.type === 'assistant') {
            let umessage = message as SDKAssistantMessage;
            if (umessage.message.content && Array.isArray(umessage.message.content)) {
                for (let c of umessage.message.content) {
                    if (c.type === 'tool_use' && c.name === 'Task' && c.input && typeof (c.input as any).prompt === 'string') {
                        const logMessage2 = sdkToLogConverter.convertSidechainUserMessage(c.id!, (c.input as any).prompt);
                        if (logMessage2) {
                            messageQueue.enqueue(logMessage2);
                        }
                    }
                }
            }
        }
    }

    try {
        let pending: {
            message: QueueMessageContent;
            mode: EnhancedMode;
            hash: string;
        } | null = null;

        // Track session ID to detect when it actually changes
        // This prevents context loss when mode changes (permission mode, model, etc.)
        // without starting a new session. Only reset parent chain when session ID
        // actually changes (e.g., new session started or /clear command used).
        // See: https://github.com/anthropics/happy-cli/issues/143
        let previousSessionId: string | null = null;
        while (!exitReason) {
            logger.debug('[remote]: launch');
            messageBuffer.addMessage('═'.repeat(40), 'status');

            // Only reset parent chain and show "new session" message when session ID actually changes
            const isNewSession = session.sessionId !== previousSessionId;
            if (isNewSession) {
                messageBuffer.addMessage('Starting new Claude session...', 'status');
                permissionHandler.reset(); // Reset permissions before starting new session
                sdkToLogConverter.resetParentChain(); // Reset parent chain for new conversation
                logger.debug(`[remote]: New session detected (previous: ${previousSessionId}, current: ${session.sessionId})`);
            } else {
                messageBuffer.addMessage('Continuing Claude session...', 'status');
                logger.debug(`[remote]: Continuing existing session: ${session.sessionId}`);
            }

            previousSessionId = session.sessionId;
            const controller = new AbortController();
            abortController = controller;
            abortFuture = new Future<void>();
            let modeHash: string | null = null;
            let mode: EnhancedMode | null = null;
            try {
                const remoteResult = await claudeRemote({
                    sessionId: session.sessionId,
                    path: session.path,
                    allowedTools: session.allowedTools ?? [],
                    mcpServers: session.mcpServers,
                    hookSettingsPath: session.hookSettingsPath,
                    jsRuntime: session.jsRuntime,
                    canCallTool: permissionHandler.handleToolCall,
                    isAborted: (toolCallId: string) => {
                        return permissionHandler.isAborted(toolCallId);
                    },
                    nextMessage: async () => {
                        if (pending) {
                            let p = pending;
                            pending = null;
                            // The subprocess is being spawned with this mode — make it the
                            // baseline so the next mode change is detected against it.
                            modeHash = p.hash;
                            mode = p.mode;
                            permissionHandler.handleModeChange(p.mode.permissionMode);
                            syncModelMetadata(p.mode);
                            return p;
                        }

                        let msg = await session.queue.waitForMessagesAndGetAsString(controller.signal);

                        // Check if mode has changed
                        if (msg) {
                            const modeChanged = (modeHash !== null && msg.hash !== modeHash) || msg.isolate;
                            if (modeChanged) {
                                // Model and permission mode (incl. plan) changes are applied to the
                                // warm subprocess — set_model here, set_permission_mode via
                                // handleModeChange below — no respawn, no context reload. Any other
                                // change (effort, system prompt, tools) or a failed/hung set_model
                                // still goes through the restart path.
                                const hotSwapped = !msg.isolate && mode !== null && currentQuery !== null
                                    && enhancedModeRestartHash(mode) === enhancedModeRestartHash(msg.mode)
                                    && (mode.model === msg.mode.model || await Promise.race([
                                        currentQuery.setModel(msg.mode.model),
                                        new Promise<never>((_, reject) =>
                                            setTimeout(() => reject(new Error('set_model timeout')), 3000)
                                        ),
                                    ]).then(() => true, (e) => {
                                        logger.debug('[remote]: set_model failed, falling back to restart', e);
                                        return false;
                                    }));
                                if (!hotSwapped) {
                                    logger.debug('[remote]: mode has changed, pending message');
                                    pending = msg;
                                    return null;
                                }
                                logger.debug(`[remote]: mode hot-swapped (model: ${msg.mode.model ?? 'default'}, permissionMode: ${msg.mode.permissionMode})`);
                            }
                            modeHash = msg.hash;
                            mode = msg.mode;
                            permissionHandler.handleModeChange(mode.permissionMode);
                            syncModelMetadata(mode);
                            return {
                                message: msg.message,
                                mode: msg.mode
                            }
                        }

                        // Exit
                        return null;
                    },
                    onSessionFound: (sessionId) => {
                        // Update converter's session ID when new session is found
                        sdkToLogConverter.updateSessionId(sessionId);
                        session.onSessionFound(sessionId);
                    },
                    onThinkingChange: session.onThinkingChange,
                    claudeEnvVars: session.claudeEnvVars,
                    claudeArgs: session.claudeArgs,
                    onMessage,
                    onCompletionEvent: (message: string) => {
                        logger.debug(`[remote]: Completion event: ${message}`);
                        session.client.sendSessionEvent({ type: 'message', message });
                    },
                    onSessionReset: () => {
                        logger.debug('[remote]: Session reset');
                        session.clearSessionId();
                    },
                    onQueryCreated: (q) => {
                        currentQuery = q;
                        permissionHandler.setModeForwarder(async (mode) => {
                            if (isClaudeMode(mode)) await q.setPermissionMode(mode);
                        });
                    },
                    onReady: () => {
                        if (!pending && session.queue.size() === 0) {
                            session.client.sendSessionEvent({ type: 'ready' });
                            session.api.push().sendCompletionToAllDevices(
                                'It\'s ready!',
                                `Claude is waiting for your command`,
                                { sessionId: session.client.sessionId }
                            );
                            // Flush outbox before setting taskCompleted so tool_result
                            // messages arrive at the app before the agentState update.
                            // Without this, taskCompleted (sent via Socket.IO) can race
                            // ahead of tool_result (sent via HTTP outbox), causing the
                            // app's recovery logic to show a false "ended without result".
                            session.client.flush().finally(() => {
                                session.client.updateAgentState((state) => ({
                                    ...state,
                                    taskCompleted: Date.now()
                                }));
                            });
                        }
                    },
                    signal: abortController.signal,
                });
                
                // Consume one-time Claude flags after spawn
                session.consumeOneTimeFlags();
                
                if (!exitReason && abortController.signal.aborted) {
                    session.client.sendSessionEvent({ type: 'message', message: 'Aborted by user' });
                }
            } catch (e) {
                const errorMessage = e instanceof Error ? e.message : String(e);
                logger.debug('[remote]: launch error', e);
                if (!exitReason) {
                    session.client.sendSessionEvent({ type: 'message', message: `Process exited unexpectedly: ${errorMessage}` });
                    continue;
                }
            } finally {

                logger.debug('[remote]: launch finally');
                currentQuery = null;
                permissionHandler.setModeForwarder(undefined);

                // Terminate all ongoing tool calls
                for (let [toolCallId, { parentToolCallId }] of ongoingToolCalls) {
                    const converted = sdkToLogConverter.generateInterruptedToolResult(toolCallId, parentToolCallId);
                    if (converted) {
                        logger.debug('[remote]: terminating tool call ' + toolCallId + ' parent: ' + parentToolCallId);
                        session.client.sendClaudeSessionMessage(converted);
                    }
                }
                ongoingToolCalls.clear();

                // Flush any remaining messages in the queue
                logger.debug('[remote]: flushing message queue');
                await messageQueue.flush();
                messageQueue.destroy();
                logger.debug('[remote]: message queue flushed');

                // Reset abort controller and future
                abortController = null;
                abortFuture?.resolve(undefined);
                abortFuture = null;
                logger.debug('[remote]: launch done');
                permissionHandler.reset();
                modeHash = null;
                mode = null;
            }
        }
    } finally {

        // Clean up permission handler
        permissionHandler.reset();

        // Reset Terminal — hand stdin cleanly back to the next consumer.
        // Unmount Ink FIRST: it restores its own stdin state (raw mode, key
        // listeners) during teardown, so that must run before we touch stdin.
        if (inkInstance) {
            inkInstance.unmount();
        }
        // Drain keystrokes buffered while Ink owned stdin (the extra spaces from
        // the double-space switch, or anything typed during the switch delay) so
        // they don't leak into the next interactive child via stdio: 'inherit'.
        // Raw mode is kept on through the drain only when we hand off to local
        // mode (claude re-asserts raw itself, avoiding a cooked-echo race); on a
        // full exit we restore cooked mode so the user's shell stays usable.
        await cleanupStdinAfterInk({
            stdin: process.stdin,
            drainMs: 150,
            leaveRawMode: exitReason === 'switch',
            onDebug: ({ bytes, chunks }) => logger.debug(`[remote] drained ${bytes}B / ${chunks} chunk(s) from stdin before handoff`),
        });
        messageBuffer.clear();
        session.queue.setOnMessage(null);

        // Resolve abort future
        if (abortFuture) { // Just in case of error
            abortFuture.resolve(undefined);
        }
    }

    return exitReason || 'exit';
}
