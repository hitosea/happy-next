import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ readSettings: vi.fn() }));
vi.mock('@/persistence', async importOriginal => ({
  ...await importOriginal<typeof import('@/persistence')>(),
  readSettings: mocks.readSettings,
}));
vi.mock('@/ui/logger', () => ({ logger: { debug: vi.fn() } }));
import { getProfileEnvironmentVariablesForAgent, resolveSessionProfileEnvironment } from './sessionProfiles';

describe('machine-local profile fallback', () => {
  beforeEach(() => {
    mocks.readSettings.mockResolvedValue({ activeProfileId: 'deepseek', profiles: [{
      id: 'deepseek', name: 'DeepSeek',
      compatibility: { claude: true, codex: false, gemini: false },
      environmentVariables: [{ name: 'ANTHROPIC_AUTH_TOKEN', value: '${DEEPSEEK_AUTH_TOKEN}' }],
    }] });
  });

  it.each(['codex', 'gemini'] as const)('does not inherit a Claude-only local profile for %s', async agent => {
    expect(await getProfileEnvironmentVariablesForAgent('deepseek', agent)).toEqual({});
  });

  it('inherits the local profile for its compatible agent', async () => {
    expect(await getProfileEnvironmentVariablesForAgent('deepseek', 'claude'))
      .toEqual({ ANTHROPIC_AUTH_TOKEN: '${DEEPSEEK_AUTH_TOKEN}' });
  });

  it('allows the machine environment when the local profile no longer exists', async () => {
    expect(await getProfileEnvironmentVariablesForAgent('deleted', 'codex')).toEqual({});
  });
});


describe('session profile inheritance with additional environment variables', () => {
  const githubEnv = { GITHUB_PERSONAL_ACCESS_TOKEN: 'github-token' };

  beforeEach(() => {
    mocks.readSettings.mockReset();
    mocks.readSettings.mockResolvedValue({ activeProfileId: 'local', profiles: [{
      id: 'local', name: 'Local',
      compatibility: { claude: true, codex: false, gemini: false },
      environmentVariables: [
        { name: 'ANTHROPIC_BASE_URL', value: 'https://local.example' },
        { name: 'ANTHROPIC_AUTH_TOKEN', value: '${LOCAL_API_KEY}' },
        { name: 'GITHUB_PERSONAL_ACCESS_TOKEN', value: 'local-github-token' },
      ],
    }] });
  });

  it('inherits the local API configuration and merges the GitHub token', async () => {
    expect(await resolveSessionProfileEnvironment({
      agent: 'claude', inheritMachineConfig: true, environmentVariables: githubEnv,
    })).toEqual({
      ANTHROPIC_BASE_URL: 'https://local.example',
      ANTHROPIC_AUTH_TOKEN: '${LOCAL_API_KEY}',
      ...githubEnv,
    });
  });

  it.each(['codex', 'gemini'] as const)('keeps additional variables without an incompatible local profile for %s', async agent => {
    expect(await resolveSessionProfileEnvironment({
      agent, inheritMachineConfig: true, environmentVariables: githubEnv,
    })).toEqual(githubEnv);
  });

  it.each([undefined, {}])('does not load the local profile when inheritance is explicitly disabled (%s)', async environmentVariables => {
    expect(await resolveSessionProfileEnvironment({ inheritMachineConfig: false, environmentVariables })).toEqual({});
    expect(mocks.readSettings).not.toHaveBeenCalled();
  });

  it('preserves legacy GUI profile behavior when the flag is omitted', async () => {
    expect(await resolveSessionProfileEnvironment({ environmentVariables: githubEnv })).toEqual(githubEnv);
    expect(mocks.readSettings).not.toHaveBeenCalled();
  });

  it('preserves legacy local fallback when no variables or flag are provided', async () => {
    expect(await resolveSessionProfileEnvironment({})).toMatchObject({
      ANTHROPIC_BASE_URL: 'https://local.example',
      ANTHROPIC_AUTH_TOKEN: '${LOCAL_API_KEY}',
    });
  });

  it('keeps additional variables when no local profile is active', async () => {
    mocks.readSettings.mockResolvedValue({ profiles: [] });
    expect(await resolveSessionProfileEnvironment({ inheritMachineConfig: true, environmentVariables: githubEnv })).toEqual(githubEnv);
  });

  it('keeps additional variables if local settings cannot be read', async () => {
    mocks.readSettings.mockRejectedValue(new Error('unavailable'));
    expect(await resolveSessionProfileEnvironment({ inheritMachineConfig: true, environmentVariables: githubEnv })).toEqual(githubEnv);
  });
});
