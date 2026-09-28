export const PUBLIC_HAPPY_COMMANDS = [
  'auth',
  'claude',
  'codex',
  'connect',
  'daemon',
  'doctor',
  'gemini',
  'qoder',
  'notify',
  'update',
] as const;

export const PUBLIC_DAEMON_SUBCOMMANDS = [
  'disable',
  'enable',
  'list',
  'logs',
  'restart',
  'start',
  'status',
  'stop',
  'stop-session',
] as const;

const HAPPY_COMMANDS = new Set<string>([
  ...PUBLIC_HAPPY_COMMANDS,
  'logout',
  'orchestrator-oneshot',
]);

export type CliInvocation =
  | { kind: 'claude'; args: string[]; passthrough: boolean }
  | { kind: 'happy-command'; command: string }
  | { kind: 'unknown-command'; command: string; suggestion?: string };

/**
 * Resolve the top-level CLI mode before any authentication or process startup.
 * Positional Claude arguments require an explicit `claude` or `--` boundary.
 */
export function resolveCliInvocation(args: readonly string[]): CliInvocation {
  if (args.length === 0) {
    return { kind: 'claude', args: [], passthrough: false };
  }

  const [first, ...rest] = args;

  if (first === 'claude') {
    return { kind: 'claude', args: rest, passthrough: false };
  }

  if (first === '--') {
    return { kind: 'claude', args: rest, passthrough: true };
  }

  if (first.startsWith('-')) {
    return { kind: 'claude', args: [...args], passthrough: false };
  }

  if (HAPPY_COMMANDS.has(first)) {
    return { kind: 'happy-command', command: first };
  }

  return {
    kind: 'unknown-command',
    command: first,
    suggestion: suggestClosestCommand(first, PUBLIC_HAPPY_COMMANDS),
  };
}

export function suggestClosestCommand(
  input: string,
  candidates: readonly string[],
): string | undefined {
  if (!input || candidates.length === 0) {
    return undefined;
  }

  const normalizedInput = input.toLowerCase();
  let closest: string | undefined;
  let closestDistance = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    const distance = damerauLevenshteinDistance(normalizedInput, candidate.toLowerCase());
    if (distance < closestDistance) {
      closest = candidate;
      closestDistance = distance;
    }
  }

  const maxLength = Math.max(normalizedInput.length, closest?.length ?? 0);
  const threshold = maxLength <= 4 ? 1 : maxLength <= 8 ? 2 : 3;
  return closestDistance <= threshold ? closest : undefined;
}

function damerauLevenshteinDistance(left: string, right: string): number {
  const rows = left.length + 1;
  const columns = right.length + 1;
  const distance = Array.from({ length: rows }, () => Array<number>(columns).fill(0));

  for (let row = 0; row < rows; row++) {
    distance[row][0] = row;
  }
  for (let column = 0; column < columns; column++) {
    distance[0][column] = column;
  }

  for (let row = 1; row < rows; row++) {
    for (let column = 1; column < columns; column++) {
      const substitutionCost = left[row - 1] === right[column - 1] ? 0 : 1;
      distance[row][column] = Math.min(
        distance[row - 1][column] + 1,
        distance[row][column - 1] + 1,
        distance[row - 1][column - 1] + substitutionCost,
      );

      if (
        row > 1
        && column > 1
        && left[row - 1] === right[column - 2]
        && left[row - 2] === right[column - 1]
      ) {
        distance[row][column] = Math.min(
          distance[row][column],
          distance[row - 2][column - 2] + 1,
        );
      }
    }
  }

  return distance[left.length][right.length];
}
