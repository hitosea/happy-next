import { render } from 'ink';
import React from 'react';
import { randomUUID } from 'node:crypto';

import { ApiClient } from '@/api/api';
import { logger } from '@/ui/logger';
import { isDebug } from '@/utils/env';
import { Credentials, readSettings } from '@/persistence';
import { createSessionMetadata } from '@/utils/createSessionMetadata';
import { initialMachineMetadata } from '@/daemon/run';
import { configuration } from '@/configuration';
import { MessageQueue2 } from '@/utils/MessageQueue2';
import { hashObject } from '@/utils/deterministicJson';
import { createMcpContext } from '@/agent/mcp';
import { MessageBuffer } from '@/ui/ink/messageBuffer';
import { notifyDaemonSessionStarted } from '@/daemon/controlClient';
import { registerKillSessionHandler } from '@/claude/registerKillSessionHandler';
import { stopCaffeinate } from '@/utils/caffeinate';
import { connectionState } from '@/utils/serverConnectionErrors';
import { setupOfflineReconnection } from '@/utils/setupOfflineReconnection';
import type { ApiSessionClient } from '@/api/apiSession';
import { parseClear } from '@/parsers/specialCommands';

import { createOpenCodeBackend } from '@/agent/factories/opencode';
import type { AgentBackend, AgentMessage } from '@/agent';
import { handleConfigMetadataEvent } from '@/agent/acp/sessionUpdateHandlers';
import { GeminiDisplay } from '@/ui/ink/GeminiDisplay';
import { OpenCodePermissionHandler } from '@/opencode/utils/permissionHandler';
import { GeminiReasoningProcessor } from '@/gemini/utils/reasoningProcessor';
import { GeminiDiffProcessor } from '@/gemini/utils/diffProcessor';
import type { OpenCodeMode, OpenCodeMessagePayload } from '@/opencode/types';
import type { ImageContent, PermissionMode } from '@/api/types';
import { formatMessageForGemini } from '@/utils/formatImageMessage';
import { getFirstTurnInstruction } from '@/opencode/constants';
import { getInitialOpenCodeModel } from '@/opencode/utils/config';
import {
  parseOptionsFromText,
  hasIncompleteOptions,
} from '@/gemini/utils/optionsParser';
import { summarizeBashToolOutput } from '@/modules/common/loadableToolOutput';

