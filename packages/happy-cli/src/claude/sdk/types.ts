/**
 * Type definitions for Claude Code SDK integration
 * Provides type-safe interfaces for all SDK communication
 */

import type { Readable } from 'node:stream'

/**
 * SDK message types
 */
export interface SDKMessage {
    type: string
    [key: string]: unknown
}

export interface SDKUserMessage extends SDKMessage {
    type: 'user'
    parent_tool_use_id?: string
    uuid?: string
    /** Set by Claude Code on the post-compaction summary record, which is otherwise a plain user message. */
    isCompactSummary?: boolean
    /** Set by Claude Code on the stream output (in place of isCompactSummary) for client-generated user turns. */
    isSynthetic?: boolean
    message: {
        role: 'user'
        content: string | Array<{
            type: string
            text?: string
            tool_use_id?: string
            content?: unknown
            [key: string]: unknown
        }>
    }
}

export interface SDKAssistantMessage extends SDKMessage {
    type: 'assistant'
    parent_tool_use_id?: string
    message: {
        role: 'assistant'
        content: Array<{
            type: string
            text?: string
            id?: string
            name?: string
            input?: unknown
            [key: string]: unknown
        }>
    }
}

export interface SDKSystemMessage extends SDKMessage {
    type: 'system'
    subtype: string
    session_id?: string
    model?: string
    cwd?: string
    tools?: string[]
    slash_commands?: string[]
    skills?: string[]
    /** Present on the `compact_boundary` subtype: the anchor is the post-compaction summary message. */
    compact_metadata?: {
        trigger?: 'auto' | 'manual'
        preserved_messages?: { anchor_uuid?: string }
        preserved_segment?: { anchor_uuid?: string }
    }
    plugins?: Array<{
        name: string
        path?: string
        source?: string
        [key: string]: unknown
    }>
}

export interface SDKResultMessage extends SDKMessage {
    type: 'result'
    subtype: 'success' | 'error_max_turns' | 'error_during_execution'
    result?: string
    num_turns: number
    usage?: {
        input_tokens: number
        output_tokens: number
        cache_read_input_tokens?: number
        cache_creation_input_tokens?: number
    }
    total_cost_usd: number
    duration_ms: number
    duration_api_ms: number
    is_error: boolean
    session_id: string
}

export interface SDKControlResponse extends SDKMessage {
    type: 'control_response'
    response: {
        request_id: string
        subtype: 'success' | 'error'
        error?: string
        response?: unknown
    }
}

export interface SDKLog extends SDKMessage {
    type: 'log'
    log: {
        level: 'debug' | 'info' | 'warn' | 'error'
        message: string
    }
}

/**
 * Control request types
 */
export interface ControlRequest {
    subtype: string
}

export interface InterruptRequest extends ControlRequest {
    subtype: 'interrupt'
}

export interface SetPermissionModeRequest extends ControlRequest {
    subtype: 'set_permission_mode'
    mode: 'default' | 'acceptEdits' | 'auto' | 'bypassPermissions' | 'plan'
}

export interface InitializeRequest extends ControlRequest {
    subtype: 'initialize'
}

/** A slash command / skill as reported by Claude Code's `initialize` control response. */
export interface SDKCommandInfo {
    name: string
    description?: string
    argumentHint?: string
    aliases?: string[]
    builtin?: boolean
}

export interface GetContextUsageRequest extends ControlRequest {
    subtype: 'get_context_usage'
    detail: 'summary' | 'full'
}

/** Subset of Claude Code's `get_context_usage` control response that we consume. */
export interface SDKContextUsage {
    totalTokens?: number
    /** Effective context window: the model window, or the `/autocompact` / `--autocompact` window when set */
    maxTokens?: number
    rawMaxTokens?: number
    autoCompactThreshold?: number
    isAutoCompactEnabled?: boolean
    model?: string
}

export interface SetModelRequest extends ControlRequest {
    subtype: 'set_model'
    model?: string
}

export interface CanUseToolRequest extends ControlRequest {
    subtype: 'can_use_tool'
    tool_name: string
    input: unknown
}

export interface CanUseToolControlRequest {
    type: 'control_request'
    request_id: string
    request: CanUseToolRequest
}

export interface CanUseToolControlResponse {
    type: 'control_response'
    response: {
        subtype: 'success' | 'error'
        request_id: string
        response?: PermissionResult
        error?: string
    }
}

export interface ControlCancelRequest {
    type: 'control_cancel_request'
    request_id: string
}

export interface SDKControlRequest {
    request_id: string
    type: 'control_request'
    request: ControlRequest
}

/**
 * Permission result type for tool calls
 */
export type PermissionResult = {
    behavior: 'allow'
    updatedInput: Record<string, unknown>
} | {
    behavior: 'deny'
    message: string
}

/**
 * Callback function for tool permission checks
 */
export interface CanCallToolCallback {
    (toolName: string, input: unknown, options: { signal: AbortSignal }): Promise<PermissionResult>
}

/**
 * Query options
 */
export interface QueryOptions {
    abort?: AbortSignal
    allowedTools?: string[]
    appendSystemPrompt?: string
    customSystemPrompt?: string
    cwd?: string
    disallowedTools?: string[]
    executable?: string
    executableArgs?: string[]
    maxTurns?: number
    mcpServers?: Record<string, unknown>
    pathToClaudeCodeExecutable?: string
    permissionMode?: 'default' | 'acceptEdits' | 'auto' | 'bypassPermissions' | 'plan'
    continue?: boolean
    resume?: string
    forkSession?: boolean
    model?: string
    effort?: string
    fallbackModel?: string
    strictMcpConfig?: boolean
    canCallTool?: CanCallToolCallback
    /** Path to a settings JSON file to pass to Claude via --settings */
    settingsPath?: string
}

/**
 * Query prompt types
 */
export type QueryPrompt = string | AsyncIterable<SDKMessage>

/**
 * Control response handlers
 */
export type ControlResponseHandler = (response: SDKControlResponse['response']) => void

/**
 * Error types
 */
export class AbortError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'AbortError'
    }
}
