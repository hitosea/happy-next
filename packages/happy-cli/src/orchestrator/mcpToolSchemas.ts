import { z } from 'zod';

const orchestratorTargetTypeSchema = z.preprocess(
  (value) => value === 'machine' ? 'machine_id' : value,
  z.enum(['current_machine', 'machine_id']),
).describe('"current_machine" or "machine_id"; alias "machine" normalizes to "machine_id".');

const orchestratorTaskSchema = z.object({
  taskKey: z.string().min(1).max(128).optional(),
  title: z.string().min(1).max(256).optional(),
  provider: z.enum(['claude', 'codex', 'gemini', 'qoder'])
    .describe('AI agent provider to execute the task.'),
  model: z.string().min(1).max(128).optional()
    .describe('Model mode for this provider; prefer orchestrator_get_context.data.modelModes[provider] (for another machine, its machines[].modelModes). Use "default" for CLI default. Codex only: append "-fast" (e.g. "gpt-5.5-high-fast") to run in fast mode, which uses more quota — off unless the user asks for it.'),
  prompt: z.string().min(1).max(65536),
  workingDirectory: z.string().max(512).optional()
    .describe('Absolute path for task execution. Defaults to the controller session working directory on its machine, or the home directory on other machines.'),
  dependsOn: z.array(z.string().min(1).max(128)).max(31).optional()
    .describe('Prerequisite taskKeys, not taskIds. The task waits for them and ends as dependency_failed if one fails, is cancelled or is missing; no output/context is passed.'),
  retry: z.object({
    maxAttempts: z.number().int().min(1).max(10).optional()
      .describe('Maximum attempts for this task (including first run).'),
    backoffMs: z.number().int().min(0).max(24 * 60 * 60 * 1000).optional()
      .describe('Retry backoff delay in milliseconds before the next attempt.'),
  }).optional(),
  target: z.object({
    type: orchestratorTargetTypeSchema,
    machineId: z.string().optional()
      .describe('Required when target.type is "machine_id" (or alias "machine").'),
  }).optional().describe('Optional dispatch routing target.'),
  metadata: z.record(z.string(), z.string()).optional(),
});

export const ORCHESTRATOR_GET_CONTEXT_TOOL_SCHEMA = {
  description: 'Get available AI providers, models, and session context before creating a dispatch.',
  title: 'Orchestrator Get Context',
  inputSchema: {},
} as const;

export const ORCHESTRATOR_SUBMIT_TOOL_SCHEMA = {
  description: 'Delegate one or more self-contained prompts to AI child tasks across claude/codex/gemini/qoder, in parallel or with dependsOn. Returns immediately; wait for <orchestrator-callback> before calling orchestrator_pend.',
  title: 'Orchestrator Submit',
  inputSchema: {
    title: z.string().min(1).max(256).describe('Run title'),
    tasks: z.array(orchestratorTaskSchema).min(1).max(32),
    maxConcurrency: z.number().int().min(1).max(8).optional(),
    idempotencyKey: z.string().min(1).max(128).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    controllerSessionId: z.string().optional().describe('Optional controller session ID. Defaults to current MCP session when omitted.'),
  },
} as const;

export const ORCHESTRATOR_EXEC_TOOL_SCHEMA = {
  description: 'Run a shell command (no AI) on one or more online machines and return each one\'s exitCode, stdout and stderr; a non-zero exit fails it. Waits up to waitMs; if still running, wait for <orchestrator-callback> before calling orchestrator_pend. No stdin, so interactive commands fail. Ask the user before destructive commands.',
  title: 'Orchestrator Exec',
  inputSchema: {
    command: z.string().min(1).max(32_000)
      .describe('Runs in $SHELL -lc, or PowerShell -Command on Windows; see orchestrator_get_context.data.machines[].shell/platform.'),
    machineIds: z.array(z.string().min(1).max(128)).min(1).max(32).optional()
      .describe('Target machine IDs with shellReady: true in orchestrator_get_context. Required unless allOnline is true.'),
    allOnline: z.boolean().optional()
      .describe('Run on every online machine with shellReady: true instead of machineIds.'),
    workingDirectory: z.string().max(512).optional()
      .describe('Working directory on each machine; use an absolute or "~" path. Defaults to the home directory when omitted.'),
    timeoutMs: z.number().int().min(1000).max(2 ** 31 - 1).optional()
      .describe('Kill the command and everything it started after this many ms. No timeout when omitted.'),
    waitMs: z.number().int().min(0).max(50_000).optional()
      .describe('How long this call waits for the result, in ms. Defaults to 30000 when omitted; 0 returns the runId at once.'),
    maxConcurrency: z.number().int().min(1).max(32).optional()
      .describe('Machines running the command at once. Defaults to all when omitted.'),
    title: z.string().min(1).max(256).optional()
      .describe('Run title. Defaults to the first line of command.'),
  },
} as const;

