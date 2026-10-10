import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { claudeCliPath } from '@/claude/claudeLocal';
import { codexPackage } from '@/codex/package';
import { codexFastModeArgs, resolveCodexRuntime } from '@/codex/codexRuntime';
import { logger } from '@/ui/logger';
import { QODER_SDK_ISOLATION_ENV, resolveQoderCommand } from '@/qoder/constants';
import { MODEL_MODE_DEFAULT, isModelModeForAgent, parseCodexModelMode, parseClaudeModelMode, splitFastModeSuffix } from 'happy-wire';
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
      // Fast mode is opt-in per task via a `-fast` model suffix. The model stays on the task, so a
      // resumed or retried execution keeps the speed the task was submitted with.
      const { mode: codexMode, fast } = splitFastModeSuffix(normalizedModelMode ?? '');
      const codexArgs = ['exec', '--dangerously-bypass-approvals-and-sandbox', ...codexFastModeArgs(fast)];
      if (fast) {
        codexArgs.push('-c', 'service_tier="fast"');
      }
      if (executionType === 'resume') {
        codexArgs.push('resume', childSessionId!, prompt);
      } else {
        codexArgs.push(prompt);
        if (codexMode && codexMode !== MODEL_MODE_DEFAULT) {
          if (isModelModeForAgent('codex', codexMode)) {
            const parsed = parseCodexModelMode(codexMode);
            if (parsed.family !== MODEL_MODE_DEFAULT) {
              codexArgs.push('--model', parsed.family);
              if (parsed.effort) {
                codexArgs.push('-c', `model_reasoning_effort=${parsed.effort}`);
              }
            }
          } else {
            codexArgs.push('--model', codexMode);
          }
        }
      }
      const runtime = resolveCodexRuntime(codexPackage(), codexArgs);
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
      // Like Claude: the scheduler assigns the session id up front and stdout is the plain answer.
      const qoderArgs = ['--dangerously-skip-permissions'];
      if (executionType === 'resume') {
        qoderArgs.push('--resume', childSessionId!);
      } else {
        if (normalizedModelMode) qoderArgs.push('--model', normalizedModelMode);
        if (childSessionId) qoderArgs.push('--session-id', childSessionId);
      }
      qoderArgs.push('-p', prompt);
      return {
        command: resolveQoderCommand(),
        args: qoderArgs,
        cwd: workingDirectory,
        env: { ...process.env, ...QODER_SDK_ISOLATION_ENV },
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
