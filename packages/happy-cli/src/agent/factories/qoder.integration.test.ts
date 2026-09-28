/**
 * Spawns the real, signed-in Qoder CLI through the production code path
 * (createQoderBackend -> AcpBackend -> QoderTransport) and drives an actual turn.
 *
 * Why this exists rather than a unit test: everything it covers was previously a guess —
 * that the inherited Agent SDK env scrub lets `--acp` start at all, that a prompt turn
 * streams text back, that Qoder's native `session/load` really replays history. A probe
 * script proved the CLI's side; this proves Happy's side of the same wire.
 *
 * Self-skipping when Qoder is absent or signed out, so it can never fail a CI run that
 * has no Qoder account. Set HAPPY_QODER_PATH to pin an edition ('qodercn' for the CN one).
 *
 * Run: npx vitest run --config vitest.integration.config.ts src/agent/factories/qoder.integration.test.ts
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { createQoderBackend, resolveQoderCommand } from './qoder';
import { qoderSdkIsolationEnv } from '@/qoder/constants';
import { forkQoderNativeSession, listQoderNativeSessions } from '@/qoder/utils/nativeSessions';

const command = resolveQoderCommand();
const installed = spawnSync(command, ['--version'], {
  encoding: 'utf-8',
  timeout: 20_000,
  env: { ...process.env, ...qoderSdkIsolationEnv() },
}).status === 0;

/** Signed in? `--list-models` prints a table when authenticated and an error when not. */
function isSignedIn(): boolean {
  const run = spawnSync(command, ['--list-models'], {
    encoding: 'utf-8',
    timeout: 60_000,
    env: { ...process.env, ...qoderSdkIsolationEnv() },
  });
  const out = `${run.stdout ?? ''}${run.stderr ?? ''}`;
  return !/not logged in|authentication required/i.test(out);
}

// Probed once: each call spawns the CLI, and a signed-out machine would pay a
// blocking `--list-models` timeout twice before the first test even runs.
const signedIn = installed && isSignedIn();
const maybe = signedIn ? describe : describe.skip;

if (!installed) {
  console.warn(`[qoder.integration] skipped: \`${command}\` is not installed`);
} else if (!signedIn) {
  console.warn(`[qoder.integration] skipped: \`${command}\` is not signed in`);
}

function workspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'happy-qoder-e2e-'));
  writeFileSync(join(dir, 'marker.txt'), 'happy-e2e-marker\n');
  return dir;
}

