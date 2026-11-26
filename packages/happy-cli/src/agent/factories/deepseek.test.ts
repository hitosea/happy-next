import { describe, expect, it } from 'vitest';
import { DeepSeekTransport } from './deepseek';

describe('DeepSeekTransport', () => {
  const transport = new DeepSeekTransport('deepseek');

  it('maps built-in dsh-base tools to Happy card names and inputs', () => {
    expect(transport.identifyToolCall({
      title: 'read',
      kind: 'other',
      rawInput: { file_path: '/repo/a.ts', offset: 1, limit: 50 },
    })).toEqual({
      name: 'Read',
      input: { file_path: '/repo/a.ts', offset: 1, limit: 50 },
    });

    expect(transport.identifyToolCall({
      title: 'write',
      kind: 'other',
      rawInput: { file_path: '/tmp/out.txt', content: 'hi', sandbox_permissions: 'danger-full-access', justification: 'write outside ws' },
    })).toEqual({
      name: 'Write',
      input: { file_path: '/tmp/out.txt', content: 'hi', sandbox_permissions: 'danger-full-access', justification: 'write outside ws' },
    });

    expect(transport.identifyToolCall({
      title: 'edit',
      kind: 'other',
      rawInput: { file_path: '/repo/a.ts', old_string: 'a', new_string: 'b' },
    })).toEqual({
      name: 'Edit',
      input: { file_path: '/repo/a.ts', old_string: 'a', new_string: 'b' },
    });

    expect(transport.identifyToolCall({
      title: 'bash',
      kind: 'other',
      rawInput: { command: 'ls -la', description: 'List files' },
    })).toEqual({
      name: 'Bash',
      input: { command: 'ls -la', description: 'List files' },
    });

    expect(transport.identifyToolCall({
      title: 'grep',
      kind: 'other',
      rawInput: { pattern: 'foo', path: '/repo', include: '*.ts' },
    })).toEqual({
      name: 'Grep',
      input: { pattern: 'foo', path: '/repo', glob: '*.ts' },
    });

    expect(transport.identifyToolCall({
      title: 'glob',
      kind: 'other',
      rawInput: { pattern: '**/*.ts' },
    })).toEqual({
      name: 'Glob',
      input: { pattern: '**/*.ts' },
    });
  });

  it('maps Happy interactive MCP tools to native card names and keeps other MCP tools intact', () => {
    const questions = [{ question: 'Pick one', header: 'Choice', options: [{ label: 'A', description: 'a' }, { label: 'B', description: 'b' }], multiSelect: false }];
    expect(transport.identifyToolCall({
      title: 'mcp__happy__ask_user_question',
      kind: 'other',
      rawInput: { questions },
    })).toEqual({
      name: 'AskUserQuestion',
      input: { questions },
    });

    expect(transport.identifyToolCall({
      title: 'mcp__happy__exit_plan_mode',
      kind: 'other',
      rawInput: { plan: '# Plan\n1. Step' },
    })).toEqual({
      name: 'ExitPlanMode',
      input: { plan: '# Plan\n1. Step' },
    });

    expect(transport.identifyToolCall({
      title: 'mcp__happy__change_title',
      kind: 'other',
      rawInput: { title: 'My chat' },
    })).toEqual({
      name: 'mcp__happy__change_title',
      input: { title: 'My chat' },
    });
  });
});
