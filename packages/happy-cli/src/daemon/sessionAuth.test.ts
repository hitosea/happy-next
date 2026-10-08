import { describe, expect, it } from 'vitest';
import { expandEnvironmentVariables } from '@/utils/expandEnvVars';
import { getUnexpandedSessionAuthVariables } from './sessionAuth';

describe('agent authentication validation after profile expansion', () => {
  const deepseekProfile = { ANTHROPIC_AUTH_TOKEN: '${DEEPSEEK_AUTH_TOKEN}', CUSTOM_VAR: '${CUSTOM_VALUE}' };

  it('allows Codex local login even if an old client sends unresolved Claude credentials', () => {
    const environment = expandEnvironmentVariables(deepseekProfile, {});
    expect(getUnexpandedSessionAuthVariables(environment, 'codex')).toEqual([]);
  });

  it('reports the unresolved credential when starting Claude with DeepSeek', () => {
    const environment = expandEnvironmentVariables(deepseekProfile, {});
    expect(getUnexpandedSessionAuthVariables(environment, 'claude')).toEqual(['ANTHROPIC_AUTH_TOKEN']);
  });

  it('allows Claude when the daemon can resolve the DeepSeek token', () => {
    const environment = expandEnvironmentVariables(deepseekProfile, { DEEPSEEK_AUTH_TOKEN: 'test-token' });
    expect(getUnexpandedSessionAuthVariables(environment, 'claude')).toEqual([]);
  });

  it.each(['claude', 'codex', 'gemini'] as const)('does not require an API key for %s local login', agent => {
    expect(getUnexpandedSessionAuthVariables({}, agent)).toEqual([]);
  });

  it('checks Codex credentials and ignores unrelated Gemini credentials', () => {
    expect(getUnexpandedSessionAuthVariables({ OPENAI_API_KEY: '${OPENAI_TOKEN}', GEMINI_API_KEY: '${GOOGLE_TOKEN}' }, 'codex'))
      .toEqual(['OPENAI_API_KEY']);
  });

  it('defers Gemini validation until its backend selects the actual credentials', () => {
    expect(getUnexpandedSessionAuthVariables({ GEMINI_API_KEY: '${GOOGLE_TOKEN}', ...deepseekProfile }, 'gemini'))
      .toEqual([]);
  });
});
