/**
 * The models the signed-in Antigravity account offers, with their thinking levels,
 * and the slash commands agy offers in a directory.
 *
 * Only agy knows either, so each ask starts a short-lived `agy acp`. The daemon keeps
 * the model list, as for every agent (see agentModels/listAgentModels).
 */

import { Readable, Writable } from 'node:stream';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { ClientSideConnection, ndJsonStream, type AvailableCommand, type SessionNotification } from '@agentclientprotocol/sdk';
import { configuration } from '@/configuration';
import { listAcpModels, type AcpModel } from '@/agent/acp/listAcpModels';
import { resolveAntigravityCommand } from '@/antigravity/constants';
import { withShortLivedProcess } from '@/utils/shortLivedProcess';

const ANTIGRAVITY_OP_TIMEOUT_MS = 30_000;

async function withAntigravityConnection<T>(
  cwd: string,
  run: (connection: ClientSideConnection) => Promise<T>,
  onSessionUpdate: (notification: SessionNotification) => void = () => {},
): Promise<T> {
  return withShortLivedProcess(resolveAntigravityCommand(), ['acp'], { cwd, env: process.env, timeoutMs: ANTIGRAVITY_OP_TIMEOUT_MS }, async (child) => {
    const connection = new ClientSideConnection(
      () => ({
        sessionUpdate: async (notification) => onSessionUpdate(notification),
        requestPermission: async () => ({ outcome: { outcome: 'cancelled' } }),
      }),
      ndJsonStream(
        Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
        Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
      ),
    );
    await connection.initialize({ protocolVersion: 1, clientCapabilities: {} });
    return run(connection);
  });
}

/** Asks agy for the account's models; agentModels/listAgentModels keeps the list. */
export async function fetchAntigravityModels(): Promise<AcpModel[]> {
  // One fixed directory, so what agy keeps per directory stays in one place
  const cwd = join(configuration.happyHomeDir, 'antigravity');
  await mkdir(cwd, { recursive: true });
  const models = await withAntigravityConnection(cwd, (connection) => listAcpModels(connection, cwd));
  if (!models.length) throw new Error('agy listed no models');
  return models;
}

/** Lists the slash commands agy offers in `cwd`, announced once a (never prompted) session exists. */
export async function listAntigravityCommands(cwd: string): Promise<AvailableCommand[]> {
  let announced: (commands: AvailableCommand[]) => void = () => {};
  const commands = new Promise<AvailableCommand[]>((resolve) => { announced = resolve; });
  return withAntigravityConnection(
    cwd,
    async (connection) => {
      await connection.newSession({ cwd, mcpServers: [] });
      return commands;
    },
    ({ update }) => update.sessionUpdate === 'available_commands_update' && announced(update.availableCommands),
  );
}
