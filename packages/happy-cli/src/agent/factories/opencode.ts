import { execFileSync, execSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join, delimiter } from 'node:path';
import { AcpBackend, type AcpBackendOptions, type AcpPermissionHandler } from '../acp/AcpBackend';
import type { AgentBackend, McpServerConfig, AgentFactoryOptions } from '../core';
import { agentRegistry } from '../core';
import { openCodeTransport } from '../transport';
import { logger } from '@/ui/logger';
import {
  OPENCODE_API_KEY_ENV,
  OPENCODE_MODEL_ENV,
  DEFAULT_OPENCODE_MODEL,
} from '@/opencode/constants';
import {
  readOpenCodeLocalConfig,
  determineOpenCodeModel,
  getOpenCodeModelSource,
} from '@/opencode/utils/config';

export interface OpenCodeBackendOptions extends AgentFactoryOptions {
  apiKey?: string;
  model?: string | null;
  mcpServers?: Record<string, McpServerConfig>;
  permissionHandler?: AcpPermissionHandler;
  normalizeToolName?: (rawName: string) => string;
}

export interface OpenCodeBackendResult {
  backend: AgentBackend;
  model: string;
  modelSource: 'explicit' | 'env-var' | 'local-config' | 'default';
}

function resolveOpenCodeCommand(): string {
  const home = homedir();
  const extraPaths = [
    join(home, '.opencode', 'bin'),
    join(home, '.local', 'bin'),
    join(home, 'go', 'bin'),
    join(home, '.cargo', 'bin'),
    join(home, 'bin'),
    join(home, '.npm-global', 'bin'),
    '/usr/local/bin',
  ];
  const fullPath = [...extraPaths, process.env.PATH || '/usr/bin:/bin'].join(delimiter);

  try {
    const resolved = execSync('command -v opencode', {
      env: { ...process.env, PATH: fullPath },
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();
    logger.debug(`[OpenCode] Resolved binary: ${resolved}`);
    return resolved || 'opencode';
  } catch {
    logger.debug(`[OpenCode] Could not resolve opencode binary, using bare command`);
    return 'opencode';
  }
}

function probeOpenCodeArgs(command: string): string[] {
  try {
    const output = execFileSync(command, ['--help'], {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const combined = output || '';
    logger.debug(`[OpenCode] --help output:\n${combined.slice(0, 1000)}`);

    if (combined.includes('opencode acp')) {
      return ['acp'];
    }
    if (combined.includes('--acp')) {
      return ['--acp'];
    }
    logger.debug('[OpenCode] No ACP mode found in --help output, trying "acp" subcommand as fallback');
  } catch (err) {
    logger.debug(`[OpenCode] --help probe failed, trying "acp" subcommand as fallback:`, err);
  }

  try {
    execFileSync(command, ['acp', '--help'], {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return ['acp'];
  } catch {
    logger.debug('[OpenCode] "acp" subcommand not available — opencode may not support ACP protocol');
  }

  return ['acp'];
}

export function createOpenCodeBackend(options: OpenCodeBackendOptions): OpenCodeBackendResult {
  const localConfig = readOpenCodeLocalConfig();

  const apiKey = process.env[OPENCODE_API_KEY_ENV]
    || options.apiKey;

  if (!apiKey) {
    logger.debug(`[OpenCode] No API key found. OpenCode uses provider-specific keys configured in ~/.opencode.json`);
  }

  const model = determineOpenCodeModel(options.model, localConfig);

  const openCodeCommand = resolveOpenCodeCommand();
  const openCodeArgs = probeOpenCodeArgs(openCodeCommand);

  const backendOptions: AcpBackendOptions = {
    agentName: 'opencode',
    cwd: options.cwd,
    command: openCodeCommand,
    args: openCodeArgs,
    env: {
      ...options.env,
      ...(apiKey ? { [OPENCODE_API_KEY_ENV]: apiKey } : {}),
      [OPENCODE_MODEL_ENV]: model,
      NODE_ENV: 'production',
      DEBUG: '',
    },
    mcpServers: options.mcpServers,
    permissionHandler: options.permissionHandler,
    transportHandler: openCodeTransport,
    normalizeToolName: options.normalizeToolName,
    hasChangeTitleInstruction: (prompt: string) => {
      const lower = prompt.toLowerCase();
      return lower.includes('change_title') ||
             lower.includes('change title') ||
             lower.includes('set title') ||
             lower.includes('mcp__happy__change_title');
    },
  };

  const modelSource = getOpenCodeModelSource(options.model, localConfig);

  logger.debug('[OpenCode] Creating ACP backend with options:', {
    cwd: backendOptions.cwd,
    command: backendOptions.command,
    args: backendOptions.args,
    resolvedFrom: openCodeCommand,
    hasApiKey: !!apiKey,
    model,
    modelSource,
    mcpServerCount: options.mcpServers ? Object.keys(options.mcpServers).length : 0,
  });

  return {
    backend: new AcpBackend(backendOptions),
    model,
    modelSource,
  };
}

export function registerOpenCodeAgent(): void {
  agentRegistry.register('opencode', (opts) => createOpenCodeBackend(opts).backend);
  logger.debug('[OpenCode] Registered with agent registry');
}
