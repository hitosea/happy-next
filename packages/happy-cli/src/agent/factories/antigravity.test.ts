import { describe, expect, it } from 'vitest';
import { ANTIGRAVITY_ACP_MODES, AntigravityTransport, antigravityMcpToolName, resolveAntigravityAcpMode } from './antigravity';

const transport = new AntigravityTransport('antigravity');
const identify = (kind: string, rawInput: unknown, title = '') => transport.identifyToolCall({ kind, title, rawInput });

describe('AntigravityTransport.identifyToolCall', () => {
  it("gives agy's tools the names and input of the app's cards", () => {
    expect(identify('execute', { CommandLine: 'ls -la', WaitMsBeforeAsync: 500, toolSummary: 'List files' }, 'ls -la'))
      .toEqual({ name: 'Bash', input: { command: 'ls -la', description: 'List files' } });
    expect(identify('read', { Path: '/a.ts' }, 'File a.ts')).toEqual({ name: 'Read', input: { file_path: '/a.ts' } });
    expect(identify('edit', { Path: '/a.ts', Target: 'x', Replacement: 'y' }, 'File a.ts'))
      .toEqual({ name: 'Edit', input: { file_path: '/a.ts', old_string: 'x', new_string: 'y' } });
    expect(identify('edit', { Path: '/a.ts', Content: 'hi' }, 'File a.ts'))
      .toEqual({ name: 'Write', input: { file_path: '/a.ts', content: 'hi' } });
  });

  it('leaves out fields agy did not send', () => {
    expect(identify('execute', { CommandLine: 'ls' })).toEqual({ name: 'Bash', input: { command: 'ls' } });
  });

  it('names MCP tools by their title, without agy\'s summary in the input', () => {
    expect(identify('other', { title: 'Notes', toolSummary: 'Set chat session title' }, 'Run mcp_happy_change_title'))
      .toEqual({ name: 'mcp__happy__change_title', input: { title: 'Notes' } });
  });

  it('leaves other tools to their kind', () => {
    expect(identify('search', { Query: 'x' }, 'Search x')).toBeNull();
    expect(identify('other', {}, 'Run something')).toBeNull();
  });
});

describe('antigravityMcpToolName', () => {
  it("names MCP tools the way Happy matches its own", () => {
    expect(antigravityMcpToolName('Run mcp_happy_orchestrator_get_context')).toBe('mcp__happy__orchestrator_get_context');
    expect(antigravityMcpToolName('Run mcp_my-server_do_it')).toBe('mcp__my-server__do_it');
    expect(antigravityMcpToolName('echo hi')).toBeNull();
  });
});

describe('resolveAntigravityAcpMode', () => {
  it('maps every Antigravity permission mode to its agy ACP mode', () => {
    expect(ANTIGRAVITY_ACP_MODES).toEqual({
      default: 'default',
      acceptEdits: 'accept-edits',
      auto: 'auto',
      plan: 'plan',
      yolo: 'default',
    });
    const allModes = new Set(['default', 'accept-edits', 'auto', 'plan']);
    expect(resolveAntigravityAcpMode('default', allModes)).toBe('default');
    expect(resolveAntigravityAcpMode('acceptEdits', allModes)).toBe('accept-edits');
    expect(resolveAntigravityAcpMode('auto', allModes)).toBe('auto');
    expect(resolveAntigravityAcpMode('plan', allModes)).toBe('plan');
    expect(resolveAntigravityAcpMode('yolo', allModes)).toBe('default');
  });

  it('falls back to default when agy does not advertise auto on the host', () => {
    const withoutAuto = new Set(['default', 'accept-edits', 'plan']);
    expect(resolveAntigravityAcpMode('auto', withoutAuto)).toBe('default');
    expect(resolveAntigravityAcpMode('acceptEdits', withoutAuto)).toBe('accept-edits');
    expect(resolveAntigravityAcpMode('plan', withoutAuto)).toBe('plan');
    expect(resolveAntigravityAcpMode('auto', null)).toBe('auto');
  });
});
