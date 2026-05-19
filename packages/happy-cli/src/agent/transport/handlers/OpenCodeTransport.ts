import type {
  TransportHandler,
  ToolPattern,
  StderrContext,
  StderrResult,
  ToolNameContext,
} from '../TransportHandler';
import type { AgentMessage } from '../../core';
import { logger } from '@/ui/logger';
import { OPENCODE_MODEL_MODES } from 'happy-wire';

export const OPENCODE_TIMEOUTS = {
  init: 60_000,
  toolCall: 120_000,
  investigation: 600_000,
  think: 30_000,
  idle: 500,
} as const;

interface ExtendedToolPattern extends ToolPattern {
  inputFields?: string[];
  emptyInputDefault?: boolean;
}

function createTool(config: {
  name: string;
  patterns?: string[];
  inputFields?: string[];
  emptyInputDefault?: boolean;
}): ExtendedToolPattern {
  return {
    name: config.name,
    patterns: config.patterns ?? [config.name],
    ...(config.inputFields && { inputFields: config.inputFields }),
    ...(config.emptyInputDefault && { emptyInputDefault: true }),
  };
}

const OPENCODE_TOOL_PATTERNS: ExtendedToolPattern[] = [
  createTool({
    name: 'change_title',
    inputFields: ['title'],
    emptyInputDefault: true,
  }),
  createTool({
    name: 'preview_html',
    inputFields: ['html'],
  }),

  createTool({ name: 'orchestrator_get_context' }),
  createTool({ name: 'orchestrator_list' }),
  createTool({
    name: 'orchestrator_submit',
    inputFields: ['result'],
  }),
  createTool({
    name: 'orchestrator_pend',
    inputFields: ['reason'],
  }),
  createTool({
    name: 'orchestrator_cancel',
    inputFields: ['taskId'],
  }),
  createTool({
    name: 'orchestrator_send_message',
    inputFields: ['message'],
  }),

  createTool({
    name: 'save_memory',
    patterns: ['save_memory', 'save-memory'],
    inputFields: ['memory', 'content'],
  }),
  createTool({
    name: 'think',
    inputFields: ['thought', 'thinking'],
  }),
  createTool({
    name: 'bash',
    patterns: ['bash', 'shell', 'terminal', 'exec'],
  }),
  createTool({
    name: 'edit',
    patterns: ['edit', 'write', 'patch', 'apply_patch'],
  }),
];

export class OpenCodeTransport implements TransportHandler {
  readonly agentName = 'opencode';

  getInitTimeout(): number {
    return OPENCODE_TIMEOUTS.init;
  }

  filterStdoutLine(line: string): string | null {
    const trimmed = line.trim();

    if (!trimmed) {
      return null;
    }

    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
      return null;
    }

    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed !== 'object' || parsed === null) {
        return null;
      }
      return line;
    } catch {
      return null;
    }
  }

  handleStderr(text: string, context: StderrContext): StderrResult {
    const trimmed = text.trim();
    if (!trimmed) {
      return { message: null, suppress: true };
    }

    if (
      trimmed.includes('status 429') ||
      trimmed.includes('code":429') ||
      trimmed.includes('rateLimitExceeded') ||
      trimmed.includes('RESOURCE_EXHAUSTED')
    ) {
      return {
        message: null,
        suppress: false,
      };
    }

    if (trimmed.includes('status 404') || trimmed.includes('code":404')) {
      const errorMessage: AgentMessage = {
        type: 'status',
        status: 'error',
        detail: `Model not found. Available modes: ${OPENCODE_MODEL_MODES.join(', ')}`,
      };
      return { message: errorMessage };
    }

    const lower = trimmed.toLowerCase();
    if (lower.includes('api key') || lower.includes('unauthorized') || lower.includes('authentication')) {
      return {
        message: { type: 'status', status: 'error', detail: `Auth error: ${trimmed}` },
      };
    }

    if (context.hasActiveInvestigation) {
      const hasError =
        lower.includes('timeout') ||
        lower.includes('failed') ||
        lower.includes('error');

      if (hasError) {
        return { message: null, suppress: false };
      }
    }

    return { message: null };
  }

  getToolPatterns(): ToolPattern[] {
    return OPENCODE_TOOL_PATTERNS;
  }

  isInvestigationTool(toolCallId: string, toolKind?: string): boolean {
    const lowerId = toolCallId.toLowerCase();
    return (
      lowerId.includes('investigator') ||
      (typeof toolKind === 'string' && toolKind.includes('investigator'))
    );
  }

  getToolCallTimeout(toolCallId: string, toolKind?: string): number {
    if (this.isInvestigationTool(toolCallId, toolKind)) {
      return OPENCODE_TIMEOUTS.investigation;
    }
    if (toolKind === 'think') {
      return OPENCODE_TIMEOUTS.think;
    }
    return OPENCODE_TIMEOUTS.toolCall;
  }

  getIdleTimeout(): number {
    return OPENCODE_TIMEOUTS.idle;
  }

  extractToolNameFromId(toolCallId: string): string | null {
    const lowerId = toolCallId.toLowerCase();

    for (const toolPattern of OPENCODE_TOOL_PATTERNS) {
      for (const pattern of toolPattern.patterns) {
        if (lowerId.includes(pattern.toLowerCase())) {
          return toolPattern.name;
        }
      }
    }

    return null;
  }

  private isEmptyInput(input: Record<string, unknown> | undefined | null): boolean {
    if (!input) return true;
    if (Array.isArray(input)) return input.length === 0;
    if (typeof input === 'object') return Object.keys(input).length === 0;
    return false;
  }

  determineToolName(
    toolName: string,
    toolCallId: string,
    input: Record<string, unknown>,
    _context: ToolNameContext
  ): string {
    if (toolName !== 'other' && toolName !== 'Unknown tool') {
      return toolName;
    }

    const idToolName = this.extractToolNameFromId(toolCallId);
    if (idToolName) {
      return idToolName;
    }

    if (input && typeof input === 'object' && !Array.isArray(input)) {
      const inputKeys = Object.keys(input);

      for (const toolPattern of OPENCODE_TOOL_PATTERNS) {
        if (toolPattern.inputFields) {
          const hasMatchingField = toolPattern.inputFields.some((field) =>
            inputKeys.some((key) => key.toLowerCase() === field.toLowerCase())
          );
          if (hasMatchingField) {
            return toolPattern.name;
          }
        }
      }
    }

    if (this.isEmptyInput(input) && toolName === 'other') {
      const defaultTool = OPENCODE_TOOL_PATTERNS.find((p) => p.emptyInputDefault);
      if (defaultTool) {
        return defaultTool.name;
      }
    }

    if (toolName === 'other' || toolName === 'Unknown tool') {
      const inputKeys = input && typeof input === 'object' ? Object.keys(input) : [];
      logger.debug(
        `[OpenCodeTransport] Unknown tool pattern - toolCallId: "${toolCallId}", ` +
        `toolName: "${toolName}", inputKeys: [${inputKeys.join(', ')}]. ` +
        `Consider adding a new pattern to OPENCODE_TOOL_PATTERNS if this tool appears frequently.`
      );
    }

    return toolName;
  }
}

export const openCodeTransport = new OpenCodeTransport();
