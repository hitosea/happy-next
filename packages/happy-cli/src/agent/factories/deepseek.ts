/**
 * DeepSeek ACP Backend - DeepSeek Harness CLI (`dsh --profile acp`)
 *
 * `dsh --profile acp` switches model and reasoning effort in place via
 * `session/set_config_option` and restores persisted sessions via `session/resume`.
 * Its `tool_call` notifications carry `kind: 'other'`, `title: <toolName>` and parsed
 * JSON arguments in `rawInput`. `DeepSeekTransport` maps built-in `dsh-base` tools and
 * Happy's interactive MCP tools to the tool names and inputs the app's cards expect.
 */

import type { DeepSeekPermissionMode } from 'happy-wire';
import { AcpBackend, type AcpPermissionHandler } from '../acp/AcpBackend';
import type { AgentFactoryOptions, McpServerConfig } from '../core';
import { agentRegistry } from '../core';
import { DefaultTransport, type IdentifiableToolCall, type IdentifiedToolCall } from '../transport';
import { logger } from '@/ui/logger';
import { resolveDeepSeekCommand } from '@/deepseek/constants';

export interface DeepSeekBackendOptions extends AgentFactoryOptions {
  mcpServers?: Record<string, McpServerConfig>;
  permissionHandler?: AcpPermissionHandler;
  /** Happy permission mode mapped to `DSH_PERMISSION_MODE` when spawning `dsh --profile acp`. */
  permissionMode?: DeepSeekPermissionMode;
  /** DeepSeek Harness session id to restore with `session/resume`. */
  resumeSessionId?: string;
}

/** `DSH_PERMISSION_MODE` preset for each Happy DeepSeek permission mode. */
export const DEEPSEEK_PERMISSION_ENV: Record<DeepSeekPermissionMode, string> = {
  default: 'workspace-write',
  'read-only': 'read-only',
  plan: 'read-only',
  yolo: 'danger-full-access',
};

const DEEPSEEK_INIT_TIMEOUT_MS = 60_000;

type DeepSeekInput = Record<string, unknown>;

function pickDefined(entries: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(entries).filter(([, value]) => value !== undefined));
}

function deepSeekCardTool(title: string, input: DeepSeekInput): IdentifiedToolCall | null {
  switch (title) {
    case 'read':
    case 'read_image':
      return {
        name: 'Read',
        input: pickDefined({
          file_path: input.file_path ?? input.path,
          offset: input.offset,
          limit: input.limit,
        }),
      };
    case 'write':
      return {
        name: 'Write',
        input: pickDefined({
          file_path: input.file_path ?? input.path,
          content: input.content,
          sandbox_permissions: input.sandbox_permissions,
          justification: input.justification,
        }),
      };
    case 'edit':
      return {
        name: 'Edit',
        input: pickDefined({
          file_path: input.file_path ?? input.path,
          old_string: input.old_string,
          new_string: input.new_string,
          replace_all: input.replace_all,
          sandbox_permissions: input.sandbox_permissions,
          justification: input.justification,
        }),
      };
    case 'bash':
    case 'pwsh':
      return {
        name: 'Bash',
        input: pickDefined({
          command: input.command,
          description: input.description ?? input.justification,
          sandbox_permissions: input.sandbox_permissions,
          justification: input.justification,
        }),
      };
    case 'grep':
      return {
        name: 'Grep',
        input: pickDefined({
          pattern: input.pattern,
          path: input.path,
          glob: input.include ?? input.glob,
        }),
      };
    case 'glob':
      return {
        name: 'Glob',
        input: pickDefined({
          pattern: input.pattern,
          path: input.path,
        }),
      };
    case 'todo_write':
      return {
        name: 'TodoWrite',
        input: pickDefined({
          todos: input.todos,
        }),
      };
    case 'web_search':
      return {
        name: 'WebSearch',
        input,
      };
    case 'web_fetch':
      return {
        name: 'WebFetch',
        input,
      };
    case 'mcp__happy__ask_user_question':
      return {
        name: 'AskUserQuestion',
        input,
      };
    case 'mcp__happy__exit_plan_mode':
      return {
        name: 'ExitPlanMode',
        input,
      };
    default:
      if (title.startsWith('mcp__')) {
        return { name: title, input };
      }
      return null;
  }
}

export class DeepSeekTransport extends DefaultTransport {
  override getInitTimeout(): number {
    return DEEPSEEK_INIT_TIMEOUT_MS;
  }

  identifyToolCall(toolCall: IdentifiableToolCall): IdentifiedToolCall | null {
    const title = typeof toolCall.title === 'string' ? toolCall.title.trim() : '';
    if (!title) return null;
    const input = toolCall.rawInput && typeof toolCall.rawInput === 'object' && !Array.isArray(toolCall.rawInput)
      ? toolCall.rawInput as DeepSeekInput
      : {};
    return deepSeekCardTool(title, input);
  }
}

const deepSeekTransport = new DeepSeekTransport('deepseek');

export function createDeepSeekBackend(options: DeepSeekBackendOptions): AcpBackend {
  const command = resolveDeepSeekCommand();
  const dshPermissionMode = DEEPSEEK_PERMISSION_ENV[options.permissionMode ?? 'default'] ?? 'workspace-write';

  logger.debug('[DeepSeek] Creating ACP backend', {
    command,
    cwd: options.cwd,
    dshPermissionMode,
    resumeSessionId: options.resumeSessionId,
    mcpServerCount: options.mcpServers ? Object.keys(options.mcpServers).length : 0,
  });

  return new AcpBackend({
    agentName: 'deepseek',
    cwd: options.cwd,
    command,
    args: ['--profile', 'acp'],
    env: {
      ...options.env,
      DSH_PERMISSION_MODE: dshPermissionMode,
    },
    mcpServers: options.mcpServers,
    permissionHandler: options.permissionHandler,
    transportHandler: deepSeekTransport,
    resumeSessionId: options.resumeSessionId,
    resumeMethod: 'resume',
  });
}

export function registerDeepSeekAgent(): void {
  agentRegistry.register('deepseek', (opts) => createDeepSeekBackend(opts));
  logger.debug('[DeepSeek] Registered with agent registry');
}
