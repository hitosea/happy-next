/**
 * Antigravity CLI Entry Point
 *
 * Runs Google Antigravity CLI (`agy acp`) as a Happy session. One agy process
 * serves the whole session: mode, model and thinking level are applied in place
 * over ACP before each prompt, and a resumed session restores its conversation
 * with `session/load` and backfills that history into the app.
 */

import { render } from 'ink';
import React from 'react';
import { randomUUID } from 'node:crypto';
import type { SessionNotification } from '@agentclientprotocol/sdk';
import { isPermissionModeForAgent } from 'happy-wire';

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
import {
  extractConfigOptionsFromPayload,
  extractCurrentModeIdFromPayload,
  extractModeStateFromPayload,
} from '@/agent/acp/sessionConfigMetadata';
import { ANTIGRAVITY_ACP_MODES, createAntigravityBackend, resolveAntigravityAcpMode } from '@/agent/factories/antigravity';
import { antigravityUsageAfter, readAntigravityTranscript } from '@/antigravity/transcript';
import { GeminiDisplay } from '@/ui/ink/GeminiDisplay';
import type { ImageContent, PermissionMode } from '@/api/types';
import { formatMessageForGemini } from '@/utils/formatImageMessage';
import { getFirstTurnInstruction } from '@/orchestrator/firstTurnInstruction';
import { parseOptionsFromText } from '@/gemini/utils/optionsParser';
import { AntigravityPermissionHandler, HAPPY_TOOLS_APPROVED_WITHOUT_ASKING } from '@/antigravity/utils/permissionHandler';
import { buildAcpBackfillMessages } from '@/agent/acp/backfill';
import { buildAcpFirstTurnPrompt } from '@/agent/acp/sessionInstructions';
import {
  ANTIGRAVITY_RESUME_SESSION_ID_ENV,
  antigravityAuthErrorMessage,
  antigravityNotFoundMessage,
  isAntigravityAuthError,
  resolveAntigravityCommand,
} from '@/antigravity/constants';
import type { AntigravityPermissionMode } from 'happy-wire';

type AntigravityMode = {
  permissionMode: PermissionMode;
  /** Antigravity model id; null means the one agy starts with. */
  model: string | null;
  /** Thinking level; null means the one agy picks for the model. */
  effort: string | null;
  originalUserMessage: string;
  images?: ImageContent[];
};

const INTERRUPTED_MESSAGE = '[Request interrupted by user]';

