/**
 * Qoder native session listing and forking.
 *
 * Unlike Gemini (which Happy can read from its own on-disk transcript) or Codex
 * (JSONL files), Qoder's history is only reachable through the CLI itself. These helpers
 * open a short-lived `qoder --acp` process just to answer one request, then tear it down.
 *
 * Three properties were measured against a signed-in CLI 1.1.62 and each one shapes the
 * code below:
 *
 * 1. `session/list` filters by the *spawned process's* working directory. Passing a `cwd`
 *    parameter changes nothing, so listing directory D requires spawning inside D. A
 *    machine-wide listing is therefore not available — only per-directory.
 * 2. The reply carries no `total` and no cursor, and `limit` is ignored, so paging has to
 *    happen client-side over the full array.
 * 3. Row `cwd` is simply whatever the process was started with — measured: a session under
 *    /var/folders/... comes back as /var/folders/... while /tmp comes back as /private/tmp.
 *    So it is NOT a normalised path and must never be used to match a session directory.
 *    Matching is unnecessary anyway: scoping happens by spawning inside that directory.
 */

import { spawn, type ChildProcess } from 'node:child_process';

import { ClientSideConnection, ndJsonStream } from '@agentclientprotocol/sdk';
import { logger } from '@/ui/logger';
import { toAcpError } from '@/agent/acp/AcpBackend';
import {
  QODER_ACP_FLAG,
  isQoderAuthError,
  qoderAuthErrorMessage,
  qoderSdkIsolationEnv,
  resolveQoderCommand,
} from '@/qoder/constants';

export interface QoderNativeSession {
  sessionId: string;
  /**
   * Directory as Qoder echoed it back, which is only trustworthy for display: it equals
   * whatever the spawned process was given, symlink and all. Use `requestedCwd` for
   * anything that has to compare against a Happy session's recorded path.
   */
  cwd: string;
  /** The directory this listing was scoped to, verbatim from the caller. */
  requestedCwd: string;
  /** First prompt text, which Qoder uses as the title. */
  title: string | null;
  /** Epoch milliseconds; Qoder reports ISO-8601. */
  updatedAt: number | null;
}

export interface QoderNativeSessionsOptions {
  cwd: string;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 45_000;

function parseIsoToEpoch(value: unknown): number | null {
  if (typeof value !== 'string' || !value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Run `fn` against a throwaway ACP connection and always reap the process.
 *
 * `initialize` is enough for list/fork: neither needs a live session, and creating one
 * just to enumerate would add a turn to Qoder's own history.
 */
async function withThrowawayQoderClient<T>(
  cwd: string,
  timeoutMs: number,
  fn: (conn: ClientSideConnection) => Promise<T>,
): Promise<T> {
  const command = resolveQoderCommand();
  const child: ChildProcess = spawn(command, [QODER_ACP_FLAG], {
    cwd,
    // Isolation is mandatory here too: a daemon started from inside a Qoder-hosted shell
    // would otherwise make every listing fail with sdk_invalid_args.
    env: { ...process.env, ...qoderSdkIsolationEnv() },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stderrTail = '';
  child.stderr?.on('data', chunk => {
    stderrTail = (stderrTail + String(chunk)).slice(-2000);
  });

  const writable = new WritableStream({
    write(chunk: Uint8Array) {
      return new Promise<void>((resolve, reject) => {
        child.stdin!.write(Buffer.from(chunk), err => (err ? reject(err) : resolve()));
      });
    },
  });
  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      child.stdout!.on('data', chunk => controller.enqueue(new Uint8Array(chunk)));
      child.stdout!.on('end', () => controller.close());
      child.stdout!.on('error', err => controller.error(err));
    },
  });

  const conn = new ClientSideConnection(
    () => ({
      async requestPermission() {
        // A listing/fork turn must not be able to hang waiting for an approval that
        // nobody is around to give: there is no mobile session behind this process.
        return { outcome: { outcome: 'cancelled' as const } };
      },
      async sessionUpdate() { /* not expected */ },
    }),
    ndJsonStream(writable, readable),
  );

  const guard = new Promise<never>((_, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Qoder did not respond within ${timeoutMs}ms`)),
      timeoutMs,
    );
    timer.unref?.();
  });

  try {
    return await Promise.race([
      (async () => {
        await conn.initialize({
          protocolVersion: 1,
          clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
          clientInfo: { name: 'happy-cli', version: '0' },
        });
        return fn(conn);
      })(),
      guard,
    ]);
  } catch (error) {
    const detail = toAcpError(error).message;
    if (isQoderAuthError(detail) || isQoderAuthError(stderrTail)) {
      throw new Error(qoderAuthErrorMessage(command));
    }
    throw new Error(stderrTail
      ? `${detail} (qoder stderr: ${stderrTail.trim().split('\n').slice(-3).join(' | ')})`
      : detail);
  } finally {
    child.kill('SIGTERM');
    // Wait for the child to actually go, up to a grace period: a SIGTERM-ignored process
    // would otherwise linger as a zombie holding a cwd handle open on Windows. Racing the
    // exit event rather than sleeping the full grace keeps the common (POSIX) case, where
    // the child is gone in milliseconds, off the caller's critical path.
    if (child.exitCode === null && child.signalCode === null) {
      await Promise.race([
        new Promise<void>(resolve => child.once('exit', () => resolve())),
        new Promise<void>(resolve => {
          const timer = setTimeout(resolve, 250);
          timer.unref?.();
        }),
      ]);
    }
  }
}

/**
 * List Qoder's own sessions for one directory.
 *
 * Results come back newest-first as Qoder reports them; sorting is applied here because
 * the caller pages over the array and an unsorted slice would drop the wrong entries.
 */
export async function listQoderNativeSessions(
  options: QoderNativeSessionsOptions,
): Promise<QoderNativeSession[]> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const rows = await withThrowawayQoderClient(options.cwd, timeoutMs, async conn => {
    const reply = await conn.unstable_listSessions({ cwd: options.cwd });
    return reply?.sessions ?? [];
  });

  const sessions: QoderNativeSession[] = [];
  for (const row of rows) {
    if (!row || typeof row.sessionId !== 'string' || !row.sessionId) continue;
    sessions.push({
      sessionId: row.sessionId,
      cwd: typeof row.cwd === 'string' && row.cwd ? row.cwd : options.cwd,
      requestedCwd: options.cwd,
      title: typeof row.title === 'string' && row.title.trim() ? row.title.trim() : null,
      updatedAt: parseIsoToEpoch(row.updatedAt),
    });
  }

  sessions.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  logger.debug(`[Qoder] Listed ${sessions.length} native sessions for ${options.cwd}`);
  return sessions;
}

/**
 * Fork a Qoder session into a fresh one, so "duplicate" gives an independent history
 * instead of two Happy sessions appending to the same native conversation.
 */
export async function forkQoderNativeSession(options: {
  cwd: string;
  sessionId: string;
  timeoutMs?: number;
}): Promise<string> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const forked = await withThrowawayQoderClient(options.cwd, timeoutMs, async conn => {
    const reply = await conn.unstable_forkSession({
      sessionId: options.sessionId,
      cwd: options.cwd,
    });
    return reply?.sessionId;
  });

  if (typeof forked !== 'string' || !forked) {
    throw new Error('Qoder accepted the fork but did not return a session id');
  }
  logger.debug(`[Qoder] Forked ${options.sessionId} -> ${forked}`);
  return forked;
}