maybe(`qoder acp backend against a signed-in ${command}`, () => {
  it('streams a real prompt turn through the happy ACP path', async () => {
    const cwd = workspace();
    const { backend, resolution } = createQoderBackend({ cwd });
    expect(resolution.args).toEqual(['--acp']);

    const text: string[] = [];
    const tools: string[] = [];
    backend.onMessage(msg => {
      if (msg.type === 'model-output' && (msg.textDelta || msg.fullText)) {
        text.push(msg.textDelta ?? msg.fullText ?? '');
      }
      if (msg.type === 'tool-call') tools.push(msg.toolName);
    });

    const started = await backend.startSession();
    expect(started.sessionId).toBeTruthy();
    const sessionId = backend.getSessionId?.();
    // The engine's own id is what Happy persists for native resume; it is not the uuid
    // startSession() returns for Happy's side.
    expect(typeof sessionId).toBe('string');
    expect(sessionId).toHaveLength(36);

    const turn = backend.sendPrompt(sessionId!, 'Reply with exactly the single word: PONG. Do not use any tools.');
    await backend.waitForResponseComplete?.(180_000);
    await turn;

    const joined = text.join('');
    expect(joined).toContain('PONG');
    expect(tools).toEqual([]);

    await backend.dispose();
  }, 240_000);

  it('resumes through Qoder-native session/load and the history is still there', async () => {
    const cwd = workspace();

    const first = createQoderBackend({ cwd });
    await first.backend.startSession();
    const nativeId = first.backend.getSessionId?.();
    expect(typeof nativeId).toBe('string');
    await first.backend.sendPrompt(nativeId!, 'Remember the passphrase CRANBERRY-42. Reply OK. Do not use tools.');
    await first.backend.waitForResponseComplete?.(180_000);
    await first.backend.dispose();

    // Second process, fresh ACP session, resuming by the engine's own id. If this really
    // replays history, the model can repeat the passphrase without being told it.
    const seen: string[] = [];
    const second = createQoderBackend({ cwd, resumeSessionId: nativeId });
    second.backend.onMessage(msg => {
      if (msg.type === 'model-output') seen.push(msg.textDelta ?? msg.fullText ?? '');
    });
    await second.backend.startSession();
    expect(second.backend.getSessionId?.()).toBe(nativeId);

    await second.backend.sendPrompt(nativeId!, 'What passphrase did I ask you to remember earlier in this conversation? Answer with just that word.');
    await second.backend.waitForResponseComplete?.(180_000);
    const answer = seen.join('');
    await second.backend.dispose();

    expect(answer.toUpperCase()).toContain('CRANBERRY');
  }, 300_000);

  it('cancels a running turn and keeps the session usable', async () => {
    const cwd = workspace();
    const { backend } = createQoderBackend({ cwd });
    await backend.startSession();
    const sessionId = backend.getSessionId?.()!;

    const statuses: string[] = [];
    backend.onMessage(msg => { if (msg.type === 'status') statuses.push(msg.status); });

    // Cancel only means something while a turn is in flight, so start a long one and
    // interrupt it partway through.
    const longTurn = backend.sendPrompt(sessionId, 'Count aloud from 1 to 300, one number per line. Do not use tools.');
    await new Promise(r => setTimeout(r, 6000));
    const acked = await backend.cancel(sessionId);
    expect(acked).toBe(true);
    // cancel() resolves the waiter, so the in-flight turn must settle rather than hang.
    await longTurn.catch(() => { /* a cancelled turn may reject; that is fine */ });

    const text: string[] = [];
    backend.onMessage(msg => { if (msg.type === 'model-output') text.push(msg.textDelta ?? msg.fullText ?? ''); });
    const nextTurn = backend.sendPrompt(sessionId, 'Reply with exactly: STILL_HERE');
    await backend.waitForResponseComplete?.(180_000);
    await nextTurn;

    expect(text.join('')).toContain('STILL_HERE');
    expect(statuses).not.toContain('error');
    await backend.dispose();
  }, 300_000);
});

maybe(`qoder native session listing against a signed-in ${command}`, () => {
  it('lists and forks the session created by a real turn', async () => {
    const cwd = workspace();

    const { backend } = createQoderBackend({ cwd });
    await backend.startSession();
    const nativeId = backend.getSessionId?.()!;
    await backend.sendPrompt(nativeId, 'Say hi in three words. Do not use tools.');
    await backend.waitForResponseComplete?.(180_000);
    await backend.dispose();

    const listed = await listQoderNativeSessions({ cwd });
    expect(listed.map(entry => entry.sessionId)).toContain(nativeId);

    const mine = listed.find(entry => entry.sessionId === nativeId)!;
    // Row shape the mobile history list depends on.
    expect(typeof mine.title).not.toBe('undefined');
    expect(mine.updatedAt === null || mine.updatedAt! > 0).toBe(true);
    // Measured: Qoder echoes back the process cwd verbatim rather than a normalised
    // path, so `requestedCwd` is what has to be trusted for matching a session dir.
    expect(mine.requestedCwd).toBe(cwd);

    const forked = await forkQoderNativeSession({ cwd, sessionId: nativeId });
    expect(forked).not.toBe(nativeId);
    const afterFork = await listQoderNativeSessions({ cwd });
    expect(afterFork.map(entry => entry.sessionId)).toContain(forked);
  }, 300_000);
});
