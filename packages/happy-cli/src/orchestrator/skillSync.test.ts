import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ORCHESTRATOR_COMMAND_CLAUDE,
  ORCHESTRATOR_COMMAND_CODEX,
  ORCHESTRATOR_COMMAND_GEMINI,
  ORCHESTRATOR_COMMAND_QODER,
  ORCHESTRATOR_SKILL_MD,
  buildOrchestratorCommandPrompt,
} from './skillAssets';

// Redirect homedir() to a per-test temp dir so the sync never touches the real ~/.claude / ~/.codex.
const hoisted = vi.hoisted(() => ({ home: '' }));
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, homedir: () => hoisted.home };
});

// Env keys that influence the sync — cleared per test for determinism, restored afterward.
const ENV_KEYS = ['CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'QODER_CONFIG_DIR', 'QODERCN_CONFIG_DIR', 'HAPPY_ORCH_ONESHOT', 'HAPPY_ORCH_EXECUTION_ID'] as const;

describe('syncOrchestratorAssets', () => {
  let home: string;
  let savedEnv: Record<string, string | undefined>;

  const claudeSkill = () => join(home, '.claude', 'skills', 'orchestrator', 'SKILL.md');
  const claudeCmd = (provider: string) => join(home, '.claude', 'commands', 'orchestrator', `${provider}.md`);
  const codexSkill = () => join(home, '.codex', 'skills', 'orchestrator', 'SKILL.md');
  const qoderSkill = (dir = '.qoder') => join(home, dir, 'skills', 'orchestrator', 'SKILL.md');
  const qoderCmd = (provider: string, dir = '.qoder') => join(home, dir, 'commands', 'orchestrator', `${provider}.md`);

  // Fresh module each run so the once-per-process guard (didSync) is reset.
  async function runSync(): Promise<void> {
    vi.resetModules();
    const mod = await import('./skillSync');
    mod.syncOrchestratorAssets();
  }

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'orch-sync-'));
    hoisted.home = home;
    savedEnv = {};
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    rmSync(home, { recursive: true, force: true });
  });

  it('writes nothing and creates no config dir when neither ~/.claude nor ~/.codex exists', async () => {
    await runSync();
    expect(existsSync(join(home, '.claude'))).toBe(false);
    expect(existsSync(join(home, '.codex'))).toBe(false);
    expect(existsSync(join(home, '.qoder'))).toBe(false);
    expect(existsSync(join(home, '.qoder-cn'))).toBe(false);
  });

  it('populates ~/.claude and never creates ~/.codex when only ~/.claude exists', async () => {
    mkdirSync(join(home, '.claude'), { recursive: true });
    await runSync();
    expect(readFileSync(claudeSkill(), 'utf8')).toBe(ORCHESTRATOR_SKILL_MD);
    expect(readFileSync(claudeCmd('claude'), 'utf8')).toBe(ORCHESTRATOR_COMMAND_CLAUDE);
    expect(readFileSync(claudeCmd('codex'), 'utf8')).toBe(ORCHESTRATOR_COMMAND_CODEX);
    expect(readFileSync(claudeCmd('gemini'), 'utf8')).toBe(ORCHESTRATOR_COMMAND_GEMINI);
    expect(readFileSync(claudeCmd('qoder'), 'utf8')).toBe(ORCHESTRATOR_COMMAND_QODER);
    expect(existsSync(join(home, '.codex'))).toBe(false);
  });

  it('populates ~/.codex and never creates ~/.claude when only ~/.codex exists', async () => {
    mkdirSync(join(home, '.codex'), { recursive: true });
    await runSync();
    expect(readFileSync(codexSkill(), 'utf8')).toBe(ORCHESTRATOR_SKILL_MD);
    expect(existsSync(join(home, '.claude'))).toBe(false);
  });

  it('populates both when both config dirs exist', async () => {
    mkdirSync(join(home, '.claude'), { recursive: true });
    mkdirSync(join(home, '.codex'), { recursive: true });
    await runSync();
    expect(existsSync(claudeSkill())).toBe(true);
    expect(existsSync(codexSkill())).toBe(true);
  });

  it('populates ~/.qoder and ~/.qoder-cn only when they exist', async () => {
    mkdirSync(join(home, '.qoder'), { recursive: true });
    await runSync();
    expect(readFileSync(qoderSkill(), 'utf8')).toBe(ORCHESTRATOR_SKILL_MD);
    expect(readFileSync(qoderCmd('claude'), 'utf8')).toBe(ORCHESTRATOR_COMMAND_CLAUDE);
    expect(readFileSync(qoderCmd('codex'), 'utf8')).toBe(ORCHESTRATOR_COMMAND_CODEX);
    expect(readFileSync(qoderCmd('gemini'), 'utf8')).toBe(ORCHESTRATOR_COMMAND_GEMINI);
    expect(readFileSync(qoderCmd('qoder'), 'utf8')).toBe(ORCHESTRATOR_COMMAND_QODER);
    expect(existsSync(join(home, '.qoder-cn'))).toBe(false);

    mkdirSync(join(home, '.qoder-cn'), { recursive: true });
    await runSync();
    expect(readFileSync(qoderSkill('.qoder-cn'), 'utf8')).toBe(ORCHESTRATOR_SKILL_MD);
    expect(readFileSync(qoderCmd('qoder', '.qoder-cn'), 'utf8')).toBe(ORCHESTRATOR_COMMAND_QODER);
  });

  it('writes nothing for a worker (oneshot) session even when config dirs exist', async () => {
    mkdirSync(join(home, '.claude'), { recursive: true });
    mkdirSync(join(home, '.codex'), { recursive: true });
    process.env.HAPPY_ORCH_ONESHOT = '1';
    await runSync();
    expect(existsSync(claudeSkill())).toBe(false);
    expect(existsSync(codexSkill())).toBe(false);
  });

  it('honors QODER_CONFIG_DIR and QODERCN_CONFIG_DIR for the qoder targets', async () => {
    const customDir = join(home, 'custom-qoder');
    const customCnDir = join(home, 'custom-qoder-cn');
    mkdirSync(customDir, { recursive: true });
    mkdirSync(customCnDir, { recursive: true });
    process.env.QODER_CONFIG_DIR = customDir;
    process.env.QODERCN_CONFIG_DIR = customCnDir;
    await runSync();
    expect(existsSync(join(customDir, 'skills', 'orchestrator', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(customCnDir, 'skills', 'orchestrator', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(home, '.qoder'))).toBe(false);
  });

  it('honors CODEX_HOME for the codex target', async () => {
    const customDir = join(home, 'custom-codex');
    mkdirSync(customDir, { recursive: true });
    process.env.CODEX_HOME = customDir;
    await runSync();
    expect(existsSync(join(customDir, 'skills', 'orchestrator', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(home, '.codex'))).toBe(false);
  });

  it('honors CLAUDE_CONFIG_DIR for the claude target', async () => {
    const customDir = join(home, 'custom-claude');
    mkdirSync(customDir, { recursive: true });
    process.env.CLAUDE_CONFIG_DIR = customDir;
    await runSync();
    expect(existsSync(join(customDir, 'skills', 'orchestrator', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(home, '.claude'))).toBe(false);
  });
});

describe('orchestrator skill frontmatter', () => {
  // Keep the bundled public description stable and single-line for compatibility with every client
  // that consumes the generated skill, including clients with minimal frontmatter parsers.
  const frontmatter = ORCHESTRATOR_SKILL_MD.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
  const descriptionLine = frontmatter.split('\n').find((line) => line.startsWith('description:'));

  it('keeps the public skill name and inline description stable', () => {
    expect(frontmatter).toContain('name: orchestrator');
    expect(descriptionLine).toBe(
      "description: Act as the commander and delegate work to one or more AI agents (claude/codex/gemini/qoder) that run in parallel or in dependency order via Happy's orchestrator. Use when the user wants to run several tasks at once, fan work out to multiple AIs, compare providers, build a dependency pipeline, or when invoking /orchestrator:claude|codex|gemini|qoder.",
    );
    expect(descriptionLine).not.toMatch(/^description:\s*[>|]/);
  });

  it('keeps the public skill available for implicit invocation', () => {
    expect(frontmatter).not.toContain('disable-model-invocation: true');
    expect(ORCHESTRATOR_SKILL_MD).toContain('If this skill is selected implicitly');
    expect(ORCHESTRATOR_SKILL_MD).toContain('do not carry the mode into unrelated topics');
    expect(ORCHESTRATOR_SKILL_MD).toContain('until the user explicitly exits');
  });
});

describe('orchestrator provider command behavior', () => {
  const commands = [
    ['claude', ORCHESTRATOR_COMMAND_CLAUDE],
    ['codex', ORCHESTRATOR_COMMAND_CODEX],
    ['gemini', ORCHESTRATOR_COMMAND_GEMINI],
    ['qoder', ORCHESTRATOR_COMMAND_QODER],
  ] as const;

  it.each(commands)('marks the %s provider command as user-invocable only', (_provider, command) => {
    const frontmatter = command.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
    expect(frontmatter).toContain('disable-model-invocation: true');
  });

  it.each(commands)('includes the explicit lifecycle and critical constraints for %s', (provider, command) => {
    expect(command).toContain(`with **${provider}** as the primary provider`);
    expect(command).toContain('explicitly entered Orchestrator mode');
    expect(command).toContain('Use only the `orchestrator_*` tools');
    expect(command).toContain('call `orchestrator_get_context`');
    expect(command).toContain('Parallel tasks that write must not have overlapping file ownership');
    expect(command).toContain('Use `orchestrator_send_message` when a completed or failed task');
    expect(command).toContain('Pass its `taskId`, not its `taskKey`');
    expect(command).toContain('Wait for the next');
    expect(command).toContain('`<orchestrator-callback>`');
    expect(command).not.toContain('If this skill is selected implicitly');
  });

  it('generates equivalent command behavior apart from the selected provider', () => {
    const normalized = commands.map(([provider]) =>
      buildOrchestratorCommandPrompt(provider).replaceAll(provider, '<provider>'),
    );
    expect(new Set(normalized).size).toBe(1);
  });
});
