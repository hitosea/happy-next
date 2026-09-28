import { spawn } from 'node:child_process';
import { qoderModelModeToCliModel } from 'happy-wire';
import { qoderSdkIsolationEnv } from '@/qoder/constants';
import { resolveQoderCommand } from '@/agent/factories/qoder';
import { existsSync } from 'node:fs';
import { claudeCliPath } from '@/claude/claudeLocal';
import { CODEX_PACKAGE } from '@/codex/package';
import { resolveCodexRuntime } from '@/codex/codexRuntime';
import { logger } from '@/ui/logger';
import { MODEL_MODE_DEFAULT, isModelModeForAgent, parseCodexModelMode, parseClaudeModelMode } from 'happy-wire';
import {
  ORCHESTRATOR_ENV_KEYS,
  type OrchestratorProvider,
  decodePromptFromBase64,
  isOrchestratorProvider,
} from './common';

type SpawnPlan = {
  command: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
  cwd?: string;
};

function parseProvider(providerArg: string | undefined): OrchestratorProvider {
  if (!providerArg || !isOrchestratorProvider(providerArg)) {
    throw new Error(`Invalid --provider value: ${providerArg ?? '(missing)'}`);
  }
  return providerArg;
}

function readPromptFromEnv(): string {
  const promptB64 = process.env[ORCHESTRATOR_ENV_KEYS.promptB64];
  if (!promptB64) {
    throw new Error(`${ORCHESTRATOR_ENV_KEYS.promptB64} is required`);
  }
  return decodePromptFromBase64(promptB64);
}

function readWorkingDirectoryFromEnv(): string | undefined {
  const value = process.env[ORCHESTRATOR_ENV_KEYS.workingDirectory];
  if (typeof value !== 'string' || value.length === 0) {
    return undefined;
  }
  return value;
}

function readModelModeFromEnv(): string | undefined {
  const value = process.env[ORCHESTRATOR_ENV_KEYS.modelMode];
  if (typeof value !== 'string' || value.length === 0) {
    return undefined;
  }
  return value;
}

function readExecutionTypeFromEnv(): 'initial' | 'resume' {
  const value = process.env[ORCHESTRATOR_ENV_KEYS.executionType];
  if (value === 'resume') {
    return 'resume';
  }
  return 'initial';
}

function readChildSessionIdFromEnv(): string | undefined {
  const value = process.env[ORCHESTRATOR_ENV_KEYS.childSessionId];
  if (typeof value !== 'string' || value.length === 0) {
    return undefined;
  }
  return value;
}

