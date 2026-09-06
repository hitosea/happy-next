/**
 * CodexAppServerBackend - AgentBackend implementation for Codex app-server
 *
 * Communicates with the Codex CLI in app-server mode via JSON-RPC over stdin/stdout.
 * Implements the AgentBackend interface so it can be used interchangeably with AcpBackend.
 *
 * Protocol flow (v2 — thread/turn model, Codex ≥ v0.112.0):
 *   initialize → initialized → thread/start (or thread/resume)
 *   → turn/start → [notifications stream] → turn/completed
 */

import { CodexJsonRpcPeer } from './CodexJsonRpcPeer';
import {
  Methods,
  type InitializeParams,
  type InitializeResponse,
  type ThreadStartParams,
  type ThreadStartResponse,
  type ThreadResumeParams,
  type ThreadResumeResponse,
  type TurnStartParams,
  type TurnStartResponse,
  type TurnInterruptParams,
  type UserInput,
  type ApplyPatchApprovalParams,
  type ExecCommandApprovalParams,
  type CommandExecutionApprovalParams,
  type FileChangeApprovalParams,
  type ToolRequestUserInputParams,
  type PermissionsRequestApprovalParams,
  type V2ApprovalDecision,
  type ReviewDecision,
  type ApprovalPolicy,
  type SandboxMode,
  type ThreadTokenUsage,
  type ReviewStartParams,
  type ReviewTarget,
  type ThreadCompactStartParams,
  type ThreadGoalSetParams,
  type ThreadGoalGetParams,
  type ThreadGoalGetResponse,
  type ThreadGoalClearParams,
  type ThreadGoalStatus,
} from './types';
import type {
  AgentBackend,
  AgentMessage,
  AgentMessageHandler,
  McpServerConfig,
  SessionId,
  SendPromptOptions,
  StartSessionResult,
} from '@/agent/core';
import { logger } from '@/ui/logger';

// ─── Options ────────────────────────────────────────────────────

export interface CodexPermissionHandler {
  handleToolCall(
    toolCallId: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<{ decision: string; reason?: string; answers?: Record<string, string> }>;
}

export interface CodexAppServerBackendOptions {
  /** Working directory for the Codex session */
  cwd: string;
  /** Executable command (e.g. 'npx') */
  command: string;
  /** Arguments for the command (e.g. ['-y', '@openai/codex@0.153.4', 'app-server']) */
  args?: string[];
  /** Environment variables passed to the spawned process */
  env?: Record<string, string>;
  /** Optional model override */
  model?: string | null;
  /** Optional approval policy */
  approvalPolicy?: ApprovalPolicy | null;
  /** Optional sandbox mode */
  sandbox?: SandboxMode | null;
  /** Optional abort signal */
  signal?: AbortSignal;
  /** Optional reasoning effort */
  reasoningEffort?: string | null;
  /** Optional base instructions */
  baseInstructions?: string | null;
  /** Optional permission handler for tool call approvals */
  permissionHandler?: CodexPermissionHandler;
  /** Optional MCP servers configuration */
  mcpServers?: Record<string, McpServerConfig>;
  /** Optional resume file path for session restoration */
  resumeFile?: string | null;
  /** Optional thread ID for resuming a specific thread */
  resumeThreadId?: string | null;
}

// ─── Model Resolution ──────────────────────────────────────────

/** Strip `-fast` suffix from model name and extract service tier. */
const FAST_SUFFIX = '-fast';
export function resolveModel(model: string | null | undefined): { model: string | null; isFast: boolean } {
  if (!model) return { model: null, isFast: false };
  if (model.endsWith(FAST_SUFFIX)) return { model: model.slice(0, -FAST_SUFFIX.length), isFast: true };
  return { model, isFast: false };
}

// Event types that indicate real turn progress and should reset idle timeout.
const TURN_PROGRESS_NOTIFICATIONS = new Set<string>([
  Methods.NOTIFY_TURN_STARTED,
  Methods.NOTIFY_ITEM_STARTED,
  Methods.NOTIFY_ITEM_COMPLETED,
  Methods.NOTIFY_AGENT_MESSAGE_DELTA,
  Methods.NOTIFY_COMMAND_OUTPUT_DELTA,
  Methods.NOTIFY_FILE_CHANGE_DELTA,
  Methods.NOTIFY_REASONING_DELTA,
  Methods.NOTIFY_REASONING_SUMMARY_DELTA,
  Methods.NOTIFY_TURN_DIFF,
  Methods.NOTIFY_TURN_PLAN,
  Methods.NOTIFY_PLAN_DELTA,
  Methods.NOTIFY_MCP_PROGRESS,
]);

interface PendingApproval {
  jsonRpcId: number | string;
  callId: string;
  protocol: 'legacy' | 'v2';
}

type ApprovalParams = Record<string, unknown>;
type StructuredDeniedReviewDecision = { denied: { rejection: string } };
type LegacyApprovalResponseDecision = ReviewDecision | StructuredDeniedReviewDecision;

const STRUCTURED_LEGACY_DENIAL_VERSION = [0, 145, 0] as const;

function supportsStructuredLegacyDenials(userAgent: string): boolean {
  const match = userAgent.match(/\/(\d+)\.(\d+)\.(\d+)(?:\b|[-+])/);
  if (!match) return false;

  const version = [Number(match[1]), Number(match[2]), Number(match[3])] as const;
  for (let i = 0; i < STRUCTURED_LEGACY_DENIAL_VERSION.length; i++) {
    if (version[i] !== STRUCTURED_LEGACY_DENIAL_VERSION[i]) {
      return version[i] > STRUCTURED_LEGACY_DENIAL_VERSION[i];
    }
  }
  return true;
}

// Servers bundled by happy-cli itself — approving the session implies approving these tools.
// User-added MCPs (HAPPY_EXTRA_MCP_SERVERS) still go through normal approval.
const TRUSTED_MCP_SERVER_NAMES = new Set(['happy']);

const buildMcpToolName = (server: string, tool: string) => `mcp:${server}:${tool}`;

interface ElicitationMeta {
  approvalKind: unknown;
  serverName: string;
  toolTitle: string;
  toolParams: Record<string, unknown>;
}

// Codex 0.121 puts `_meta` at the top level of the elicitation params; older
// documented shapes nested it under `request.meta` / `request._meta`. Check all four.
function parseElicitationMeta(params: unknown): ElicitationMeta {
  const p = (params ?? {}) as Record<string, unknown>;
  const nestedRequest = (p.request ?? {}) as Record<string, unknown>;
  const meta = (p._meta ?? p.meta ?? nestedRequest._meta ?? nestedRequest.meta ?? {}) as Record<string, unknown>;
  const serverName = typeof p.serverName === 'string'
    ? p.serverName
    : (typeof meta.connector_name === 'string' ? meta.connector_name : '');
  return {
    approvalKind: meta.codex_approval_kind,
    serverName,
    toolTitle: typeof meta.tool_title === 'string' ? meta.tool_title : '',
    toolParams: (meta.tool_params ?? {}) as Record<string, unknown>,
  };
}

// ─── Backend ─────────────────────────────────────────────────

export class CodexAppServerBackend implements AgentBackend {
  private peer: CodexJsonRpcPeer;
  private listeners: AgentMessageHandler[] = [];
  private threadId: string | null = null;
  private currentTurnId: string | null = null;
  private sessionId: string | null = null;
  private pendingApprovals = new Map<string, PendingApproval>();
  private feedbackQueue: string[] = [];
  private disposed = false;
  private structuredLegacyDenials = false;

