import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { findCodexSessionFile, listCodexSessions } from './utils/codexSessionReader';

export type CodexCliInvocation =
  | {
      kind: 'start';
      startedBy?: 'daemon' | 'terminal';
    }
  | {
      kind: 'resume';
      startedBy?: 'daemon' | 'terminal';
      sessionId?: string;
      includeAllDirectories: boolean;
      selectMostRecent: boolean;
    }
  | {
      kind: 'help';
    };

export class CodexCliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CodexCliUsageError';
  }
}

export class CodexCliSelectionCancelledError extends Error {
  constructor() {
    super('Codex session selection cancelled.');
    this.name = 'CodexCliSelectionCancelledError';
  }
}

export function parseCodexCliInvocation(args: readonly string[]): CodexCliInvocation {
  const remaining: string[] = [];
  let startedBy: 'daemon' | 'terminal' | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--happy-starting-mode') {
      const value = args[++i];
      if (value !== 'local' && value !== 'remote') {
        throw new CodexCliUsageError('--happy-starting-mode must be followed by "local" or "remote".');
      }
      continue;
    }
    if (arg !== '--started-by') {
      remaining.push(arg);
      continue;
    }

    const value = args[++i];
    if (value !== 'daemon' && value !== 'terminal') {
      throw new CodexCliUsageError('--started-by must be followed by "daemon" or "terminal".');
    }
    startedBy = value;
  }

  if (remaining.length === 0) {
    return { kind: 'start', startedBy };
  }

  if (remaining.length === 1 && (remaining[0] === '--help' || remaining[0] === '-h')) {
    return { kind: 'help' };
  }

  const [command, ...commandArgs] = remaining;
  if (command !== 'resume') {
    throw new CodexCliUsageError(`Unsupported Codex command or option: ${command}`);
  }
  if (commandArgs.length === 1 && (commandArgs[0] === '--help' || commandArgs[0] === '-h')) {
    return { kind: 'help' };
  }

  let sessionId: string | undefined;
  let includeAllDirectories = false;
  let hasLast = false;

  for (const arg of commandArgs) {
    if (arg === '--all') {
      includeAllDirectories = true;
    } else if (arg === '--last') {
      hasLast = true;
    } else if (arg.startsWith('-')) {
      throw new CodexCliUsageError(`Unsupported option for happy codex resume: ${arg}`);
    } else if (sessionId) {
      throw new CodexCliUsageError('happy codex resume accepts at most one session ID.');
    } else {
      sessionId = arg;
    }
  }

  if (hasLast && sessionId) {
    throw new CodexCliUsageError('--last cannot be used together with a session ID.');
  }

  return {
    kind: 'resume',
    startedBy,
    sessionId,
    includeAllDirectories,
    selectMostRecent: hasLast,
  };
}

type ResumeSession = {
  sessionId: string;
  sessionFile: string;
  originalPath: string | null;
  title?: string | null;
  updatedAt?: number;
};

type ResumeResolverDependencies = {
  findSessionFile: (sessionId: string) => string | null;
  listSessions: () => Promise<ResumeSession[]>;
  isInteractive?: () => boolean;
  selectSession?: (sessions: readonly ResumeSession[]) => Promise<ResumeSession | null>;
};

