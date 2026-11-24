/**
 * The models the signed-in Antigravity account offers, with their thinking levels,
 * and the slash commands agy offers in a directory.
 *
 * Only agy knows either, so each ask starts a short-lived `agy acp`. The daemon keeps
 * one model list per machine, on disk too, and starts agy only when that list is old:
 * under 5 min served as is, up to 1 h served and refreshed in the background, older
 * refreshed first (served if that fails). After a failed refresh agy is not started
 * again for 5 min while a list is on hand, or for 1 min with none.
 */

import { Readable, Writable } from 'node:stream';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { ClientSideConnection, ndJsonStream, type AvailableCommand, type SessionNotification } from '@agentclientprotocol/sdk';
import { configuration } from '@/configuration';
import { listAcpModels, type AcpModel } from '@/agent/acp/listAcpModels';
import { resolveAntigravityCommand } from '@/antigravity/constants';
import { createRefreshingCache } from '@/utils/refreshingCache';
import { withShortLivedProcess } from '@/utils/shortLivedProcess';

const ANTIGRAVITY_OP_TIMEOUT_MS = 30_000;
const MINUTE_MS = 60_000;

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

async function fetchAntigravityModels(): Promise<AcpModel[]> {
  // One fixed directory, so what agy keeps per directory stays in one place
  const cwd = join(configuration.happyHomeDir, 'antigravity');
  await mkdir(cwd, { recursive: true });
  const models = await withAntigravityConnection(cwd, (connection) => listAcpModels(connection, cwd));
  if (!models.length) throw new Error('agy listed no models');
  return models;
}

const antigravityModels = createRefreshingCache({
  file: join(configuration.happyHomeDir, 'antigravity-models.json'),
  fetch: fetchAntigravityModels,
  freshMs: 5 * MINUTE_MS,
  maxAgeMs: 60 * MINUTE_MS,
  failureCooldownMs: 5 * MINUTE_MS,
  emptyFailureCooldownMs: MINUTE_MS,
});

export function listAntigravityModels(): Promise<AcpModel[]> {
  return antigravityModels.get();
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
