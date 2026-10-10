export const ORCHESTRATOR_PROVIDERS = ['claude', 'codex', 'gemini', 'qoder'] as const;

export type OrchestratorProvider = (typeof ORCHESTRATOR_PROVIDERS)[number];

export type OrchestratorFinishStatus = 'completed' | 'failed' | 'cancelled' | 'timeout';

export type OrchestratorDispatchPayload = {
  executionId: string;
  runId: string;
  taskId: string;
  dispatchToken: string;
  provider: OrchestratorProvider;
  executionType: 'initial' | 'resume';
  childSessionId?: string;
  model?: string;
  prompt: string;
  timeoutMs: number;
  workingDirectory?: string;
};

export type OrchestratorCancelPayload = {
  executionId: string;
  runId: string;
  taskId: string;
  dispatchToken: string;
};

export type OrchestratorFinishReason = {
  watchdogTriggered: boolean;
  cancelRequested: boolean;
  exitCode: number | null;
};

export const ORCHESTRATOR_ENV_KEYS = {
  oneshot: 'HAPPY_ORCH_ONESHOT',
  executionId: 'HAPPY_ORCH_EXECUTION_ID',
  runId: 'HAPPY_ORCH_RUN_ID',
  taskId: 'HAPPY_ORCH_TASK_ID',
  executionType: 'HAPPY_ORCH_EXECUTION_TYPE',
  childSessionId: 'HAPPY_ORCH_CHILD_SESSION_ID',
  modelMode: 'HAPPY_ORCH_MODEL_MODE',
  promptB64: 'HAPPY_ORCH_PROMPT_B64',
  timeoutMs: 'HAPPY_ORCH_TIMEOUT_MS',
  workingDirectory: 'HAPPY_ORCH_WORKING_DIRECTORY',
} as const;

export function isOrchestratorProvider(value: unknown): value is OrchestratorProvider {
  return typeof value === 'string' && (ORCHESTRATOR_PROVIDERS as readonly string[]).includes(value);
}

export function mapFinishStatus(reason: OrchestratorFinishReason): OrchestratorFinishStatus {
  if (reason.watchdogTriggered) {
    return 'timeout';
  }
  if (reason.cancelRequested) {
    return 'cancelled';
  }
  if (reason.exitCode === 0) {
    return 'completed';
  }
  return 'failed';
}

export function encodePromptToBase64(prompt: string): string {
  return Buffer.from(prompt, 'utf8').toString('base64');
}

export function decodePromptFromBase64(promptB64: string): string {
  return Buffer.from(promptB64, 'base64').toString('utf8');
}

export function buildOrchestratorEnv(payload: OrchestratorDispatchPayload): Record<string, string> {
  const env: Record<string, string> = {
    [ORCHESTRATOR_ENV_KEYS.oneshot]: '1',
    [ORCHESTRATOR_ENV_KEYS.executionId]: payload.executionId,
    [ORCHESTRATOR_ENV_KEYS.runId]: payload.runId,
    [ORCHESTRATOR_ENV_KEYS.taskId]: payload.taskId,
    [ORCHESTRATOR_ENV_KEYS.executionType]: payload.executionType,
    [ORCHESTRATOR_ENV_KEYS.promptB64]: encodePromptToBase64(payload.prompt),
    [ORCHESTRATOR_ENV_KEYS.timeoutMs]: String(payload.timeoutMs),
  };
  if (payload.childSessionId) {
    env[ORCHESTRATOR_ENV_KEYS.childSessionId] = payload.childSessionId;
  }
  if (payload.workingDirectory) {
    env[ORCHESTRATOR_ENV_KEYS.workingDirectory] = payload.workingDirectory;
  }
  if (payload.model) {
    env[ORCHESTRATOR_ENV_KEYS.modelMode] = payload.model;
  }
  return env;
}

export function applyDefaultWorkingDirectory<T extends { workingDirectory?: string; target?: { type: string; machineId?: string } }>(
  tasks: T[],
  defaultWorkingDirectory?: string | null,
  currentMachineId?: string | null,
): T[] {
  const fallback = typeof defaultWorkingDirectory === 'string' ? defaultWorkingDirectory.trim() : '';
  if (!fallback) {
    return tasks;
  }
  return tasks.map((task) => {
    const taskWorkingDirectory = typeof task.workingDirectory === 'string'
      ? task.workingDirectory.trim()
      : '';
    if (taskWorkingDirectory) {
      return task;
    }
    if (task.target?.type === 'machine_id' && task.target.machineId !== currentMachineId) {
      return task;
    }
    return {
      ...task,
      workingDirectory: fallback,
    };
  });
}

export function appendOutputChunk(current: string, chunk: string, maxChars: number): string {
  if (maxChars <= 0) {
    return '';
  }
  const combined = `${current}${chunk}`;
  if (combined.length <= maxChars) {
    return combined;
  }
  return combined.slice(combined.length - maxChars);
}

const ORCHESTRATOR_ERROR_LOG_TAIL_LINES = 40;
const ORCHESTRATOR_ERROR_LOG_TAIL_CHARS = 4_000;

/**
 * Short preview of an execution's output. A successful run's stdout is its final message, so the
 * summary is its beginning; without stdout the last stderr line is the most telling one.
 */
export function buildOutputSummary(stdout: string, stderr: string, maxChars: number = 200): string | null {
  const head = stdout.trim();
  const source = head || stderr.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0).at(-1) || '';
  if (!source) {
    return null;
  }
  if (source.length <= maxChars) {
    return source;
  }
  return `${source.slice(0, maxChars - 3)}...`;
}

/**
 * The result text of an execution: the final message the provider printed on stdout. Provider
 * progress logs go to stderr, so they are only attached (as a short tail) when the run did not
 * complete or printed nothing, to explain what went wrong.
 */
export function buildExecutionOutputText(opts: { status: string; stdout: string; stderr: string }): string {
  const stdout = opts.stdout.trim();
  if (opts.status === 'completed' && stdout) {
    return stdout;
  }
  const stderrTail = opts.stderr
    .trim()
    .split(/\r?\n/)
    .slice(-ORCHESTRATOR_ERROR_LOG_TAIL_LINES)
    .join('\n')
    .slice(-ORCHESTRATOR_ERROR_LOG_TAIL_CHARS);
  return [stdout, stderrTail].filter(Boolean).join('\n');
}
