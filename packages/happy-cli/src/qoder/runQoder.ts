/**
 * Qoder CLI Entry Point
 *
 * Runs Qoder CLI (`qodercli --acp`) as a Happy session. Unlike the Gemini runner,
 * one qodercli process serves the whole session: mode, model and effort changes are
 * applied in place over ACP before each prompt, and a resumed session restores
 * its conversation with `session/load` and backfills that history into the app.
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
import type { AcpBackend } from '@/agent/acp/AcpBackend';
import type { AgentMessage } from '@/agent';
import { handleConfigMetadataEvent } from '@/agent/acp/sessionUpdateHandlers';
import { extractConfigOptionsFromPayload } from '@/agent/acp/sessionConfigMetadata';
import { createQoderBackend } from '@/agent/factories/qoder';
import { GeminiDisplay } from '@/ui/ink/GeminiDisplay';
import type { ImageContent, PermissionMode } from '@/api/types';
import { formatMessageForGemini } from '@/utils/formatImageMessage';
import { getFirstTurnInstruction } from '@/orchestrator/firstTurnInstruction';
import { parseOptionsFromText } from '@/gemini/utils/optionsParser';
import { QoderPermissionHandler } from '@/qoder/utils/permissionHandler';
import { buildQoderBackfillMessages } from '@/qoder/utils/backfill';
import { buildQoderFirstTurnPrompt } from '@/qoder/prompt';
import {
  QODER_RESUME_SESSION_ID_ENV,
  isQoderAuthError,
  qoderAuthErrorMessage,
  resolveQoderCommand,
} from '@/qoder/constants';

type QoderMode = {
  permissionMode: PermissionMode;
  /** Qoder model id; null means the account default reported by qodercli. */
  model: string | null;
  /** Reasoning effort; null means the one qodercli picks for the model. */
  effort: string | null;
  originalUserMessage: string;
  images?: ImageContent[];
};

const INTERRUPTED_MESSAGE = '[Request interrupted by user]';

