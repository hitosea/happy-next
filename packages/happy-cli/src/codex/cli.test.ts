import { describe, expect, it, vi } from 'vitest';
import {
  CodexCliUsageError,
  parseCodexCliInvocation,
  resolveCodexResumeFile,
} from './cli';

describe('parseCodexCliInvocation', () => {
  it('starts a new session when no Codex arguments are provided', () => {
    expect(parseCodexCliInvocation([])).toEqual({ kind: 'start', startedBy: undefined });
  });

  it('parses resume using the current directory by default', () => {
    expect(parseCodexCliInvocation(['resume'])).toEqual({
      kind: 'resume',
      startedBy: undefined,
      sessionId: undefined,
      includeAllDirectories: false,
      selectMostRecent: false,
    });
  });

  it('parses resume flags, session IDs, and Happy internal options', () => {
    expect(parseCodexCliInvocation([
      'resume',
      '--all',
      '--last',
      '--happy-starting-mode',
      'remote',
      '--started-by',
      'daemon',
    ])).toEqual({
      kind: 'resume',
      startedBy: 'daemon',
      sessionId: undefined,
      includeAllDirectories: true,
      selectMostRecent: true,
    });
    expect(parseCodexCliInvocation(['--started-by', 'terminal', 'resume', 'session-123'])).toEqual({
      kind: 'resume',
      startedBy: 'terminal',
      sessionId: 'session-123',
      includeAllDirectories: false,
      selectMostRecent: false,
    });
  });

  it('returns help without starting a session', () => {
    expect(parseCodexCliInvocation(['--help'])).toEqual({ kind: 'help' });
    expect(parseCodexCliInvocation(['resume', '--help'])).toEqual({ kind: 'help' });
  });

  it('rejects unsupported commands and invalid resume combinations', () => {
    expect(() => parseCodexCliInvocation(['fork'])).toThrow(CodexCliUsageError);
    expect(() => parseCodexCliInvocation(['resume', '--unknown'])).toThrow(
      'Unsupported option for happy codex resume: --unknown',
    );
    expect(() => parseCodexCliInvocation(['resume', '--last', 'session-123'])).toThrow(
      '--last cannot be used together with a session ID.',
    );
    expect(() => parseCodexCliInvocation(['--started-by', 'other'])).toThrow(
      '--started-by must be followed by "daemon" or "terminal".',
    );
    expect(() => parseCodexCliInvocation(['--happy-starting-mode', 'other'])).toThrow(
      '--happy-starting-mode must be followed by "local" or "remote".',
    );
  });
});

