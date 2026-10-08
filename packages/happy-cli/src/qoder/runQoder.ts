/**
 * Qoder CLI Entry Point
 *
 * Runs the Qoder agent through Happy CLI: owns the agent lifecycle, mirrors it into a
 * Happy session, and translates normalised ACP events into the message vocabulary the
 * mobile/web app renders.
 *
 * Shaped after src/gemini/runGemini.ts but deliberately smaller, because Qoder does
 * not need the two heaviest parts of the Gemini runner:
 *
 * - No JSONL transcript (sessionWriter / sessionReader / sessionFork / backfill). Qoder
 *   advertises ACP `loadSession` plus session list/fork/resume, so its own on-disk
 *   history is the source of truth. Happy stores just the native session id in metadata
 *   and hands it back on relaunch.
 * - No vendor OAuth token fetch. Qoder authenticates as a signed-in account
 *   (`qodercli login`), which Happy cannot hold or refresh, so there is no
 *   `happy connect qoder` step here.
 */

import { render } from 'ink';
import React from 'react';
import { randomUUID } from 'node:crypto';

import { ApiClient } from '@/api/api';
import { isPermissionModeForAgent, type QoderPermissionMode } from 'happy-wire';
import { logger } from '@/ui/logger';
import { isDebug } from '@/utils/env';
import { readSettings, type Credentials } from '@/persistence';
import { createSessionMetadata } from '@/utils/createSessionMetadata';
import { initialMachineMetadata } from '@/daemon/run';
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
import { addBuiltinSlashCommands, expandBuiltinSlashCommand, syncBuiltinCommands } from '@/commands/builtinCommands';
import type { ImageContent, PermissionMode } from '@/api/types';
import { getFirstTurnInstruction } from '@/orchestrator/firstTurnInstruction';

import { createQoderBackend } from '@/agent/factories/qoder';
import type { AgentBackend, AgentMessage } from '@/agent';
import { handleConfigMetadataEvent } from '@/agent/acp/sessionUpdateHandlers';
import { GeminiDisplay } from '@/ui/ink/GeminiDisplay';
import { QoderPermissionHandler } from '@/qoder/utils/permissionHandler';
import { QODER_MODEL_ENV, QODER_RESUME_SESSION_ID_ENV, isQoderAuthError, qoderAuthErrorMessage } from '@/qoder/constants';
import type { PromptImageContent } from '@/agent/core';
import { downloadImage } from '@/utils/downloadImage';
import { resolveQoderCommand } from '@/agent/factories/qoder';
import { hasIncompleteOptions, parseOptionsFromText } from '@/gemini/utils/optionsParser';

/** Per-message context carried through the queue; the hash of it keys a session restart. */
type QoderMode = {
  permissionMode: QoderPermissionMode;
  model: string | undefined;
  originalUserMessage: string;
  images?: ImageContent[];
};

