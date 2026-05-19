import { getBaseSystemPrompt } from '@/orchestrator/prompt';

export const OPENCODE_API_KEY_ENV = 'OPENCODE_API_KEY';

export const OPENCODE_MODEL_ENV = 'OPENCODE_MODEL';

export const DEFAULT_OPENCODE_MODEL = 'default';

export function getFirstTurnInstruction(env: NodeJS.ProcessEnv = process.env): string {
  return getBaseSystemPrompt(env) ?? '';
}
