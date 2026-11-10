/**
 * Qoder ACP Backend - Qoder CLI agent via ACP
 *
 * `qodercli --acp` switches mode and model in place (session/set_mode,
 * session/set_model) and restores a conversation with session/load, so one
 * process serves a whole Happy session; the runner applies mode and model over
 * ACP instead of passing CLI flags.
 */

import type { SessionNotification } from '@agentclientprotocol/sdk';
import { AcpBackend, type AcpBackendOptions, type AcpPermissionHandler } from '../acp/AcpBackend';
import type { AgentFactoryOptions, McpServerConfig } from '../core';
import { agentRegistry } from '../core';
import { DefaultTransport, type IdentifiableToolCall, type IdentifiedToolCall } from '../transport';
import { logger } from '@/ui/logger';
import { QODER_SDK_ISOLATION_ENV, resolveQoderCommand } from '@/qoder/constants';

export interface QoderBackendOptions extends AgentFactoryOptions {
  mcpServers?: Record<string, McpServerConfig>;
  permissionHandler?: AcpPermissionHandler;
  /** Qoder session id to restore with session/load. */
  resumeSessionId?: string;
  /** Receives the history qodercli replays while loading `resumeSessionId`. */
  onReplayedUpdate?: (update: SessionNotification['update']) => void;
  /**
   * Model and context window to start with. qodercli takes a context window only at
   * startup (`--context-window`; ACP has no option for it) and switching models over
   * ACP resets it to the model's default, so a picked window comes with its model.
   * Both override what a restored session had.
   */
  launch?: QoderLaunch;
  /**
   * Answers AskUserQuestion, which qodercli offers only to a client that can answer
   * form elicitations. Left out (orchestrator one-shot runs), the agent cannot ask.
   */
  onElicitation?: AcpBackendOptions['onElicitation'];
}

export type QoderLaunch = { model: string | null; contextWindow: number | null };

/**
 * qodercli names an MCP tool only in a call's title, with a `call_…` id and kind
 * `other`: "change_title (happy)" in permission requests and "change_title (happy
 * MCP Server)" in session updates. Returns the name in qodercli's own form
 * (`mcp__happy__change_title`), or null for any other title.
 */
export function qoderMcpToolName(title: unknown): string | null {
  const match = String(title ?? '').match(/^(\S+) \((\S+?)(?: MCP Server)?\)$/);
  return match ? `mcp__${match[2]}__${match[1]}` : null;
}

/** ACP kinds that do not say which tool a qodercli call is. */
const QODER_UNNAMED_KINDS = new Set(['other', 'switch_mode']);

/**
 * qodercli's meta-tool for MCP tools it loads lazily: `mcp_call({ toolName, arguments })`
 * runs MCP tool `toolName` (`mcp__<server>__<tool>`), named nowhere else in the call.
 */
const QODER_MCP_CALL = 'mcp_call';

/**
 * The MCP tool an `mcp_call` input runs and its arguments, or null when the input names
 * no tool. A `<server>/<tool>` name, the form qodercli's permission titles use, is
 * given in qodercli's own form too.
 */
export function unwrapQoderMcpCall(rawInput: unknown): IdentifiedToolCall | null {
  const { toolName, arguments: args } = (rawInput ?? {}) as { toolName?: unknown; arguments?: unknown };
  if (typeof toolName !== 'string' || !toolName) return null;
  return {
    name: toolName.replace(/^([^/]+)\/(.+)$/, 'mcp__$1__$2'),
    input: args && typeof args === 'object' && !Array.isArray(args) ? args as Record<string, unknown> : {},
  };
}

/**
 * Names the calls whose ACP kind does not say which tool they are: MCP tools by their
 * title, the rest (EnterPlanMode as `other`, ExitPlanMode as `switch_mode`) by the
 * tool name qodercli puts in `_meta.qoder`, else by the title. The tool call and its
 * permission request get the same name, though their titles differ ("EnterPlanMode",
 * then "Allow entering plan mode?"), so the app and the permission handler know the tool.
 * An `mcp_call` is named after the MCP tool it runs, with that tool's arguments as input.
 */
export class QoderTransport extends DefaultTransport {
  identifyToolCall(toolCall: IdentifiableToolCall): IdentifiedToolCall | null {
    if (!QODER_UNNAMED_KINDS.has(String(toolCall.kind))) return null;
    const metaName = (toolCall._meta as { qoder?: { toolName?: unknown } } | undefined)?.qoder?.toolName;
    const name = qoderMcpToolName(toolCall.title) || (typeof metaName === 'string' && metaName) || (typeof toolCall.title === 'string' && toolCall.title) || null;
    if (name === QODER_MCP_CALL) return unwrapQoderMcpCall(toolCall.rawInput) ?? { name };
    return name ? { name } : null;
  }
}

const qoderTransport = new QoderTransport('qoder');

/**
 * qodercli writes token counts (and the share of the context window used) to its
 * transcript only with this set; without it every count is zero or left out.
 * readQoderContextUsage reads them.
 */
const QODER_TOKEN_USAGE_ENV = { QODER_EXPOSE_TOKEN_USAGE: '1' };

export function createQoderBackend(options: QoderBackendOptions): AcpBackend {
  const command = resolveQoderCommand();
  logger.debug('[Qoder] Creating ACP backend', {
    command,
    cwd: options.cwd,
    resumeSessionId: options.resumeSessionId,
    launch: options.launch,
    mcpServerCount: options.mcpServers ? Object.keys(options.mcpServers).length : 0,
  });

  return new AcpBackend({
    agentName: 'qoder',
    cwd: options.cwd,
    command,
    args: [
      '--acp',
      ...(options.launch?.model ? ['--model', options.launch.model] : []),
      ...(options.launch?.contextWindow ? ['--context-window', String(options.launch.contextWindow)] : []),
    ],
    env: { ...options.env, ...QODER_SDK_ISOLATION_ENV, ...QODER_TOKEN_USAGE_ENV },
    mcpServers: options.mcpServers,
    permissionHandler: options.permissionHandler,
    transportHandler: qoderTransport,
    resumeSessionId: options.resumeSessionId,
    onReplayedUpdate: options.onReplayedUpdate,
    onElicitation: options.onElicitation,
  });
}

export function registerQoderAgent(): void {
  agentRegistry.register('qoder', (opts) => createQoderBackend(opts));
  logger.debug('[Qoder] Registered with agent registry');
}