export async function runQoder(opts: {
  credentials: Credentials;
  startedBy?: 'daemon' | 'terminal';
}): Promise<void> {
  const sessionTag = randomUUID();
  const resolvedQoderCommand = resolveQoderCommand();

  // Names this backend in offline / quota warnings.
  connectionState.setBackend('Qoder');

  const api = await ApiClient.create(opts.credentials);

  //
  // Machine
  //

  const settings = await readSettings();
  const machineId = settings?.machineId;
  if (!machineId) {
    console.error(`[START] No machine ID found in settings, which is unexpected since authAndSetupMachineIfNeeded should have created it. Please report this issue on https://github.com/hitosea/happy-next/issues`);
    process.exit(1);
  }
  logger.debug(`Using machineId: ${machineId}`);
  await api.getOrCreateMachine({ machineId, metadata: initialMachineMetadata });

  //
  // Session
  //

  const { state, metadata } = createSessionMetadata({
    flavor: 'qoder',
    machineId,
    startedBy: opts.startedBy,
  });
  const response = await api.getOrCreateSession({ tag: sessionTag, metadata, state });

  let session: ApiSessionClient;
  let permissionHandler: QoderPermissionHandler;

  const registerBuiltinSlashCommands = (target: ApiSessionClient) => {
    target.updateCapabilities(current => addBuiltinSlashCommands(current));
  };

  // A swap must land between turns; applying one mid-turn would write the reply into a
  // session the user already left.
  let isProcessingMessage = false;
  let pendingSessionSwap: ApiSessionClient | null = null;

  const adoptSession = (nextSession: ApiSessionClient) => {
    session = nextSession;
    permissionHandler?.updateSession(nextSession);
    registerBuiltinSlashCommands(nextSession);
  };

  const applyPendingSessionSwap = () => {
    if (!pendingSessionSwap) return;
    logger.debug('[qoder] Applying pending session swap');
    adoptSession(pendingSessionSwap);
    pendingSessionSwap = null;
  };

  const { session: initialSession, reconnectionHandle } = setupOfflineReconnection({
    api,
    sessionTag,
    metadata,
    state,
    response,
    onSessionSwap: newSession => {
      if (isProcessingMessage) {
        logger.debug('[qoder] Session swap requested during message processing - queueing');
        pendingSessionSwap = newSession;
        return;
      }
      adoptSession(newSession);
    },
  });
  session = initialSession;

  syncBuiltinCommands();
  registerBuiltinSlashCommands(session);

  const sessionTitle = process.env.HAPPY_SESSION_TITLE?.trim();
  if (sessionTitle) {
    session.updateMetadata(current => ({
      ...current,
      summary: { text: sessionTitle, updatedAt: Date.now() },
    }));
  }

  try {
    if (!response) throw new Error('no session id yet');
    const result = await notifyDaemonSessionStarted(response.id, metadata);
    if (result?.error) {
      logger.debug('[START] Failed to report to daemon (may not be running):', result.error);
    }
  } catch (error) {
    logger.debug('[START] Failed to report session to daemon:', error);
  }

  //
  // Agent state
  //

  const messageQueue = new MessageQueue2<QoderMode>(mode => hashObject({
    permissionMode: mode.permissionMode,
    model: mode.model ?? null,
  }));

  // Model / approval mode reach Qoder as spawn flags, so changing either means
  // recreating the backend - hence the hash comparison below.
  let currentModel: string | undefined = process.env[QODER_MODEL_ENV]?.trim() || undefined;
  let displayedModel: string | undefined = currentModel;
  let currentPermissionMode: QoderPermissionMode = 'default';

  let backend: AgentBackend | null = null;
  let acpSessionId: string | null = null;
  let currentModeHash: string | null = null;

  // Qoder resumes from its own history: the daemon passes back the native session id
  // recorded in metadata on the previous run. Only the first backend creation consumes
  // it; a later mode change must not re-load a stale session.
  let resumeSessionId: string | null =
    process.env[QODER_RESUME_SESSION_ID_ENV]?.trim() || null;

  let shouldExit = false;
  let thinking = false;
  let accumulatedResponse = '';
  let abortRequested = false;
  let turnFailed = false;
  let isFirstMessage = true;
  const firstTurnInstruction = getFirstTurnInstruction(process.env, { includeOrchestrator: true });
  const abortController = new AbortController();

  const mcp = await createMcpContext(session);
  const mcpServers = mcp.configForHttp();
  permissionHandler = new QoderPermissionHandler(session, api.push());

  const updatePermissionMode = (mode: PermissionMode) => {
    // Only the ACP ids Qoder advertises are usable; anything else falls back to `default`.
    const validated: QoderPermissionMode = isPermissionModeForAgent('qoder', mode) ? mode : 'default';
    currentPermissionMode = validated;
    permissionHandler.setPermissionMode(validated);
  };

  const disposeBackend = async () => {
    if (!backend) return;
    const dying = backend;
    backend = null;
    acpSessionId = null;
    currentModeHash = null;
    try {
      await dying.dispose();
    } catch (error) {
      logger.debug('[qoder] Error disposing backend:', error);
    }
  };

  const ensureBackend = async (): Promise<AgentBackend> => {
    if (backend && acpSessionId) return backend;

    const created = createQoderBackend({
      cwd: process.cwd(),
      model: currentModel ?? null,
      permissionMode: currentPermissionMode,
      mcpServers,
      permissionHandler,
      normalizeToolName: mcp.normalizeToolName.bind(mcp),
      resumeSessionId,
    });
    backend = created.backend;
    backend.onMessage(handleAgentMessage);

    const started = await backend.startSession();
    // AgentBackend returns Happy's own uuid; the engine's id is the ACP one.
    acpSessionId = backend.getSessionId?.() ?? started.sessionId;
    resumeSessionId = null;

    if (typeof acpSessionId !== 'string' || !acpSessionId) {
      throw new Error('Qoder did not return a session id');
    }

    // Persist the engine's own id so the next launch can resume through it.
    const engineSessionId = acpSessionId;
    session.updateMetadata(current => ({ ...current, qoderSessionId: engineSessionId }));
    logger.debug(`[qoder] ACP session ready: ${engineSessionId}`);
    return backend;
  };

  //
  // ACP event -> app message translation
  //

  function handleAgentMessage(msg: AgentMessage): void {
    switch (msg.type) {
      case 'model-output': {
        const text = msg.textDelta ?? msg.fullText;
        if (!text) break;
        accumulatedResponse += text;
        if (hasTTY) {
          if (msg.fullText) messageBuffer.addMessage(msg.fullText, 'assistant');
          else messageBuffer.updateLastMessage(text, 'assistant');
        }
        break;
      }

      case 'tool-call':
        session.sendAgentMessage('qoder', {
          type: 'tool-call',
          callId: msg.callId,
          name: msg.toolName,
          input: msg.args,
          id: randomUUID(),
        });
        break;

      case 'tool-result':
        session.sendAgentMessage('qoder', {
          type: 'tool-result',
          callId: msg.callId,
          output: msg.result,
          id: randomUUID(),
        });
        break;

      case 'fs-edit':
        session.sendAgentMessage('qoder', {
          type: 'file-edit',
          filePath: msg.path ?? '',
          diff: msg.diff,
          description: msg.description,
          id: randomUUID(),
        });
        break;

      case 'token-count': {
        const { type: _dropped, ...rest } = msg;
        session.sendAgentMessage('qoder', {
          type: 'token_count',
          ...(displayedModel ? { model: displayedModel } : {}),
          ...rest,
          id: randomUUID(),
        });
        break;
      }

      case 'permission-request': {
        const payload = msg.payload as { toolName?: unknown } | null;
        session.sendAgentMessage('qoder', {
          type: 'permission-request',
          permissionId: msg.id,
          toolName: String(payload?.toolName ?? msg.reason ?? 'unknown'),
          description: String(msg.reason ?? payload?.toolName ?? ''),
          options: msg.payload,
        });
        break;
      }

      case 'event': {
        // Model / mode lists the CLI advertises, so the app picker shows real tiers.
        // Qoder's `thinking` events are dropped with everything else: its thought stream
        // is internal chain-of-thought, and forwarding it would render as assistant text.
        handleConfigMetadataEvent(
          msg.name,
          msg.payload,
          session.updateMetadata.bind(session),
          session.updateCapabilities.bind(session),
        );
        break;
      }

      case 'status':
        if (msg.status === 'error' && msg.detail) {
          session.sendAgentMessage('qoder', { type: 'message', message: `Error: ${msg.detail}` });
        }
        break;

      default:
        break;
    }
  }

  //
  // Inbound user messages
  //

  session.onUserMessage(message => {
    let messagePermissionMode: QoderPermissionMode = currentPermissionMode;
    // updatePermissionMode() validates too, and is what decides the fallback for an
    // unknown id; ask it only for ids this agent could plausibly accept.
    const requestedMode = message.meta?.permissionMode;
    if (requestedMode) {
      if (isPermissionModeForAgent('qoder', requestedMode)) {
        updatePermissionMode(requestedMode);
        messagePermissionMode = currentPermissionMode;
        logger.debug(`[qoder] Permission mode updated from user message to: ${currentPermissionMode}`);
      } else {
        logger.debug(`[qoder] Invalid permission mode received: ${requestedMode}`);
      }
    }

    let messageModel = currentModel;
    if (message.meta && Object.prototype.hasOwnProperty.call(message.meta, 'model')) {
      if (message.meta.model === null) {
        messageModel = undefined;
        currentModel = undefined;
      } else if (message.meta.model) {
        const previous = currentModel;
        messageModel = String(message.meta.model);
        currentModel = messageModel;
        if (previous !== messageModel) {
          displayedModel = messageModel;
          if (hasTTY) messageBuffer.addMessage(`[MODEL:${messageModel}]`, 'system');
        }
      }
    }

    const content = message.content;
    const originalUserMessage = content.text;
    const images: ImageContent[] = content.type === 'mixed' ? content.images : [];

    // Expand /preview-html & friends; history and display keep the raw text.
    const expanded = expandBuiltinSlashCommand(originalUserMessage);
    const effective = expanded?.prompt ?? originalUserMessage;
    if (expanded) logger.debug(`[qoder] Expanded /${expanded.name} command`);

    let fullPrompt = effective;
    if (isFirstMessage) {
      const append = message.meta?.appendSystemPrompt ?? firstTurnInstruction;
      fullPrompt = append ? `${append}\n\n${effective}` : effective;
      isFirstMessage = false;
    }

    messageQueue.push(fullPrompt, {
      permissionMode: messagePermissionMode,
      model: messageModel,
      originalUserMessage,
      images: images.length > 0 ? images : undefined,
    });
  });

  //
  // Abort / kill
  //

  async function handleAbort() {
    logger.debug('[qoder] Abort requested - stopping current task');
    abortRequested = true;
    thinking = false;
    session.keepAlive(thinking, 'remote');

    messageBuffer.addMessage('[Request interrupted by user]', 'status');
    session.sendAgentMessage('qoder', { type: 'message', message: '[Request interrupted by user]' });
    session.sendAgentMessage('qoder', { type: 'turn_aborted', id: randomUUID() });

    try {
      messageQueue.reset();
      if (backend && acpSessionId) {
        await backend.cancel(acpSessionId);
      }
      logger.debug('[qoder] Abort completed - session remains active');
    } catch (error) {
      logger.debug('[qoder] Error during abort:', error);
    }
  }

  const handleKillSession = async () => {
    logger.debug('[qoder] Kill session requested - terminating process');
    await handleAbort();
    try {
      session.updateMetadata(current => ({
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
      clearInterval(keepAliveInterval);
      reconnectionHandle?.cancel();
      await disposeBackend();
      logger.debug('[qoder] Session termination complete, exiting');
      process.exit(0);
    } catch (error) {
      logger.debug('[qoder] Error during session termination:', error);
      process.exit(1);
    }
  };

  session.rpcHandlerManager.registerHandler('abort', handleAbort);
  registerKillSessionHandler(session.rpcHandlerManager, handleKillSession);

  //
  // Ink UI (terminal mode only; daemon sessions have no TTY)
  //

  const messageBuffer = new MessageBuffer();
  const hasTTY = !!process.stdout.isTTY && !!process.stdin.isTTY;

  if (hasTTY) {
    console.clear();
    render(React.createElement(GeminiDisplay, {
      messageBuffer,
      logPath: isDebug() ? logger.getLogPath() : undefined,
      currentModel: displayedModel,
      agentLabel: 'Qoder Agent',
      onExit: async () => {
        logger.debug('[qoder]: Exiting agent via Ctrl-C');
        shouldExit = true;
        await handleAbort();
      },
    }), { exitOnCtrlC: false, patchConsole: false });
    process.stdin.resume();
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.setEncoding('utf8');
    messageBuffer.addMessage(`[MODEL:${displayedModel ?? 'qoder default'}]`, 'system');
  }

  const sendReady = () => {
    session.sendSessionEvent({ type: 'ready' });
    api.push().sendCompletionToAllDevices(
      "It's ready!",
      'Agent has started',
      { message: `Qoder session is ready in ${process.cwd()}`, sessionId: session.sessionId },
    );
  };

  session.keepAlive(thinking, 'remote');
  const keepAliveInterval = setInterval(() => {
    session.keepAlive(thinking, 'remote');
  }, 2000);

  //
  // Main loop
  //

  sendReady();

  while (!shouldExit) {
    logger.debug('[qoder] Main loop: waiting for messages from queue...');
    const batch = await messageQueue.waitForMessagesAndGetAsString(abortController.signal);
    if (!batch) {
      if (shouldExit) break;
      logger.debug('[qoder] Main loop: no batch received, continuing...');
      continue;
    }
    if (shouldExit) break;

    applyPendingSessionSwap();

    if (parseClear(batch.message).isClear) {
      logger.debug('[qoder] /clear command detected - resetting session');
      messageBuffer.addMessage('Context was reset', 'status');
      permissionHandler.reset();
      await disposeBackend();
      sendReady();
      continue;
    }

    isProcessingMessage = true;
    abortRequested = false;
    turnFailed = false;
    thinking = true;
    session.keepAlive(thinking, 'remote');
    session.sendAgentMessage('qoder', { type: 'task_started', id: randomUUID() });

    try {
      // Model / mode are spawn-time flags in Qoder, so a change needs a new backend.
      // `currentModeHash` is cleared whenever the backend is disposed, so it alone says
      // whether a session is live.
      if (currentModeHash && batch.hash !== currentModeHash) {
        logger.debug('[qoder] Mode changed - restarting session');
        messageBuffer.addMessage('Starting new Qoder session (mode changed)...', 'status');
        permissionHandler.reset();
        await disposeBackend();
      }

      if (batch.mode.model !== undefined && batch.mode.model !== currentModel) {
        currentModel = batch.mode.model;
      }
      if (batch.mode.permissionMode !== currentPermissionMode) {
        updatePermissionMode(batch.mode.permissionMode);
      }

      const active = await ensureBackend();
      currentModeHash = batch.hash;

      if (!acpSessionId) throw new Error('Qoder session was not established');

      if (hasTTY) {
        const shown = batch.mode.originalUserMessage ?? batch.message;
        messageBuffer.addMessage(shown.length > 120 ? `${shown.slice(0, 117)}...` : shown, 'user');
      }

      // Do NOT await sendPrompt before waiting: with ACP it resolves at the *end* of the
      // turn, so awaiting it first leaves nothing subscribed for the idle transition and
      // the following wait would run to its timeout. Starting the prompt, then waiting,
      // then awaiting the promise keeps trailing chunks ordered and surfaces rejections.
      // ACP wants base64 bytes, but ImageContent carries a URL, so it has to be fetched
      // first (same contract the Gemini/Claude/Codex runners use).
      const promptImages: PromptImageContent[] | undefined = batch.mode.images?.length
        ? await Promise.all(batch.mode.images.map(async image => {
            const downloaded = await downloadImage(image.url);
            return { data: downloaded.base64, mimeType: downloaded.mimeType };
          }))
        : undefined;

      const turn = active.sendPrompt(acpSessionId, batch.message, {
        ...(promptImages ? { images: promptImages } : {}),
      });
      // ACP prompt requests resolve/reject independently of the response-idle
      // notification below. Attach a handler immediately so a fast RPC rejection
      // cannot become an unhandled rejection while we wait for trailing chunks.
      void turn.catch(() => undefined);
      await active.waitForResponseComplete?.();
      await turn;
    } catch (error) {
      turnFailed = true;
      const detail = error instanceof Error ? error.message : String(error);
      logger.debug('[qoder] Turn failed:', error);
      const friendly = isQoderAuthError(detail)
        ? qoderAuthErrorMessage(resolvedQoderCommand)
        : `Qoder error: ${detail}`;
      session.sendAgentMessage('qoder', { type: 'message', message: friendly });
      if (hasTTY) messageBuffer.addMessage(friendly, 'status');
      // A dead backend must not be reused: dispose so the next turn rebuilds.
      await disposeBackend();
    } finally {
      if (accumulatedResponse.trim()) {
        const { text: messageText, options, rawOptionsXml } = parseOptionsFromText(accumulatedResponse);
        const finalMessageText = options.length > 0 ? messageText + rawOptionsXml : messageText;
        session.sendAgentMessage('qoder', {
          type: 'message',
          message: finalMessageText,
          ...(options.length > 0 ? { options } : {}),
        });
        if (hasIncompleteOptions(accumulatedResponse)) {
          logger.debug('[qoder] Incomplete options block detected in response');
        }
        accumulatedResponse = '';
      }
      if (!abortRequested && !turnFailed) {
        session.sendAgentMessage('qoder', { type: 'task_complete', id: randomUUID() });
      }
      thinking = false;
      isProcessingMessage = false;
      session.keepAlive(thinking, 'remote');
      applyPendingSessionSwap();
    }
  }

  await handleKillSession();
}
