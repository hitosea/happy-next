/**
 * Qoder ACP Backend - Qoder CLI agent via ACP
 *
 * `qodercli --acp` switches mode and model in place (session/set_mode,
 * session/set_model) and restores a conversation with session/load, so one
 * process serves a whole Happy session; the runner applies mode and model over
 * ACP instead of passing CLI flags.
 */

import type { SessionNotification } from '@agentclientprotocol/sdk';
import { AcpBackend, type AcpPermissionHandler } from '../acp/AcpBackend';
import type { AgentFactoryOptions, McpServerConfig } from '../core';
import { agentRegistry } from '../core';
import { DefaultTransport } from '../transport';
import { logger } from '@/ui/logger';
import { QODER_SDK_ISOLATION_ENV, resolveQoderCommand } from '@/qoder/constants';

export interface QoderBackendOptions extends AgentFactoryOptions {
  mcpServers?: Record<string, McpServerConfig>;
  permissionHandler?: AcpPermissionHandler;
  /** Qoder session id to restore with session/load. */
  resumeSessionId?: string;
  /** Receives the history qodercli replays while loading `resumeSessionId`. */
  onReplayedUpdate?: (update: SessionNotification['update']) => void;
}

const qoderTransport = new DefaultTransport('qoder');

export function createQoderBackend(options: QoderBackendOptions): AcpBackend {
  const command = resolveQoderCommand();
  logger.debug('[Qoder] Creating ACP backend', {
    command,
    cwd: options.cwd,
    resumeSessionId: options.resumeSessionId,
    mcpServerCount: options.mcpServers ? Object.keys(options.mcpServers).length : 0,
  });

  return new AcpBackend({
    agentName: 'qoder',
    cwd: options.cwd,
    command,
    args: ['--acp'],
    env: { ...options.env, ...QODER_SDK_ISOLATION_ENV },
    mcpServers: options.mcpServers,
    permissionHandler: options.permissionHandler,
    transportHandler: qoderTransport,
    resumeSessionId: options.resumeSessionId,
    onReplayedUpdate: options.onReplayedUpdate,
  });
}

export function registerQoderAgent(): void {
  agentRegistry.register('qoder', (opts) => createQoderBackend(opts));
  logger.debug('[Qoder] Registered with agent registry');
}
