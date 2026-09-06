import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CodexJsonRpcPeer } from './CodexJsonRpcPeer';

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

async function waitFor<T>(read: () => Promise<T | null>, timeoutMs = 2_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (value !== null) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Condition was not met within ${timeoutMs}ms`);
}

describe.skipIf(process.platform === 'win32')('CodexJsonRpcPeer process cleanup', () => {
  let processGroupId: number | null = null;
  let tempDir: string | null = null;

  afterEach(async () => {
    if (processGroupId && processExists(processGroupId)) {
      try { process.kill(-processGroupId, 'SIGKILL'); } catch { /* already exited */ }
    }
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  });

  it('kills the detached process group without leaving its child behind', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'happy-codex-peer-'));
    const childPidFile = join(tempDir, 'child.pid');
    const peer = new CodexJsonRpcPeer();

    await peer.spawn('/bin/sh', [
      '-c',
      'sleep 60 & echo $! > "$1"; wait',
      'codex-test',
      childPidFile,
    ], { cwd: tempDir });

    processGroupId = (peer as unknown as { process: { pid?: number } }).process.pid ?? null;
    expect(processGroupId).not.toBeNull();

    const childPid = await waitFor(async () => {
      try {
        const value = Number.parseInt(await readFile(childPidFile, 'utf8'), 10);
        return Number.isFinite(value) ? value : null;
      } catch {
        return null;
      }
    });
    expect(processExists(processGroupId!)).toBe(true);
    expect(processExists(childPid)).toBe(true);

    await peer.close();

    await waitFor(async () => (
      !processExists(processGroupId!) && !processExists(childPid) ? true : null
    ));
    expect(processExists(processGroupId!)).toBe(false);
    expect(processExists(childPid)).toBe(false);
  });
});