export async function runAntigravity(opts: {
  credentials: Credentials;
  startedBy?: 'daemon' | 'terminal';
}): Promise<void> {
  const sessionTag = randomUUID();
  const antigravityCommand = resolveAntigravityCommand();
  connectionState.setBackend('Antigravity');

  const api = await ApiClient.create(opts.credentials);

  const settings = await readSettings();
  const machineId = settings?.machineId;
  if (!machineId) {
    logger.debug('[Antigravity] No machine ID found in settings');
    process.exit(1);
  }
  await api.getOrCreateMachine({ machineId, metadata: initialMachineMetadata });

  //
  // Happy session
  //

  // A resumed session's history is backfilled into the app once agy has restored it
  const resumeSessionId = process.env[ANTIGRAVITY_RESUME_SESSION_ID_ENV]?.trim() || undefined;
  const { state, metadata } = createSessionMetadata({ flavor: 'antigravity', machineId, startedBy: opts.startedBy, historyBackfill: !!resumeSessionId });
  const response = await api.getOrCreateSession({ tag: sessionTag, metadata, state });

  let session: ApiSessionClient;
  let permissionHandler: AntigravityPermissionHandler | undefined;
  let isProcessingMessage = false;
  let pendingSessionSwap: ApiSessionClient | null = null;

  const adoptSession = (next: ApiSessionClient) => {
    session = next;
    permissionHandler?.updateSession(next);
    next.updateCapabilities((capabilities) => addBuiltinSlashCommands(capabilities));
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
    logger.debug('[Antigravity] Reported session to daemon', result);
  }

  //
  // Incoming user messages
  //

  const messageQueue = new MessageQueue2<AntigravityMode>((mode) => hashObject({
    permissionMode: mode.permissionMode,
    model: mode.model,
    effort: mode.effort,
  }));

  let desiredPermissionMode: PermissionMode = 'default';
  let desiredModel: string | null = null;
  let desiredEffort: string | null = null;
  let isFirstMessage = true;
  const firstTurnInstruction = getFirstTurnInstruction(process.env, { includeOrchestrator: true });

  session.onUserMessage((message, hooks) => {
    const requestedMode = message.meta?.permissionMode;
    if (requestedMode && isPermissionModeForAgent('antigravity', requestedMode)) {
      desiredPermissionMode = requestedMode;
    }
    if (message.meta && 'model' in message.meta) {
      desiredModel = message.meta.model && message.meta.model !== 'default' ? message.meta.model : null;
      desiredEffort = message.meta.reasoningEffort || null;
    }

    const originalUserMessage = message.content.text;
    const images = message.content.type === 'mixed' && 'images' in message.content ? message.content.images : [];
    const userMessage = expandBuiltinSlashCommand(originalUserMessage)?.prompt ?? originalUserMessage;
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
  let displayedModel = 'auto';

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
      api.push().sendCompletionToAllDevices("It's ready!", 'Antigravity is waiting for your command', { sessionId: session.sessionId });
    } catch (pushError) {
      logger.debug('[Antigravity] Failed to send ready push', pushError);
    }
    session.flush().finally(() => {
      session.updateAgentState((current) => ({ ...current, taskCompleted: Date.now() }));
    });
  };

  const sendAgentText = (text: string) => {
    messageBuffer.addMessage(text, 'status');
    session.sendAgentMessage('antigravity', { type: 'message', message: text });
  };

  //
  // Antigravity backend
  //

  const mcp = await createMcpContext(session);
  const mcpServers = mcp.configForHttp();
  permissionHandler = new AntigravityPermissionHandler(session, api.push());

  // Typed through a cast: TS would otherwise narrow it to null, since only closures assign it.
  let antigravityBackend = null as AcpBackend | null;
  // Values agy last reported for its `mode`, `model` and `thought_level` config options.
  let appliedMode: string | null = null;
  let availableAcpModes: Set<string> | null = null;
  // The unavailable agy mode the app was last told about, so a fallback is reported once.
  let notifiedUnavailableAcpMode: string | null = null;
  let appliedModel: string | null = null;
  let appliedEffort: string | null = null;
  // The model a fresh agy session starts with, used when the app asks for the default.
  let defaultModel: string | null = null;
  // How full the context window is, as agy last reported it; sent to the app after each turn.
  let contextUsage: { used: number; size: number } | null = null;
  // The last step of agy's transcript whose tokens are in the usage report. A restored session
  // starts from its last step, so the history it brings is not counted again.
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
    session.sendAgentMessage('antigravity', { type: 'turn_aborted', id: randomUUID() });
  };

  /** Sends the reasoning streamed so far as one message rather than one per chunk. */
  const flushThinking = () => {
    if (accumulatedThinking.trim()) session.sendAgentMessage('antigravity', { type: 'thinking', text: accumulatedThinking });
    accumulatedThinking = '';
  };

  /** Sends the text streamed so far as one message, so text and tool calls keep their order. */
  const flushResponse = () => {
    flushThinking();
    if (!accumulatedResponse.trim()) {
      accumulatedResponse = '';
      return;
    }
    const { text, options, rawOptionsXml } = parseOptionsFromText(accumulatedResponse);
    // The app reads <options> from the message text itself.
    session.sendAgentMessage('antigravity', { type: 'message', message: options.length > 0 ? text + rawOptionsXml : text });
    accumulatedResponse = '';
  };

  /** Reports the tokens of the steps agy logged since the last report. */
  const reportUsage = async (sessionId: string) => {
    const { lastStep, tokens } = antigravityUsageAfter(await readAntigravityTranscript(sessionId), usageReportedThrough);
    usageReportedThrough = lastStep;
    if (tokens.total > 0) session.sendUsageReport({ key: 'antigravity-session', tokens, cost: { total: 0 } });
  };

  const sendContextUsage = () => {
    if (!contextUsage) return;
    session.sendAgentMessage('antigravity', { type: 'token_count', context_used_tokens: contextUsage.used, context_window_size: contextUsage.size, id: randomUUID() });
  };

  const describeError = (error: unknown): string => {
    const detail = error instanceof Error
      ? [error.message, JSON.stringify((error as { data?: unknown }).data ?? '')].join(' ')
      : JSON.stringify(error);
    if (isAntigravityAuthError(detail)) return antigravityAuthErrorMessage(antigravityCommand);
    if (detail.includes('ENOENT')) return antigravityNotFoundMessage(antigravityCommand);
    return error instanceof Error ? error.message : detail;
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
        // Errors are reported once, by the prompt or startup that failed.
        logger.debug(`[Antigravity] Status: ${msg.status}`, msg.detail);
        if (msg.status === 'running' && !taskStartedSent) {
          taskStartedSent = true;
          session.sendAgentMessage('antigravity', { type: 'task_started', id: randomUUID() });
          messageBuffer.addMessage('Thinking...', 'system');
        }
        break;

      case 'tool-call': {
        flushResponse();
        const input = inlinePreviewHtmlFileArgs(msg.toolName, msg.args) ?? {};
        messageBuffer.addMessage(`Executing: ${msg.toolName} ${JSON.stringify(msg.args ?? {}).substring(0, 100)}`, 'tool');
        session.sendAgentMessage('antigravity', { type: 'tool-call', name: msg.toolName, callId: msg.callId, input, id: randomUUID() });
        break;
      }

      case 'tool-result': {
        // ACP returns [{ type: 'content', content: {...} }]; the app reads { content: [...] }.
        const result = msg.result;
        const output = Array.isArray(result) && result.length > 0 && result.every((item) => item?.type === 'content' && item?.content)
          ? { content: result.map((item) => item.content) }
          : result;
        messageBuffer.addMessage(`Result: ${JSON.stringify(result ?? '').substring(0, 200)}`, 'result');
        session.sendAgentMessage('antigravity', { type: 'tool-result', callId: msg.callId, output, id: randomUUID() });
        break;
      }

      case 'fs-edit':
        messageBuffer.addMessage(`File edit: ${msg.description}`, 'tool');
        session.sendAgentMessage('antigravity', { type: 'file-edit', description: msg.description, filePath: msg.path || 'unknown', id: randomUUID() });
        break;

      case 'permission-request': {
        const payload = (msg.payload ?? {}) as { toolName?: string };
        // Happy's own tools are approved without asking; their tool call alone is shown.
        if (HAPPY_TOOLS_APPROVED_WITHOUT_ASKING.includes(payload.toolName ?? '')) break;
        session.sendAgentMessage('antigravity', {
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
          const configOptions = extractConfigOptionsFromPayload(msg.payload) ?? [];
          const findSelect = (category: string) => configOptions.find((option) => option.type === 'select' && option.category === category);
          const modeOption = findSelect('mode');
          appliedMode = modeOption?.currentValue ?? appliedMode;
          if (modeOption && Array.isArray(modeOption.options)) {
            const values: string[] = [];
            for (const entry of modeOption.options) {
              if ('value' in entry && typeof entry.value === 'string') {
                values.push(entry.value);
              } else if ('options' in entry && Array.isArray(entry.options)) {
                for (const nested of entry.options) {
                  if (nested && typeof nested.value === 'string') values.push(nested.value);
                }
              }
            }
            if (values.length > 0) availableAcpModes = new Set(values);
          }
          appliedModel = findSelect('model')?.currentValue ?? appliedModel;
          appliedEffort = findSelect('thought_level')?.currentValue ?? null;
          displayedModel = appliedModel ?? displayedModel;
          messageBuffer.addMessage(`[MODEL:${displayedModel}]`, 'system');
        }
        if (msg.name === 'modes_update') {
          const modeState = extractModeStateFromPayload(msg.payload);
          if (modeState) {
            appliedMode = modeState.currentModeId;
            if (modeState.availableModes.length > 0) {
              availableAcpModes = new Set(modeState.availableModes.map((mode) => mode.id));
            }
          }
        }
        if (msg.name === 'current_mode_update') {
          appliedMode = extractCurrentModeIdFromPayload(msg.payload) ?? appliedMode;
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
   * Starts agy and its ACP session, restoring `resumeSessionId` when given.
   * Returns the history agy replayed while restoring.
   */
  const startBackend = async (resumeSessionId?: string): Promise<SessionNotification['update'][]> => {
    const replayed: SessionNotification['update'][] = [];
    const backend = createAntigravityBackend({
      cwd: process.cwd(),
      mcpServers,
      permissionHandler,
      resumeSessionId,
      onReplayedUpdate: (update) => replayed.push(update),
    });
    backend.onMessage(handleBackendMessage);
    appliedMode = null;
    availableAcpModes = null;
    appliedModel = null;
    appliedEffort = null;
    contextUsage = null;
    try {
      await backend.startSession();
    } catch (error) {
      await backend.dispose();
      throw error;
    }
    antigravityBackend = backend;
    defaultModel ??= appliedModel;
    const antigravitySessionId = backend.getSessionId() ?? undefined;
    session.updateMetadata((current) => ({ ...current, antigravitySessionId }));
    usageReportedThrough = antigravityUsageAfter(antigravitySessionId ? await readAntigravityTranscript(antigravitySessionId) : [], -1).lastStep;
    logger.debug('[Antigravity] Session started', { antigravitySessionId, resumeSessionId, appliedMode, appliedModel });
    return replayed;
  };

  const applyPermissionMode = async (backend: AcpBackend, mode: PermissionMode) => {
    permissionHandler!.setPermissionMode(mode);
    const requestedAcpMode = ANTIGRAVITY_ACP_MODES[mode as AntigravityPermissionMode] ?? 'default';
    const acpMode = resolveAntigravityAcpMode(mode, availableAcpModes);
    const unavailableAcpMode = acpMode === requestedAcpMode ? null : requestedAcpMode;
    // Told once per switch, not on every prompt, so the app explains why the session runs in Default.
    if (unavailableAcpMode && unavailableAcpMode !== notifiedUnavailableAcpMode) {
      logger.debug(`[Antigravity] Mode ${unavailableAcpMode} is unavailable on this host; falling back to ${acpMode}`);
      session.sendSessionEvent({
        type: 'message',
        message: `No terminal sandbox on this machine for ${unavailableAcpMode} mode; using Default`,
      });
    }
    notifiedUnavailableAcpMode = unavailableAcpMode;
    if (appliedMode === acpMode) return;
    const applied = await backend.setSessionConfigOption('mode', acpMode);
    logger.debug(`[Antigravity] Set mode ${acpMode} for ${mode}: ${applied}`);
    if (!applied && acpMode !== 'default' && appliedMode !== 'default') {
      const fallbackApplied = await backend.setSessionConfigOption('mode', 'default');
      logger.debug(`[Antigravity] Fallback to default mode after ${acpMode} failed: ${fallbackApplied}`);
    }
  };

  const promptImages = async (text: string, images: ImageContent[] | undefined) => images
    ? (await formatMessageForGemini(text, images)).parts.flatMap((part) => 'inlineData' in part && part.inlineData
      ? [{ data: part.inlineData.data, mimeType: part.inlineData.mimeType }]
      : [])
    : undefined;

  const handleAbort = async () => {
    logger.debug('[Antigravity] Abort requested');
    abortRequested = true;
    setThinking(false);
    messageQueue.reset();
    const sessionId = antigravityBackend?.getSessionId();
    if (antigravityBackend && sessionId) {
      await antigravityBackend.cancel(sessionId).catch((error) => logger.debug('[Antigravity] Cancel failed', error));
    }
  };

  const handleKillSession = async () => {
    logger.debug('[Antigravity] Kill session requested');
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
      await antigravityBackend?.dispose();
      process.exit(0);
    } catch (error) {
      logger.debug('[Antigravity] Error during session termination', error);
      process.exit(1);
    }
  };

  session.rpcHandlerManager.registerHandler('abort', handleAbort);
  registerKillSessionHandler(session, handleKillSession);
  session.rpcHandlerManager.registerHandler<{ mode?: PermissionMode }, boolean>('permission-mode-changed', async (payload) => {
    const mode = payload?.mode;
    if (!mode || !isPermissionModeForAgent('antigravity', mode)) {
      logger.debug('[Antigravity] Invalid permission mode via rpc', { mode });
      return false;
    }
    desiredPermissionMode = mode;
    if (antigravityBackend) await applyPermissionMode(antigravityBackend, mode);
    return true;
  });

  if (hasTTY) {
    console.clear();
    inkInstance = render(React.createElement(() => React.createElement(GeminiDisplay, {
      messageBuffer,
      logPath: isDebug() ? logger.getLogPath() : undefined,
      currentModel: displayedModel,
      agentLabel: 'Antigravity Agent',
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
  // Start agy up front so the app gets the account's models right away and a resumed
  // session shows its history before the first new message. Only a resume reports
  // thinking: the server queues messages sent meanwhile until its history is in.
  //

  try {
    setThinking(!!resumeSessionId);
    const replayed = await startBackend(resumeSessionId);
    const restored = !!resumeSessionId && antigravityBackend!.getSessionId() === resumeSessionId;
    if (restored) {
      for (let i = 0; i < 150 && !session.isConnected(); i++) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      await session.sendBackfillBatch(buildAcpBackfillMessages(replayed, resumeSessionId, 'antigravity'), 'replace');
      sendContextUsage();
      messageBuffer.addMessage('Resumed previous Antigravity conversation', 'status');
    } else if (resumeSessionId) {
      sendAgentText('The previous Antigravity conversation could not be restored, so this session starts fresh.');
    }
  } catch (error) {
    logger.debug('[Antigravity] Failed to start agy', error);
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
      // An abort resets the queue, which wakes this wait without a batch.
      if (!batch) {
        if (messageQueue.isClosed()) break;
        continue;
      }

      if (parseClear(batch.message).isClear) {
        messageBuffer.addMessage('Context was reset', 'status');
        session.sendSessionEvent({ type: 'message', message: 'Context was reset' });
        await antigravityBackend?.dispose();
        antigravityBackend = null;
        permissionHandler.reset();
        permissionHandler.clearSessionApprovals();
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
      setThinking(true);

      try {
        if (!antigravityBackend) await startBackend();
        const backend = antigravityBackend!;
        const model = batch.mode.model ?? defaultModel;
        if (model && model !== appliedModel) {
          const applied = await backend.setSessionConfigOption('model', model);
          logger.debug(`[Antigravity] Set model ${model}: ${applied}`);
        }
        // Switching models resets the thinking level to the model's own default, so this follows the model.
        if (batch.mode.effort && batch.mode.effort !== appliedEffort) {
          const applied = await backend.setSessionConfigOption('thought_level', batch.mode.effort);
          logger.debug(`[Antigravity] Set thinking level ${batch.mode.effort}: ${applied}`);
        }
        // Apply permission mode after model/thinking updates: agy can reset mode back to default when model changes.
        await applyPermissionMode(backend, batch.mode.permissionMode);

        const images = await promptImages(batch.message, batch.mode.images);
        await backend.sendPrompt(backend.getSessionId()!, batch.message, { images });
        // The ACP SDK dispatches notifications without awaiting them, so the last
        // chunks of the turn can still be queued when the prompt response resolves.
        await new Promise((resolve) => setImmediate(resolve));
      } catch (error) {
        logger.debug('[Antigravity] Turn failed', error);
        flushResponse();
        if (!abortRequested) sendAgentText(describeError(error));
      } finally {
        flushResponse();
        permissionHandler.reset();
        sendContextUsage();
        const usageSessionId = antigravityBackend?.getSessionId();
        if (usageSessionId) reportUsage(usageSessionId).catch((error) => logger.debug('[Antigravity] Cannot report usage', error));
        if (abortRequested) {
          sendAbortFeedback();
        } else {
          session.sendAgentMessage('antigravity', { type: 'task_complete', id: randomUUID() });
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
    logger.debug('[Antigravity] Final cleanup');
    reconnectionHandle?.cancel();
    try {
      // The loop ended on its own (exit from the UI): the session ended, so the app must not list
      // it as disconnected and waiting to be resumed.
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
      logger.debug('[Antigravity] Error while closing session', error);
    }
    await antigravityBackend?.dispose();
    mcp.stop();
    if (hasTTY) {
      try { process.stdin.setRawMode(false); process.stdin.pause(); } catch { /* ignore */ }
    }
    clearInterval(keepAliveInterval);
    inkInstance?.unmount();
    messageBuffer.clear();
  }
}
