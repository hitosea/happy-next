/**
 * Qoder session operations for the app's copy flow and new-session pickers.
 *
 * qodercli has no plain command for these, so each call starts a short-lived
 * `qodercli --acp`, uses the ACP method and exits.
 */

import { Readable, Writable } from 'node:stream';
import { ClientSideConnection, ndJsonStream, type AvailableCommand, type SessionNotification } from '@agentclientprotocol/sdk';
import { logger } from '@/ui/logger';
import { listAcpModels, type AcpModel } from '@/agent/acp/listAcpModels';
import { QODER_SDK_ISOLATION_ENV, resolveQoderCommand, type QoderBuild } from '@/qoder/constants';
import { withShortLivedProcess } from '@/utils/shortLivedProcess';

const QODER_SESSION_OP_TIMEOUT_MS = 30_000;

async function withQoderConnection<T>(
  cwd: string,
  build: QoderBuild | undefined,
  run: (connection: ClientSideConnection) => Promise<T>,
  onSessionUpdate: (notification: SessionNotification) => void = () => {},
  timeoutMs = QODER_SESSION_OP_TIMEOUT_MS,
): Promise<T> {
  const env = { ...process.env, ...QODER_SDK_ISOLATION_ENV };
  return withShortLivedProcess(resolveQoderCommand(process.env, build), ['--acp'], { cwd, env, timeoutMs }, async (child) => {
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

/** Copies a Qoder conversation into a new session and returns the new session id. */
export async function forkQoderSession(sessionId: string, cwd: string, build?: QoderBuild): Promise<string> {
  return withQoderConnection(cwd, build, async (connection) => {
    const forked = await connection.unstable_forkSession({ sessionId, cwd, mcpServers: [] });
    logger.debug(`[Qoder] Forked session ${sessionId} into ${forked.sessionId}`);
    return forked.sessionId;
  });
}

/**
 * Lists the models the signed-in account offers over ACP. A session that never
 * gets a prompt is not saved by qodercli, so this leaves no trace in Qoder's history.
 */
export async function listQoderModelsOverAcp(cwd: string, build: QoderBuild, timeoutMs: number): Promise<AcpModel[]> {
  return withQoderConnection(cwd, build, (connection) => listAcpModels(connection, cwd), undefined, timeoutMs);
}

/**
 * Lists the slash commands and skills qodercli offers in `cwd`. qodercli keeps
 * them nowhere Happy can read and only announces them once a session exists,
 * so a throwaway session is opened and its first announcement returned.
 */
export async function listQoderCommands(cwd: string, build?: QoderBuild): Promise<AvailableCommand[]> {
  let announced: (commands: AvailableCommand[]) => void = () => {};
  const commands = new Promise<AvailableCommand[]>((resolve) => { announced = resolve; });
  return withQoderConnection(
    cwd,
    build,
    async (connection) => {
      await connection.newSession({ cwd, mcpServers: [] });
      return commands;
    },
    ({ update }) => update.sessionUpdate === 'available_commands_update' && announced(update.availableCommands),
  );
}
