import { AGENT_FLAVORS, type AgentFlavor } from './modelCatalog';

/**
 * Executables that satisfy each agent flavor, in probe order.
 *
 * A flavor may be provided by more than one binary: Qoder ships an international (`qoder`)
 * and a China (`qodercn`) build that install separately and sign in separately, and either
 * one is a usable Qoder.
 */
export const AGENT_CLI_EXECUTABLES: Record<AgentFlavor, readonly string[]> = {
  claude: ['claude'],
  codex: ['codex'],
  gemini: ['gemini'],
  qoder: ['qoder', 'qodercn'],
};

/** Display name of each flavor, for the prose the app and the CLI write about an agent. */
export const AGENT_DISPLAY_NAMES: Record<AgentFlavor, string> = {
  claude: 'Claude',
  codex: 'Codex',
  gemini: 'Gemini',
  qoder: 'Qoder',
};

/**
 * Display name for a flavor that may be missing or unrecognised: a session without
 * metadata yet, or a reason string naming an agent this build does not know. Claude is
 * the fallback because it is the flavor a session defaults to.
 */
export function agentDisplayName(flavor: string | null | undefined): string {
  return AGENT_DISPLAY_NAMES[flavor as AgentFlavor] ?? AGENT_DISPLAY_NAMES.claude;
}

/** One `command -v` probe that always prints a verdict, so the chain never short-circuits. */
function cliProbeClause(flavor: AgentFlavor): string {
  const found = AGENT_CLI_EXECUTABLES[flavor]
    .map(name => `command -v ${name} >/dev/null 2>&1`)
    .join(' || ');
  return `(${found}) && echo "${flavor}:true" || echo "${flavor}:false"`;
}

/**
 * Shell script that reports which agent CLIs are installed on the machine, one
 * `<flavor>:true|false` line per flavor.
 *
 * Generated rather than hand-concatenated: the app and the server each used to carry their
 * own copy of this string, and hand-editing one to add an agent is what produced an
 * unbalanced parenthesis that made the whole script a shell syntax error.
 */
export function buildCliDetectionScript(
  flavors: readonly AgentFlavor[] = AGENT_FLAVORS,
): string {
  return flavors.map(cliProbeClause).join(' && ');
}