export async function runQoder(opts: {
  credentials: Credentials;
  startedBy?: 'daemon' | 'terminal';
}): Promise<void> {
  const sessionTag = randomUUID();
  const qoderCommand = resolveQoderCommand();
  connectionState.setBackend('Qoder');

  const api = await ApiClient.create(opts.credentials);

  const settings = await readSettings();
  const machineId = settings?.machineId;
  if (!machineId) {
    logger.debug('[Qoder] No machine ID found in settings');
    process.exit(1);
  }
  await api.getOrCreateMachine({ machineId, metadata: initialMachineMetadata });

  //
  // Happy session
  //

  const { state, metadata } = createSessionMetadata({ flavor: 'qoder', machineId, startedBy: opts.startedBy });
  const response = await api.getOrCreateSession({ tag: sessionTag, metadata, state });

  let session: ApiSessionClient;
  let permissionHandler: QoderPermissionHandler | undefined;
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
  adoptSession(initialSession);
  session = initialSession;

  const sessionTitle = process.env.HAPPY_SESSION_TITLE?.trim();
  if (sessionTitle) {
    session.updateMetadata((current) => ({ ...current, summary: { text: sessionTitle, updatedAt: Date.now() } }));
  }

  if (response) {
    const result = await notifyDaemonSessionStarted(response.id, metadata).catch((error) => ({ error }));
    logger.debug('[Qoder] Reported session to daemon', result);
  }

  //
  // Incoming user messages
  //

  const messageQueue = new MessageQueue2<QoderMode>((mode) => hashObject({
    permissionMode: mode.permissionMode,
    model: mode.model,
    effort: mode.effort,
  }));

  let desiredPermissionMode: PermissionMode = 'default';
  let desiredModel: string | null = null;
  let desiredEffort: string | null = null;
  let isFirstMessage = true;
  const firstTurnInstruction = getFirstTurnInstruction(process.env, { includeOrchestrator: true });

  session.onUserMessage((message) => {
    const requestedMode = message.meta?.permissionMode;
    if (requestedMode && isPermissionModeForAgent('qoder', requestedMode)) {
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
      ? buildQoderFirstTurnPrompt({ appendSystemPrompt: message.meta?.appendSystemPrompt, firstTurnInstruction, userMessage })
      : userMessage;
    isFirstMessage = false;

    messageQueue.push(prompt, {
      permissionMode: desiredPermissionMode,
      model: desiredModel,
      effort: desiredEffort,
      originalUserMessage,
      images: images.length > 0 ? images : undefined,
    });
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
      api.push().sendCompletionToAllDevices("It's ready!", 'Qoder is waiting for your command', { sessionId: session.sessionId });
    } catch (pushError) {
      logger.debug('[Qoder] Failed to send ready push', pushError);
    }
    session.flush().finally(() => {
      session.updateAgentState((current) => ({ ...current, taskCompleted: Date.now() }));
    });
  };

  const sendAgentText = (text: string) => {
    messageBuffer.addMessage(text, 'status');
    session.sendAgentMessage('qoder', { type: 'message', message: text });
  };

  //
  // Qoder backend
  //

  const mcp = await createMcpContext(session);
  const mcpServers = mcp.configForHttp();
  permissionHandler = new QoderPermissionHandler(session, api.push());

  // Typed through a cast: TS would otherwise narrow it to null, since only closures assign it.
  let qoderBackend = null as AcpBackend | null;
  // Values qodercli last reported for its `mode`, `model` and effort config options.
  let appliedMode: string | null = null;
  let appliedModel: string | null = null;
  let appliedEffort: string | null = null;
  // The model a fresh qodercli session starts with, used when the app asks for the default.
  let defaultModel: string | null = null;

  let accumulatedResponse = '';
  let abortRequested = false;
  let abortFeedbackSent = false;
  let taskStartedSent = false;

  const sendAbortFeedback = () => {
    if (abortFeedbackSent) return;
    abortFeedbackSent = true;
    sendAgentText(INTERRUPTED_MESSAGE);
    session.sendAgentMessage('qoder', { type: 'turn_aborted', id: randomUUID() });
  };

  /** Sends the text streamed so far as one message, so text and tool calls keep their order. */
  const flushResponse = () => {
    if (!accumulatedResponse.trim()) {
      accumulatedResponse = '';
      return;
    }
    const { text, options, rawOptionsXml } = parseOptionsFromText(accumulatedResponse);
    // The app reads <options> from the message text itself.
    session.sendAgentMessage('qoder', { type: 'message', message: options.length > 0 ? text + rawOptionsXml : text });
    accumulatedResponse = '';
  };

  const describeError = (error: unknown): string => {
    const detail = error instanceof Error
      ? [error.message, JSON.stringify((error as { data?: unknown }).data ?? '')].join(' ')
      : JSON.stringify(error);
    if (isQoderAuthError(detail)) return qoderAuthErrorMessage(qoderCommand);
    if (detail.includes('ENOENT')) {
      return `Qoder CLI (${qoderCommand}) was not found. Install it with \`curl -fsSL https://qoder.com/install | bash\` (China: \`curl -fsSL https://qoder.com.cn/install | bash\`), then start the session again.`;
    }
    return error instanceof Error ? error.message : detail;
  };

  const handleBackendMessage = (msg: AgentMessage) => {
    switch (msg.type) {
      case 'model-output':
        if (!msg.textDelta) break;
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
        logger.debug(`[Qoder] Status: ${msg.status}`, msg.detail);
        if (msg.status === 'running' && !taskStartedSent) {
          taskStartedSent = true;
          session.sendAgentMessage('qoder', { type: 'task_started', id: randomUUID() });
          messageBuffer.addMessage('Thinking...', 'system');
        }
        break;

      case 'tool-call': {
        flushResponse();
        const input = inlinePreviewHtmlFileArgs(msg.toolName, msg.args);
        messageBuffer.addMessage(`Executing: ${msg.toolName} ${JSON.stringify(msg.args ?? {}).substring(0, 100)}`, 'tool');
        session.sendAgentMessage('qoder', { type: 'tool-call', name: msg.toolName, callId: msg.callId, input, id: randomUUID() });
        break;
      }

      case 'tool-result': {
        // ACP returns [{ type: 'content', content: {...} }]; the app reads { content: [...] }.
        const result = msg.result;
        const output = Array.isArray(result) && result.length > 0 && result.every((item) => item?.type === 'content' && item?.content)
          ? { content: result.map((item) => item.content) }
          : result;
        messageBuffer.addMessage(`Result: ${JSON.stringify(result ?? '').substring(0, 200)}`, 'result');
        session.sendAgentMessage('qoder', { type: 'tool-result', callId: msg.callId, output, id: randomUUID() });
        break;
      }

      case 'fs-edit':
        messageBuffer.addMessage(`File edit: ${msg.description}`, 'tool');
        session.sendAgentMessage('qoder', { type: 'file-edit', description: msg.description, filePath: msg.path || 'unknown', id: randomUUID() });
        break;

      case 'permission-request': {
        const payload = (msg.payload ?? {}) as { toolName?: string };
        session.sendAgentMessage('qoder', {
          type: 'permission-request',
          permissionId: msg.id,
          toolName: payload.toolName || msg.reason || 'unknown',
          description: msg.reason || payload.toolName || '',
          options: payload,
        });
        break;
      }

      case 'event': {
        if (msg.name === 'config_options_update') {
          const configOptions = extractConfigOptionsFromPayload(msg.payload) ?? [];
          const current = (category: string) => configOptions.find((option) => option.type === 'select' && option.category === category)?.currentValue ?? null;
          appliedMode = current('mode') ?? appliedMode;
          appliedModel = current('model') ?? appliedModel;
          appliedEffort = current('thought_level');
          displayedModel = appliedModel ?? displayedModel;
          messageBuffer.addMessage(`[MODEL:${displayedModel}]`, 'system');
        }
        if (handleConfigMetadataEvent(msg.name, msg.payload, session.updateMetadata.bind(session), session.updateCapabilities.bind(session))) {
          break;
        }
        if (msg.name === 'thinking') {
          const text = String((msg.payload as { text?: string } | undefined)?.text ?? '');
          messageBuffer.updateLastMessage(`[Thinking] ${text.substring(0, 100)}...`, 'system');
          session.sendAgentMessage('qoder', { type: 'thinking', text });
        }
        break;
      }

      default:
        break;
    }
  };

  /**
   * Starts qodercli and its ACP session, restoring `resumeSessionId` when given.
   * Returns the history qodercli replayed while restoring.
   */
  const startBackend = async (resumeSessionId?: string): Promise<SessionNotification['update'][]> => {
    const replayed: SessionNotification['update'][] = [];
    const backend = createQoderBackend({
      cwd: process.cwd(),
      mcpServers,
      permissionHandler,
      resumeSessionId,
      onReplayedUpdate: (update) => replayed.push(update),
    });
    backend.onMessage(handleBackendMessage);
    appliedMode = null;
    appliedModel = null;
    try {
      await backend.startSession();
    } catch (error) {
      await backend.dispose();
      throw error;
    }
    qoderBackend = backend;
    defaultModel = appliedModel;
    const qoderSessionId = backend.getSessionId() ?? undefined;
    session.updateMetadata((current) => ({ ...current, qoderSessionId }));
    logger.debug('[Qoder] Session started', { qoderSessionId, resumeSessionId, appliedMode, appliedModel });
    return replayed;
  };

  const applyPermissionMode = async (backend: AcpBackend, mode: PermissionMode) => {
    if (appliedMode === mode) return;
    const applied = await backend.setSessionConfigOption('mode', mode);
    logger.debug(`[Qoder] Set mode ${mode}: ${applied}`);
  };

  const handleAbort = async () => {
    logger.debug('[Qoder] Abort requested');
    abortRequested = true;
    setThinking(false);
    messageQueue.reset();
    const sessionId = qoderBackend?.getSessionId();
    if (qoderBackend && sessionId) {
      await qoderBackend.cancel(sessionId).catch((error) => logger.debug('[Qoder] Cancel failed', error));
    }
  };

  const handleKillSession = async () => {
    logger.debug('[Qoder] Kill session requested');
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
      await qoderBackend?.dispose();
      process.exit(0);
    } catch (error) {
      logger.debug('[Qoder] Error during session termination', error);
      process.exit(1);
    }
  };

  session.rpcHandlerManager.registerHandler('abort', handleAbort);
  registerKillSessionHandler(session.rpcHandlerManager, handleKillSession);
  session.rpcHandlerManager.registerHandler<{ mode?: PermissionMode }, boolean>('permission-mode-changed', async (payload) => {
    const mode = payload?.mode;
    if (!mode || !isPermissionModeForAgent('qoder', mode)) {
      logger.debug('[Qoder] Invalid permission mode via rpc', { mode });
      return false;
    }
    desiredPermissionMode = mode;
    if (qoderBackend) await applyPermissionMode(qoderBackend, mode);
    return true;
  });

  if (hasTTY) {
    console.clear();
    inkInstance = render(React.createElement(() => React.createElement(GeminiDisplay, {
      messageBuffer,
      logPath: isDebug() ? logger.getLogPath() : undefined,
      currentModel: displayedModel,
      agentLabel: 'Qoder Agent',
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
  // Start qodercli up front so the app gets the account's models right away and a
  // resumed session shows its history before the first new message.
  //

  const resumeSessionId = process.env[QODER_RESUME_SESSION_ID_ENV]?.trim() || undefined;
  try {
    setThinking(true);
    const replayed = await startBackend(resumeSessionId);
    const restored = !!resumeSessionId && qoderBackend!.getSessionId() === resumeSessionId;
    if (restored) {
      for (let i = 0; i < 15 && !session.isConnected(); i++) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      await session.sendBackfillBatch(buildQoderBackfillMessages(replayed), 'replace');
      messageBuffer.addMessage('Resumed previous Qoder conversation', 'status');
    } else if (resumeSessionId) {
      sendAgentText('The previous Qoder conversation could not be restored, so this session starts fresh.');
    }
  } catch (error) {
    logger.debug('[Qoder] Failed to start qodercli', error);
    sendAgentText(describeError(error));
  } finally {
    setThinking(false);
  }
  sendReady();

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
        await qoderBackend?.dispose();
        qoderBackend = null;
        permissionHandler.reset();
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
      setThinking(true);

      try {
        if (!qoderBackend) await startBackend();
        const backend = qoderBackend!;
        await applyPermissionMode(backend, batch.mode.permissionMode);
        const model = batch.mode.model ?? defaultModel;
        if (model && model !== appliedModel) {
          const applied = await backend.setSessionConfigOption('model', model);
          logger.debug(`[Qoder] Set model ${model}: ${applied}`);
        }
        // Switching models resets the effort to the model's own default, so this follows the model.
        if (batch.mode.effort && batch.mode.effort !== appliedEffort) {
          const applied = await backend.setSessionConfigOption('reasoning_effort', batch.mode.effort);
          logger.debug(`[Qoder] Set effort ${batch.mode.effort}: ${applied}`);
        }

        const images = batch.mode.images
          ? (await formatMessageForGemini(batch.message, batch.mode.images)).parts.flatMap((part) => 'inlineData' in part && part.inlineData
            ? [{ data: part.inlineData.data, mimeType: part.inlineData.mimeType }]
            : [])
          : undefined;
        await backend.sendPrompt(backend.getSessionId()!, batch.message, { images });
        // The ACP SDK dispatches notifications without awaiting them, so the last
        // chunks of the turn can still be queued when the prompt response resolves.
        await new Promise((resolve) => setImmediate(resolve));
      } catch (error) {
        logger.debug('[Qoder] Turn failed', error);
        flushResponse();
        if (!abortRequested) sendAgentText(describeError(error));
      } finally {
        flushResponse();
        permissionHandler.reset();
        if (abortRequested) {
          sendAbortFeedback();
        } else {
          session.sendAgentMessage('qoder', { type: 'task_complete', id: randomUUID() });
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
    logger.debug('[Qoder] Final cleanup');
    reconnectionHandle?.cancel();
    try {
      session.sendSessionDeath();
      await session.flush();
      await session.close();
    } catch (error) {
      logger.debug('[Qoder] Error while closing session', error);
    }
    await qoderBackend?.dispose();
    mcp.stop();
    if (hasTTY) {
      try { process.stdin.setRawMode(false); process.stdin.pause(); } catch { /* ignore */ }
    }
    clearInterval(keepAliveInterval);
    inkInstance?.unmount();
    messageBuffer.clear();
  }
}