  // Resolvers for waitForResponseComplete()
  private turnCompleteResolve: (() => void) | null = null;
  private turnCompletePromise: Promise<void> | null = null;
  private turnCompletionError: Error | null = null;
  private turnStartedAt = 0;
  private turnLastProgressAt = 0;
  private turnLastProgressEvent: string | null = null;

  constructor(private readonly options: CodexAppServerBackendOptions) {
    this.peer = new CodexJsonRpcPeer();
  }

  // ─── AgentBackend Interface ─────────────────────────────────

  async startSession(initialPrompt?: string): Promise<StartSessionResult> {
    // 1. Spawn the app-server process
    const command = this.options.command;
    const args = this.options.args ?? ['app-server'];

    await this.peer.spawn(command, args, {
      cwd: this.options.cwd,
      env: this.options.env,
      signal: this.options.signal,
    });

    // 2. Register handlers before initialize (events may arrive early)
    this.peer.onNotification((method, params) => this.handleNotification(method, params));
    this.peer.onServerRequest((method, params, id) => this.handleServerRequest(method, params, id));
    this.peer.onClose(() => {
      if (!this.turnCompleteResolve) {
        return;
      }
      if (this.disposed) {
        this.resolveTurnComplete();
      } else {
        this.resolveTurnComplete(new Error('Codex app-server closed before turn completed'));
      }
    });

    // 3. Initialize handshake
    const initializeResult = await this.peer.request<InitializeResponse>(Methods.INITIALIZE, {
      clientInfo: {
        name: 'happy-codex-backend',
        version: '0.14.0',
      },
      capabilities: { experimentalApi: true },
    } satisfies InitializeParams);
    this.structuredLegacyDenials = supportsStructuredLegacyDenials(initializeResult.userAgent ?? '');

    this.peer.notify(Methods.INITIALIZED);

    // 4. Create or resume thread
    let threadId: string;

    if (this.options.resumeThreadId || this.options.resumeFile) {
      const resumeParams: ThreadResumeParams = {
        threadId: this.options.resumeThreadId ?? 'resume-via-path',
        ...this.buildThreadParams(),
        ...(this.options.resumeFile ? { path: this.options.resumeFile } : {}),
      };
      const resumeResult = await this.peer.request<ThreadResumeResponse>(
        Methods.THREAD_RESUME,
        resumeParams
      );
      threadId = resumeResult.thread.id;
      this.handleSessionConfigured({
        sessionId: threadId,
        model: resumeResult.model,
        reasoningEffort: resumeResult.reasoningEffort,
      });
    } else {
      const newResult = await this.peer.request<ThreadStartResponse>(
        Methods.THREAD_START,
        this.buildThreadParams()
      );
      threadId = newResult.thread.id;
      logger.info(`[CodexBackend] New thread: id=${threadId}, model=${newResult.model}`);
      this.handleSessionConfigured({
        sessionId: threadId,
        model: newResult.model,
        reasoningEffort: newResult.reasoningEffort,
      });
    }

    this.threadId = threadId;
    this.sessionId = threadId;

    // 5. Send initial prompt if provided
    if (initialPrompt) {
      this.resetTurnComplete();
      await this.doSendMessage(initialPrompt);
    }

    return { sessionId: threadId };
  }

  async sendPrompt(_sessionId: SessionId, prompt: string, options?: SendPromptOptions): Promise<void> {
    if (!this.threadId) {
      throw new Error('CodexAppServerBackend: no active thread');
    }

    // Flush feedback queue (denied approval reasons from previous turn)
    await this.flushFeedbackQueue();

    // Reset turn-complete promise for the new turn
    this.resetTurnComplete();

    await this.doSendMessage(prompt, options);
  }

  // Returns true if the turn/interrupt was acked, so callers can keep the backend
  // warm on success and only tear it down on failure/timeout.
  async cancel(_sessionId: SessionId): Promise<boolean> {
    if (!this.threadId || !this.peer.isAlive) return false;

    try {
      // 3s ack window over the local stdin/stdout pipe (not network), aligned with
      // the Claude graceful-interrupt timeout.
      await this.peer.request(Methods.TURN_INTERRUPT, {
        threadId: this.threadId,
        turnId: this.currentTurnId ?? '',
      } satisfies TurnInterruptParams, 3000);
      return true;
    } catch {
      // Interrupt may fail if already completed - ignore
      logger.debug('[CodexBackend] Interrupt failed (process may have already exited)');
      return false;
    }
  }

  onMessage(handler: AgentMessageHandler): void {
    this.listeners.push(handler);
  }

