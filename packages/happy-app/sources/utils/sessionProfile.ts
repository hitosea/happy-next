import { getProfileEnvironmentVariables, validateProfileForAgent, type AIBackendProfile } from '@/sync/settings';

export function getSessionProfileEnvironment(profile: AIBackendProfile, agent: 'claude' | 'codex' | 'gemini'): Record<string, string> {
    // Agent selection can retain a profile belonging to another backend.
    // Do not pass that profile's credentials to the selected agent.
    if (!validateProfileForAgent(profile, agent)) return {};
    return getProfileEnvironmentVariables(profile);
}

export function shouldInheritMachineConfig(environmentVariables?: Record<string, string>): boolean {
    return !environmentVariables || Object.keys(environmentVariables).length === 0;
}
