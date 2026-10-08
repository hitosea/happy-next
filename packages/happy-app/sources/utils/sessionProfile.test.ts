import { describe, expect, it } from 'vitest';
import { getBuiltInProfile } from '@/sync/profileUtils';
import { getSessionProfileEnvironment, shouldInheritMachineConfig } from './sessionProfile';

describe('new session profile compatibility without changing the UI', () => {
    it.each(['codex', 'gemini'] as const)('ignores a restored DeepSeek selection when the agent is %s', agent => {
        const env = getSessionProfileEnvironment(getBuiltInProfile('deepseek')!, agent);
        expect(env).toEqual({});
        expect(shouldInheritMachineConfig(env)).toBe(true);
    });

    it('preserves the DeepSeek configuration for Claude', () => {
        const env = getSessionProfileEnvironment(getBuiltInProfile('deepseek')!, 'claude');
        expect(env).toMatchObject({ ANTHROPIC_AUTH_TOKEN: '${DEEPSEEK_AUTH_TOKEN}' });
        expect(shouldInheritMachineConfig(env)).toBe(false);
    });

    it('preserves the existing fallback for the empty default Anthropic profile', () => {
        const env = getSessionProfileEnvironment(getBuiltInProfile('anthropic')!, 'claude');
        expect(env).toEqual({});
        expect(shouldInheritMachineConfig(env)).toBe(true);
    });

    it('inherits when there is no selected profile', () => {
        expect(shouldInheritMachineConfig()).toBe(true);
    });

    it('preserves user-defined variables in compatible profiles', () => {
        const profile = { ...getBuiltInProfile('openai')!, environmentVariables: [{ name: 'MY_TOOL_TOKEN', value: '${TOOL_TOKEN}' }] };
        expect(getSessionProfileEnvironment(profile, 'codex')).toMatchObject({ MY_TOOL_TOKEN: '${TOOL_TOKEN}' });
    });
});