export async function runOpenCode(opts: {
  credentials: Credentials;
  startedBy?: 'daemon' | 'terminal';
}): Promise<void> {

  const sessionTag = randomUUID();

  connectionState.setBackend('OpenCode');

  const api = await ApiClient.create(opts.credentials);

  const settings = await readSettings();
  const machineId = settings?.machineId;
  if (!machineId) {
    console.error(`[START] No machine ID found in settings. Please report this issue.`);
    process.exit(1);
  }
  logger.debug(`Using machineId: ${machineId}`);
  await api.getOrCreateMachine({
    machineId,
    metadata: initialMachineMetadata
  });

  const { state, metadata } = createSessionMetadata({
    flavor: 'opencode',
    machineId,
    startedBy: opts.startedBy
  });
  const response = await api.getOrCreateSession({ tag: sessionTag, metadata, state });

  let session: ApiSessionClient;
  let permissionHandler: OpenCodePermissionHandler;

  let isProcessingMessage = false;
  let pendingSessionSwap: ApiSessionClient | null = null;

  const applyPendingSessionSwap = () => {
    if (pendingSessionSwap) {
      logger.debug('[opencode] Applying pending session swap');
      session = pendingSessionSwap;
      if (permissionHandler) {
        permissionHandler.updateSession(pendingSessionSwap);
      }
      pendingSessionSwap = null;
    }
  };

  const { session: initialSession, reconnectionHandle } = setupOfflineReconnection({
    api,
    sessionTag,
    metadata,
    state,
    response,
    onSessionSwap: (newSession) => {
      if (isProcessingMessage) {
        logger.debug('[opencode] Session swap requested during message processing - queueing');
        pendingSessionSwap = newSession;
      } else {
        session = newSession;
        if (permissionHandler) {
          permissionHandler.updateSession(newSession);
        }
      }
    }
  });
  session = initialSession;

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

  if (response) {
    try {
      logger.debug(`[START] Reporting session ${response.id} to daemon`);
      const result = await notifyDaemonSessionStarted(response.id, metadata);
      if (result.error) {
        logger.debug(`[START] Failed to report to daemon:`, result.error);
      }
    } catch (error) {
      logger.debug('[START] Failed to report to daemon:', error);
    }
  }

  const messageQueue = new MessageQueue2<OpenCodeMode>((mode) => hashObject({
    permissionMode: mode.permissionMode,
    model: mode.model,
  }));

  let currentPermissionMode: PermissionMode | undefined = undefined;
  let currentModel: string | undefined = undefined;
  let currentSessionModel: string | undefined = undefined;

  const normalizeModel = (model: unknown): string | undefined => {
    if (typeof model !== 'string') return undefined;
    const trimmed = model.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  };

  const syncSessionModel = (model: unknown): void => {
    const normalized = normalizeModel(model);
    if (!normalized || normalized === currentSessionModel) return;
    currentSessionModel = normalized;
    session.updateMetadata((currentMetadata) => {
      if (currentMetadata.model === normalized) return currentMetadata;
      return { ...currentMetadata, model: normalized };
    });
  };

  let isFirstMessage = true;
  const firstTurnInstruction = getFirstTurnInstruction();

  session.onUserMessage((message) => {
    let messagePermissionMode = currentPermissionMode;
    if (message.meta?.permissionMode) {
      const validModes: PermissionMode[] = ['default', 'read-only', 'safe-yolo', 'yolo'];
      if (validModes.includes(message.meta.permissionMode as PermissionMode)) {
        messagePermissionMode = message.meta.permissionMode as PermissionMode;
        currentPermissionMode = messagePermissionMode;
        updatePermissionMode(messagePermissionMode);
      }
    }

    if (currentPermissionMode === undefined) {
      currentPermissionMode = 'default';
      updatePermissionMode('default');
    }

    let messageModel = currentModel;
    if (message.meta?.hasOwnProperty('model')) {
      if (message.meta.model === null) {
        messageModel = undefined;
        currentModel = undefined;
      } else if (message.meta.model) {
        const previousModel = currentModel;
        messageModel = message.meta.model;
        currentModel = messageModel;
        if (previousModel !== messageModel) {
          updateDisplayedModel(messageModel);
          messageBuffer.addMessage(`Model changed to: ${messageModel}`, 'system');
        }
      }
    }

    const isMixedContent = message.content.type === 'mixed';
    const originalUserMessage = message.content.text;
    const images: ImageContent[] = isMixedContent && 'images' in message.content
        ? message.content.images
        : [];

    let fullPrompt = originalUserMessage;
    if (isFirstMessage) {
      if (message.meta?.appendSystemPrompt) {
        fullPrompt = message.meta.appendSystemPrompt + '\n\n' + fullPrompt;
      }
      if (firstTurnInstruction) {
        fullPrompt = fullPrompt + '\n\n' + firstTurnInstruction;
      }
      isFirstMessage = false;
    }

    const mode: OpenCodeMode = {
      permissionMode: messagePermissionMode || 'default',
      model: messageModel,
      originalUserMessage,
      images: images.length > 0 ? images : undefined,
    };
    messageQueue.push(fullPrompt, mode);
  });

  let thinking = false;
  session.keepAlive(thinking, 'remote');
  const keepAliveInterval = setInterval(() => {
    session.keepAlive(thinking, 'remote');
  }, 2000);

  const sendReady = () => {
    session.sendSessionEvent({ type: 'ready' });
    try {
      api.push().sendToAllDevices(
        "It's ready!",
        'OpenCode is waiting for your command',
        { sessionId: session.sessionId }
      );
    } catch (pushError) {
      logger.debug('[OpenCode] Failed to send ready push', pushError);
    }
    session.flush().finally(() => {
      session.updateAgentState((state) => ({
        ...state,
        taskCompleted: Date.now()
      }));
    });
  };

  const emitReadyIfIdle = (): boolean => {
    if (shouldExit) return false;
    if (thinking) return false;
    if (isResponseInProgress) return false;
    if (messageQueue.size() > 0) return false;
    sendReady();
    return true;
  };

  let abortController = new AbortController();
  let shouldExit = false;
  let abortRequested = false;
  let abortFeedbackSent = false;
  let openCodeBackend: AgentBackend | null = null;
  let acpSessionId: string | null = null;
  let wasSessionCreated = false;

  async function handleAbort() {
    logger.debug('[OpenCode] Abort requested');
    abortRequested = true;
    thinking = false;
    session.keepAlive(thinking, 'remote');

    if (!abortFeedbackSent) {
      abortFeedbackSent = true;
      messageBuffer.addMessage('Aborted by user', 'status');
      session.sendSessionEvent({ type: 'message', message: 'Aborted by user' });
      session.sendAgentMessage('opencode', {
        type: 'turn_aborted',
        id: randomUUID(),
      });
    }

    reasoningProcessor.abort();
    diffProcessor.reset();

    try {
      abortController.abort();
      messageQueue.reset();
      if (openCodeBackend && acpSessionId) {
        await openCodeBackend.cancel(acpSessionId);
      }
    } catch (error) {
      logger.debug('[OpenCode] Error during abort:', error);
    } finally {
      abortController = new AbortController();
    }
  }

  const handleKillSession = async () => {
    logger.debug('[OpenCode] Kill session requested');
    await handleAbort();

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

      stopCaffeinate();
      mcp.stop();

      if (openCodeBackend) {
        await openCodeBackend.dispose();
      }

      process.exit(0);
    } catch (error) {
      logger.debug('[OpenCode] Error during session termination:', error);
      process.exit(1);
    }
  };

  session.rpcHandlerManager.registerHandler('abort', handleAbort);
  registerKillSessionHandler(session.rpcHandlerManager, handleKillSession);

  const messageBuffer = new MessageBuffer();
  const hasTTY = process.stdout.isTTY && process.stdin.isTTY;
  let inkInstance: ReturnType<typeof render> | null = null;

  let displayedModel: string | undefined = getInitialOpenCodeModel();

  const updateDisplayedModel = (model: string | undefined) => {
    if (model === undefined) return;
    const oldModel = displayedModel;
    displayedModel = model;
    syncSessionModel(model);
    if (hasTTY && oldModel !== model) {
      messageBuffer.addMessage(`[MODEL:${model}]`, 'system');
    }
  };

  if (hasTTY) {
    console.clear();
    const DisplayComponent = () => {
      const currentModelValue = displayedModel || 'opencode';
      return React.createElement(GeminiDisplay, {
        messageBuffer,
        logPath: isDebug() ? logger.getLogPath() : undefined,
        currentModel: currentModelValue,
        onExit: async () => {
          shouldExit = true;
          await handleAbort();
        }
      });
    };

    inkInstance = render(React.createElement(DisplayComponent), {
      exitOnCtrlC: false,
      patchConsole: false
    });

    const initialModelName = displayedModel || 'opencode';
    messageBuffer.addMessage(`[MODEL:${initialModelName}]`, 'system');
  }

  if (hasTTY) {
    process.stdin.resume();
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.setEncoding('utf8');
  }

  const mcp = await createMcpContext(session);
  const mcpServers = mcp.configForHttp();

  permissionHandler = new OpenCodePermissionHandler(session, api.push());

  const reasoningProcessor = new GeminiReasoningProcessor((message) => {
    session.sendAgentMessage('opencode', message);
  });

  const diffProcessor = new GeminiDiffProcessor((message) => {
    session.sendAgentMessage('opencode', message);
  });
  diffProcessor.setSessionId(session.sessionId);

  const updatePermissionMode = (mode: PermissionMode) => {
    permissionHandler.setPermissionMode(mode);
  };

  const validPermissionModes: PermissionMode[] = ['default', 'read-only', 'safe-yolo', 'yolo'];
  session.rpcHandlerManager.registerHandler<{ mode?: PermissionMode }, boolean>(
    'permission-mode-changed',
    async (payload) => {
      const mode = payload?.mode;
      if (!mode || !validPermissionModes.includes(mode)) return false;
      currentPermissionMode = mode;
      updatePermissionMode(mode);
      return true;
    }
  );

  let accumulatedResponse = '';
  let isResponseInProgress = false;
  let hadToolCallInTurn = false;
  let taskStartedSent = false;
  let hadError = false;

  function setupOpenCodeMessageHandler(backend: AgentBackend): void {
    backend.onMessage((msg: AgentMessage) => {

    switch (msg.type) {
      case 'model-output':
        if (msg.textDelta) {
          if (!isResponseInProgress) {
            messageBuffer.removeLastMessage('system');
            messageBuffer.addMessage(msg.textDelta, 'assistant');
            isResponseInProgress = true;
          } else {
            messageBuffer.updateLastMessage(msg.textDelta, 'assistant');
          }
          accumulatedResponse += msg.textDelta;
        }
        break;

      case 'status':
        if (msg.status === 'running') {
          thinking = true;
          session.keepAlive(thinking, 'remote');
          if (!taskStartedSent) {
            session.sendAgentMessage('opencode', {
              type: 'task_started',
              id: randomUUID(),
            });
            taskStartedSent = true;
          }
          messageBuffer.addMessage('Thinking...', 'system');
        } else if (msg.status === 'idle' || msg.status === 'stopped') {
          reasoningProcessor.complete();
        } else if (msg.status === 'error') {
          thinking = false;
          session.keepAlive(thinking, 'remote');
          accumulatedResponse = '';
          isResponseInProgress = false;

          let errorMessage = 'Unknown error';
          if (msg.detail) {
            errorMessage = typeof msg.detail === 'object'
              ? JSON.stringify(msg.detail)
              : String(msg.detail);
          }

          messageBuffer.addMessage(`Error: ${errorMessage}`, 'status');
          session.sendAgentMessage('opencode', {
            type: 'message',
            message: `Error: ${errorMessage}`,
          });
        }
        break;

      case 'tool-call':
        hadToolCallInTurn = true;
        const toolArgs = msg.args ? JSON.stringify(msg.args).substring(0, 100) : '';
        messageBuffer.addMessage(`Executing: ${msg.toolName}${toolArgs ? ` ${toolArgs}` : ''}`, 'tool');
        session.sendAgentMessage('opencode', {
          type: 'tool-call',
          name: msg.toolName,
          callId: msg.callId,
          input: msg.args,
          id: randomUUID(),
        });
        break;

      case 'tool-result': {
        const isError = msg.result && typeof msg.result === 'object' && 'error' in msg.result;
        const resultText = typeof msg.result === 'string'
          ? msg.result.substring(0, 200)
          : JSON.stringify(msg.result).substring(0, 200);

        if (!isError) {
          diffProcessor.processToolResult(msg.toolName, msg.result, msg.callId);
        }

        if (isError) {
          messageBuffer.addMessage(`Error: ${resultText}`, 'status');
        } else {
          messageBuffer.addMessage(`Result: ${resultText}`, 'result');
        }

        let trimmedResult: unknown = msg.result;
        if (Array.isArray(trimmedResult) && trimmedResult.length > 0
            && trimmedResult.every((item: any) => item?.type === 'content' && item?.content)) {
          trimmedResult = {
            content: trimmedResult.map((item: any) => item.content),
          };
        }
        if (msg.toolName === 'OpenCodeBash' && typeof trimmedResult === 'object' && trimmedResult !== null) {
          trimmedResult = summarizeBashToolOutput({
            sessionId: session.sessionId,
            callId: msg.callId,
            toolName: 'OpenCodeBash',
            agent: 'opencode',
            result: trimmedResult,
          });
        }

        session.sendAgentMessage('opencode', {
          type: 'tool-result',
          callId: msg.callId,
          output: trimmedResult,
          id: randomUUID(),
        });
        break;
      }

      case 'fs-edit':
        messageBuffer.addMessage(`File edit: ${msg.description}`, 'tool');
        diffProcessor.processFsEdit(msg.path || '', msg.description, msg.diff);
        session.sendAgentMessage('opencode', {
          type: 'file-edit',
          description: msg.description,
          filePath: msg.path || 'unknown',
          id: randomUUID(),
        });
        break;

      case 'terminal-output':
        break;

      case 'permission-request': {
        const payload = (msg as any).payload || {};
        session.sendAgentMessage('opencode', {
          type: 'permission-request',
          permissionId: msg.id,
          toolName: payload.toolName || (msg as any).reason || 'unknown',
          description: (msg as any).reason || payload.toolName || '',
          options: payload,
        });
        break;
      }

      case 'permission-response':
        break;

      case 'exec-approval-request': {
        const execMsg = msg as any;
        const callId = execMsg.call_id || execMsg.callId || randomUUID();
        const { call_id, type, ...inputs } = execMsg;
        messageBuffer.addMessage(`Exec approval requested: ${callId}`, 'tool');
        session.sendAgentMessage('opencode', {
          type: 'tool-call',
          name: 'OpenCodeBash',
          callId,
          input: inputs,
          id: randomUUID(),
        });
        break;
      }

      case 'patch-apply-begin': {
        const patchMsg = msg as any;
        const patchCallId = patchMsg.call_id || patchMsg.callId || randomUUID();
        const changes = patchMsg.changes || {};
        const changeCount = Object.keys(changes).length;
        messageBuffer.addMessage(`Modifying ${changeCount === 1 ? '1 file' : `${changeCount} files`}...`, 'tool');

        const trimmedChanges: Record<string, Record<string, boolean>> = {};
        for (const [filePath, change] of Object.entries(changes as Record<string, any>)) {
          const ops: Record<string, boolean> = {};
          if (change.add) ops.add = true;
          if (change.modify) ops.modify = true;
          if (change.delete) ops.delete = true;
          trimmedChanges[filePath] = ops;
        }

        session.sendAgentMessage('opencode', {
          type: 'tool-call',
          name: 'OpenCodePatch',
          callId: patchCallId,
          input: { auto_approved: patchMsg.auto_approved, changes: trimmedChanges },
          id: randomUUID(),
        });
        break;
      }

      case 'patch-apply-end': {
        const patchEndMsg = msg as any;
        const patchEndCallId = patchEndMsg.call_id || patchEndMsg.callId || randomUUID();
        if (patchEndMsg.success) {
          messageBuffer.addMessage((patchEndMsg.stdout || 'Files modified successfully').substring(0, 200), 'result');
        } else {
          messageBuffer.addMessage(`Error: ${(patchEndMsg.stderr || 'Failed').substring(0, 200)}`, 'result');
        }
        session.sendAgentMessage('opencode', {
          type: 'tool-result',
          callId: patchEndCallId,
          output: { stdout: patchEndMsg.stdout, stderr: patchEndMsg.stderr, success: patchEndMsg.success },
          id: randomUUID(),
        });
        break;
      }

      case 'event':
        if (handleConfigMetadataEvent(msg.name, msg.payload, session.updateMetadata.bind(session))) {
          break;
        }
        if (msg.name === 'thinking') {
          const thinkingPayload = msg.payload as { text?: string } | undefined;
          const thinkingText = thinkingPayload?.text ? String(thinkingPayload.text) : '';
          if (thinkingText) {
            reasoningProcessor.processChunk(thinkingText);
            if (!thinkingText.startsWith('**')) {
              messageBuffer.updateLastMessage(`[Thinking] ${thinkingText.substring(0, 100)}...`, 'system');
            }
            session.sendAgentMessage('opencode', {
              type: 'thinking',
              text: thinkingText,
            });
          }
        }
        break;

      default:
        if ((msg as any).type === 'token-count') {
          session.sendAgentMessage('opencode', {
            type: 'token_count',
            ...(msg as any),
            ...(currentSessionModel ? { model: currentSessionModel } : {}),
            id: randomUUID(),
          });
        }
        break;
    }
    });
  }

  let first = true;

  try {
    let currentModeHash: string | null = null;
    let pending: { message: string; mode: OpenCodeMode; isolate: boolean; hash: string } | null = null;

    while (!shouldExit) {
      let message: { message: string; mode: OpenCodeMode; isolate: boolean; hash: string } | null = pending;
      pending = null;

      if (!message) {
        const waitSignal = abortController.signal;
        const batch = await messageQueue.waitForMessagesAndGetAsString(waitSignal);
        if (!batch) {
          if (waitSignal.aborted && !shouldExit) continue;
          break;
        }
        message = batch;
      }

      if (!message) break;

      if (parseClear(message.message).isClear) {
        messageBuffer.addMessage('Context was reset', 'status');
        session.sendSessionEvent({ type: 'message', message: 'Context was reset' });
        if (openCodeBackend) {
          await openCodeBackend.dispose();
          openCodeBackend = null;
        }
        acpSessionId = null;
        wasSessionCreated = false;
        currentModeHash = null;
        permissionHandler.reset();
        reasoningProcessor.abort();
        thinking = false;
        sendReady();
        continue;
      }

      if (wasSessionCreated && currentModeHash && message.hash !== currentModeHash) {
        messageBuffer.addMessage('Starting new OpenCode session (mode changed)...', 'status');
        permissionHandler.reset();
        reasoningProcessor.abort();

        if (openCodeBackend) {
          await openCodeBackend.dispose();
          openCodeBackend = null;
        }

        const modelToUse = message.mode?.model === undefined ? undefined : (message.mode.model || null);
        const backendResult = createOpenCodeBackend({
          cwd: process.cwd(),
          mcpServers,
          permissionHandler,
          normalizeToolName: mcp.normalizeToolName.bind(mcp),
          model: modelToUse,
        });
        openCodeBackend = backendResult.backend;
        setupOpenCodeMessageHandler(openCodeBackend);

        const { sessionId } = await openCodeBackend.startSession();
        acpSessionId = sessionId;
        if (backendResult.model !== 'default' && openCodeBackend.setSessionModel) {
          const ok = await openCodeBackend.setSessionModel(backendResult.model);
          if (!ok) {
            messageBuffer.addMessage(`Warning: could not switch model to ${backendResult.model}`, 'status');
          }
        }
        updateDisplayedModel(backendResult.model);
        updatePermissionMode(message.mode.permissionMode);
        wasSessionCreated = true;
        currentModeHash = message.hash;
        first = false;
      }

      currentModeHash = message.hash;
      const userMessageToShow = message.mode?.originalUserMessage || message.message;
      messageBuffer.addMessage(userMessageToShow, 'user');

      isProcessingMessage = true;

      try {
        if (first || !wasSessionCreated) {
          thinking = true;
          session.keepAlive(thinking, 'remote');

          if (!openCodeBackend) {
            const modelToUse = message.mode?.model === undefined ? undefined : (message.mode.model || null);
            const backendResult = createOpenCodeBackend({
              cwd: process.cwd(),
              mcpServers,
              permissionHandler,
              normalizeToolName: mcp.normalizeToolName.bind(mcp),
              model: modelToUse,
            });
            openCodeBackend = backendResult.backend;
            setupOpenCodeMessageHandler(openCodeBackend);
            updateDisplayedModel(backendResult.model);
          }

          if (!acpSessionId) {
            updatePermissionMode(message.mode.permissionMode);
            const { sessionId } = await openCodeBackend.startSession();
            acpSessionId = sessionId;
            const resolvedModel = currentModel || getInitialOpenCodeModel();
            if (resolvedModel !== 'default' && openCodeBackend.setSessionModel) {
              const ok = await openCodeBackend.setSessionModel(resolvedModel);
              if (!ok) {
                messageBuffer.addMessage(`Warning: could not switch model to ${resolvedModel}`, 'status');
              }
            }
            wasSessionCreated = true;
            currentModeHash = message.hash;
          }
        }

        if (!acpSessionId) {
          throw new Error('ACP session not started');
        }

        abortRequested = false;
        abortFeedbackSent = false;
        accumulatedResponse = '';
        isResponseInProgress = false;
        hadToolCallInTurn = false;
        taskStartedSent = false;

        if (!openCodeBackend || !acpSessionId) {
          throw new Error('OpenCode backend or session not initialized');
        }

        let promptToSend = message.message;

        let promptImages: { data: string; mimeType: string }[] | undefined;
        if (message.mode.images && message.mode.images.length > 0) {
          const formattedContent = await formatMessageForGemini(promptToSend, message.mode.images);
          promptImages = formattedContent.parts
            .filter((part): part is { inlineData: { mimeType: string; data: string } } =>
              'inlineData' in part && part.inlineData !== undefined
            )
            .map(part => ({
              data: part.inlineData.data,
              mimeType: part.inlineData.mimeType,
            }));
        }

        const MAX_RETRIES = 3;
        const RETRY_DELAY_MS = 2000;

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
          try {
            await openCodeBackend.sendPrompt(acpSessionId, promptToSend, { images: promptImages });
            if (openCodeBackend.waitForResponseComplete) {
              await openCodeBackend.waitForResponseComplete(120000);
            }
            break;
          } catch (promptError) {
            const errObj = promptError as any;
            const errorDetails = errObj?.data?.details || errObj?.details || errObj?.message || '';
            const isRetryable = errorDetails.includes('empty response') || errObj?.code === -32603;

            if (isRetryable && attempt < MAX_RETRIES) {
              messageBuffer.addMessage(`OpenCode returned empty response, retrying (${attempt}/${MAX_RETRIES})...`, 'status');
              await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * attempt));
              continue;
            }
            throw promptError;
          }
        }

        if (first) first = false;
      } catch (error) {
        const isAbortError = error instanceof Error && error.name === 'AbortError';
        const isUserAbort = isAbortError || abortRequested;

        if (isUserAbort && !abortFeedbackSent) {
          abortFeedbackSent = true;
          messageBuffer.addMessage('Aborted by user', 'status');
          session.sendAgentMessage('opencode', {
            type: 'turn_aborted',
            id: randomUUID(),
          });
        } else if (!isUserAbort) {
          hadError = true;
          let errorMsg = 'Process error occurred';
          if (error instanceof Error) {
            errorMsg = error.message;
          } else if (typeof error === 'object' && error !== null) {
            const errObj = error as any;
            errorMsg = errObj.data?.details || errObj.message || errorMsg;
          }
          messageBuffer.addMessage(errorMsg, 'status');
          session.sendAgentMessage('opencode', {
            type: 'message',
            message: errorMsg,
          });
        }
      } finally {
        permissionHandler.reset();
        reasoningProcessor.abort();
        diffProcessor.reset();

        if (accumulatedResponse.trim()) {
          const { text: messageText, options, rawOptionsXml } = parseOptionsFromText(accumulatedResponse);

          let finalMessageText = messageText;
          if (options.length > 0) {
            finalMessageText = messageText + rawOptionsXml;
          }

          const messagePayload: OpenCodeMessagePayload = {
            type: 'message',
            message: finalMessageText,
            id: randomUUID(),
            ...(options.length > 0 && { options }),
          };

          session.sendAgentMessage('opencode', messagePayload);
          accumulatedResponse = '';
          isResponseInProgress = false;
        }

        if (abortRequested && !abortFeedbackSent) {
          abortFeedbackSent = true;
          session.sendAgentMessage('opencode', {
            type: 'turn_aborted',
            id: randomUUID(),
          });
        }

        if (!abortRequested && !hadError) {
          session.sendAgentMessage('opencode', {
            type: 'task_complete',
            id: randomUUID(),
          });
        }

        abortRequested = false;
        abortFeedbackSent = false;
        hadToolCallInTurn = false;
        taskStartedSent = false;
        hadError = false;

        thinking = false;
        session.keepAlive(thinking, 'remote');
        emitReadyIfIdle();

        isProcessingMessage = false;
        applyPendingSessionSwap();
      }
    }

  } finally {
    logger.debug('[opencode]: Final cleanup start');

    if (reconnectionHandle) {
      reconnectionHandle.cancel();
    }

    try {
      session.sendSessionDeath();
      await session.flush();
      await session.close();
    } catch (e) {
      logger.debug('[opencode]: Error while closing session', e);
    }

    if (openCodeBackend) {
      await openCodeBackend.dispose();
    }

    mcp.stop();

    if (process.stdin.isTTY) {
      try { process.stdin.setRawMode(false); } catch { /* ignore */ }
    }
    if (hasTTY) {
      try { process.stdin.pause(); } catch { /* ignore */ }
    }

    clearInterval(keepAliveInterval);
    if (inkInstance) {
      inkInstance.unmount();
    }
    messageBuffer.clear();

    logger.debug('[opencode]: Final cleanup completed');
  }
}