  offMessage(handler: AgentMessageHandler): void {
    const idx = this.listeners.indexOf(handler);
    if (idx >= 0) this.listeners.splice(idx, 1);
  }


  async compactThread(): Promise<void> {
    if (!this.threadId) {
      throw new Error('CodexAppServerBackend: no active thread');
    }
    await this.peer.request(Methods.THREAD_COMPACT_START, {
      threadId: this.threadId,
    } satisfies ThreadCompactStartParams);
  }

  async startReview(target: ReviewTarget): Promise<void> {
    if (!this.threadId) {
      throw new Error('CodexAppServerBackend: no active thread');
    }
    this.resetTurnComplete();
    await this.peer.request(Methods.REVIEW_START, {
      threadId: this.threadId,
      target,
      delivery: 'inline',
    } satisfies ReviewStartParams);
  }

  async getGoal(): Promise<ThreadGoalGetResponse> {
    if (!this.threadId) {
      throw new Error('CodexAppServerBackend: no active thread');
    }
    return await this.peer.request<ThreadGoalGetResponse>(Methods.THREAD_GOAL_GET, {
      threadId: this.threadId,
    } satisfies ThreadGoalGetParams);
  }

  async setGoal(params: { objective?: string | null; status?: ThreadGoalStatus | null; tokenBudget?: number | null }): Promise<void> {
    if (!this.threadId) {
      throw new Error('CodexAppServerBackend: no active thread');
    }
    await this.peer.request(Methods.THREAD_GOAL_SET, {
      threadId: this.threadId,
      ...params,
    } satisfies ThreadGoalSetParams);
  }

  async clearGoal(): Promise<void> {
    if (!this.threadId) {
      throw new Error('CodexAppServerBackend: no active thread');
    }
    await this.peer.request(Methods.THREAD_GOAL_CLEAR, {
      threadId: this.threadId,
    } satisfies ThreadGoalClearParams);
  }

  async respondToPermission(requestId: string, approved: boolean): Promise<void> {
    const pending = this.pendingApprovals.get(requestId);
    if (!pending) {
      logger.debug(`[CodexBackend] No pending approval for requestId=${requestId}`);
      return;
    }

    this.pendingApprovals.delete(requestId);

    const decision = pending.protocol === 'v2'
      ? (approved ? 'accept' : 'decline') satisfies V2ApprovalDecision
      : this.formatLegacyDecision(approved ? 'approved' : 'denied');

    // Send the response back to Codex
    this.peer.respond(pending.jsonRpcId, { decision });

    // Emit permission-response for UI
    this.emit({ type: 'permission-response', id: requestId, approved });
  }

