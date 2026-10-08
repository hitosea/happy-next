import { readSettings, validateProfileForAgent, getProfileEnvironmentVariables } from '@/persistence';
import { logger } from '@/ui/logger';

// Get environment variables for a profile, filtered for agent compatibility
export async function getProfileEnvironmentVariablesForAgent(
  profileId: string,
  agentType: 'claude' | 'codex' | 'gemini'
): Promise<Record<string, string>> {
  try {
    const settings = await readSettings();
    const profile = settings.profiles.find(p => p.id === profileId);

    if (!profile) {
      logger.debug(`[DAEMON RUN] Profile ${profileId} not found`);
      return {};
    }

    // Check if profile is compatible with the agent
    if (!validateProfileForAgent(profile, agentType)) {
      logger.debug(`[DAEMON RUN] Profile ${profileId} not compatible with agent ${agentType}`);
      return {};
    }

    // Get environment variables from profile (new schema)
    const envVars = getProfileEnvironmentVariables(profile);

    logger.debug(`[DAEMON RUN] Loaded ${Object.keys(envVars).length} environment variables from profile ${profileId} for agent ${agentType}`);
    return envVars;
  } catch (error) {
    logger.debug('[DAEMON RUN] Failed to get profile environment variables:', error);
    return {};
  }
}

/** Resolve explicit inheritance while preserving fallback behavior for older clients. */
export async function resolveSessionProfileEnvironment(options: {
  agent?: 'claude' | 'codex' | 'gemini';
  inheritMachineConfig?: boolean;
  environmentVariables?: Record<string, string>;
}): Promise<Record<string, string>> {
  const additionalEnv = options.environmentVariables ?? {};
  const shouldInherit = options.inheritMachineConfig
    ?? (Object.keys(additionalEnv).length === 0);
  let localEnv: Record<string, string> = {};

  if (shouldInherit) {
    try {
      const settings = await readSettings();
      if (settings.activeProfileId) {
        localEnv = await getProfileEnvironmentVariablesForAgent(
          settings.activeProfileId, options.agent ?? 'claude'
        );
      }
    } catch (error) {
      logger.debug('[DAEMON RUN] Failed to load CLI local profile environment variables:', error);
    }
  }

  return { ...localEnv, ...additionalEnv };
}
