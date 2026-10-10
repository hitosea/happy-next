/**
 * Qoder first-turn prompt
 *
 * ACP takes one prompt string, so Happy's session guidance rides along with the
 * first user message. It goes after the message: qodercli treats a prompt that
 * starts with a tag as context and leaves it out of the history it replays on
 * session/load. The tag lets a resumed session strip the guidance again before
 * showing that message in the app.
 */

const INSTRUCTIONS_TAG = 'happy-session-instructions';
const INSTRUCTIONS_BLOCK = new RegExp(`\\s*<${INSTRUCTIONS_TAG}>[\\s\\S]*?</${INSTRUCTIONS_TAG}>\\s*$`);

export function buildQoderFirstTurnPrompt(opts: {
  userMessage: string;
  appendSystemPrompt?: string | null;
  firstTurnInstruction?: string | null;
}): string {
  const guidance = [opts.appendSystemPrompt, opts.firstTurnInstruction]
    .filter((part): part is string => typeof part === 'string' && part.length > 0)
    .join('\n\n');
  return guidance ? `${opts.userMessage}\n\n<${INSTRUCTIONS_TAG}>\n${guidance}\n</${INSTRUCTIONS_TAG}>` : opts.userMessage;
}

export function stripQoderSessionInstructions(text: string): string {
  return text.replace(INSTRUCTIONS_BLOCK, '');
}
