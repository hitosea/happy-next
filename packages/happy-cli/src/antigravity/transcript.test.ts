import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { antigravityPreviewMessages, antigravityUsageAfter, readAntigravityTranscript } from './transcript';

const SESSION_ID = '91335d83-371e-4cb6-b491-4033ebc4cd32';

describe('Antigravity transcript', () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'agy-transcript-'));
    const dir = join(home, '.gemini', 'antigravity-cli', 'brain', SESSION_ID, '.system_generated', 'logs');
    mkdirSync(dir, { recursive: true });
    const steps = [
      { step_index: 0, type: 'USER_INPUT', created_at: '2026-11-25T00:31:14Z', content: '<USER_REQUEST>\nfirst\n\n<happy-session-instructions>x</happy-session-instructions>\n</USER_REQUEST>\n<ADDITIONAL_METADATA>y</ADDITIONAL_METADATA>' },
      { step_index: 1, type: 'PLANNER_RESPONSE', model: 'm', input_tokens: 13526, cache_read_tokens: 0, output_tokens: 149, tool_calls: [{}] },
      { step_index: 2, type: 'GENERIC', content: 'tool output' },
      { step_index: 3, type: 'PLANNER_RESPONSE', created_at: '2026-11-25T00:31:20Z', content: 'one', input_tokens: 2292, cache_read_tokens: 11469, output_tokens: 36 },
    ];
    writeFileSync(join(dir, 'transcript.jsonl'), [...steps.map((step) => JSON.stringify(step)), '{not json', ''].join('\n'));
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it('reads the steps and skips lines it cannot parse', async () => {
    expect((await readAntigravityTranscript(SESSION_ID, home)).map((step) => step.step_index)).toEqual([0, 1, 2, 3]);
    expect(await readAntigravityTranscript('missing', home)).toEqual([]);
  });

  it('previews what the user sent and the replies, without agy or Happy additions', async () => {
    const steps = await readAntigravityTranscript(SESSION_ID, home);
    expect(antigravityPreviewMessages(steps, 10)).toEqual([
      { role: 'user', content: 'first', timestamp: '2026-11-25T00:31:14Z' },
      { role: 'assistant', content: 'one', timestamp: '2026-11-25T00:31:20Z' },
    ]);
    expect(antigravityPreviewMessages(steps, 1)).toEqual([{ role: 'assistant', content: 'one', timestamp: '2026-11-25T00:31:20Z' }]);
  });

  it('sums the tokens of the steps after the last report', async () => {
    const steps = await readAntigravityTranscript(SESSION_ID, home);
    expect(antigravityUsageAfter(steps, -1)).toEqual({
      lastStep: 3,
      tokens: { total: 13526 + 149 + 2292 + 11469 + 36, input: 13526 + 2292, output: 149 + 36, cache_creation: 0, cache_read: 11469 },
    });
    expect(antigravityUsageAfter(steps, 1).tokens.total).toBe(2292 + 11469 + 36);
    expect(antigravityUsageAfter(steps, 3)).toEqual({ lastStep: 3, tokens: { total: 0, input: 0, output: 0, cache_creation: 0, cache_read: 0 } });
  });
});
