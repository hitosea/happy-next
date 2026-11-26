/**
 * DeepSeek CLI Entry Point
 *
 * Runs DeepSeek Harness (`dsh --profile acp`) as a Happy session:
 * - Model and reasoning effort switch in place via ACP `session/set_config_option`.
 * - Permission modes map to `DSH_PERMISSION_MODE` (`default` -> `workspace-write`,
 *   `read-only` / `plan` -> `read-only`, `yolo` -> `danger-full-access`). Switching
 *   between different sandbox presets cleanly restarts `dsh` and restores the exact
 *   conversation with ACP `session/resume`.
 * - Interactive `AskUserQuestion` and `/plan` + `ExitPlanMode` are bridged via Happy's
 *   HTTP MCP server (`mcp__happy__ask_user_question`, `mcp__happy__exit_plan_mode`) so
 *   the app renders its native question and plan review cards with zero DSH private hacks.
 */

import { render } from 'ink';
import React from 'react';
import { randomUUID } from 'node:crypto';
import type { SessionConfigOption } from '@agentclientprotocol/sdk';
import { isPermissionModeForAgent, type DeepSeekPermissionMode } from 'happy-wire';

import { ApiClient } from '@/api/api';
import { logger } from '@/ui/logger';
import { isDebug } from '@/utils/env';
import { Credentials, readSettings } from '@/persistence';
import { createSessionMetadata } from '@/utils/createSessionMetadata';
import { initialMachineMetadata } from '@/daemon/run';
import { MessageQueue2 } from '@/utils/MessageQueue2';
import { hashObject } from '@/utils/deterministicJson';
import { createMcpContext } from '@/agent/mcp';
import { inlinePreviewHtmlFileArgs } from '@/utils/previewHtmlFile';
import { MessageBuffer } from '@/ui/ink/messageBuffer';
import { notifyDaemonSessionStarted } from '@/daemon/controlClient';
import { registerKillSessionHandler } from '@/claude/registerKillSessionHandler';
import { stopCaffeinate } from '@/utils/caffeinate';
import { connectionState } from '@/utils/serverConnectionErrors';
import { setupOfflineReconnection } from '@/utils/setupOfflineReconnection';
import type { ApiSessionClient } from '@/api/apiSession';
import { parseClear } from '@/parsers/specialCommands';
import { addBuiltinSlashCommands, expandBuiltinSlashCommand, syncBuiltinCommands } from '@/commands/builtinCommands';
import { syncOrchestratorAssets } from '@/orchestrator/skillSync';
import type { AcpBackend } from '@/agent/acp/AcpBackend';
import type { AgentMessage } from '@/agent';
import { handleConfigMetadataEvent } from '@/agent/acp/sessionUpdateHandlers';
import { extractConfigOptionsFromPayload } from '@/agent/acp/sessionConfigMetadata';
import { createDeepSeekBackend, DEEPSEEK_PERMISSION_ENV } from '@/agent/factories/deepseek';
import { decodeDeepSeekModelValue, encodeDeepSeekModelValue } from '@/deepseek/models';
import { deepSeekEventsToAcpUpdates, deepSeekUsageAfter, readDeepSeekTranscript } from '@/deepseek/transcript';
import { DeepSeekPermissionHandler, HAPPY_TOOLS_APPROVED_WITHOUT_ASKING } from '@/deepseek/utils/permissionHandler';
import { GeminiDisplay } from '@/ui/ink/GeminiDisplay';
import type { ImageContent, PermissionMode } from '@/api/types';
import { formatMessageForGemini } from '@/utils/formatImageMessage';
import { getFirstTurnInstruction } from '@/orchestrator/firstTurnInstruction';
import { parseOptionsFromText } from '@/gemini/utils/optionsParser';
import { buildAcpBackfillMessages } from '@/agent/acp/backfill';
import { buildAcpFirstTurnPrompt } from '@/agent/acp/sessionInstructions';
import {
  DEEPSEEK_RESUME_SESSION_ID_ENV,
  deepSeekAuthErrorMessage,
  deepSeekNotFoundMessage,
  isDeepSeekAuthError,
  resolveDeepSeekCommand,
  sanitizeDeepSeekErrorText,
} from '@/deepseek/constants';

type DeepSeekMode = {
  permissionMode: DeepSeekPermissionMode;
  /** Clean Happy model code (e.g. `deepseek-v4-pro`); null means `dsh`'s own default. */
  model: string | null;
  /** Reasoning effort id (e.g. `high`, `max`, `low`, `off`); null means the model's default. */
  effort: string | null;
  originalUserMessage: string;
  images?: ImageContent[];
};

const INTERRUPTED_MESSAGE = '[Request interrupted by user]';

