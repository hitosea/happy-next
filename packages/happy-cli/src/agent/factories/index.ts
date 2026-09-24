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

// Qoder factory
export {
  createQoderBackend,
  registerQoderAgent,
  buildQoderAcpArgs,
  resolveQoderCommand,
  type QoderBackendOptions,
  type QoderBackendResult,
} from './qoder';

// Future factories:
// export { createClaudeBackend, registerClaudeAgent, type ClaudeBackendOptions } from './claude';
// export { createOpenCodeBackend, registerOpenCodeAgent, type OpenCodeBackendOptions } from './opencode';
