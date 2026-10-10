/**
 * Qoder session operations for the app's copy flow and new-session model picker.
 *
 * qodercli has no plain command for these, so each call starts a short-lived
 * `qodercli --acp`, uses the ACP method and exits.
 */

import { spawn } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import { ClientSideConnection, ndJsonStream } from '@agentclientprotocol/sdk';
import { logger } from '@/ui/logger';
import type { Metadata } from '@/api/types';
import { mergeAcpSessionConfigIntoMetadata } from '@/agent/acp/sessionConfigMetadata';
import { QODER_SDK_ISOLATION_ENV, resolveQoderCommand } from '@/qoder/constants';

const QODER_SESSION_OP_TIMEOUT_MS = 30_000;

async function withQoderConnection<T>(cwd: string, run: (connection: ClientSideConnection) => Promise<T>): Promise<T> {
  const child = spawn(resolveQoderCommand(), ['--acp'], {
    cwd,
    env: { ...process.env, ...QODER_SDK_ISOLATION_ENV },
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  let timer: NodeJS.Timeout | undefined;
  const failed = new Promise<never>((_, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => reject(new Error(`qodercli exited with code ${code}`)));
    timer = setTimeout(() => reject(new Error('Timed out waiting for qodercli')), QODER_SESSION_OP_TIMEOUT_MS);
  });

  const connection = new ClientSideConnection(
    () => ({
      sessionUpdate: async () => {},
      requestPermission: async () => ({ outcome: { outcome: 'cancelled' } }),
    }),
    ndJsonStream(
      Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
      Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
    ),
  );

  try {
    return await Promise.race([
      connection.initialize({ protocolVersion: 1, clientCapabilities: {} }).then(() => run(connection)),
      failed,
    ]);
  } finally {
    clearTimeout(timer);
    child.kill();
  }
}

/** Copies a Qoder conversation into a new session and returns the new session id. */
export async function forkQoderSession(sessionId: string, cwd: string): Promise<string> {
  return withQoderConnection(cwd, async (connection) => {
    const forked = await connection.unstable_forkSession({ sessionId, cwd, mcpServers: [] });
    logger.debug(`[Qoder] Forked session ${sessionId} into ${forked.sessionId}`);
    return forked.sessionId;
  });
}

export type QoderModel = NonNullable<Metadata['models']>[number] & {
  /** Reasoning efforts the model takes; absent when it has no effort control. */
  efforts?: NonNullable<Metadata['thoughtLevels']>;
  /** The effort qodercli picks when the model is selected. */
  defaultEffort?: string;
};

/**
 * Lists the models the signed-in account offers, with the efforts each takes.
 * qodercli only reports a model's efforts once it is selected, and resets the
 * effort to the model's own default on every switch, so each model is selected
 * in turn. A session that never gets a prompt is not saved by qodercli, so this
 * leaves no trace in Qoder's history.
 */
export async function listQoderModels(cwd: string): Promise<QoderModel[]> {
  return withQoderConnection(cwd, async (connection) => {
    const { sessionId, configOptions, models } = await connection.newSession({ cwd, mcpServers: [] });
    const listed = mergeAcpSessionConfigIntoMetadata({} as Metadata, { configOptions, models }).models ?? [];
    const result: QoderModel[] = [];
    for (const model of listed) {
      const selected = await connection.setSessionConfigOption({ sessionId, configId: 'model', value: model.code });
      const { thoughtLevels, currentThoughtLevelCode } = mergeAcpSessionConfigIntoMetadata({} as Metadata, { configOptions: selected.configOptions });
      result.push(thoughtLevels?.length ? { ...model, efforts: thoughtLevels, defaultEffort: currentThoughtLevelCode } : model);
    }
    return result;
  });
}