const PLAN_MODE_GUIDANCE = [
  '[Plan Mode Active]',
  'You are currently in plan mode (read-only sandbox).',
  '- Explore the codebase using read-only tools and design a clear, complete implementation plan.',
  '- Do NOT modify files, run mutating commands, or implement changes yet.',
  '- If requirements are ambiguous, use `mcp__happy__ask_user_question` to clarify with the user.',
  '- When your plan is ready, submit it for review by calling `mcp__happy__exit_plan_mode` with the full Markdown plan (starting with a `#` heading).',
  '- Wait for approval before implementing.',
].join('\n');

const PLAN_MODE_EXIT_NOTICE = '[Plan Mode Exited] Plan mode is now off. You may proceed with normal implementation.';

export type ParsedPlanCommand =
  | { action: 'enter'; prompt: string | null }
  | { action: 'exit'; prompt: null };

/** Parses `/plan`, `/plan off`, and `/plan <message>` matching DeepSeek Harness conventions. */
export function parseDeepSeekPlanCommand(text: string): ParsedPlanCommand | null {
  const trimmed = text.trim();
  if (trimmed === '/plan') return { action: 'enter', prompt: null };
  if (!trimmed.startsWith('/plan ') && !trimmed.startsWith('/plan\t') && !trimmed.startsWith('/plan\n')) return null;
  const rest = trimmed.slice(5).trim();
  if (!rest) return { action: 'enter', prompt: null };
  if (rest.toLowerCase() === 'off') return { action: 'exit', prompt: null };
  return { action: 'enter', prompt: rest };
}

/**
 * Rewrites `dsh`'s opaque `JSON.stringify([provider, model])` values inside `configOptions`
 * to clean Happy model codes, while collecting the exact `code -> rawValue` map for round-tripping.
 */
function normalizeDeepSeekConfigOptions(
  configOptions: SessionConfigOption[],
): { normalized: SessionConfigOption[]; rawModelByCode: Map<string, string>; modelConfigId: string; effortConfigId: string } {
  const rawModelByCode = new Map<string, string>();
  let modelConfigId = 'model';
  let effortConfigId = 'reasoning_effort';

  const normalized = configOptions.map((option) => {
    if (option.type !== 'select') return option;
    if (option.category === 'thought_level') {
      effortConfigId = option.id;
      return option;
    }
    if (option.category !== 'model') return option;

    modelConfigId = option.id;
    const decodeEntry = (entry: { value: string; name: string; description?: string | null }) => {
      const decoded = decodeDeepSeekModelValue(entry.value);
      rawModelByCode.set(decoded.code, entry.value);
      return { ...entry, value: decoded.code, _provider: decoded.provider, _model: decoded.model };
    };

    const currentDecoded = decodeDeepSeekModelValue(option.currentValue);
    rawModelByCode.set(currentDecoded.code, option.currentValue);

    const stripSyntheticStaleDefault = (
      entries: Array<{ value: string; name: string; description?: string | null; _provider: string; _model: string }>,
    ) => {
      const hasNamedOfficialEntry = entries.some(
        (entry) => entry._provider === 'deepseek-official' && entry.name !== entry._model,
      );
      return entries
        .filter((entry) => !(
          hasNamedOfficialEntry
          && entry._provider === 'deepseek-official'
          && entry.value === currentDecoded.code
          && entry.name === entry._model
          && !entry.description
        ))
        .map(({ _provider: _p, _model: _m, ...clean }) => clean);
    };

    // ACP select options are either all groups or all flat entries.
    const isGrouped = option.options.some((item) => 'options' in item && Array.isArray(item.options));
    const mappedOptions = isGrouped
      ? option.options.map((group) => ({
          ...group,
          options: stripSyntheticStaleDefault((group as { options: Array<{ value: string; name: string; description?: string | null }> }).options.map(decodeEntry)),
        }))
      : stripSyntheticStaleDefault((option.options as Array<{ value: string; name: string; description?: string | null }>).map(decodeEntry));

    return {
      ...option,
      currentValue: currentDecoded.code,
      options: mappedOptions,
    } as SessionConfigOption;
  });

  return { normalized, rawModelByCode, modelConfigId, effortConfigId };
}

