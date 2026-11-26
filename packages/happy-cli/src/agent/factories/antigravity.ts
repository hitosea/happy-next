/**
 * Antigravity ACP Backend - Google Antigravity CLI (`agy acp`)
 *
 * `agy acp` switches mode, model and thinking level in place (session/set_mode,
 * session/set_config_option) and restores a conversation with session/load, so one
 * process serves a whole Happy session.
 *
 * agy's tool calls carry no tool name: only an ACP `kind` (`read`, `execute`, `edit`,
 * `other`), a `title`, and its own input in `rawInput` (`{ CommandLine }`, `{ Path, Target,
 * Replacement }`, ...). The tools the app has cards for are told apart by kind and input and
 * given the names and input those cards read; MCP tools by their title, `Run mcp_<server>_<tool>`.
 */

import type { SessionNotification } from '@agentclientprotocol/sdk';
import type { AntigravityPermissionMode } from 'happy-wire';
import { AcpBackend, type AcpPermissionHandler } from '../acp/AcpBackend';
import type { AgentFactoryOptions, McpServerConfig } from '../core';
import { agentRegistry } from '../core';
import { DefaultTransport, type IdentifiableToolCall, type IdentifiedToolCall } from '../transport';
import { logger } from '@/ui/logger';
import { resolveAntigravityCommand } from '@/antigravity/constants';

export interface AntigravityBackendOptions extends AgentFactoryOptions {
  mcpServers?: Record<string, McpServerConfig>;
  permissionHandler?: AcpPermissionHandler;
  /** Antigravity session id to restore with session/load. */
  resumeSessionId?: string;
  /** Receives the history agy replays while loading `resumeSessionId`. */
  onReplayedUpdate?: (update: SessionNotification['update']) => void;
}

/** agy's ACP mode for each Happy permission mode; yolo runs in agy's default mode with Happy approving every request. */
export const ANTIGRAVITY_ACP_MODES: Record<AntigravityPermissionMode, string> = {
  default: 'default',
  acceptEdits: 'accept-edits',
  auto: 'auto',
  plan: 'plan',
  yolo: 'default',
};

/**
 * Resolves the ACP mode id to send to `agy acp` for a Happy permission mode.
 * Falls back to `default` when `agy` reported its available modes and does not
 * offer the requested mode (e.g. `auto` without an OS terminal sandbox).
 */
export function resolveAntigravityAcpMode(
  mode: string,
  availableModes?: ReadonlySet<string> | null,
): string {
  const requested = ANTIGRAVITY_ACP_MODES[mode as AntigravityPermissionMode] ?? 'default';
  if (availableModes && availableModes.size > 0 && !availableModes.has(requested)) {
    return 'default';
  }
  return requested;
}

type AntigravityInput = Record<string, unknown>;

/** The app's tool for an agy tool call it has a card for, with the input that card reads. */
function antigravityCardTool(kind: unknown, input: AntigravityInput): IdentifiedToolCall | null {
  if (kind === 'execute' && input.CommandLine !== undefined) {
    return { name: 'Bash', input: { command: input.CommandLine, description: input.toolSummary } };
  }
  if (kind === 'read' && input.Path !== undefined) return { name: 'Read', input: { file_path: input.Path } };
  if (kind === 'edit' && input.Target !== undefined) {
    return { name: 'Edit', input: { file_path: input.Path, old_string: input.Target, new_string: input.Replacement } };
  }
  if (kind === 'edit' && input.Content !== undefined) return { name: 'Write', input: { file_path: input.Path, content: input.Content } };
  return null;
}

/**
 * agy titles an MCP tool call `Run mcp_<server>_<tool>`; returns the tool in the
 * `mcp__<server>__<tool>` form Happy matches its own tools by, or null for other titles.
 */
export function antigravityMcpToolName(title: string): string | null {
  const match = title.match(/^Run mcp_([a-z0-9-]+?)_(\w+)$/i);
  return match ? `mcp__${match[1]}__${match[2]}` : null;
}

export class AntigravityTransport extends DefaultTransport {
  identifyToolCall(toolCall: IdentifiableToolCall): IdentifiedToolCall | null {
    const input = toolCall.rawInput && typeof toolCall.rawInput === 'object' && !Array.isArray(toolCall.rawInput)
      ? toolCall.rawInput as AntigravityInput
      : {};
    const card = antigravityCardTool(toolCall.kind, input);
    if (card) return { name: card.name, input: Object.fromEntries(Object.entries(card.input ?? {}).filter(([, value]) => value !== undefined)) };
    const mcpName = typeof toolCall.title === 'string' ? antigravityMcpToolName(toolCall.title) : null;
    if (!mcpName) return null;
    // toolSummary is agy's own note on the call, not the tool's input.
    const { toolSummary: _summary, ...mcpInput } = input;
    return { name: mcpName, input: mcpInput };
  }
}

const antigravityTransport = new AntigravityTransport('antigravity');

export function createAntigravityBackend(options: AntigravityBackendOptions): AcpBackend {
  const command = resolveAntigravityCommand();
  logger.debug('[Antigravity] Creating ACP backend', {
    command,
    cwd: options.cwd,
    resumeSessionId: options.resumeSessionId,
    mcpServerCount: options.mcpServers ? Object.keys(options.mcpServers).length : 0,
  });

  return new AcpBackend({
    agentName: 'antigravity',
    cwd: options.cwd,
    command,
    args: ['acp'],
    env: options.env,
    mcpServers: options.mcpServers,
    permissionHandler: options.permissionHandler,
    transportHandler: antigravityTransport,
    resumeSessionId: options.resumeSessionId,
    onReplayedUpdate: options.onReplayedUpdate,
  });
}

export function registerAntigravityAgent(): void {
  agentRegistry.register('antigravity', (opts) => createAntigravityBackend(opts));
  logger.debug('[Antigravity] Registered with agent registry');
}