export function buildSpawnPlan(
  provider: OrchestratorProvider,
  prompt: string,
  workingDirectory?: string,
  modelMode?: string,
  executionType: 'initial' | 'resume' = 'initial',
  childSessionId?: string,
): SpawnPlan {
  if (executionType === 'resume' && !childSessionId) {
    throw new Error('childSessionId is required for resume execution');
  }
  const normalizedModelMode = modelMode === MODEL_MODE_DEFAULT ? undefined : modelMode;
  switch (provider) {
    case 'claude': {
      const baseArgs = [claudeCliPath, '--dangerously-skip-permissions'];
      if (executionType === 'resume') {
        baseArgs.push('--resume', childSessionId!, '-p', prompt);
      } else {
        if (normalizedModelMode) {
          if (isModelModeForAgent('claude', normalizedModelMode)) {
            const parsed = parseClaudeModelMode(normalizedModelMode as any);
            if (parsed.family !== MODEL_MODE_DEFAULT) {
              baseArgs.push('--model', parsed.family);
              if (parsed.effort) {
                baseArgs.push('--effort', parsed.effort);
              }
            }
          } else {
            baseArgs.push('--model', normalizedModelMode);
          }
        }
        if (childSessionId) baseArgs.push('--session-id', childSessionId);
        baseArgs.push('-p', prompt);
      }
      return {
        command: process.execPath,
        args: baseArgs,
        cwd: workingDirectory,
        env: {
          ...process.env,
          DISABLE_AUTOUPDATER: '1',
        },
      };
    }
    case 'codex': {
      const codexArgs = ['exec', '--dangerously-bypass-approvals-and-sandbox'];
      if (executionType === 'resume') {
        codexArgs.push('resume', childSessionId!, prompt);
      } else {
        codexArgs.push(prompt);
        if (normalizedModelMode) {
          if (isModelModeForAgent('codex', normalizedModelMode)) {
            const parsed = parseCodexModelMode(normalizedModelMode);
            if (parsed.family !== MODEL_MODE_DEFAULT) {
              codexArgs.push('--model', parsed.family);
              if (parsed.effort) {
                codexArgs.push('-c', `model_reasoning_effort=${parsed.effort}`);
              }
            }
          } else {
            codexArgs.push('--model', normalizedModelMode);
          }
        }
      }
      const runtime = resolveCodexRuntime(CODEX_PACKAGE, codexArgs);
      return {
        command: runtime.command,
        args: runtime.args,
        cwd: workingDirectory,
        env: { ...process.env },
      };
    }
    case 'gemini': {
      const geminiArgs = ['--yolo'];
      if (executionType === 'resume') {
        geminiArgs.push('--resume', childSessionId!, '-p', prompt);
      } else {
        geminiArgs.push('-p', prompt, '--output-format', 'json');
        if (normalizedModelMode) {
          geminiArgs.push('--model', normalizedModelMode);
        }
      }
      return {
        command: 'gemini',
        args: geminiArgs,
        cwd: workingDirectory,
        env: { ...process.env },
      };
    }
    case 'qoder': {
      // Headless one-shot: `-p` prints a single response and exits, so this path does
      // not need ACP. `--output-format json` is what the daemon's output parser reads.
      const qoderArgs = ['--yolo'];
      if (executionType === 'resume') {
        qoderArgs.push('--resume', childSessionId!, '-p', prompt);
      } else {
        qoderArgs.push('-p', prompt, '--output-format', 'json');
        if (normalizedModelMode) {
          qoderArgs.push('--model', qoderModelModeToCliModel(normalizedModelMode) ?? normalizedModelMode);
        }
      }
      return {
        command: resolveQoderCommand(),
        args: qoderArgs,
        cwd: workingDirectory,
        // Isolation matters here too: an orchestrator worker spawned from a Qoder-host
        // shell inherits QODER_AGENT_SDK_ENTRYPOINT and would fail before --print.
        env: { ...process.env, ...qoderSdkIsolationEnv() },
      };
    }
    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }
}

async function spawnAndWait(plan: SpawnPlan): Promise<number> {
  if (plan.cwd && !existsSync(plan.cwd)) {
    throw new Error(`Working directory does not exist: ${plan.cwd}`);
  }
  return new Promise<number>((resolve, reject) => {
    const child = spawn(plan.command, plan.args, {
      cwd: plan.cwd,
      env: plan.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout?.on('data', (chunk) => {
      process.stdout.write(chunk);
    });
    child.stderr?.on('data', (chunk) => {
      process.stderr.write(chunk);
    });

    child.once('error', (error) => {
      reject(error);
    });

    child.once('exit', (code) => {
      resolve(typeof code === 'number' ? code : 1);
    });
  });
}

function readProviderFromArgs(args: string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--provider') {
      return args[i + 1];
    }
  }
  return undefined;
}

export async function runOrchestratorOneShot(args: string[]): Promise<number> {
  const provider = parseProvider(readProviderFromArgs(args));
  const prompt = readPromptFromEnv();
  const workingDirectory = readWorkingDirectoryFromEnv();
  const modelMode = readModelModeFromEnv();
  const executionType = readExecutionTypeFromEnv();
  const childSessionId = readChildSessionIdFromEnv();
  logger.debug(`[ORCHESTRATOR ONESHOT] Starting ${provider} one-shot`);

  const plan = buildSpawnPlan(provider, prompt, workingDirectory, modelMode, executionType, childSessionId);
  return spawnAndWait(plan);
}
