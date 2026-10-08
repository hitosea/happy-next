/**
 * Transport Handlers
 *
 * Agent-specific transport logic for ACP backends.
 *
 * @module transport
 */

// Core types and interfaces
export type {
  TransportHandler,
  ToolPattern,
  StderrContext,
  StderrResult,
  ToolNameContext,
} from './TransportHandler';

// Default implementation
export { DefaultTransport, defaultTransport } from './DefaultTransport';

// Agent-specific handlers. './handlers' would cycle back through this barrel, so
// import the concrete modules.
export { GeminiTransport, geminiTransport } from './handlers/GeminiTransport';
export { CodexTransport, codexTransport } from './handlers/CodexTransport';
export { QoderTransport, qoderTransport } from './handlers/QoderTransport';

// Future handlers will be exported from their own modules:
// export { ClaudeTransport, claudeTransport } from './handlers/ClaudeTransport';
// export { OpenCodeTransport, openCodeTransport } from './handlers/OpenCodeTransport';