  async waitForResponseComplete(timeoutMs?: number): Promise<void> {
    if (!this.turnCompletePromise) return;

    let timer: ReturnType<typeof setInterval> | undefined;
    const timeout = timeoutMs
      ? new Promise<void>(() => {
          const idleThreshold = Math.min(timeoutMs / 2, 120_000);
          timer = setInterval(() => {
            const now = Date.now();
            const elapsed = now - this.turnStartedAt;
            const idleMs = now - this.turnLastProgressAt;

            // Hard timeout
            if (elapsed > timeoutMs) {
              clearInterval(timer);
              this.resolveTurnComplete(
                new Error(`Codex turn timed out after ${(elapsed / 1000).toFixed(0)}s`)
              );
              return;
            }

            // Idle timeout (no progress events for too long)
            if (idleMs > idleThreshold) {
              clearInterval(timer);
              this.resolveTurnComplete(
                new Error(`Codex turn idle for ${(idleMs / 1000).toFixed(0)}s (last event: ${this.turnLastProgressEvent})`)
              );
            }
          }, 5_000);
        })
      : undefined;

    try {
      await Promise.race([this.turnCompletePromise!, timeout].filter(Boolean));
      if (this.turnCompletionError) {
        throw this.turnCompletionError;
      }
    } finally {
      if (timer) clearInterval(timer);
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;

    // Reject all pending approvals
    for (const [, pending] of this.pendingApprovals) {
      const decision = pending.protocol === 'v2'
        ? 'cancel' satisfies V2ApprovalDecision
        : 'abort' satisfies ReviewDecision;
      this.peer.respond(pending.jsonRpcId, { decision });
    }
    this.pendingApprovals.clear();

    // Resolve any waitForResponseComplete
    this.resolveTurnComplete();

    await this.peer.close();
  }

  // ─── Thread Params ────────────────────────────────────────────

  private buildThreadParams(): ThreadStartParams {
    const params: ThreadStartParams = {
      cwd: this.options.cwd,
    };

    const { model: resolvedModel, isFast } = resolveModel(this.options.model);
    if (resolvedModel) params.model = resolvedModel;
    if (this.options.approvalPolicy) params.approvalPolicy = this.options.approvalPolicy;
    if (this.options.sandbox) params.sandbox = this.options.sandbox;
    if (this.options.baseInstructions) params.baseInstructions = this.options.baseInstructions;

    // Fast mode: use serviceTier directly
    if (isFast) {
      params.serviceTier = 'fast';
    }

    // Build config overrides (MCP servers + reasoning effort)
    const config: Record<string, unknown> = {};
    if (this.options.mcpServers && Object.keys(this.options.mcpServers).length > 0) {
      // `default_tools_approval_mode: "approve"` lets Codex's guardian skip MCP
      // approval for trusted servers; handleMcpElicitation stays as fallback.
      // Codex 0.125 renamed the variant from PascalCase `Approve` to lowercase `approve`.
      const mcpServers: Record<string, unknown> = {};
      for (const [name, cfg] of Object.entries(this.options.mcpServers)) {
        mcpServers[name] = TRUSTED_MCP_SERVER_NAMES.has(name)
          ? { ...cfg, default_tools_approval_mode: 'approve' }
          : cfg;
      }
      config.mcp_servers = mcpServers;
    }
    if (this.options.reasoningEffort) {
      config.model_reasoning_effort = this.options.reasoningEffort;
    }
    if (Object.keys(config).length > 0) {
      params.config = config;
    }

    return params;
  }

  // ─── Message Sending ──────────────────────────────────────────

  private async doSendMessage(prompt: string, options?: SendPromptOptions): Promise<void> {
    if (!this.threadId) return;

    const input: UserInput[] = [];

    // Add images if present
    if (options?.images?.length) {
      for (const img of options.images) {
        input.push({
          type: 'image',
          url: `data:${img.mimeType};base64,${img.data}`,
        });
      }
    }

    // Add text
    input.push({
      type: 'text',
      text: prompt,
    });

    const result = await this.peer.request<TurnStartResponse>(Methods.TURN_START, {
      threadId: this.threadId,
      input,
    } satisfies TurnStartParams);

    // Track the current turn ID for interrupts
    this.currentTurnId = result.turn.id;
  }

  private async flushFeedbackQueue(): Promise<void> {
    while (this.feedbackQueue.length > 0) {
      const feedback = this.feedbackQueue.shift()!;
      await this.doSendMessage(`User feedback: ${feedback}`);
    }
  }

  // ─── Turn Complete ──────────────────────────────────────────

  private resetTurnComplete(): void {
    const now = Date.now();
    this.turnStartedAt = now;
    this.turnLastProgressAt = now;
    this.turnLastProgressEvent = Methods.NOTIFY_TURN_STARTED;
    this.turnCompletionError = null;
    this.turnCompletePromise = new Promise<void>((resolve) => {
      this.turnCompleteResolve = resolve;
    });
  }

  private resolveTurnComplete(error?: Error): void {
    if (!this.turnCompleteResolve) return;
    this.turnCompletionError = error ?? null;
    const resolve = this.turnCompleteResolve;
    this.turnCompleteResolve = null;
    resolve();
  }

  private markTurnProgress(notificationMethod: string): void {
    if (!this.turnCompleteResolve) return;
    this.turnLastProgressAt = Date.now();
    this.turnLastProgressEvent = notificationMethod;
  }

  // ─── Emit ───────────────────────────────────────────────────

  private emit(msg: AgentMessage): void {
    for (const handler of this.listeners) {
      try {
        handler(msg);
      } catch (err) {
        logger.debug(`[CodexBackend] Message handler error: ${err}`);
      }
    }
  }

  // ─── Notification Handler (v2 — individual methods) ─────────

  private handleNotification(method: string, params: unknown): void {
    if (TURN_PROGRESS_NOTIFICATIONS.has(method)) {
      this.markTurnProgress(method);
    }

    const p = (params ?? {}) as Record<string, any>;

    switch (method) {
      // ── Agent message streaming ──
      case Methods.NOTIFY_AGENT_MESSAGE_DELTA:
        this.emit({ type: 'model-output', textDelta: p.delta });
        break;

      // ── Reasoning streaming ──
      case Methods.NOTIFY_REASONING_DELTA:
        this.emit({ type: 'event', name: 'reasoning_delta', payload: { delta: p.delta } });
        break;

      case Methods.NOTIFY_REASONING_SUMMARY_DELTA:
        this.emit({ type: 'event', name: 'reasoning_delta', payload: { delta: p.delta } });
        break;

      case Methods.NOTIFY_REASONING_SUMMARY_ADDED:
        this.emit({ type: 'event', name: 'reasoning_section_break', payload: p });
        break;

      // ── Command output streaming ──
      case Methods.NOTIFY_COMMAND_OUTPUT_DELTA:
        this.emit({ type: 'terminal-output', data: p.delta });
        break;

      // ── File change diff streaming ──
      case Methods.NOTIFY_FILE_CHANGE_DELTA:
        // File diffs streamed as they're generated
        break;

      // ── Item lifecycle ──
      case Methods.NOTIFY_ITEM_STARTED:
        this.handleItemStarted(p.item);
        break;

      case Methods.NOTIFY_ITEM_COMPLETED:
        this.handleItemCompleted(p.item);
        break;

      // ── Turn lifecycle ──
      case Methods.NOTIFY_TURN_STARTED:
        this.emit({ type: 'status', status: 'running' });
        break;

      case Methods.NOTIFY_TURN_COMPLETED:
        this.handleTurnCompleted(p.turn);
        break;

      // ── Turn diff ──
      case Methods.NOTIFY_TURN_DIFF:
        this.emit({ type: 'event', name: 'turn_diff', payload: { unified_diff: p.diff } });
        break;

      // ── Plan updates ──
      case Methods.NOTIFY_TURN_PLAN:
        this.emit({ type: 'event', name: 'plan_update', payload: p });
        break;

      case Methods.NOTIFY_PLAN_DELTA:
        // Plan deltas streamed — can be accumulated by the consumer
        break;

      // ── Thread lifecycle ──
      case Methods.NOTIFY_THREAD_STARTED:
        // Thread created — already handled in startSession
        break;

      case Methods.NOTIFY_THREAD_STATUS_CHANGED:
        // Thread status update (idle, active, etc.)
        break;

      case Methods.NOTIFY_THREAD_CLOSED:
        this.emit({ type: 'status', status: 'stopped' });
        this.resolveTurnComplete();
        break;

      // ── Token usage ──
      case Methods.NOTIFY_THREAD_TOKEN_USAGE:
        this.handleTokenUsage(p.tokenUsage);
        break;

      case Methods.NOTIFY_THREAD_COMPACTED:
        this.emit({ type: 'event', name: 'context_compacted', payload: p });
        break;

      case Methods.NOTIFY_THREAD_GOAL_UPDATED:
        this.emit({ type: 'event', name: 'goal_updated', payload: p });
        break;

      case Methods.NOTIFY_THREAD_GOAL_CLEARED:
        this.emit({ type: 'event', name: 'goal_cleared', payload: p });
        break;

      // ── Errors ──
      case Methods.NOTIFY_ERROR:
        this.handleErrorNotification(p);
        break;

      // ── MCP progress ──
      case Methods.NOTIFY_MCP_PROGRESS:
        // MCP tool call progress — informational
        break;

      // ── Deprecation & config warnings ──
      case Methods.NOTIFY_DEPRECATION:
      case Methods.NOTIFY_CONFIG_WARNING:
        logger.debug(`[CodexBackend] ${method}: ${JSON.stringify(p)}`);
        break;

      default:
        logger.debug(`[CodexBackend] Unhandled notification: ${method}`);
        break;
    }
  }

  private handleSessionConfigured(params: {
    sessionId: string;
    model?: string | null;
    reasoningEffort?: string | null;
  }): void {
    this.sessionId = params.sessionId;
    logger.debug(`[CodexBackend] Session configured: model=${params.model}, sessionId=${params.sessionId}`);
    this.emit({
      type: 'event',
      name: 'session_configured',
      payload: {
        sessionId: params.sessionId,
        model: params.model ?? undefined,
        ...(params.reasoningEffort ? { reasoningEffort: params.reasoningEffort } : {}),
      },
    });
  }

  // ─── Item Event Mapping ──────────────────────────────────────

  private handleItemStarted(item: Record<string, any> | undefined): void {
    if (!item) return;

    switch (item.type) {
      case 'commandExecution':
        this.emit({
          type: 'tool-call',
          toolName: 'CodexBash',
          callId: item.id,
          args: {
            command: item.command,
            cwd: item.cwd,
            // Forward commandActions as parsed_cmd for app display (read file detection)
            ...(Array.isArray(item.commandActions) && item.commandActions.length > 0
              ? { parsed_cmd: item.commandActions }
              : {}),
          },
        });
        break;

      case 'fileChange':
        this.emit({
          type: 'patch-apply-begin',
          call_id: item.id,
          auto_approved: item.status !== 'declined',
          changes: this.normalizeFileChanges(item.changes),
        });
        break;

      case 'mcpToolCall':
        this.emit({
          type: 'tool-call',
          toolName: buildMcpToolName(item.server, item.tool),
          callId: item.id,
          args: (item.arguments ?? {}) as Record<string, unknown>,
        });
        break;

      case 'webSearch':
        this.emit({
          type: 'tool-call',
          toolName: 'web_search',
          callId: item.id,
          args: item.query ? { query: item.query } : {},
        });
        break;

      case 'imageView':
        this.emit({
          type: 'tool-call',
          toolName: 'view_image',
          callId: item.id,
          args: { path: item.path },
        });
        break;

      case 'agentMessage':
      case 'reasoning':
      case 'plan':
      case 'userMessage':
      case 'imageGeneration':
      case 'contextCompaction':
        // These items are handled via delta notifications or turn/completed
        break;

      default:
        logger.debug(`[CodexBackend] Unhandled item/started type: ${item.type}`);
        break;
    }
  }

  private handleItemCompleted(item: Record<string, any> | undefined): void {
    if (!item) return;

    switch (item.type) {
      case 'commandExecution':
        this.emit({
          type: 'tool-result',
          toolName: 'CodexBash',
          callId: item.id,
          result: {
            stdout: item.aggregatedOutput ?? '',
            stderr: '',
            exit_code: item.exitCode ?? 0,
            formatted_output: item.aggregatedOutput,
          },
        });
        break;

      case 'fileChange':
        this.emit({
          type: 'patch-apply-end',
          call_id: item.id,
          stdout: '',
          stderr: '',
          success: item.status === 'completed',
        });
        break;

      case 'mcpToolCall':
        this.emit({
          type: 'tool-result',
          toolName: buildMcpToolName(item.server, item.tool),
          callId: item.id,
          result: item.status === 'failed'
            ? { error: item.error?.message ?? 'MCP tool call failed' }
            : item.result,
        });
        break;

      case 'webSearch':
        this.emit({
          type: 'tool-result',
          toolName: 'web_search',
          callId: item.id,
          result: { query: item.query, action: item.action },
        });
        break;

      case 'agentMessage':
        // Full message text available in item.text
        this.emit({ type: 'model-output', fullText: item.text });
        break;

      case 'reasoning':
        // Full reasoning available in item.content
        if (Array.isArray(item.content) && item.content.length > 0) {
          this.emit({ type: 'event', name: 'reasoning', payload: { text: item.content.join('') } });
        }
        break;

      case 'contextCompaction':
        this.emit({ type: 'event', name: 'context_compacted', payload: item });
        break;

      case 'plan':
      case 'userMessage':
      case 'imageView':
      case 'imageGeneration':
        // Informational
        break;

      default:
        logger.debug(`[CodexBackend] Unhandled item/completed type: ${item.type}`);
        break;
    }
  }

  private handleTurnCompleted(turn: Record<string, any> | undefined): void {
    if (!turn) {
      this.emit({ type: 'status', status: 'idle' });
      this.resolveTurnComplete();
      return;
    }

    const status = turn.status as string;

    if (status === 'failed' && turn.error) {
      const errorMsg = turn.error.message ?? 'Turn failed';
      this.emit({ type: 'status', status: 'error', detail: errorMsg });
      this.resolveTurnComplete(new Error(errorMsg));
      return;
    }

    if (status === 'interrupted') {
      this.emit({ type: 'status', status: 'idle', detail: 'aborted' });
    } else {
      this.emit({ type: 'status', status: 'idle' });
    }

    this.resolveTurnComplete();
  }

  private handleTokenUsage(tokenUsage: ThreadTokenUsage | undefined): void {
    if (!tokenUsage) return;

    this.emit({
      type: 'token-count',
      total_token_usage: {
        input_tokens: tokenUsage.total.inputTokens,
        cached_input_tokens: tokenUsage.total.cachedInputTokens,
        output_tokens: tokenUsage.total.outputTokens,
        reasoning_output_tokens: tokenUsage.total.reasoningOutputTokens,
        total_tokens: tokenUsage.total.totalTokens,
      },
      last_token_usage: {
        input_tokens: tokenUsage.last.inputTokens,
        cached_input_tokens: tokenUsage.last.cachedInputTokens,
        output_tokens: tokenUsage.last.outputTokens,
        reasoning_output_tokens: tokenUsage.last.reasoningOutputTokens,
        total_tokens: tokenUsage.last.totalTokens,
      },
      model_context_window: tokenUsage.modelContextWindow,
    });
  }

  private handleErrorNotification(params: Record<string, any>): void {
    const error = params.error;
    const errorDetail = typeof error?.message === 'string' ? error.message : JSON.stringify(error);
    const message = errorDetail && errorDetail !== 'undefined' ? errorDetail : 'Codex error';
    // Surface error to UI; don't resolve turn — let turn/completed handle lifecycle
    this.emit({ type: 'status', status: 'error', detail: message });
  }

  // ─── Server Request Handler (Approvals) ─────────────────────

  private handleServerRequest(method: string, params: unknown, id: number | string): void {
    switch (method) {
      // Legacy approval requests (deprecated but may still be sent)
      case Methods.APPLY_PATCH_APPROVAL:
        this.handlePatchApproval(params as ApplyPatchApprovalParams, id);
        break;

      case Methods.EXEC_COMMAND_APPROVAL:
        this.handleExecApproval(params as ExecCommandApprovalParams, id);
        break;

      // New v2 approval requests
      case Methods.COMMAND_EXECUTION_APPROVAL:
        this.handleCommandExecutionApproval(params as CommandExecutionApprovalParams, id);
        break;

      case Methods.FILE_CHANGE_APPROVAL:
        this.handleFileChangeApproval(params as FileChangeApprovalParams, id);
        break;

      case Methods.TOOL_REQUEST_USER_INPUT:
        this.handleToolRequestUserInput(params as ToolRequestUserInputParams, id);
        break;

      case Methods.PERMISSIONS_APPROVAL:
        this.handlePermissionsApproval(params as PermissionsRequestApprovalParams, id);
        break;

      case Methods.MCP_ELICITATION:
        this.handleMcpElicitation(params, id);
        break;

      // Dynamic tool calls — not supported, respond with error
      case Methods.TOOL_CALL:
        this.peer.respond(id, { success: false, contentItems: [] });
        break;

      default:
        // Respond with null to unblock unknown server requests
        logger.debug(`[CodexBackend] Unhandled server request: ${method}`);
        this.peer.respond(id, null);
        break;
    }
  }

  // ─── Legacy Approval Handlers ─────────────────────────────────

  private handlePatchApproval(params: ApplyPatchApprovalParams, jsonRpcId: number | string): void {
    const rawParams = params as unknown as ApprovalParams;
    const callId = this.getApprovalCallId(rawParams);
    if (!callId) {
      logger.warn('[CodexBackend] applyPatchApproval missing callId/call_id; denying request');
      this.peer.respond(jsonRpcId, {
        decision: this.formatLegacyDecision('denied', 'Approval request did not include a call ID.'),
      });
      return;
    }

    const reason = this.getApprovalReason(rawParams);
    const changes = this.getPatchChanges(rawParams);

    if (this.options.permissionHandler) {
      // Store pending approval for respondToPermission()
      this.pendingApprovals.set(callId, { jsonRpcId, callId, protocol: 'legacy' });

      // Delegate to permission handler
      this.options.permissionHandler
        .handleToolCall(callId, 'CodexPatch', {
          changes,
          reason,
        })
        .then((result) => {
          // If still pending (not already responded via respondToPermission)
          if (this.pendingApprovals.has(callId)) {
            this.pendingApprovals.delete(callId);
            const decision = this.mapLegacyDecision(result.decision);
            this.peer.respond(jsonRpcId, {
              decision: this.formatLegacyDecision(decision, result.reason ?? reason),
            });

            // Queue feedback for denied/abort with reason
            if ((decision === 'denied' || decision === 'abort') && reason) {
              this.feedbackQueue.push(reason);
            }
          }
        })
        .catch(() => {
          // Permission handler error/cancel - deny
          if (this.pendingApprovals.has(callId)) {
            this.pendingApprovals.delete(callId);
            this.peer.respond(jsonRpcId, {
              decision: this.formatLegacyDecision('denied', 'Permission handler rejected the request.'),
            });
          }
        });
    } else {
      // No handler - auto-approve
      this.peer.respond(jsonRpcId, { decision: 'approved' as ReviewDecision });
    }
  }

  private handleExecApproval(params: ExecCommandApprovalParams, jsonRpcId: number | string): void {
    const rawParams = params as unknown as ApprovalParams;
    const callId = this.getApprovalCallId(rawParams);
    if (!callId) {
      logger.warn('[CodexBackend] execCommandApproval missing callId/call_id; denying request');
      this.peer.respond(jsonRpcId, {
        decision: this.formatLegacyDecision('denied', 'Approval request did not include a call ID.'),
      });
      return;
    }

    const reason = this.getApprovalReason(rawParams);
    const command = this.getExecCommand(rawParams);
    const cwd = this.getExecCwd(rawParams);

    if (this.options.permissionHandler) {
      this.pendingApprovals.set(callId, { jsonRpcId, callId, protocol: 'legacy' });

      this.options.permissionHandler
        .handleToolCall(callId, 'CodexBash', {
          command,
          cwd,
          reason,
        })
        .then((result) => {
          if (this.pendingApprovals.has(callId)) {
            this.pendingApprovals.delete(callId);
            const decision = this.mapLegacyDecision(result.decision);
            this.peer.respond(jsonRpcId, {
              decision: this.formatLegacyDecision(decision, result.reason ?? reason),
            });

            // Queue feedback for denied/abort with reason
            if ((decision === 'denied' || decision === 'abort') && reason) {
              this.feedbackQueue.push(reason);
            }
          }
        })
        .catch(() => {
          if (this.pendingApprovals.has(callId)) {
            this.pendingApprovals.delete(callId);
            this.peer.respond(jsonRpcId, {
              decision: this.formatLegacyDecision('denied', 'Permission handler rejected the request.'),
            });
          }
        });
    } else {
      this.peer.respond(jsonRpcId, { decision: 'approved' as ReviewDecision });
    }
  }

  // ─── V2 Approval Handlers ──────────────────────────────────────

  private handleCommandExecutionApproval(params: CommandExecutionApprovalParams, jsonRpcId: number | string): void {
    const callId = params.approvalId ?? params.itemId;
    this.dispatchV2Approval(callId, jsonRpcId, 'CodexBash', {
      command: params.command ? [params.command] : [],
      cwd: params.cwd ?? '',
      reason: params.reason,
      kind: params.kind ?? 'command',
      approvalId: params.approvalId,
      parsed_cmd: params.commandActions ?? undefined,
    }, params.reason);
  }

  private handleFileChangeApproval(params: FileChangeApprovalParams, jsonRpcId: number | string): void {
    this.dispatchV2Approval(params.itemId, jsonRpcId, 'CodexPatch', {
      reason: params.reason,
      grantRoot: params.grantRoot,
    }, params.reason);
  }

  private dispatchV2Approval(
    callId: string,
    jsonRpcId: number | string,
    toolName: string,
    args: Record<string, unknown>,
    feedbackReason?: string | null,
  ): void {
    if (this.options.permissionHandler) {
      this.pendingApprovals.set(callId, { jsonRpcId, callId, protocol: 'v2' });

      this.options.permissionHandler
        .handleToolCall(callId, toolName, args)
        .then((result) => {
          if (this.pendingApprovals.has(callId)) {
            this.pendingApprovals.delete(callId);
            const decision = this.mapV2Decision(result.decision);
            this.peer.respond(jsonRpcId, { decision });

            if ((decision === 'decline' || decision === 'cancel') && feedbackReason) {
              this.feedbackQueue.push(feedbackReason);
            }
          }
        })
        .catch(() => {
          if (this.pendingApprovals.has(callId)) {
            this.pendingApprovals.delete(callId);
            this.peer.respond(jsonRpcId, { decision: 'decline' as V2ApprovalDecision });
          }
        });
    } else {
      this.peer.respond(jsonRpcId, { decision: 'accept' as V2ApprovalDecision });
    }
  }

  private handleToolRequestUserInput(params: ToolRequestUserInputParams, jsonRpcId: number | string): void {
    const questions = params.questions.map((question) => ({
      id: question.id,
      header: question.header,
      question: question.question,
      options: question.options ?? [],
      multiSelect: false,
      isOther: question.isOther ?? false,
      isSecret: question.isSecret ?? false,
    }));
    const input = {
      questions,
      isBlocking: params.isBlocking,
    };

    this.emit({
      type: 'tool-call',
      toolName: 'AskUserQuestion',
      callId: params.itemId,
      args: input,
    });

    if (!this.options.permissionHandler) {
      this.peer.respond(jsonRpcId, { answers: {} });
      this.emit({
        type: 'tool-result',
        toolName: 'AskUserQuestion',
        callId: params.itemId,
        result: { answers: {} },
      });
      return;
    }

    this.options.permissionHandler
      .handleToolCall(params.itemId, 'AskUserQuestion', input)
      .then((result) => {
        const answers = result.decision === 'approved' || result.decision === 'approved_for_session'
          ? result.answers ?? {}
          : {};
        const protocolAnswers = Object.fromEntries(params.questions.map((question) => [
          question.id,
          { answers: answers[question.id] ? [answers[question.id]] : [] },
        ]));
        const displayAnswers = Object.fromEntries(params.questions.map((question) => [
          question.id,
          question.isSecret && answers[question.id] ? '********' : answers[question.id] ?? '',
        ]));

        this.peer.respond(jsonRpcId, { answers: protocolAnswers });
        this.emit({
          type: 'tool-result',
          toolName: 'AskUserQuestion',
          callId: params.itemId,
          result: { answers: displayAnswers },
        });
      })
      .catch((err) => {
        logger.warn('[CodexBackend] User input permission handler rejected', err);
        this.peer.respond(jsonRpcId, { answers: {} });
        this.emit({
          type: 'tool-result',
          toolName: 'AskUserQuestion',
          callId: params.itemId,
          result: { answers: {} },
        });
      });
  }

  private handlePermissionsApproval(params: PermissionsRequestApprovalParams, jsonRpcId: number | string): void {
    const callId = `codex-permissions-${String(jsonRpcId)}`;
    const input = {
      cwd: params.cwd,
      reason: params.reason,
      permissions: params.permissions,
    };

    this.emit({ type: 'tool-call', toolName: 'CodexPermissions', callId, args: input });

    if (!this.options.permissionHandler) {
      this.peer.respond(jsonRpcId, { permissions: params.permissions, scope: 'turn' });
      this.emit({ type: 'tool-result', toolName: 'CodexPermissions', callId, result: { approved: true } });
      return;
    }

    this.options.permissionHandler
      .handleToolCall(callId, 'CodexPermissions', input)
      .then((result) => {
        const approved = result.decision === 'approved' || result.decision === 'approved_for_session';
        this.peer.respond(jsonRpcId, {
          permissions: approved ? params.permissions : {},
          scope: result.decision === 'approved_for_session' ? 'session' : 'turn',
        });
        this.emit({
          type: 'tool-result',
          toolName: 'CodexPermissions',
          callId,
          result: { approved },
        });
      })
      .catch((err) => {
        logger.warn('[CodexBackend] Permissions approval handler rejected', err);
        this.peer.respond(jsonRpcId, { permissions: {}, scope: 'turn' });
        this.emit({ type: 'tool-result', toolName: 'CodexPermissions', callId, result: { approved: false } });
      });
  }

  // ─── MCP Elicitation / Tool Approval ───────────────────────────

  /**
   * Codex reuses `mcpServer/elicitation/request` for both structured user input
   * and MCP tool-call approvals (kind = `mcp_tool_call`). We auto-accept tool
   * calls from trusted servers, decline other elicitations, and delegate
   * untrusted tools to the permission handler so they surface in the app UI.
   */
  private handleMcpElicitation(params: unknown, jsonRpcId: number | string): void {
    const parsed = parseElicitationMeta(params);

    if (parsed.approvalKind !== 'mcp_tool_call') {
      this.peer.respond(jsonRpcId, { action: 'decline' });
      return;
    }

    // Trusted servers skip shouldAutoApprove because Codex gives us `tool_title`
    // (display name), not the raw tool name the whitelist would need to match.
    if (TRUSTED_MCP_SERVER_NAMES.has(parsed.serverName)) {
      this.peer.respond(jsonRpcId, { action: 'accept', meta: { persist: 'session' } });
      return;
    }

    if (!this.options.permissionHandler) {
      this.peer.respond(jsonRpcId, { action: 'decline' });
      return;
    }

    const fullToolName = parsed.serverName && parsed.toolTitle
      ? buildMcpToolName(parsed.serverName, parsed.toolTitle)
      : (parsed.toolTitle || parsed.serverName || 'mcp_tool_call');
    const callId = `mcp-elicit-${String(jsonRpcId)}`;

    this.options.permissionHandler
      .handleToolCall(callId, fullToolName, parsed.toolParams)
      .then((result) => {
        logger.debug('[CodexBackend] MCP elicitation decision', { callId, decision: result.decision });
        if (result.decision !== 'approved' && result.decision !== 'approved_for_session') {
          this.peer.respond(jsonRpcId, { action: 'decline' });
          return;
        }
        const response = result.decision === 'approved_for_session'
          ? { action: 'accept', meta: { persist: 'session' as const } }
          : { action: 'accept' };
        this.peer.respond(jsonRpcId, response);
      })
      .catch((err) => {
        logger.warn('[CodexBackend] MCP elicitation permission handler rejected', err);
        this.peer.respond(jsonRpcId, { action: 'decline' });
      });
  }

  // ─── Decision Mapping ──────────────────────────────────────────

  private mapLegacyDecision(decision: string): ReviewDecision {
    switch (decision) {
      case 'approved': return 'approved';
      case 'approved_for_session': return 'approved_for_session';
      case 'abort': return 'abort';
      case 'denied':
      default:
        return 'denied';
    }
  }

  private formatLegacyDecision(
    decision: ReviewDecision,
    rejection?: string | null,
  ): LegacyApprovalResponseDecision {
    if (decision !== 'denied' || !this.structuredLegacyDenials) {
      return decision;
    }

    return {
      denied: {
        rejection: rejection?.trim() || 'User denied the request.',
      },
    };
  }

  private mapV2Decision(decision: string): V2ApprovalDecision {
    switch (decision) {
      case 'approved':
      case 'accept': return 'accept';
      case 'approved_for_session':
      case 'acceptForSession': return 'acceptForSession';
      case 'abort':
      case 'cancel': return 'cancel';
      case 'denied':
      case 'decline':
      default:
        return 'decline';
    }
  }

  // ─── Approval Param Helpers (for legacy handlers) ──────────────

  private getApprovalCallId(params: ApprovalParams): string | null {
    if (typeof params.callId === 'string' && params.callId.length > 0) {
      return params.callId;
    }
    if (typeof params.call_id === 'string' && params.call_id.length > 0) {
      return params.call_id;
    }
    return null;
  }

  private getApprovalReason(params: ApprovalParams): string | undefined {
    if (typeof params.reason === 'string' && params.reason.length > 0) {
      return params.reason;
    }
    return undefined;
  }

  private getPatchChanges(params: ApprovalParams): Record<string, unknown> {
    const fileChanges = params.fileChanges;
    if (fileChanges && typeof fileChanges === 'object') {
      return fileChanges as Record<string, unknown>;
    }
    const snakeFileChanges = params.file_changes;
    if (snakeFileChanges && typeof snakeFileChanges === 'object') {
      return snakeFileChanges as Record<string, unknown>;
    }
    return {};
  }

  private getExecCommand(params: ApprovalParams): string[] {
    const command = params.command;
    if (Array.isArray(command)) {
      return command.filter((part): part is string => typeof part === 'string');
    }
    const parsedCmd = params.parsedCmd;
    if (Array.isArray(parsedCmd)) {
      return parsedCmd.map(String);
    }
    const snakeParsedCmd = params.parsed_cmd;
    if (Array.isArray(snakeParsedCmd)) {
      return snakeParsedCmd.map(String);
    }
    return [];
  }

  private getExecCwd(params: ApprovalParams): string {
    if (typeof params.cwd === 'string') {
      return params.cwd;
    }
    return '';
  }

  // ─── Data Normalization ─────────────────────────────────────

  /**
   * Normalize v2 FileUpdateChange[] to v1 map format { [filePath]: { add?, modify?, delete? } }.
   *
   * v2 protocol: changes is an array of { path, kind: { type: "add"|"update"|"delete" }, diff }
   * v1/app format: changes is { [filePath]: { add?: obj, modify?: obj, delete?: obj } }
   */
  private normalizeFileChanges(changes: unknown): Record<string, Record<string, unknown>> {
    if (!changes || !Array.isArray(changes)) {
      return (changes ?? {}) as Record<string, Record<string, unknown>>;
    }

    const result: Record<string, Record<string, unknown>> = {};
    for (const entry of changes) {
      const c = entry as Record<string, any>;
      const filePath = typeof c.path === 'string' ? c.path : `unknown_${Object.keys(result).length}`;
      const kindType = typeof c.kind?.type === 'string' ? c.kind.type : 'update';

      const ops: Record<string, unknown> = {};
      if (kindType === 'add') ops.add = true;
      else if (kindType === 'delete') ops.delete = true;
      else ops.modify = true;
      result[filePath] = ops;
    }
    return result;
  }

  // ─── Public Accessors ───────────────────────────────────────

  /** Get the current thread ID (backward-compat: aliased as conversationId) */
  getConversationId(): string | null {
    return this.threadId;
  }

  /** Get the Codex session ID (may differ from threadId after session_configured) */
  getSessionId(): string | null {
    return this.sessionId;
  }

  /** Check if the backend is alive */
  get isAlive(): boolean {
    return !this.disposed && this.peer.isAlive;
  }

  /** Get the process PID */
  get pid(): number | undefined {
    return this.peer.pid;
  }
}
