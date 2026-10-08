/**
 * Prompt Instructions
 *
 * Detection of the instructions Happy writes into a prompt, shared by the ACP agent
 * factories so they cannot disagree about what a prompt asked for.
 *
 * @module core
 */

/**
 * True when the prompt tells the agent to retitle the session.
 *
 * ACP backends use this to auto-approve the first tool call of a turn that may turn out
 * to be `change_title`. Agents name and id that tool differently, hence the spellings:
 * `mcp__happy__change_title` and `mcp:happy:change_title` both contain `change_title`.
 */
export function hasChangeTitleInstruction(prompt: string): boolean {
  const lower = prompt.toLowerCase();
  return lower.includes('change_title')
    || lower.includes('change title')
    || lower.includes('set title')
    || lower.includes('mcp__happy__change_title');
}
