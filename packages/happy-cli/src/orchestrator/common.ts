// Qoder and Qoder CN are one CLI on two builds that sign in separately, so like the new-session
// picker the orchestrator names them apart: `qoder` runs qodercli, `qodercn` runs qoderclicn.
export const ORCHESTRATOR_PROVIDERS = ['claude', 'codex', 'gemini', 'qoder', 'qodercn', 'antigravity', 'deepseek'] as const;

export type OrchestratorProvider = (typeof ORCHESTRATOR_PROVIDERS)[number];

/** The Qoder build each Qoder provider runs. */
export const QODER_PROVIDER_BUILDS = { qoder: 'intl', qodercn: 'cn' } as const;

export type QoderProvider = keyof typeof QODER_PROVIDER_BUILDS;

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
  /** As dispatched, the task's sealed envelope; once opened, what the agent is asked */
  prompt: string;
  /** A resume's sealed follow-up message */
  resumeMessage?: string;
  timeoutMs: number;
  workingDirectory?: string;
};

/**
 * A shell task, run by the daemon itself rather than by an agent: `prompt` is its sealed
 * envelope as dispatched, the command once opened
 */
export type OrchestratorShellDispatchPayload = {
  executionId: string;
  runId: string;
  taskId: string;
  dispatchToken: string;
  provider: 'shell';
  prompt: string;
  /** Null: no timeout, the command runs until it exits or is cancelled */
  timeoutMs: number | null;
  workingDirectory?: string;
};

/** A transfer task, run on its target machine: `prompt` is its sealed envelope */
export type OrchestratorTransferDispatchPayload = {
  executionId: string;
  runId: string;
  taskId: string;
  dispatchToken: string;
  provider: 'transfer';
  prompt: string;
  /** Null: no timeout, the transfer runs until it ends or is cancelled */
  timeoutMs: number | null;
};

/** What arrived at a transfer's target */
export type OrchestratorTransferResult = {
  path: string;
  kind: 'file' | 'directory';
  bytes: number;
  /** The regular files written: 1 for a file */
  files: number;
  /** The file's sha256 in hex; null for a directory */
  sha256: string | null;
};

/**
 * One step of pulling a transfer's source, which the server relays to the source machine. The
 * target's public key travels sealed (OrchestratorTransferKey), as does the source's in answer.
 */
export type OrchestratorTransferSourceRequest =
  | { op: 'open'; publicKey: string }
  | { op: 'read'; index: number }
  | { op: 'close' };

/**
 * A transfer step as the source machine gets it: `transferId` is the execution's id, `spec` the
 * task's sealed envelope, which says what to send
 */
export type OrchestratorTransferSourceParams = OrchestratorTransferSourceRequest & {
  transferId: string;
  spec: string;
};

/** Where a shell task's stream was saved in full, when it was too long for a tool result */
export type OrchestratorOutputFile = {
  path: string;
  chars: number;
  lines: number;
  /** False when the file stopped at its size cap before the output ended */
  complete: boolean;
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

// What one tool result shows of shell output in all, shared among the streams of its tasks, so
// one call cannot flood the context
export const SHELL_OUTPUT_BUDGET_CHARS = 30_000;
// Per stream: output longer than this is also saved to a file on its machine, since a result
// covering it may show only part of it
export const SHELL_OUTPUT_FILE_THRESHOLD_CHARS = SHELL_OUTPUT_BUDGET_CHARS / 2;
// An output file stops growing here, so a runaway command cannot fill the disk
export const SHELL_OUTPUT_FILE_MAX_BYTES = 100 * 1024 * 1024;
// What a result shows of a stream saved to a file: its end, the rest being read from the file
const SHELL_OUTPUT_FILE_TAIL_CHARS = 4_000;
// What any stream may show however many share the budget
const SHELL_OUTPUT_MIN_SHARE_CHARS = 1_000;
const SHELL_OUTPUT_STREAMS = [['stdout', 'stdoutFile'], ['stderr', 'stderrFile']] as const;

/**
 * Shell tasks (as `/exec` and `/pend` return them) with their output cut to what one tool result
 * shows, and without the output files' details. Each stream gets an even share of
 * SHELL_OUTPUT_BUDGET_CHARS, what a shorter one leaves going to the others. A stream saved to a
 * file shows its end and says where the file is, to be read in parts; another one longer than its
 * share keeps its start and, mostly, its end. Other tasks pass through.
 */
export function compactShellTasks(tasks: Array<Record<string, any>>): Array<Record<string, any>> {
  const streams = tasks.flatMap((task, index) => SHELL_OUTPUT_STREAMS
    .filter(([field]) => typeof task[field] === 'string' && task[field].length > 0)
    .map(([field, fileField]) => {
      const text: string = task[field];
      const file: OrchestratorOutputFile | null = task[fileField] ?? null;
      return { index, field, text, file, wanted: file ? Math.min(text.length, SHELL_OUTPUT_FILE_TAIL_CHARS) : text.length };
    }));
  const shares = new Map<(typeof streams)[number], number>();
  let left = SHELL_OUTPUT_BUDGET_CHARS;
  [...streams].sort((a, b) => a.wanted - b.wanted).forEach((stream, position, sorted) => {
    const share = Math.min(stream.wanted, Math.max(SHELL_OUTPUT_MIN_SHARE_CHARS, Math.floor(left / (sorted.length - position))));
    shares.set(stream, share);
    left -= share;
  });

  const omittedHint = tasks.length > 1 ? '; orchestrator_pend with taskId shows more' : '';
  const compacted = tasks.map(({ stdoutFile, stderrFile, ...task }) => task);
  for (const stream of streams) {
    const { text, file } = stream;
    const shown = shares.get(stream)!;
    const head = Math.floor(shown / 4);
    const saved = file?.complete
      ? 'The full output is saved'
      : `Its first ${SHELL_OUTPUT_FILE_MAX_BYTES / 1024 / 1024} MB are saved`;
    compacted[stream.index][stream.field] = file
      ? `[Output too long: ${file.chars} characters in ${file.lines} lines, showing the last ${shown}. ${saved} on machine ${tasks[stream.index].machineId} at ${file.path}; read parts of it with orchestrator_exec on that machine (grep -n, tail -n, sed -n).]\n${text.slice(-shown)}`
      : text.length > shown
        ? `${text.slice(0, head)}\n[... ${text.length - shown} characters omitted${omittedHint} ...]\n${text.slice(text.length - shown + head)}`
        : text;
  }
  return compacted;
}
