import { spawn } from 'node:child_process';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { claudeCliPath } from '@/claude/claudeLocal';
import { codexPackage } from '@/codex/package';
import { codexFastModeArgs, resolveCodexRuntime } from '@/codex/codexRuntime';
import { logger } from '@/ui/logger';
import { QODER_SDK_ISOLATION_ENV, resolveQoderCommand } from '@/qoder/constants';
import { resolveAntigravityCommand } from '@/antigravity/constants';
import { resolveDeepSeekCommand } from '@/deepseek/constants';
import { decodeDeepSeekModelValue } from '@/deepseek/models';
import { MODEL_MODE_DEFAULT, parseModelMode, resolveModelSelectionForFlavor, splitFastModeSuffix } from 'happy-wire';
import {
  ORCHESTRATOR_ENV_KEYS,
  QODER_PROVIDER_BUILDS,
  type OrchestratorProvider,
  decodePromptFromBase64,
  isOrchestratorProvider,
} from './common';

type SpawnPlan = {
  command: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  cleanup?: () => void;
};

/**
 * Builds a minimal Cordis `--patch` overlay for `dsh --profile headless`:
 *  - Re-enables the managed credential store so keys saved via `dsh web` work alongside `DEEPSEEK_API_KEY`.
 *  - Applies the requested provider/model/reasoningEffort to `agent-default-model` when specified.
 */
export function buildDeepSeekHeadlessPatchYaml(modelMode?: string): string {
  const lines = [
    '- id: credentials',
    '  disabled: false',
    '- id: authorization',
    '  disabled: false',
    '- id: deepseek-account',
    '  disabled: false',
  ];
  if (modelMode && modelMode !== MODEL_MODE_DEFAULT) {
    const { model, reasoningEffort } = parseModelMode(modelMode, 'deepseek');
    if (model) {
      const decoded = decodeDeepSeekModelValue(model);
      lines.push(
        '- id: agent-default-model',
        '  config:',
        `    provider: ${JSON.stringify(decoded.provider)}`,
        `    model: ${JSON.stringify(decoded.model)}`,
        ...(reasoningEffort ? [`    reasoningEffort: ${JSON.stringify(reasoningEffort)}`] : []),
      );
    }
  }
  return `${lines.join('\n')}\n`;
}

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
          const { model, reasoningEffort, contextWindow } = parseModelMode(normalizedModelMode, 'claude');
          if (model) baseArgs.push('--model', model);
          if (reasoningEffort) baseArgs.push('--effort', reasoningEffort);
          if (contextWindow) baseArgs.push('--autocompact', String(contextWindow));
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
          const selection = resolveModelSelectionForFlavor('codex', codexMode);
          if (selection.model) {
            codexArgs.push('--model', selection.model);
            if (selection.reasoningEffort) {
              codexArgs.push('-c', `model_reasoning_effort=${selection.reasoningEffort}`);
            }
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
    case 'qoder':
    case 'qodercn': {
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
        command: resolveQoderCommand(process.env, QODER_PROVIDER_BUILDS[provider]),
        args: qoderArgs,
        cwd: workingDirectory,
        env: { ...process.env, ...QODER_SDK_ISOLATION_ENV },
      };
    }
    case 'antigravity': {
      // Like Gemini, JSON output carries the answer and the conversation id agy picked; streamed, the
      // id comes first, so the app can follow the running task. A model mode is `model[:effort]`,
      // the account's ACP model ids, which print mode also takes.
      const { model, reasoningEffort: effort } = parseModelMode(normalizedModelMode ?? MODEL_MODE_DEFAULT, 'antigravity');
      const antigravityArgs = ['-p', prompt, '--output-format', 'stream-json', '--dangerously-skip-permissions'];
      if (executionType === 'resume') antigravityArgs.push('--conversation', childSessionId!);
      if (model) antigravityArgs.push('--model', model, ...(effort ? ['--effort', effort] : []));
      return {
        command: resolveAntigravityCommand(),
        args: antigravityArgs,
        cwd: workingDirectory,
        env: { ...process.env },
      };
    }
    case 'deepseek': {
      // `dsh --profile headless --json` emits `{ type: "session", sessionId }` first and
      // `{ type: "final", sessionId, text }` last. Model/effort and saved credentials come
      // through a temporary `--patch` overlay cleaned up once the child exits.
      const patchFile = join(tmpdir(), `happy-dsh-headless-${randomUUID()}.yml`);
      writeFileSync(patchFile, buildDeepSeekHeadlessPatchYaml(normalizedModelMode), 'utf8');
      const deepSeekArgs = [
        '--profile',
        'headless',
        '--json',
        '--permission-mode',
        'danger-full-access',
        '--patch',
        patchFile,
        ...(executionType === 'resume' ? ['--session-id', childSessionId!] : []),
        '--',
        prompt,
      ];
      return {
        command: resolveDeepSeekCommand(),
        args: deepSeekArgs,
        cwd: workingDirectory,
        env: { ...process.env, DSH_PERMISSION_MODE: 'danger-full-access' },
        cleanup: () => {
          try {
            rmSync(patchFile, { force: true });
          } catch {
            // ignore cleanup error
          }
        },
      };
    }
    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }
}

async function spawnAndWait(plan: SpawnPlan): Promise<number> {
  try {
    if (plan.cwd && !existsSync(plan.cwd)) {
      throw new Error(`Working directory does not exist: ${plan.cwd}`);
    }
    return await new Promise<number>((resolve, reject) => {
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
  } finally {
    plan.cleanup?.();
  }
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
  // A cancel or timeout kills this process, skipping spawnAndWait's `finally`: clean up first,
  // then die from the same signal as before.
  const cleanupSignals: NodeJS.Signals[] = ['SIGTERM', 'SIGINT', 'SIGHUP'];
  const onSignal = (signal: NodeJS.Signals) => {
    plan.cleanup?.();
    for (const s of cleanupSignals) process.removeListener(s, onSignal);
    process.kill(process.pid, signal);
  };
  if (plan.cleanup) {
    for (const s of cleanupSignals) process.once(s, onSignal);
  }
  return spawnAndWait(plan);
}
