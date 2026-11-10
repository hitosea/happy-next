/**
 * Queued messages steered into Qoder's running turn ("插话").
 *
 * A steered message goes to qodercli as one more `session/prompt` while the turn runs. qodercli
 * either merges it into the turn once the tool call in flight returns, and that request never
 * returns, or runs it as a turn of its own straight after, and that request returns when that turn
 * ends. ACP says neither, so which and when come from its transcript: a merged message is written
 * there as a `queued_command` attachment, one run on its own as a user message. Without the
 * transcript, a message counts as read once its request returns, or once nothing happened for a
 * while after the turn.
 */

import { open, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { findClaudeProjectId } from '@/claude/utils/claudeSessionIndex';
import { qoderTranscriptStore } from '@/qoder/transcripts';
import { logger } from '@/ui/logger';

type Steer = {
  pendingId: string;
  text: string;
  /** `merged`: taken into the turn, its request never returns; `ownTurn`: running as a turn of its own */
  state: 'unread' | 'merged' | 'ownTurn' | 'done';
};

const POLL_MS = 250;
/** How long after the turn, with nothing happening, unread messages still wait to start */
export const QODER_STEER_START_TIMEOUT_MS = 30_000;

export class QoderSteering {
  private steers: Steer[] = [];
  private transcript: { path: string | null; offset: number; partial: string } | null = null;
  private timer: NodeJS.Timeout | null = null;
  private polling: Promise<void> | null = null;
  private lastProgress = Date.now();

  constructor(private readonly opts: {
    /** qodercli's session id, whose transcript tells when it takes a message */
    sessionId: () => string | null;
    report: (pendingId: string, outcome: 'read' | 'dropped') => void;
    /** Whether the turn was cancelled: a message whose request returns then never ran */
    cancelled: () => boolean;
  }) {}

  /** Sends a steered message through `send`, the `session/prompt` that carries it */
  async add(pendingId: string, text: string, send: () => Promise<void>): Promise<void> {
    const steer: Steer = { pendingId, text: text.trim(), state: 'unread' };
    this.steers.push(steer);
    // The transcript is read from where it stands before the message goes
    this.transcript ??= await this.openTranscript();
    this.timer ??= setInterval(() => void this.poll(), POLL_MS);
    send().then(
      () => this.finish(steer, !this.opts.cancelled()),
      (error) => {
        logger.debug('[Qoder] Steered prompt failed', error);
        this.finish(steer, false);
      },
    );
  }

  /**
   * Waits, once the turn's own request has returned, for the steered messages qodercli runs as
   * turns of their own, so the turn is reported over only after them.
   */
  async settle(): Promise<void> {
    this.lastProgress = Date.now();
    while (this.steers.some((steer) => steer.state === 'unread' || steer.state === 'ownTurn')) {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      const stalled = Date.now() - this.lastProgress > QODER_STEER_START_TIMEOUT_MS
        && !this.steers.some((steer) => steer.state === 'ownTurn');
      if (stalled) {
        // qodercli has them, but its transcript did not say what it did with them
        logger.debug('[Qoder] Steered messages never seen starting; counting them read');
        this.steers.filter((steer) => steer.state === 'unread').forEach((steer) => this.read(steer, 'done'));
      }
    }
    await this.polling;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.steers = [];
    this.transcript = null;
  }

  private read(steer: Steer, state: Steer['state']) {
    steer.state = state;
    this.lastProgress = Date.now();
    this.opts.report(steer.pendingId, 'read');
  }

  /** A steered message's request returned: it ran unless it failed or the turn was cancelled */
  private finish(steer: Steer, ran: boolean) {
    this.lastProgress = Date.now();
    if (steer.state === 'merged') return;
    if (steer.state === 'unread') this.opts.report(steer.pendingId, ran ? 'read' : 'dropped');
    steer.state = 'done';
  }

  private async openTranscript(): Promise<NonNullable<QoderSteering['transcript']>> {
    const sessionId = this.opts.sessionId();
    const store = qoderTranscriptStore();
    const projectId = sessionId ? await findClaudeProjectId(sessionId, store) : null;
    const path = projectId ? join(store.configDir, 'projects', projectId, `${sessionId}.jsonl`) : null;
    const offset = path ? await stat(path).then((stats) => stats.size, () => 0) : 0;
    logger.debug('[Qoder] Watching the transcript for steered messages', { path, offset });
    return { path, offset, partial: '' };
  }

  private poll(): Promise<void> {
    this.polling ??= this.readTranscript()
      .catch((error) => logger.debug('[Qoder] Cannot read the transcript', error))
      .finally(() => { this.polling = null; });
    return this.polling;
  }

  private async readTranscript() {
    const transcript = this.transcript;
    if (!transcript?.path) return;
    const file = await open(transcript.path, 'r');
    try {
      const { size } = await file.stat();
      if (size <= transcript.offset) return;
      const buffer = Buffer.alloc(size - transcript.offset);
      await file.read(buffer, 0, buffer.length, transcript.offset);
      transcript.offset = size;
      const lines = (transcript.partial + buffer.toString('utf8')).split('\n');
      transcript.partial = lines.pop() ?? '';
      for (const line of lines) {
        const entry = JSON.parse(line) as {
          type?: string;
          attachment?: { type?: string; prompt?: { type?: string; text?: string }[] };
          message?: { content?: string | { type?: string; text?: string }[] };
        };
        const merged = entry.type === 'attachment' && entry.attachment?.type === 'queued_command';
        const content = merged ? entry.attachment?.prompt : entry.type === 'user' ? entry.message?.content : undefined;
        const text = (typeof content === 'string' ? content : (content ?? []).filter((block) => block.type === 'text').map((block) => block.text).join('\n')).trim();
        const steer = text ? this.steers.find((candidate) => candidate.state === 'unread' && candidate.text === text) : undefined;
        if (steer) this.read(steer, merged ? 'merged' : 'ownTurn');
      }
    } finally {
      await file.close();
    }
  }
}
