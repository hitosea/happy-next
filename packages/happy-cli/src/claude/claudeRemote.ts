import { EnhancedMode } from "./loop";
import { Query, query, type QueryOptions, type SDKMessage, type SDKSystemMessage, AbortError, SDKUserMessage } from '@/claude/sdk'
import { mapToClaudeMode } from "./utils/permissionMode";
import { claudeCheckSession } from "./utils/claudeCheckSession";
import { join, resolve } from 'node:path';
import { projectPath } from "@/projectPath";
import { parseSpecialCommand } from "@/parsers/specialCommands";
import { logger } from "@/lib";
import { PushableAsyncIterable } from "@/utils/PushableAsyncIterable";
import { getProjectPath } from "./utils/path";
import { awaitFileExist } from "@/modules/watcher/awaitFileExist";
import { systemPrompt } from "./utils/systemPrompt";
import { PermissionResult } from "./sdk/types";
import type { JsRuntime } from "./runClaude";
import { formatMessageForClaude, ClaudeContent } from '@/utils/formatImageMessage';
import { ImageContent } from '@/api/types';
import type { PendingSteerAck } from 'happy-wire';
import { randomUUID } from 'node:crypto';

/** A message the app sent, as the caller's queue holds it */
export type ClaudeRemoteMessage = string | { type: 'text'; text: string } | { type: 'mixed'; text: string; images: ImageContent[] };

/** Takes a queued message into the running turn ("插话") */
export type ClaudeSteer = (message: ClaudeRemoteMessage, pendingId: string) => Promise<PendingSteerAck>;

/**
 * How long a turn's end waits for Claude to start the messages steered into it that it had not
 * taken yet: Claude runs them as a turn of their own straight after, so this only guards against
 * one that never comes.
 */
const STEERED_TURN_START_TIMEOUT_MS = 30_000;