function formatSessionAge(updatedAt?: number, now: number = Date.now()): string {
  if (!updatedAt) return 'unknown';

  const elapsed = Math.max(0, now - updatedAt);
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function sanitizePickerText(value: string): string {
  return value.replace(/[\x00-\x1f\x7f-\x9f]/g, ' ').trim();
}

function truncatePickerText(value: string, maxLength: number, preserveEnd = false): string {
  const characters = Array.from(value);
  if (characters.length <= maxLength) return value;
  if (maxLength <= 3) return characters.slice(0, maxLength).join('');
  return preserveEnd
    ? `...${characters.slice(-(maxLength - 3)).join('')}`
    : `${characters.slice(0, maxLength - 3).join('')}...`;
}

async function promptForCodexSession(sessions: readonly ResumeSession[]): Promise<ResumeSession | null> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log('Select a Codex session:');
    const indexWidth = String(sessions.length).length;
    const directories = new Set(sessions.map(session => session.originalPath).filter(Boolean));
    const showDirectories = directories.size > 1;
    const terminalWidth = Math.max(60, process.stdout.columns || 120);

    sessions.forEach((session, index) => {
      const title = sanitizePickerText(session.title || 'Untitled session');
      const directory = sanitizePickerText(session.originalPath || 'unknown directory');
      const number = String(index + 1).padStart(indexWidth);
      const age = formatSessionAge(session.updatedAt).padEnd(7);
      const shortId = session.sessionId.slice(0, 6);
      const pathSuffix = showDirectories
        ? `  ${truncatePickerText(directory, Math.min(40, Math.floor(terminalWidth / 3)), true)}`
        : '';
      const fixedWidth = 2 + indexWidth + 2 + age.length + 2 + 8 + pathSuffix.length;
      const displayTitle = truncatePickerText(title, Math.max(12, terminalWidth - fixedWidth));
      console.log(`  ${number}. ${age}  ${shortId}  ${displayTitle}${pathSuffix}`);
    });

    while (true) {
      const answer = (await rl.question('Enter a number, or q to cancel: ')).trim();
      if (answer.toLowerCase() === 'q') {
        return null;
      }

      const selection = Number(answer);
      if (Number.isInteger(selection) && selection >= 1 && selection <= sessions.length) {
        return sessions[selection - 1];
      }
      console.log(`Enter a number from 1 to ${sessions.length}, or q to cancel.`);
    }
  } finally {
    rl.close();
  }
}

const defaultResumeResolverDependencies: ResumeResolverDependencies = {
  findSessionFile: findCodexSessionFile,
  listSessions: listCodexSessions,
  isInteractive: () => Boolean(process.stdin.isTTY && process.stdout.isTTY),
  selectSession: promptForCodexSession,
};

export async function resolveCodexResumeFile(
  invocation: Extract<CodexCliInvocation, { kind: 'resume' }>,
  workingDirectory: string = process.cwd(),
  dependencies: ResumeResolverDependencies = defaultResumeResolverDependencies,
): Promise<string> {
  if (invocation.sessionId) {
    const sessionFile = dependencies.findSessionFile(invocation.sessionId);
    if (!sessionFile) {
      throw new CodexCliUsageError(`Codex session not found: ${invocation.sessionId}`);
    }
    return sessionFile;
  }

  const normalizedWorkingDirectory = resolve(workingDirectory);
  const sessions = await dependencies.listSessions();
  const matchingSessions = sessions
    .filter(candidate => (
      invocation.includeAllDirectories
      || (candidate.originalPath !== null && resolve(candidate.originalPath) === normalizedWorkingDirectory)
    ))
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));

  if (matchingSessions.length === 0) {
    const scope = invocation.includeAllDirectories
      ? 'in any directory'
      : `for ${normalizedWorkingDirectory}`;
    const hint = invocation.includeAllDirectories ? '' : ' Try `happy codex resume --all`.';
    throw new CodexCliUsageError(`No resumable Codex session found ${scope}.${hint}`);
  }

  if (invocation.selectMostRecent) {
    return matchingSessions[0].sessionFile;
  }

  const isInteractive = dependencies.isInteractive ?? defaultResumeResolverDependencies.isInteractive!;
  if (!isInteractive()) {
    throw new CodexCliUsageError(
      'Cannot open the Codex session picker without an interactive terminal. '
      + 'Use `happy codex resume --last` or `happy codex resume <SESSION_ID>`.',
    );
  }

  const selectSession = dependencies.selectSession ?? defaultResumeResolverDependencies.selectSession!;
  const selectedSession = await selectSession(matchingSessions);
  if (!selectedSession) {
    throw new CodexCliSelectionCancelledError();
  }
  return selectedSession.sessionFile;
}

export const CODEX_CLI_HELP = `happy codex - Start Codex with Happy remote control

Usage:
  happy codex                       Start a new Codex session
  happy codex resume                Select a session from the current directory
  happy codex resume --last         Resume the latest session in the current directory
  happy codex resume <SESSION_ID>   Resume a specific session
  happy codex resume --all          Select a session from any directory

Options:
  --last                            Resume the most recent session without a picker
  --all                             Include sessions outside the current directory
  --started-by <daemon|terminal>    Set how the Happy session was started
  -h, --help                        Show this help`;
