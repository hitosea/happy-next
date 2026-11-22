import { describe, expect, it } from 'vitest';
import { canUseBypassPermissions, mapToClaudeMode, toRunnableClaudeMode } from './permissionMode';

const claudeModes = ['default', 'acceptEdits', 'plan', 'auto', 'bypassPermissions'] as const;

describe('mapToClaudeMode', () => {
  it('passes through Claude CLI native permission modes', () => {
    for (const mode of claudeModes) {
      expect(mapToClaudeMode(mode)).toBe(mode);
    }
  });

  it('rejects non-Claude permission modes', () => {
    expect(() => mapToClaudeMode('read-only' as any)).toThrow('Unsupported Claude permission mode');
    expect(() => mapToClaudeMode('on-failure' as any)).toThrow('Unsupported Claude permission mode');
    expect(() => mapToClaudeMode('full-auto' as any)).toThrow('Unsupported Claude permission mode');
    expect(() => mapToClaudeMode('auto_edit' as any)).toThrow('Unsupported Claude permission mode');
    expect(() => mapToClaudeMode('yolo' as any)).toThrow('Unsupported Claude permission mode');
  });
});

describe('canUseBypassPermissions', () => {
  const uid = (n: number) => () => n;

  it('allows it as a regular user', () => {
    expect(canUseBypassPermissions(uid(1000), {})).toBe(true);
  });

  it('refuses it as root, where Claude Code would exit at startup', () => {
    expect(canUseBypassPermissions(uid(0), {})).toBe(false);
  });

  it('allows it as root inside a declared sandbox', () => {
    expect(canUseBypassPermissions(uid(0), { IS_SANDBOX: '1' })).toBe(true);
    expect(canUseBypassPermissions(uid(0), { CLAUDE_CODE_BUBBLEWRAP: '1' })).toBe(true);
    expect(canUseBypassPermissions(uid(0), { CLAUDE_CODE_BUBBLEWRAP: ' TRUE ' })).toBe(true);
  });

  it('reads CLAUDE_CODE_BUBBLEWRAP the way Claude Code does', () => {
    expect(canUseBypassPermissions(uid(0), { CLAUDE_CODE_BUBBLEWRAP: '0' })).toBe(false);
    expect(canUseBypassPermissions(uid(0), { CLAUDE_CODE_BUBBLEWRAP: 'false' })).toBe(false);
    expect(canUseBypassPermissions(uid(0), { IS_SANDBOX: 'true' })).toBe(false);
  });

  it('allows it where there are no uids (Windows)', () => {
    expect(canUseBypassPermissions(undefined, {})).toBe(true);
  });
});

describe('toRunnableClaudeMode', () => {
  it('keeps every mode where bypass is available', () => {
    for (const mode of claudeModes) expect(toRunnableClaudeMode(mode, true)).toBe(mode);
  });

  it('runs bypassPermissions as default where Claude Code would refuse it', () => {
    expect(toRunnableClaudeMode('bypassPermissions', false)).toBe('default');
    expect(toRunnableClaudeMode('acceptEdits', false)).toBe('acceptEdits');
  });
});
