import { z } from 'zod';
import { ORCHESTRATOR_PROVIDERS } from './common';

const orchestratorTargetTypeSchema = z.preprocess(
  (value) => value === 'machine' ? 'machine_id' : value,
  z.enum(['current_machine', 'machine_id']),
).describe('"current_machine" or "machine_id"; alias "machine" normalizes to "machine_id".');

const orchestratorTaskSchema = z.object({
  taskKey: z.string().min(1).max(128).optional(),
  title: z.string().min(1).max(256).optional(),
  provider: z.enum(ORCHESTRATOR_PROVIDERS)
    .describe('AI agent provider to execute the task.'),
  model: z.string().min(1).max(128).optional()
    .describe('Model mode for this provider; prefer orchestrator_get_context.data.modelModes[provider]. Use "default" for CLI default.'),
  prompt: z.string().min(1).max(65536),
  workingDirectory: z.string().max(512).optional()
    .describe('Absolute path for task execution. Defaults to the controller session working directory from get_context.'),
  dependsOn: z.array(z.string().min(1).max(128)).max(31).optional()
    .describe('Prerequisite taskKeys, not taskIds. Ordering only; no output/context is passed.'),
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
  description: 'Delegate one or more self-contained prompts to AI child tasks across claude/codex/gemini, in parallel or with dependsOn. Returns immediately; wait for <orchestrator-callback> before calling orchestrator_pend.',
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

export const ORCHESTRATOR_PEND_TOOL_SCHEMA = {
  description: 'Fetch dispatch status/results. Do not poll after submit; wait for <orchestrator-callback>, then call once with include="all_tasks" and timeoutMs=0. Call earlier only on resume, missing callback, or user-requested progress.',
  title: 'Orchestrator Pend',
  inputSchema: {
    runId: z.string().describe('Run ID'),
    cursor: z.string().optional(),
    waitFor: z.enum(['change', 'terminal']).optional(),
    timeoutMs: z.number().int().min(0).max(3_600_000).optional()
      .describe('Total wait timeout in ms. Defaults to 10 minutes when omitted.'),
    include: z.enum(['summary', 'all_tasks']).optional()
      .describe('"summary" returns run-level status only; "all_tasks" includes per-task details.'),
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
  },
} as const;
