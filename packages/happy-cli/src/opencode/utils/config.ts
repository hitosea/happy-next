import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { logger } from '@/ui/logger';
import { OPENCODE_MODEL_ENV, DEFAULT_OPENCODE_MODEL } from '../constants';

export interface OpenCodeLocalConfig {
  token: string | null;
  model: string | null;
}

export function readOpenCodeLocalConfig(): OpenCodeLocalConfig {
  const result: OpenCodeLocalConfig = { token: null, model: null };

  // Try reading from ~/.opencode.json (opencode's config file)
  try {
    const configPath = join(homedir(), '.opencode.json');
    if (existsSync(configPath)) {
      const raw = JSON.parse(readFileSync(configPath, 'utf-8'));
      if (raw?.model) {
        result.model = raw.model;
        logger.debug(`[OpenCode] Found model in config: ${result.model}`);
      }
    }
  } catch (error) {
    logger.debug('[OpenCode] Failed to read ~/.opencode.json:', error);
  }

  // Also check XDG config
  try {
    const xdgConfig = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
    const configPath = join(xdgConfig, 'opencode', '.opencode.json');
    if (existsSync(configPath)) {
      const raw = JSON.parse(readFileSync(configPath, 'utf-8'));
      if (!result.model && raw?.model) {
        result.model = raw.model;
        logger.debug(`[OpenCode] Found model in XDG config: ${result.model}`);
      }
    }
  } catch (error) {
    logger.debug('[OpenCode] Failed to read XDG config:', error);
  }

  return result;
}

export function determineOpenCodeModel(
  explicitModel: string | null | undefined,
  localConfig: OpenCodeLocalConfig,
): string {
  if (explicitModel) return explicitModel;

  const envModel = process.env[OPENCODE_MODEL_ENV];
  if (envModel) return envModel;

  if (localConfig.model) return localConfig.model;

  return DEFAULT_OPENCODE_MODEL;
}

export function getInitialOpenCodeModel(): string {
  const localConfig = readOpenCodeLocalConfig();
  return determineOpenCodeModel(undefined, localConfig);
}

export function getOpenCodeModelSource(
  explicitModel: string | null | undefined,
  localConfig: OpenCodeLocalConfig,
): 'explicit' | 'env-var' | 'local-config' | 'default' {
  if (explicitModel) return 'explicit';
  if (process.env[OPENCODE_MODEL_ENV]) return 'env-var';
  if (localConfig.model) return 'local-config';
  return 'default';
}

export function saveOpenCodeModelToConfig(model: string): void {
  try {
    const configPath = join(homedir(), '.opencode.json');
    let config: Record<string, unknown> = {};
    if (existsSync(configPath)) {
      config = JSON.parse(readFileSync(configPath, 'utf-8'));
    }
    config.model = model;
    writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
    logger.debug(`[OpenCode] Saved model to config: ${model}`);
  } catch (error) {
    logger.debug('[OpenCode] Failed to save model to config:', error);
  }
}