export const ORCHESTRATOR_TRANSFER_TOOL_SCHEMA = {
  description: 'Copy a file or directory (up to 2 GiB, encrypted end to end) from one machine to one or more others and return each target\'s path, bytes, files and sha256; an existing destination fails it unless overwrite is true. Waits up to waitMs; if still running, wait for <orchestrator-callback> before calling orchestrator_pend. Ask the user before overwriting.',
  title: 'Orchestrator Transfer',
  inputSchema: {
    fromMachineId: z.string().min(1).max(128)
      .describe('Source machine ID with shellReady: true in orchestrator_get_context, or "current" for the machine you run on.'),
    fromPath: z.string().min(1).max(4096)
      .describe('Path on the source machine; "~" expands, and a relative path is relative to the home directory.'),
    toMachineIds: z.array(z.string().min(1).max(128)).min(1).max(32).optional()
      .describe('Target machine IDs with shellReady: true in orchestrator_get_context, or "current". Required unless allOnline is true.'),
    allOnline: z.boolean().optional()
      .describe('Send to every other online machine with shellReady: true instead of toMachineIds.'),
    toPath: z.string().min(1).max(4096)
      .describe('Destination on each target; "~" expands, and a relative path is relative to the home directory. Like cp: ending in "/" or naming a directory puts the source inside it, else it is the exact path; missing parents are created.'),
    overwrite: z.boolean().optional()
      .describe('Replace an existing destination of the same kind (a directory is replaced, not merged). Defaults to false.'),
    timeoutMs: z.number().int().min(1000).max(2 ** 31 - 1).optional()
      .describe('Cancel the transfer after this many ms. No timeout when omitted.'),
    waitMs: z.number().int().min(0).max(50_000).optional()
      .describe('How long this call waits for the result, in ms. Defaults to 30000 when omitted; 0 returns the runId at once.'),
    title: z.string().min(1).max(256).optional()
      .describe('Run title. Defaults to "Transfer <fromPath> → <toPath>".'),
  },
} as const;

export const ORCHESTRATOR_PEND_TOOL_SCHEMA = {
  description: 'Fetch a run\'s status and every task\'s status and result, as they are now; it never waits. Call it after <orchestrator-callback>, or when the user asks for progress. Do not poll: a run that has not finished delivers <orchestrator-callback> when it does.',
  title: 'Orchestrator Pend',
  inputSchema: {
    runId: z.string().describe('Run ID'),
    taskId: z.string().optional()
      .describe('Return only this task. Results covering several shell tasks show less of each one\'s output.'),
  },
} as const;

export const ORCHESTRATOR_LIST_TOOL_SCHEMA = {
  description: 'List all dispatches and their current status (active, completed, failed).',
  title: 'Orchestrator List',
  inputSchema: {
    status: z.enum(['active', 'terminal', 'queued', 'running', 'canceling', 'completed', 'failed', 'cancelled']).optional()
      .describe('Filter by status. "active" = queued|running|canceling; "terminal" = completed|failed|cancelled.'),
    limit: z.number().int().min(1).max(50).optional(),
    cursor: z.string().optional(),
  },
} as const;

export const ORCHESTRATOR_CANCEL_TOOL_SCHEMA = {
  description: 'Cancel a dispatch that is queued or in progress.',
  title: 'Orchestrator Cancel',
  inputSchema: {
    runId: z.string().describe('Run ID'),
    reason: z.string().max(512).optional(),
  },
} as const;

export const ORCHESTRATOR_SEND_MESSAGE_TOOL_SCHEMA = {
  description: 'Resume an existing child task session by sending a follow-up to a completed/failed task. Requires a captured childSessionId, requeues the task, and returns immediately; wait for <orchestrator-callback>.',
  title: 'Orchestrator Send Message',
  inputSchema: {
    taskId: z.string().describe('Completed/failed task ID to resume; use taskId, not taskKey.'),
    message: z.string().min(1).max(65_536).describe('Message to send to the existing child session'),
    controllerSessionId: z.string().optional().describe('Optional session to report back to. Defaults to current MCP session when omitted.'),
  },
} as const;
