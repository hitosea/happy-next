import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { QODER_STEER_START_TIMEOUT_MS, QoderSteering } from './steering';

const SESSION_ID = 'qoder-session';

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('QoderSteering', () => {
  let configDir: string;
  let transcriptPath: string;
  let reports: Array<[string, string]>;
  let cancelled: boolean;
  let sessionId: string | null;
  let steering: QoderSteering;

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), 'qoder-steer-'));
    vi.stubEnv('QODER_CONFIG_DIR', configDir);
    mkdirSync(join(configDir, 'projects', '-work'), { recursive: true });
    transcriptPath = join(configDir, 'projects', '-work', `${SESSION_ID}.jsonl`);
    // What came before the steered message is not taken for it
    writeFileSync(transcriptPath, JSON.stringify({ type: 'user', message: { content: [{ type: 'text', text: 'also this' }] } }) + '\n');
    reports = [];
    cancelled = false;
    sessionId = SESSION_ID;
    steering = new QoderSteering({
      sessionId: () => sessionId,
      report: (pendingId, outcome) => reports.push([pendingId, outcome]),
      cancelled: () => cancelled,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    rmSync(configDir, { recursive: true, force: true });
  });

  const write = (entry: unknown) => appendFileSync(transcriptPath, JSON.stringify(entry) + '\n');

  it('reports a message merged into the turn read, without waiting for its request', async () => {
    const send = vi.fn(() => new Promise<void>(() => {}));
    await steering.add('p1', 'also this', send);
    expect(send).toHaveBeenCalled();
    write({ type: 'user', message: { content: [{ type: 'tool_result', content: 'done' }] } });
    write({ type: 'attachment', attachment: { type: 'queued_command', prompt: [{ type: 'text', text: 'also this' }] } });
    await sleep(400);
    expect(reports).toEqual([['p1', 'read']]);
    await steering.settle();
    expect(reports).toEqual([['p1', 'read']]);
  });

  it('reports a message run on its own read as it starts, and holds the turn until it ends', async () => {
    const request = deferred();
    await steering.add('p1', 'also this', () => request.promise);
    let settled = false;
    const settling = steering.settle().then(() => { settled = true; });
    write({ type: 'user', message: { content: 'also this' } });
    await sleep(400);
    expect(reports).toEqual([['p1', 'read']]);
    expect(settled).toBe(false);
    request.resolve();
    await settling;
    expect(reports).toEqual([['p1', 'read']]);
  });

  it('reports a message dropped when the turn is cancelled before Qoder took it', async () => {
    const request = deferred();
    await steering.add('p1', 'also this', () => request.promise);
    cancelled = true;
    request.resolve();
    await steering.settle();
    expect(reports).toEqual([['p1', 'dropped']]);
  });

  it('reports a message dropped when its request fails', async () => {
    const request = deferred();
    await steering.add('p1', 'also this', () => request.promise);
    request.reject(new Error('gone'));
    await steering.settle();
    expect(reports).toEqual([['p1', 'dropped']]);
  });

  it('without a transcript, reports a message read when its request returns', async () => {
    sessionId = null;
    const request = deferred();
    await steering.add('p1', 'also this', () => request.promise);
    const settling = steering.settle();
    await sleep(300);
    expect(reports).toEqual([]);
    request.resolve();
    await settling;
    expect(reports).toEqual([['p1', 'read']]);
  });

  it('counts a message read once nothing happened for a while after the turn', async () => {
    sessionId = null;
    await steering.add('p1', 'also this', () => new Promise<void>(() => {}));
    vi.useFakeTimers();
    const settling = steering.settle();
    await vi.advanceTimersByTimeAsync(QODER_STEER_START_TIMEOUT_MS + 1000);
    await settling;
    expect(reports).toEqual([['p1', 'read']]);
  });
});
