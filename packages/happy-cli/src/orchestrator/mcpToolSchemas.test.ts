import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  ORCHESTRATOR_PEND_TOOL_SCHEMA,
  ORCHESTRATOR_SEND_MESSAGE_TOOL_SCHEMA,
  ORCHESTRATOR_SUBMIT_TOOL_SCHEMA,
} from './mcpToolSchemas';

describe('orchestrator mcp tool schemas', () => {
  it('accepts target.type machine alias in submit schema', () => {
    const submitSchema = z.object(ORCHESTRATOR_SUBMIT_TOOL_SCHEMA.inputSchema);
    const parsed = submitSchema.parse({
      title: 'alias test',
      tasks: [
        {
          provider: 'codex',
          model: 'gpt-5.3-codex-medium',
          prompt: 'hello',
          target: {
            type: 'machine',
            machineId: 'machine-1',
          },
        },
      ],
    });

    expect(parsed.tasks[0].target?.type).toBe('machine_id');
  });

  it('keeps concise guidance descriptions for high-risk fields', () => {
    const submitSchema = ORCHESTRATOR_SUBMIT_TOOL_SCHEMA.inputSchema;
    const taskSchema = submitSchema.tasks.element;
    const targetSchema = taskSchema.shape.target.unwrap();

    expect(ORCHESTRATOR_SUBMIT_TOOL_SCHEMA.description).toContain('Returns immediately');
    expect(ORCHESTRATOR_SUBMIT_TOOL_SCHEMA.description).toContain('self-contained');
    expect(ORCHESTRATOR_PEND_TOOL_SCHEMA.description).toContain('Do not poll after submit');
    expect(ORCHESTRATOR_PEND_TOOL_SCHEMA.description).toContain('include="all_tasks"');
    expect(ORCHESTRATOR_SEND_MESSAGE_TOOL_SCHEMA.description).toContain('child task session');
    expect(ORCHESTRATOR_SEND_MESSAGE_TOOL_SCHEMA.description).toContain('completed/failed');
    expect(ORCHESTRATOR_SEND_MESSAGE_TOOL_SCHEMA.description).toContain('childSessionId');
    expect(ORCHESTRATOR_SEND_MESSAGE_TOOL_SCHEMA.description).toContain('<orchestrator-callback>');
    expect(ORCHESTRATOR_SEND_MESSAGE_TOOL_SCHEMA.inputSchema.taskId.description).toContain('not taskKey');
    expect(taskSchema.shape.provider.description).toContain('provider');
    expect(taskSchema.shape.model.description).toContain('get_context.data.modelModes[provider]');
    expect(taskSchema.shape.model.description).toContain('"default"');
    expect(taskSchema.shape.dependsOn.description).toContain('taskKeys, not taskIds');
    expect(taskSchema.shape.dependsOn.description).toContain('no output/context');
    expect(targetSchema.shape.type.description).toContain('alias "machine"');
    expect(submitSchema.controllerSessionId.description).toContain('Defaults to current MCP session');
    expect(ORCHESTRATOR_SEND_MESSAGE_TOOL_SCHEMA.inputSchema.controllerSessionId.description).toContain('Defaults to current MCP session');
  });
});
