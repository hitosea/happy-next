/**
 * Agent Factories
 *
 * Factory functions for creating agent backends with proper configuration.
 * Each factory includes the appropriate transport handler for the agent.
 *
 * @module factories
 */

// Gemini factory
export {
  createGeminiBackend,
  registerGeminiAgent,
  type GeminiBackendOptions,
  type GeminiBackendResult,
} from './gemini';

// Codex factory
export {
  createCodexBackend,
  registerCodexAgent,
  type CodexBackendOptions,
  type CodexBackendResult,
} from './codex';

// OpenCode factory
export {
  createOpenCodeBackend,
  registerOpenCodeAgent,
  type OpenCodeBackendOptions,
  type OpenCodeBackendResult,
} from './opencode';

// Future factories:
// export { createClaudeBackend, registerClaudeAgent, type ClaudeBackendOptions } from './claude';