describe('resolveCodexResumeFile', () => {
  it('resolves an explicitly selected session', async () => {
    const findSessionFile = vi.fn(() => '/sessions/selected.jsonl');
    const listSessions = vi.fn();

    await expect(resolveCodexResumeFile(
      {
        kind: 'resume',
        sessionId: 'session-123',
        includeAllDirectories: false,
        selectMostRecent: false,
      },
      '/repo',
      { findSessionFile, listSessions },
    )).resolves.toBe('/sessions/selected.jsonl');

    expect(findSessionFile).toHaveBeenCalledWith('session-123');
    expect(listSessions).not.toHaveBeenCalled();
  });

  it('selects the newest session from the current directory with --last', async () => {
    const findSessionFile = vi.fn();
    const listSessions = vi.fn(async () => [
      { sessionId: 'same-id', sessionFile: '/sessions/repo-older.jsonl', originalPath: '/repo', updatedAt: 1 },
      { sessionId: 'same-id', sessionFile: '/sessions/other-newest.jsonl', originalPath: '/other', updatedAt: 3 },
      { sessionId: 'same-id', sessionFile: '/sessions/repo-newest.jsonl', originalPath: '/repo', updatedAt: 2 },
    ]);

    await expect(resolveCodexResumeFile(
      { kind: 'resume', includeAllDirectories: false, selectMostRecent: true },
      '/repo',
      { findSessionFile, listSessions },
    )).resolves.toBe('/sessions/repo-newest.jsonl');
    expect(findSessionFile).not.toHaveBeenCalled();
  });

  it('selects the newest session from any directory with --last --all', async () => {
    const findSessionFile = vi.fn((id: string) => `/sessions/${id}.jsonl`);
    const listSessions = vi.fn(async () => [
      { sessionId: 'older', sessionFile: '/sessions/older.jsonl', originalPath: '/repo', updatedAt: 1 },
      { sessionId: 'newest', sessionFile: '/sessions/newest.jsonl', originalPath: '/other', updatedAt: 2 },
    ]);

    await expect(resolveCodexResumeFile(
      { kind: 'resume', includeAllDirectories: true, selectMostRecent: true },
      '/repo',
      { findSessionFile, listSessions },
    )).resolves.toBe('/sessions/newest.jsonl');
  });

  it('fails clearly instead of silently creating a new session', async () => {
    await expect(resolveCodexResumeFile(
      { kind: 'resume', includeAllDirectories: false, selectMostRecent: false },
      '/repo',
      { findSessionFile: vi.fn(), listSessions: vi.fn(async () => []) },
    )).rejects.toThrow('No resumable Codex session found for /repo.');
  });

  it('opens a picker for resume without --last', async () => {
    const selectSession = vi.fn(async (sessions: readonly any[]) => sessions[1]);
    const listSessions = vi.fn(async () => [
      { sessionId: 'older', sessionFile: '/sessions/older.jsonl', originalPath: '/repo', updatedAt: 1 },
      { sessionId: 'newest', sessionFile: '/sessions/newest.jsonl', originalPath: '/repo', updatedAt: 2 },
      { sessionId: 'other', sessionFile: '/sessions/other.jsonl', originalPath: '/other', updatedAt: 3 },
    ]);

    await expect(resolveCodexResumeFile(
      { kind: 'resume', includeAllDirectories: false, selectMostRecent: false },
      '/repo',
      {
        findSessionFile: vi.fn(),
        listSessions,
        isInteractive: () => true,
        selectSession,
      },
    )).resolves.toBe('/sessions/older.jsonl');

    expect(selectSession).toHaveBeenCalledWith([
      expect.objectContaining({ sessionId: 'newest' }),
      expect.objectContaining({ sessionId: 'older' }),
    ]);
  });

  it('includes sessions from every directory in the picker with --all', async () => {
    const selectSession = vi.fn(async (sessions: readonly any[]) => sessions[0]);

    await resolveCodexResumeFile(
      { kind: 'resume', includeAllDirectories: true, selectMostRecent: false },
      '/repo',
      {
        findSessionFile: vi.fn(),
        listSessions: vi.fn(async () => [
          { sessionId: 'other', sessionFile: '/sessions/other.jsonl', originalPath: '/other', updatedAt: 2 },
          { sessionId: 'repo', sessionFile: '/sessions/repo.jsonl', originalPath: '/repo', updatedAt: 1 },
        ]),
        isInteractive: () => true,
        selectSession,
      },
    );

    expect(selectSession).toHaveBeenCalledWith([
      expect.objectContaining({ sessionId: 'other' }),
      expect.objectContaining({ sessionId: 'repo' }),
    ]);
  });

  it('requires --last or a session ID without an interactive terminal', async () => {
    await expect(resolveCodexResumeFile(
      { kind: 'resume', includeAllDirectories: false, selectMostRecent: false },
      '/repo',
      {
        findSessionFile: vi.fn(),
        listSessions: vi.fn(async () => [
          { sessionId: 'session-123', sessionFile: '/sessions/session.jsonl', originalPath: '/repo' },
        ]),
        isInteractive: () => false,
      },
    )).rejects.toThrow('Use `happy codex resume --last`');
  });

  it('ends cleanly when picker selection is cancelled', async () => {
    await expect(resolveCodexResumeFile(
      { kind: 'resume', includeAllDirectories: false, selectMostRecent: false },
      '/repo',
      {
        findSessionFile: vi.fn(),
        listSessions: vi.fn(async () => [
          { sessionId: 'session-123', sessionFile: '/sessions/session.jsonl', originalPath: '/repo' },
        ]),
        isInteractive: () => true,
        selectSession: vi.fn(async () => null),
      },
    )).rejects.toMatchObject({ name: 'CodexCliSelectionCancelledError' });
  });
});
