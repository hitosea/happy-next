/**
 * Qoder ACP Backend - Qoder CLI agent via ACP
 *
 * Factory for a backend that drives `qoder --acp` over the Agent Client Protocol.
 * Modelled on src/agent/factories/gemini.ts, with two deliberate differences:
 *
 * 1. No API key plumbing. Qoder authenticates as a signed-in *account*
 *    (the international build advertises `qodercli-login`, the CN build `qoderclicn-login`), not with an inference token Happy can
 *    hold, so there is no `happy connect qoder` equivalent of GEMINI_API_KEY here.
 * 2. Model and approval mode are passed as spawn flags rather than env vars.
 *    Verified against qoder-cli 1.1.62 that `--acp` composes with `--model`,
 *    `--permission-mode` and `--yolo`; an unknown `--model` value still passes
 *    `initialize`, so tier validation happens later (session/new or first prompt).
 */

import { AcpBackend, type AcpBackendOptions, type AcpPermissionHandler } from '../acp/AcpBackend';
import type { AgentBackend, McpServerConfig, AgentFactoryOptions } from '../core';
import { agentRegistry, hasChangeTitleInstruction } from '../core';
import { qoderTransport } from '../transport';
import { logger } from '@/ui/logger';
import {
  QODER_ACP_FLAG,
  qoderSdkIsolationEnv,
  resolveQoderCommand,
} from '@/qoder/constants';

// Single home for command resolution lives in @/qoder/constants so the transport can
// name the right executable in error text without importing the factory (cycle).
export { resolveQoderCommand } from '@/qoder/constants';
import { qoderModelModeToCliModel, type QoderPermissionMode } from 'happy-wire';

export interface QoderBackendOptions extends AgentFactoryOptions {
  /** Model mode id from happy-wire's QODER_MODEL_MODES (e.g. 'qoder-auto'), null = CLI default. */
  model?: string | null;

  /** Qoder approval mode, forwarded as `--permission-mode`. */
  permissionMode?: QoderPermissionMode | null;

  /** Skip every approval prompt, mirroring the CLI's own --yolo. */
  yolo?: boolean;

  /** MCP servers to make available to the agent. */
  mcpServers?: Record<string, McpServerConfig>;

  /**
   * Native Qoder session id to reopen through ACP `session/load`, so Qoder replays
   * its own history instead of Happy re-feeding a copied transcript.
   */
  resumeSessionId?: string | null;

  /** Optional permission handler for tool approval. */
  permissionHandler?: AcpPermissionHandler;

  /**
   * Normalize raw MCP tool names to Happy's prefixed form
   * (e.g. 'change_title' -> 'mcp:happy:change_title').
   */
  normalizeToolName?: (rawName: string) => string;
}

export interface QoderBackendResult {
  backend: AgentBackend;
  /** The argv that actually reached the CLI, for assertion in tests. */
  resolution: {
    args: string[];
  };
}

/**
 * ACP mode id -> CLI `--permission-mode` value.
 *
 * The two vocabularies disagree on spelling (measured against a signed-in CLI): ACP says
 * `acceptEdits` / `dontAsk` / `yolo`; the flag takes `accept_edits` / `dont_ask` and has
 * no `yolo` — its bypass tier is `bypass_permissions`, also exposed as the `--yolo`
 * alias. Returning the literal '--yolo' as a sentinel keeps bypass identical on both
 * paths instead of trusting an undocumented flag spelling.
 */
export function qoderPermissionModeToCliFlag(
  mode?: QoderPermissionMode | null,
): string | null {
  if (mode === null || mode === undefined) return null;
  switch (mode) {
    case 'default':
    case 'auto':
      return mode;
    case 'acceptEdits':
      return 'accept_edits';
    case 'dontAsk':
      return 'dont_ask';
    case 'yolo':
      return '--yolo';
    default:
      // Unknown or forward-compat id: pass it through. The CLI rejects what it cannot
      // parse at startup, which is louder than silently downgrading to `default`.
      return mode;
  }
}

/**
 * Build the spawn argument list for `qoder`.
 *
 * `yolo` wins over `permissionMode`: Happy's "always allow" intent is stricter than any
 * named mode, and passing both would let Qoder resolve a precedence we have not
 * verified.
 */
export function buildQoderAcpArgs(opts: {
  model?: string | null;
  permissionMode?: QoderPermissionMode | null;
  yolo?: boolean;
}): string[] {
  const args: string[] = [QODER_ACP_FLAG];
  const cliModel = qoderModelModeToCliModel(opts.model ?? null);
  if (cliModel) {
    args.push('--model', cliModel);
  }
  // Happy's "always allow" wins over a named mode: it is stricter than any tier Qoder
  // would apply, and passing both would let the CLI resolve a precedence we have not
  // verified.
  if (opts.yolo) {
    args.push('--yolo');
    return args;
  }
  const cliMode = qoderPermissionModeToCliFlag(opts.permissionMode);
  if (cliMode === '--yolo') {
    args.push('--yolo');
  } else if (cliMode) {
    args.push('--permission-mode', cliMode);
  }
  return args;
}

export function createQoderBackend(options: QoderBackendOptions): QoderBackendResult {
  const command = resolveQoderCommand();
  const args = buildQoderAcpArgs(options);
  const cliModel = qoderModelModeToCliModel(options.model ?? null);

  const backendOptions: AcpBackendOptions = {
    agentName: 'qoder',
    cwd: options.cwd,
    command,
    args,
    // qoderSdkIsolationEnv() must stay *before* options.env so an explicit caller
    // override still wins, and must be present at all: inheriting
    // QODER_AGENT_SDK_ENTRYPOINT makes Qoder reject --acp outright.
    env: {
      ...qoderSdkIsolationEnv(),
      ...options.env,
    },
    mcpServers: options.mcpServers,
    permissionHandler: options.permissionHandler,
    transportHandler: qoderTransport,
    normalizeToolName: options.normalizeToolName,
    resumeSessionId: options.resumeSessionId ?? null,
    hasChangeTitleInstruction,
  };

  logger.debug('[Qoder] Creating ACP backend with options:', {
    cwd: options.cwd,
    command,
    args,
    cliModel,
    permissionMode: options.yolo ? 'yolo' : (options.permissionMode ?? 'cli-default'),
    mcpServerCount: options.mcpServers ? Object.keys(options.mcpServers).length : 0,
  });

  return {
    backend: new AcpBackend(backendOptions),
    resolution: { args },
  };
}

export function registerQoderAgent(): void {
  agentRegistry.register('qoder', (opts) => createQoderBackend(opts).backend);
  logger.debug('[Qoder] Registered with agent registry');
}