export async function runDeepSeek(opts: {
  credentials: Credentials;
  startedBy?: 'daemon' | 'terminal';
}): Promise<void> {
  const sessionTag = randomUUID();
  const deepSeekCommand = resolveDeepSeekCommand();
  connectionState.setBackend('DeepSeek');

  const api = await ApiClient.create(opts.credentials);

  const settings = await readSettings();
  const machineId = settings?.machineId;
  if (!machineId) {
    logger.debug('[DeepSeek] No machine ID found in settings');
    process.exit(1);
  }
  await api.getOrCreateMachine({ machineId, metadata: initialMachineMetadata });

  //
  // Happy session
  //

  const resumeSessionId = process.env[DEEPSEEK_RESUME_SESSION_ID_ENV]?.trim() || undefined;
  const { state, metadata } = createSessionMetadata({
    flavor: 'deepseek',
    machineId,
    startedBy: opts.startedBy,
    historyBackfill: !!resumeSessionId,
  });
  const response = await api.getOrCreateSession({ tag: sessionTag, metadata, state });

  let session: ApiSessionClient;
  let permissionHandler: DeepSeekPermissionHandler | undefined;
  let isProcessingMessage = false;
  let pendingSessionSwap: ApiSessionClient | null = null;

  const adoptSession = (next: ApiSessionClient) => {
    session = next;
    permissionHandler?.updateSession(next);
    next.updateCapabilities((capabilities) => {
      const withBuiltins = addBuiltinSlashCommands(capabilities);
      const existing = withBuiltins.slashCommandMetadata ?? [];
      const hasPlan = existing.some((cmd) => cmd.name === 'plan');
      return hasPlan
        ? withBuiltins
        : {
            ...withBuiltins,
            slashCommandMetadata: [
              ...existing,
              { name: 'plan', description: 'Enter plan mode (/plan [task] or /plan off)', kind: 'command' as const },
            ],
          };
    });
  };

  const { session: initialSession, reconnectionHandle } = setupOfflineReconnection({
    api,
    sessionTag,
    metadata,
    state,
    response,
    onSessionSwap: (newSession) => {
      if (isProcessingMessage) {
        pendingSessionSwap = newSession;
        return;
      }
      adoptSession(newSession);
    },
  });
  syncBuiltinCommands();
  syncOrchestratorAssets();
  adoptSession(initialSession);
  session = initialSession;

  const sessionTitle = process.env.HAPPY_SESSION_TITLE?.trim();
  if (sessionTitle) {
    session.updateMetadata((current) => ({ ...current, summary: { text: sessionTitle, updatedAt: Date.now() } }));
  }

  if (response) {
    const result = await notifyDaemonSessionStarted(response.id, metadata).catch((error) => ({ error }));
    logger.debug('[DeepSeek] Reported session to daemon', result);
  }

  //
  // Incoming user messages & mode state
  //

  const messageQueue = new MessageQueue2<DeepSeekMode>((mode) => hashObject({
    permissionMode: mode.permissionMode,
    model: mode.model,
    effort: mode.effort,
  }));

  let desiredPermissionMode: DeepSeekPermissionMode = 'default';
  let previousNonPlanMode: DeepSeekPermissionMode = 'default';
  let planGuidanceActive = false;
  let desiredModel: string | null = null;
  let desiredEffort: string | null = null;
  let isFirstMessage = true;
  const firstTurnInstruction = getFirstTurnInstruction(process.env, { includeOrchestrator: true });

  const setDesiredPermissionMode = (next: DeepSeekPermissionMode) => {
    if (next !== 'plan') previousNonPlanMode = next;
    desiredPermissionMode = next;
    permissionHandler?.setPermissionMode(next);
  };

  session.onUserMessage((message, hooks) => {
    const requestedMode = message.meta?.permissionMode;
    if (requestedMode && isPermissionModeForAgent('deepseek', requestedMode)) {
      setDesiredPermissionMode(requestedMode as DeepSeekPermissionMode);
    }
    if (message.meta && 'model' in message.meta) {
      desiredModel = message.meta.model && message.meta.model !== 'default' ? message.meta.model : null;
      desiredEffort = message.meta.reasoningEffort || null;
    }

    const originalUserMessage = message.content.text;
    const planCommand = parseDeepSeekPlanCommand(originalUserMessage);
    if (planCommand) {
      if (planCommand.action === 'enter') {
        setDesiredPermissionMode('plan');
        session.sendSessionEvent({ type: 'message', message: 'Entered plan mode (read-only sandbox).' });
        if (!planCommand.prompt) {
          sendReadyIfIdle();
          return;
        }
      } else {
        setDesiredPermissionMode(previousNonPlanMode);
        session.sendSessionEvent({ type: 'message', message: `Exited plan mode (switched to ${previousNonPlanMode}).` });
        sendReadyIfIdle();
        return;
      }
    }

    const effectiveRawText = planCommand?.prompt ?? originalUserMessage;
    const images = message.content.type === 'mixed' && 'images' in message.content ? message.content.images : [];
    const userMessage = expandBuiltinSlashCommand(effectiveRawText)?.prompt ?? effectiveRawText;
    const prompt = isFirstMessage
      ? buildAcpFirstTurnPrompt({ appendSystemPrompt: message.meta?.appendSystemPrompt, firstTurnInstruction, userMessage })
      : userMessage;
    isFirstMessage = false;

    messageQueue.push(prompt, {
      permissionMode: desiredPermissionMode,
      model: desiredModel,
      effort: desiredEffort,
      originalUserMessage,
      images: images.length > 0 ? images : undefined,
    }, hooks);
  });

  //
  // Terminal UI
  //

  const messageBuffer = new MessageBuffer();
  const hasTTY = process.stdout.isTTY && process.stdin.isTTY;
  let inkInstance: ReturnType<typeof render> | null = null;
  let shouldExit = false;
  let displayedModel = 'default';

  let thinking = false;
  session.keepAlive(thinking, 'remote');
  const keepAliveInterval = setInterval(() => session.keepAlive(thinking, 'remote'), 2000);

  const setThinking = (value: boolean) => {
    thinking = value;
    session.keepAlive(thinking, 'remote');
  };

  const sendReady = () => {
    session.sendSessionEvent({ type: 'ready' });
    try {
      api.push().sendCompletionToAllDevices("It's ready!", 'DeepSeek is waiting for your command', { sessionId: session.sessionId });
    } catch (pushError) {
      logger.debug('[DeepSeek] Failed to send ready push', pushError);
    }
    session.flush().finally(() => {
      session.updateAgentState((current) => ({ ...current, taskCompleted: Date.now() }));
    });
  };

  /** A bare `/plan` or `/plan off` sent mid-turn must not report the running turn as finished. */
  const sendReadyIfIdle = () => {
    if (!isProcessingMessage && messageQueue.size() === 0) sendReady();
  };

  const sendAgentText = (text: string) => {
    messageBuffer.addMessage(text, 'status');
    session.sendAgentMessage('deepseek', { type: 'message', message: text });
  };

  //
  // Interactive MCP bridge (`AskUserQuestion` & `ExitPlanMode`)
  //

  permissionHandler = new DeepSeekPermissionHandler(session, api.push());

  /**
   * Pairs DSH's ACP `tool_call` (stdout) with our HTTP MCP handler invocation. The two travel
   * on different channels, so either may arrive first: ids seen first wait in `ids`, handlers
   * that arrive first wait in `waiters`. A handler that gives up waiting uses a random id and
   * counts as `orphaned`, so its late `tool_call` is dropped instead of being paired with the
   * next call of the same tool.
   */
  type InteractiveTool = 'AskUserQuestion' | 'ExitPlanMode';
  const interactiveCalls: Record<InteractiveTool, { ids: string[]; waiters: Array<(id: string) => void>; orphaned: number }> = {
    AskUserQuestion: { ids: [], waiters: [], orphaned: 0 },
    ExitPlanMode: { ids: [], waiters: [], orphaned: 0 },
  };

  const INTERACTIVE_CALL_PAIR_TIMEOUT_MS = 3000;

  const claimInteractiveCallId = (tool: InteractiveTool): Promise<string> => {
    const calls = interactiveCalls[tool];
    const queued = calls.ids.shift();
    if (queued) return Promise.resolve(queued);
    return new Promise((resolve) => {
      const waiter = (id: string) => {
        clearTimeout(timer);
        resolve(id);
      };
      const timer = setTimeout(() => {
        calls.waiters = calls.waiters.filter((w) => w !== waiter);
        calls.orphaned++;
        logger.debug(`[DeepSeek] ${tool} MCP call arrived without an ACP tool_call; using a fresh id`);
        resolve(randomUUID());
      }, INTERACTIVE_CALL_PAIR_TIMEOUT_MS);
      calls.waiters.push(waiter);
    });
  };

  const registerInteractiveCallId = (tool: InteractiveTool, id: string) => {
    const calls = interactiveCalls[tool];
    const waiter = calls.waiters.shift();
    if (waiter) {
      waiter(id);
    } else if (calls.orphaned > 0) {
      calls.orphaned--;
    } else {
      calls.ids.push(id);
    }
  };

  const resetInteractiveCalls = () => {
    for (const calls of Object.values(interactiveCalls)) {
      calls.ids.length = 0;
      calls.orphaned = 0;
      // Pending waiters keep their timers and fall back to a fresh id on their own.
    }
  };

  const mcp = await createMcpContext(session, {
    interactiveTools: {
      askUserQuestion: async ({ questions }) => {
        const callId = await claimInteractiveCallId('AskUserQuestion');
        try {
          const result = await permissionHandler!.handleToolCall(callId, 'AskUserQuestion', { questions });
          if (result.decision === 'approved' || result.decision === 'approved_for_session') {
            return { answers: result.answers ?? {} };
          }
          return { cancelled: true };
        } catch (error) {
          logger.debug('[DeepSeek] AskUserQuestion aborted/cancelled', error);
          return { cancelled: true };
        }
      },
      exitPlanMode: async ({ plan }) => {
        const callId = await claimInteractiveCallId('ExitPlanMode');
        try {
          const result = await permissionHandler!.handleToolCall(callId, 'ExitPlanMode', { plan });
          if (result.decision === 'approved' || result.decision === 'approved_for_session') {
            const nextMode: DeepSeekPermissionMode = result.mode && isPermissionModeForAgent('deepseek', result.mode) && result.mode !== 'plan'
              ? result.mode as DeepSeekPermissionMode
              : previousNonPlanMode;
            setDesiredPermissionMode(nextMode);
            planGuidanceActive = false;
            permissionHandler!.markPlanExitedForTurn();
            return { approved: true };
          }
          return {
            approved: false,
            feedback: 'The user did not approve the plan. Ask clarifying questions or revise the plan before calling exit_plan_mode again.',
          };
        } catch (error) {
          logger.debug('[DeepSeek] ExitPlanMode aborted/cancelled', error);
          return { approved: false, feedback: 'Plan review was cancelled by the user.' };
        }
      },
    },
  });
  const mcpServers = mcp.configForHttp();

  //
  // DeepSeek ACP backend state
  //

  let deepSeekBackend = null as AcpBackend | null;
  let runningDshPermissionMode: string | null = null;
  /** Conversation to restore on the next dsh start; kept when a start fails so the next one retries it. */
  let deepSeekSessionId: string | undefined = resumeSessionId;
  /** Serializes every dsh start/restart so an idle mode switch and an incoming turn never race. */
  let backendLock: Promise<unknown> = Promise.resolve();
  const withBackendLock = <T>(task: () => Promise<T>): Promise<T> => {
    const run = backendLock.then(task);
    backendLock = run.catch(() => undefined);
    return run;
  };
  let modelConfigId = 'model';
  let effortConfigId = 'reasoning_effort';
  let rawModelByCode = new Map<string, string>();
  let appliedModel: string | null = null;
  let appliedEffort: string | null = null;
  let defaultModel: string | null = null;
  let contextUsage: { used: number; size: number } | null = null;
  let usageReportedThrough = -1;

  let accumulatedResponse = '';
  let accumulatedThinking = '';
  let abortRequested = false;
  let abortFeedbackSent = false;
  let taskStartedSent = false;

  const sendAbortFeedback = () => {
    if (abortFeedbackSent) return;
    abortFeedbackSent = true;
    sendAgentText(INTERRUPTED_MESSAGE);
    session.sendAgentMessage('deepseek', { type: 'turn_aborted', id: randomUUID() });
  };

  const flushThinking = () => {
    if (accumulatedThinking.trim()) session.sendAgentMessage('deepseek', { type: 'thinking', text: accumulatedThinking });
    accumulatedThinking = '';
  };

  const flushResponse = () => {
    flushThinking();
    if (!accumulatedResponse.trim()) {
      accumulatedResponse = '';
      return;
    }
    const { text, options, rawOptionsXml } = parseOptionsFromText(accumulatedResponse);
    session.sendAgentMessage('deepseek', { type: 'message', message: options.length > 0 ? text + rawOptionsXml : text });
    accumulatedResponse = '';
  };

  const reportUsage = async (sessionId: string) => {
    const events = await readDeepSeekTranscript(sessionId);
    const { lastSeq, tokens } = deepSeekUsageAfter(events, usageReportedThrough);
    usageReportedThrough = lastSeq;
    if (tokens.total > 0) session.sendUsageReport({ key: 'deepseek-session', tokens: { ...tokens }, cost: { total: 0 } });
  };

  const sendContextUsage = () => {
    if (!contextUsage) return;
    session.sendAgentMessage('deepseek', {
      type: 'token_count',
      context_used_tokens: contextUsage.used,
      context_window_size: contextUsage.size,
      id: randomUUID(),
    });
  };

  const describeError = (error: unknown): string => {
    const rawDetail = error instanceof Error
      ? [error.message, JSON.stringify((error as { data?: unknown }).data ?? '')].join(' ')
      : JSON.stringify(error);
    const detail = sanitizeDeepSeekErrorText(rawDetail);
    if (isDeepSeekAuthError(detail)) return deepSeekAuthErrorMessage();
    if (detail.includes('ENOENT')) return deepSeekNotFoundMessage(deepSeekCommand);
    return error instanceof Error ? sanitizeDeepSeekErrorText(error.message) : detail;
  };

  const handleBackendMessage = (msg: AgentMessage) => {
    switch (msg.type) {
      case 'model-output':
        if (!msg.textDelta) break;
        flushThinking();
        if (accumulatedResponse) {
          messageBuffer.updateLastMessage(msg.textDelta, 'assistant');
        } else {
          messageBuffer.removeLastMessage('system');
          messageBuffer.addMessage(msg.textDelta, 'assistant');
        }
        accumulatedResponse += msg.textDelta;
        break;

      case 'status':
        logger.debug(`[DeepSeek] Status: ${msg.status}`, msg.detail);
        if (msg.status === 'running' && !taskStartedSent) {
          taskStartedSent = true;
          session.sendAgentMessage('deepseek', { type: 'task_started', id: randomUUID() });
          messageBuffer.addMessage('Thinking...', 'system');
        }
        break;

      case 'tool-call': {
        flushResponse();
        if (msg.toolName === 'AskUserQuestion' || msg.toolName === 'ExitPlanMode') {
          registerInteractiveCallId(msg.toolName, msg.callId);
        }
        const input = inlinePreviewHtmlFileArgs(msg.toolName, msg.args) ?? {};
        messageBuffer.addMessage(`Executing: ${msg.toolName} ${JSON.stringify(msg.args ?? {}).substring(0, 100)}`, 'tool');
        session.sendAgentMessage('deepseek', { type: 'tool-call', name: msg.toolName, callId: msg.callId, input, id: randomUUID() });
        break;
      }

      case 'tool-result': {
        const result = msg.result;
        const output = Array.isArray(result) && result.length > 0 && result.every((item) => item?.type === 'content' && item?.content)
          ? { content: result.map((item) => item.content) }
          : result;
        messageBuffer.addMessage(`Result: ${JSON.stringify(result ?? '').substring(0, 200)}`, 'result');
        session.sendAgentMessage('deepseek', { type: 'tool-result', callId: msg.callId, output, id: randomUUID() });
        break;
      }

      case 'fs-edit':
        messageBuffer.addMessage(`File edit: ${msg.description}`, 'tool');
        session.sendAgentMessage('deepseek', { type: 'file-edit', description: msg.description, filePath: msg.path || 'unknown', id: randomUUID() });
        break;

      case 'permission-request': {
        const payload = (msg.payload ?? {}) as { toolName?: string };
        if (HAPPY_TOOLS_APPROVED_WITHOUT_ASKING.includes(payload.toolName ?? '')) break;
        session.sendAgentMessage('deepseek', {
          type: 'permission-request',
          permissionId: msg.id,
          toolName: payload.toolName || msg.reason || 'unknown',
          description: msg.reason || payload.toolName || '',
          options: payload,
        });
        break;
      }

      case 'event': {
        if (msg.name === 'usage_update') {
          contextUsage = msg.payload as { used: number; size: number };
          break;
        }
        if (msg.name === 'config_options_update') {
          const rawConfigOptions = extractConfigOptionsFromPayload(msg.payload) ?? [];
          const {
            normalized,
            rawModelByCode: nextMap,
            modelConfigId: nextModelId,
            effortConfigId: nextEffortId,
          } = normalizeDeepSeekConfigOptions(rawConfigOptions);
          rawModelByCode = nextMap;
          modelConfigId = nextModelId;
          effortConfigId = nextEffortId;
          const current = (category: string) => normalized.find((option) => option.type === 'select' && option.category === category)?.currentValue ?? null;
          appliedModel = current('model') ?? appliedModel;
          appliedEffort = current('thought_level');
          displayedModel = appliedModel ?? displayedModel;
          messageBuffer.addMessage(`[MODEL:${displayedModel}]`, 'system');
          handleConfigMetadataEvent(msg.name, { configOptions: normalized }, session.updateMetadata.bind(session), session.updateCapabilities.bind(session));
          break;
        }
        if (handleConfigMetadataEvent(msg.name, msg.payload, session.updateMetadata.bind(session), session.updateCapabilities.bind(session))) {
          break;
        }
        if (msg.name === 'thinking') {
          const text = String((msg.payload as { text?: string } | undefined)?.text ?? '');
          messageBuffer.updateLastMessage(`[Thinking] ${text.substring(0, 100)}...`, 'system');
          if (accumulatedResponse) flushResponse();
          accumulatedThinking += text;
        }
        break;
      }

      default:
        break;
    }
  };

  /**
   * Starts `dsh --profile acp`, restoring `deepSeekSessionId` when set. Returns whether that
   * conversation was restored; when it wasn't, the user is told the chat starts fresh.
   * Only call it while holding `backendLock`.
   */
  const startBackend = async (permissionMode: DeepSeekPermissionMode): Promise<boolean> => {
    const targetDshMode = DEEPSEEK_PERMISSION_ENV[permissionMode] ?? 'workspace-write';
    const targetResumeSessionId = deepSeekSessionId;
    const backend = createDeepSeekBackend({
      cwd: process.cwd(),
      mcpServers,
      permissionHandler,
      permissionMode,
      resumeSessionId: targetResumeSessionId,
    });
    backend.onMessage(handleBackendMessage);
    appliedModel = null;
    appliedEffort = null;
    contextUsage = null;
    try {
      await backend.startSession();
    } catch (error) {
      await backend.dispose();
      throw error;
    }
    deepSeekBackend = backend;
    runningDshPermissionMode = targetDshMode;
    defaultModel ??= appliedModel;
    const deepseekSessionId = backend.getSessionId() ?? undefined;
    deepSeekSessionId = deepseekSessionId;
    session.updateMetadata((current) => ({ ...current, deepseekSessionId }));
    if (deepseekSessionId) {
      const existingEvents = await readDeepSeekTranscript(deepseekSessionId);
      usageReportedThrough = deepSeekUsageAfter(existingEvents, -1).lastSeq;
    }
    const restored = !!targetResumeSessionId && deepseekSessionId === targetResumeSessionId;
    if (targetResumeSessionId && !restored) {
      sendAgentText('The previous DeepSeek conversation could not be restored, so this session starts fresh.');
    }
    logger.debug('[DeepSeek] Session started', { deepseekSessionId, targetResumeSessionId, restored, targetDshMode, appliedModel });
    return restored;
  };

  /** Starts dsh if needed, or restarts it with the new `DSH_PERMISSION_MODE` and resumes the same conversation. */
  const ensureSandboxPermissionMode = (mode: DeepSeekPermissionMode): Promise<void> => withBackendLock(async () => {
    permissionHandler!.setPermissionMode(mode);
    const targetDshMode = DEEPSEEK_PERMISSION_ENV[mode] ?? 'workspace-write';
    if (deepSeekBackend && runningDshPermissionMode === targetDshMode) return;
    if (deepSeekBackend) {
      logger.debug('[DeepSeek] Switching DSH_PERMISSION_MODE via restart+resume', {
        from: runningDshPermissionMode,
        to: targetDshMode,
        sessionId: deepSeekSessionId,
      });
      const previous = deepSeekBackend;
      deepSeekBackend = null;
      runningDshPermissionMode = null;
      await previous.dispose();
    }
    await startBackend(mode);
  });

  const promptImages = async (text: string, images: ImageContent[] | undefined) => images
    ? (await formatMessageForGemini(text, images)).parts.flatMap((part) => 'inlineData' in part && part.inlineData
      ? [{ data: part.inlineData.data, mimeType: part.inlineData.mimeType }]
      : [])
    : undefined;

  const handleAbort = async () => {
    logger.debug('[DeepSeek] Abort requested');
    abortRequested = true;
    setThinking(false);
    messageQueue.reset();
    // Release any pending AskUserQuestion / ExitPlanMode MCP waits immediately
    permissionHandler?.reset();
    resetInteractiveCalls();
    const sessionId = deepSeekBackend?.getSessionId();
    if (deepSeekBackend && sessionId) {
      await deepSeekBackend.cancel(sessionId).catch((error) => logger.debug('[DeepSeek] Cancel failed', error));
    }
  };

  const handleKillSession = async () => {
    logger.debug('[DeepSeek] Kill session requested');
    await handleAbort();
    try {
      session.updateMetadata((current) => ({
        ...current,
        lifecycleState: 'archived',
        lifecycleStateSince: Date.now(),
        archivedBy: 'cli',
        archiveReason: 'User terminated',
      }));
      session.sendSessionDeath();
      await session.flush();
      await session.close();
      stopCaffeinate();
      mcp.stop();
      await deepSeekBackend?.dispose();
      process.exit(0);
    } catch (error) {
      logger.debug('[DeepSeek] Error during session termination', error);
      process.exit(1);
    }
  };

  session.rpcHandlerManager.registerHandler('abort', handleAbort);
  registerKillSessionHandler(session, handleKillSession);
  session.rpcHandlerManager.registerHandler<{ mode?: PermissionMode }, boolean>('permission-mode-changed', async (payload) => {
    const mode = payload?.mode;
    if (!mode || !isPermissionModeForAgent('deepseek', mode)) {
      logger.debug('[DeepSeek] Invalid permission mode via rpc', { mode });
      return false;
    }
    setDesiredPermissionMode(mode as DeepSeekPermissionMode);
    if (!isProcessingMessage && deepSeekBackend) {
      await ensureSandboxPermissionMode(mode as DeepSeekPermissionMode).catch((error) => {
        logger.debug('[DeepSeek] Deferred sandbox mode switch after idle restart failure', error);
      });
    }
    return true;
  });

  if (hasTTY) {
    console.clear();
    inkInstance = render(React.createElement(() => React.createElement(GeminiDisplay, {
      messageBuffer,
      logPath: isDebug() ? logger.getLogPath() : undefined,
      currentModel: displayedModel,
      agentLabel: 'DeepSeek Agent',
      onExit: async () => {
        shouldExit = true;
        await handleAbort();
      },
    })), { exitOnCtrlC: false, patchConsole: false });
    process.stdin.resume();
    process.stdin.setRawMode(true);
    process.stdin.setEncoding('utf8');
  }

  //
  // Start dsh up front so the app immediately receives models and resumed sessions backfill history.
  //

  try {
    setThinking(!!resumeSessionId);
    const restored = await withBackendLock(() => startBackend(desiredPermissionMode));
    if (restored && resumeSessionId) {
      for (let i = 0; i < 150 && !session.isConnected(); i++) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      const events = await readDeepSeekTranscript(resumeSessionId);
      const updates = deepSeekEventsToAcpUpdates(events);
      if (updates.length > 0) {
        await session.sendBackfillBatch(buildAcpBackfillMessages(updates, resumeSessionId, 'deepseek'), 'replace');
      }
      sendContextUsage();
      messageBuffer.addMessage('Resumed previous DeepSeek conversation', 'status');
    }
  } catch (error) {
    logger.debug('[DeepSeek] Failed to start dsh', error);
    sendAgentText(describeError(error));
  } finally {
    setThinking(false);
    if (resumeSessionId) {
      session.updateMetadata((current) => ({ ...current, historyBackfill: 'done' }));
    }
  }

  //
  // Main loop
  //

  try {
    while (!shouldExit) {
      const batch = await messageQueue.waitForMessagesAndGetAsString();
      if (!batch) {
        if (messageQueue.isClosed()) break;
        continue;
      }

      if (parseClear(batch.message).isClear) {
        messageBuffer.addMessage('Context was reset', 'status');
        session.sendSessionEvent({ type: 'message', message: 'Context was reset' });
        await withBackendLock(async () => {
          const previous = deepSeekBackend;
          deepSeekBackend = null;
          runningDshPermissionMode = null;
          deepSeekSessionId = undefined;
          await previous?.dispose();
        });
        permissionHandler.reset();
        permissionHandler.clearTurnFlags();
        planGuidanceActive = false;
        isFirstMessage = true;
        sendReady();
        continue;
      }

      messageBuffer.addMessage(batch.mode.originalUserMessage, 'user');
      isProcessingMessage = true;
      abortRequested = false;
      abortFeedbackSent = false;
      taskStartedSent = false;
      accumulatedResponse = '';
      accumulatedThinking = '';
      resetInteractiveCalls();
      permissionHandler.clearTurnFlags();
      setThinking(true);

      try {
        await ensureSandboxPermissionMode(batch.mode.permissionMode);
        const backend = deepSeekBackend!;

        const targetModel = batch.mode.model ?? defaultModel;
        if (targetModel && targetModel !== appliedModel) {
          const encoded = encodeDeepSeekModelValue(targetModel, rawModelByCode);
          const applied = await backend.setSessionConfigOption(modelConfigId, encoded);
          logger.debug(`[DeepSeek] Set model ${targetModel} (${encoded}): ${applied}`);
        }
        if (batch.mode.effort && batch.mode.effort !== appliedEffort) {
          const applied = await backend.setSessionConfigOption(effortConfigId, batch.mode.effort);
          logger.debug(`[DeepSeek] Set reasoning effort ${batch.mode.effort} via ${effortConfigId}: ${applied}`);
        }

        // Inject plan mode transition guidance when entering or leaving plan mode
        let promptToSend = batch.message;
        if (batch.mode.permissionMode === 'plan' && !planGuidanceActive) {
          planGuidanceActive = true;
          promptToSend = `${PLAN_MODE_GUIDANCE}\n\n${promptToSend}`;
        } else if (batch.mode.permissionMode !== 'plan' && planGuidanceActive) {
          planGuidanceActive = false;
          promptToSend = `${PLAN_MODE_EXIT_NOTICE}\n\n${promptToSend}`;
        }

        const images = await promptImages(promptToSend, batch.mode.images);
        await backend.sendPrompt(backend.getSessionId()!, promptToSend, { images });
        await new Promise((resolve) => setImmediate(resolve));
      } catch (error) {
        logger.debug('[DeepSeek] Turn failed', error);
        flushResponse();
        if (!abortRequested) sendAgentText(describeError(error));
      } finally {
        flushResponse();
        permissionHandler.reset();
        permissionHandler.clearTurnFlags();
        resetInteractiveCalls();
        sendContextUsage();
        const usageSessionId = deepSeekBackend?.getSessionId();
        if (usageSessionId) {
          reportUsage(usageSessionId).catch((error) => logger.debug('[DeepSeek] Cannot report usage', error));
          // An app older than the field drops it when it rewrites the metadata, and resume and copy need it
          session.updateMetadata((current) => (current.deepseekSessionId === usageSessionId ? current : { ...current, deepseekSessionId: usageSessionId }));
        }
        if (abortRequested) {
          sendAbortFeedback();
        } else {
          session.sendAgentMessage('deepseek', { type: 'task_complete', id: randomUUID() });
        }
        setThinking(false);
        if (!shouldExit && messageQueue.size() === 0) sendReady();
        isProcessingMessage = false;
        if (pendingSessionSwap) {
          adoptSession(pendingSessionSwap);
          pendingSessionSwap = null;
        }
      }
    }
  } finally {
    logger.debug('[DeepSeek] Final cleanup');
    reconnectionHandle?.cancel();
    permissionHandler.reset();
    try {
      session.updateMetadata((current) => ({
        ...current,
        lifecycleState: 'archived',
        lifecycleStateSince: Date.now(),
        archivedBy: 'cli',
        archiveReason: 'Session ended',
      }));
      session.sendSessionDeath();
      await session.flush();
      await session.close();
    } catch (error) {
      logger.debug('[DeepSeek] Error while closing session', error);
    }
    await deepSeekBackend?.dispose();
    mcp.stop();
    if (hasTTY) {
      try { process.stdin.setRawMode(false); process.stdin.pause(); } catch { /* ignore */ }
    }
    clearInterval(keepAliveInterval);
    inkInstance?.unmount();
    messageBuffer.clear();
  }
}