export async function claudeRemote(opts: {

    // Fixed parameters
    sessionId: string | null,
    path: string,
    mcpServers?: Record<string, any>,
    claudeEnvVars?: Record<string, string>,
    claudeArgs?: string[],
    allowedTools: string[],
    signal?: AbortSignal,
    canCallTool: (toolName: string, input: unknown, mode: EnhancedMode, options: { signal: AbortSignal }) => Promise<PermissionResult>,
    /** Path to temporary settings file with SessionStart hook (required for session tracking) */
    hookSettingsPath: string,
    /** JavaScript runtime to use for spawning Claude Code (default: 'node') */
    jsRuntime?: JsRuntime,

    // Dynamic parameters
    nextMessage: () => Promise<{ message: ClaudeRemoteMessage, mode: EnhancedMode } | null>,
    onReady: () => void,
    /** Hands on messages the caller still holds back, so they leave ahead of the idle heartbeat. */
    flushOutgoing?: () => Promise<void>,
    /** Claude has ended a turn and its messages have been handed on; whatever it sends next is a new one. */
    onTurnEnd?: () => void,
    isAborted: (toolCallId: string) => boolean,

    // Callbacks
    onSessionFound: (id: string) => void,
    onThinkingChange?: (thinking: boolean) => void,
    onMessage: (message: SDKMessage) => void,
    onCompletionEvent?: (message: string) => void,
    onSessionReset?: () => void,
    /** Called when the SDK Query instance is created, allowing the caller to call interrupt() */
    onQueryCreated?: (query: Query) => void,
    /**
     * This Claude can take messages into the running turn, through `steer`; null once it has
     * exited. Claude tells its input's lifecycle only from some version on, so this comes with
     * the first message it reports.
     */
    onSteerChange?: (steer: ClaudeSteer | null) => void,
    /** A steered message was taken in by Claude, or dropped as Claude exited without it */
    onSteerResult?: (pendingId: string, outcome: 'read' | 'dropped') => void,
}) {

    // Check if session is valid
    let startFrom = opts.sessionId;
    if (opts.sessionId && !claudeCheckSession(opts.sessionId, opts.path)) {
        startFrom = null;
    }
    
    // Extract --resume and --fork-session from claudeArgs if present (for first spawn)
    let forkSession = false;
    if (opts.claudeArgs) {
        // Check for --fork-session flag
        if (opts.claudeArgs.includes('--fork-session')) {
            forkSession = true;
            logger.debug('[claudeRemote] Found --fork-session flag');
        }

        // Extract --resume if not already set
        if (!startFrom) {
            for (let i = 0; i < opts.claudeArgs.length; i++) {
                if (opts.claudeArgs[i] === '--resume') {
                    // Check if next arg exists and looks like a session ID
                    if (i + 1 < opts.claudeArgs.length) {
                        const nextArg = opts.claudeArgs[i + 1];
                        // If next arg doesn't start with dash and contains dashes, it's likely a UUID
                        if (!nextArg.startsWith('-') && nextArg.includes('-')) {
                            startFrom = nextArg;
                            logger.debug(`[claudeRemote] Found --resume with session ID: ${startFrom}`);
                            break;
                        } else {
                            // Just --resume without UUID - SDK doesn't support this
                            logger.debug('[claudeRemote] Found --resume without session ID - not supported in remote mode');
                            break;
                        }
                    } else {
                        // --resume at end of args - SDK doesn't support this
                        logger.debug('[claudeRemote] Found --resume without session ID - not supported in remote mode');
                        break;
                    }
                }
            }
        }
    }

    // Set environment variables for Claude Code SDK
    if (opts.claudeEnvVars) {
        Object.entries(opts.claudeEnvVars).forEach(([key, value]) => {
            process.env[key] = value;
        });
    }

    // Get initial message
    const initial = await opts.nextMessage();
    if (!initial) { // No initial message - exit
        return;
    }

    // Extract text from message for special command parsing
    const initialText = typeof initial.message === 'string'
        ? initial.message
        : initial.message.text;

    // Handle special commands
    const specialCommand = parseSpecialCommand(initialText);

    // Handle /clear command
    if (specialCommand.type === 'clear') {
        if (opts.onCompletionEvent) {
            opts.onCompletionEvent('Context was reset');
        }
        if (opts.onSessionReset) {
            opts.onSessionReset();
        }
        // Immediately signal thinking=false so the server clears awaitingTurnStart
        // without waiting for the next 2s heartbeat interval. This prevents
        // subsequent messages from being unnecessarily queued as pending.
        if (opts.onThinkingChange) {
            opts.onThinkingChange(false);
        }
        return;
    }

    // Handle /compact command
    let isCompactCommand = false;
    // Tracks whether the engine rejected the compaction. The trailing `result`
    // message reports subtype 'success' even when compaction was refused (e.g.
    // "Not enough messages to compact"), so success/failure must be read from the
    // dedicated system/status message instead — see the message loop below.
    let compactFailed = false;
    // Whether the engine is compacting right now, manual or auto.
    let compacting = false;
    if (specialCommand.type === 'compact') {
        logger.debug('[claudeRemote] /compact command detected - will process as normal but with compaction behavior');
        isCompactCommand = true;
        if (opts.onCompletionEvent) {
            opts.onCompletionEvent('Compaction started');
        }
    }

    // Prepare SDK options
    let mode = initial.mode;
    const sdkOptions: QueryOptions = {
        cwd: opts.path,
        resume: startFrom ?? undefined,
        forkSession: forkSession || undefined,
        mcpServers: opts.mcpServers,
        permissionMode: mapToClaudeMode(initial.mode.permissionMode),
        model: initial.mode.model,
        effort: initial.mode.reasoningEffort,
        autoCompactWindow: initial.mode.contextWindow,
        fallbackModel: initial.mode.fallbackModel,
        customSystemPrompt: initial.mode.customSystemPrompt ? initial.mode.customSystemPrompt + '\n\n' + systemPrompt : undefined,
        appendSystemPrompt: initial.mode.appendSystemPrompt ? initial.mode.appendSystemPrompt + '\n\n' + systemPrompt : systemPrompt,
        allowedTools: initial.mode.allowedTools ? initial.mode.allowedTools.concat(opts.allowedTools) : opts.allowedTools,
        disallowedTools: initial.mode.disallowedTools,
        canCallTool: (toolName: string, input: unknown, options: { signal: AbortSignal }) => opts.canCallTool(toolName, input, mode, options),
        executable: opts.jsRuntime ?? 'node',
        abort: opts.signal,
        pathToClaudeCodeExecutable: (() => {
            return resolve(join(projectPath(), 'scripts', 'claude_remote_launcher.cjs'));
        })(),
        settingsPath: opts.hookSettingsPath,
    }

    // Track thinking state
    let thinking = false;
    const updateThinking = (newThinking: boolean) => {
        if (thinking !== newThinking) {
            thinking = newThinking;
            logger.debug(`[claudeRemote] Thinking state changed to: ${thinking}`);
            if (opts.onThinkingChange) {
                opts.onThinkingChange(thinking);
            }
        }
    };

    // Push initial message
    let messages = new PushableAsyncIterable<SDKUserMessage>();

    // Normalize queue message payloads into Claude SDK content format
    const toClaudeMessageContent = async (message: ClaudeRemoteMessage): Promise<string | ClaudeContent[]> => {
        if (typeof message === 'object' && 'type' in message) {
            if (message.type === 'mixed') {
                return formatMessageForClaude(message.text, message.images);
            }
            return message.text;
        }
        return message;
    };

    const initialMessageContent = await toClaudeMessageContent(initial.message);

    // Every message goes with an id, which Claude reports it under as it queues and starts it
    messages.push({
        type: 'user',
        uuid: randomUUID(),
        message: {
            role: 'user',
            content: initialMessageContent,
        },
    });

    // Steered messages Claude has not started yet: their input id → their pending id
    const unreadSteers = new Map<string, string>();
    let steerSupported = false;
    // A turn's end held back while Claude has steered messages still to start
    let heldTurnEnd: NodeJS.Timeout | null = null;
    // From the turn's result until the next one starts: a message steered then would start a turn
    // of its own after the turn was reported over
    let turnFinishing = false;
    const steer: ClaudeSteer = async (message, pendingId) => {
        const text = typeof message === 'string' ? message : message.text;
        // Commands act on the session rather than talk to Claude: they wait for their turn in the queue
        if (text.trimStart().startsWith('/')) return { accepted: false, reason: 'command' };
        const content = await toClaudeMessageContent(message);
        if (!thinking || turnFinishing || streamEnded) return { accepted: false, reason: 'not_running' };
        if (compacting) return { accepted: false, reason: 'compacting' };
        const uuid = randomUUID();
        unreadSteers.set(uuid, pendingId);
        messages.push({ type: 'user', uuid, message: { role: 'user', content } });
        return { accepted: true };
    };

    let awaitingNextUserMessage = false;
    let streamEnded = false;
    const pumpNextUserMessage = async (): Promise<void> => {
        if (awaitingNextUserMessage || streamEnded) {
            return;
        }
        awaitingNextUserMessage = true;
        try {
            while (!streamEnded) {
                const next = await opts.nextMessage();
                if (!next) {
                    streamEnded = true;
                    messages.end();
                    return;
                }
                mode = next.mode;
                try {
                    const messageContent = await toClaudeMessageContent(next.message);
                    messages.push({
                        type: 'user',
                        uuid: randomUUID(),
                        message: {
                            role: 'user',
                            content: messageContent
                        }
                    });
                    return;
                } catch (formatError) {
                    logger.debug('[claudeRemote] Failed to format user message', formatError);
                    if (opts.onCompletionEvent) {
                        opts.onCompletionEvent('Failed to process message attachments. Please try again.');
                    }
                    opts.onReady();
                }
            }
        } catch (error) {
            logger.debug('[claudeRemote] Failed to fetch next user message', error);
            streamEnded = true;
            messages.end();
        } finally {
            awaitingNextUserMessage = false;
        }
    };

    // The turn is over: its messages are handed on, then Claude is reported idle
    const finishTurn = async () => {
        turnFinishing = true;
        // The turn's last messages can still sit in the caller's outgoing queue:
        // hand them on first, or idle reaches the app ahead of them.
        await opts.flushOutgoing?.();
        opts.onTurnEnd?.();
        updateThinking(false);
        logger.debug('[claudeRemote] Result received, waiting for next user message');

        // Send completion messages. Only report success when the engine
        // actually compacted; otherwise the engine already surfaced the
        // reason as its own message, so we just close the started/ended
        // pair with a truthful status instead of a misleading "completed".
        if (isCompactCommand) {
            const completionMessage = compactFailed ? 'Compaction failed' : 'Compaction completed';
            logger.debug(`[claudeRemote] ${completionMessage}`);
            if (opts.onCompletionEvent) {
                opts.onCompletionEvent(completionMessage);
            }
            isCompactCommand = false;
            compactFailed = false;
        }

        // Send ready event
        opts.onReady();

        // Keep consuming SDK output while waiting for next user message.
        // Waiting inline here can block late-arriving events (task notifications, tool outputs)
        // until the user sends another message.
        void pumpNextUserMessage();
    };

    const dropUnreadSteers = () => {
        for (const pendingId of unreadSteers.values()) {
            opts.onSteerResult?.(pendingId, 'dropped');
        }
        unreadSteers.clear();
    };

    // Start the loop
    const response = query({
        prompt: messages,
        options: sdkOptions,
    });

    // Expose Query instance so the caller can call interrupt() for graceful abort
    opts.onQueryCreated?.(response);

    updateThinking(true);
    try {
        logger.debug(`[claudeRemote] Starting to iterate over response`);

        for await (const message of response) {
            logger.debugLargeJson(`[claudeRemote] Message ${message.type}`, message);

            // Claude's word on the messages it was sent: queued, started (taken in), completed
            if (message.type === 'command_lifecycle') {
                if (!steerSupported) {
                    steerSupported = true;
                    opts.onSteerChange?.(steer);
                }
                const pendingId = unreadSteers.get(message.command_uuid as string);
                if (message.state === 'started' && pendingId) {
                    unreadSteers.delete(message.command_uuid as string);
                    // On the wall after everything Claude produced before taking it in
                    await opts.flushOutgoing?.();
                    opts.onSteerResult?.(pendingId, 'read');
                    if (heldTurnEnd && unreadSteers.size === 0) {
                        clearTimeout(heldTurnEnd);
                        heldTurnEnd = null;
                    }
                }
                continue;
            }

            // Handle messages
            opts.onMessage(message);

            // Handle special system messages
            if (message.type === 'system' && message.subtype === 'init') {
                // Start thinking when session initializes
                turnFinishing = false;
                updateThinking(true);

                const systemInit = message as SDKSystemMessage;

                // Session id is still in memory, wait until session file is written to disk
                // Start a watcher for to detect the session id
                if (systemInit.session_id) {
                    logger.debug(`[claudeRemote] Waiting for session file to be written to disk: ${systemInit.session_id}`);
                    const projectDir = getProjectPath(opts.path);
                    const found = await awaitFileExist(join(projectDir, `${systemInit.session_id}.jsonl`));
                    logger.debug(`[claudeRemote] Session file found: ${systemInit.session_id} ${found}`);
                    opts.onSessionFound(systemInit.session_id);
                }
            }

            // Compaction reports itself through system/status messages: `status: 'compacting'`
            // when it starts (repeated every ~30s with progress), then one carrying
            // `compact_result` when it ends. The later `result` message is 'success'
            // regardless, so `compact_result` is the only reliable signal of a refusal.
            if (message.type === 'system' && (message as { subtype?: string }).subtype === 'status') {
                const status = message as { status?: string | null, compact_result?: string };
                // Auto-compaction has no command to announce it, so the first progress
                // message does — mirroring the started/ended pair a manual /compact gets.
                // Flush first so the notice lands after the messages that led up to it.
                if (status.status === 'compacting' && !compacting && !isCompactCommand) {
                    await opts.flushOutgoing?.();
                    opts.onCompletionEvent?.('Compaction started');
                }
                compacting = status.status === 'compacting';
                if (status.compact_result === 'failed') {
                    compactFailed = true;
                }
                if (status.compact_result !== undefined && !isCompactCommand) {
                    opts.onCompletionEvent?.(compactFailed ? 'Compaction failed' : 'Compaction completed');
                    compactFailed = false;
                }
            }

            // Handle result messages
            if (message.type === 'result') {
                if (unreadSteers.size > 0) {
                    // Claude starts the steered messages it has not taken as a turn of their own
                    // straight after: the turn goes on, and only if none comes is it over.
                    logger.debug(`[claudeRemote] Result with ${unreadSteers.size} steered message(s) to start; holding the turn end`);
                    heldTurnEnd = setTimeout(() => {
                        heldTurnEnd = null;
                        dropUnreadSteers();
                        void finishTurn();
                    }, STEERED_TURN_START_TIMEOUT_MS);
                } else {
                    await finishTurn();
                }
            }

            // Handle tool result
            if (message.type === 'user') {
                const msg = message as SDKUserMessage;
                if (msg.message.role === 'user' && Array.isArray(msg.message.content)) {
                    for (let c of msg.message.content) {
                        if (c.type === 'tool_result' && c.tool_use_id && opts.isAborted(c.tool_use_id)) {
                            logger.debug('[claudeRemote] Tool aborted, exiting claudeRemote');
                            return;
                        }
                    }
                }
            }
        }
    } catch (e) {
        if (e instanceof AbortError) {
            logger.debug(`[claudeRemote] Aborted`);
            // Ignore
        } else {
            throw e;
        }
    } finally {
        if (heldTurnEnd) clearTimeout(heldTurnEnd);
        opts.onSteerChange?.(null);
        dropUnreadSteers();
        updateThinking(false);
    }
}
