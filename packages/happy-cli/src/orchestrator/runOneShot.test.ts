import { describe, expect, it, vi } from 'vitest';
import { CODEX_PACKAGE } from '@/codex/package';
import { resolveCodexRuntime } from '@/codex/codexRuntime';

vi.mock('@/claude/claudeLocal', () => ({
  claudeCliPath: '/mock/claude.js',
}));
vi.mock('@/ui/logger', () => ({
  logger: {
    debug: vi.fn(),
  },
}));

const { buildSpawnPlan } = await import('./runOneShot');
const { resolveQoderCommand } = await import('@/agent/factories/qoder');

/** Whatever this machine resolves for the pinned Codex: a matching local binary or npx. */
const codexCommand = resolveCodexRuntime(CODEX_PACKAGE, []).command;

describe('runOneShot spawn plan', () => {
  it('passes claude model and initial session-id arguments', () => {
    const plan = buildSpawnPlan('claude', 'hello', '/tmp/workdir', 'claude-sonnet-4-6', 'initial', 'session-uuid');
    expect(plan.command).toBe(process.execPath);
    expect(plan.args).toContain('--model');
    expect(plan.args).toContain('claude-sonnet-4-6');
    expect(plan.args).toEqual(expect.arrayContaining(['--session-id', 'session-uuid']));
    expect(plan.args).toContain('--dangerously-skip-permissions');
  });

  it('uses claude resume command for resume execution', () => {
    const plan = buildSpawnPlan('claude', 'continue', '/tmp/workdir', undefined, 'resume', 'session-uuid');
    expect(plan.command).toBe(process.execPath);
    expect(plan.args).toEqual(['/mock/claude.js', '--dangerously-skip-permissions', '--resume', 'session-uuid', '-p', 'continue']);
  });

  it('decomposes codex model mode into --model and -c model_reasoning_effort', () => {
    const plan = buildSpawnPlan('codex', 'hello', '/tmp/workdir', 'gpt-5.5-high', 'initial');
    expect(plan.command).toBe(codexCommand);
    expect(plan.args).toContain('--dangerously-bypass-approvals-and-sandbox');
    expect(plan.args).toContain('hello');
    expect(plan.args).toContain('--model');
    expect(plan.args).toContain('gpt-5.5');
    expect(plan.args).toContain('-c');
    expect(plan.args).toContain('model_reasoning_effort=high');
  });

  it('uses codex resume command for resume execution', () => {
    const plan = buildSpawnPlan('codex', 'continue', '/tmp/workdir', undefined, 'resume', 'session-uuid');
    expect(plan.command).toBe(codexCommand);
    expect(plan.args).toContain('--dangerously-bypass-approvals-and-sandbox');
    expect(plan.args).toContain('resume');
    expect(plan.args).toContain('session-uuid');
    expect(plan.args).toContain('continue');
  });

  it('passes gemini model as --model argument and outputs json for initial session capture', () => {
    const plan = buildSpawnPlan('gemini', 'hello', '/tmp/workdir', 'gemini-2.5-pro', 'initial');
    expect(plan.command).toBe('gemini');
    expect(plan.args).toContain('--yolo');
    expect(plan.args).toContain('-p');
    expect(plan.args).toContain('hello');
    expect(plan.args).toContain('--output-format');
    expect(plan.args).toContain('json');
    expect(plan.args).toContain('--model');
    expect(plan.args).toContain('gemini-2.5-pro');
  });

  it('maps the prefixed qoder mode to a bare --model tier and isolates the SDK env', () => {
    const plan = buildSpawnPlan('qoder', 'hello', '/tmp/workdir', 'qoder-qmodel_38max', 'initial');
    // Must be whatever resolveQoderCommand() picks for this host ('qoder' or 'qodercn');
    // asserting a literal here would make the test depend on which edition is installed.
    expect(plan.command).toBe(resolveQoderCommand());
    expect(['qoder', 'qodercn']).toContain(plan.command);
    expect(plan.args).toContain('--yolo');
    expect(plan.args).toContain('-p');
    expect(plan.args).toContain('--output-format');
    expect(plan.args).toContain('json');
    // 'qoder-qmodel_38max' is the wire id; the CLI only understands 'qmodel_38max'.
    const modelIndex = plan.args.indexOf('--model');
    expect(modelIndex).toBeGreaterThan(-1);
    expect(plan.args[modelIndex + 1]).toBe('qmodel_38max');
    // An inherited QODER_AGENT_SDK_ENTRYPOINT makes `qoder` refuse to run headless too.
    expect((plan.env as Record<string, string>).QODER_AGENT_SDK_ENTRYPOINT).toBe('');
  });

  it('uses qoder resume command for resume execution', () => {
    const plan = buildSpawnPlan('qoder', 'continue', '/tmp/workdir', undefined, 'resume', 'session-uuid');
    expect(plan.command).toBe(resolveQoderCommand());
    expect(plan.args).toContain('--resume');
    expect(plan.args).toContain('session-uuid');
    expect(plan.args).toContain('-p');
    expect(plan.args).toContain('continue');
    expect(plan.args).not.toContain('--model');
  });

  it('uses gemini resume command for resume execution', () => {
    const plan = buildSpawnPlan('gemini', 'continue', '/tmp/workdir', undefined, 'resume', 'session-uuid');
    expect(plan.command).toBe('gemini');
    expect(plan.args).toContain('--yolo');
    expect(plan.args).toContain('--resume');
    expect(plan.args).toContain('session-uuid');
    expect(plan.args).toContain('-p');
    expect(plan.args).toContain('continue');
  });
});
