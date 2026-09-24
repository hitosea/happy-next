/**
 * Happy MCP server
 * Provides Happy CLI specific tools including chat session title management
 *
 * Supports multiple sessions to handle mode switching (local <-> remote)
 * where each mode spawns a new Claude Code process that needs to connect.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { AddressInfo } from "node:net";
import { z } from "zod";
import { logger } from "@/ui/logger";
import { ApiSessionClient } from "@/api/apiSession";
import { randomUUID } from "node:crypto";
import { shouldEnableOrchestratorTools } from '@/orchestrator/prompt';
import { applyDefaultWorkingDirectory } from '@/orchestrator/common';
import {
    ORCHESTRATOR_CANCEL_TOOL_SCHEMA,
    ORCHESTRATOR_GET_CONTEXT_TOOL_SCHEMA,
    ORCHESTRATOR_LIST_TOOL_SCHEMA,
    ORCHESTRATOR_PEND_TOOL_SCHEMA,
    ORCHESTRATOR_SEND_MESSAGE_TOOL_SCHEMA,
    ORCHESTRATOR_SUBMIT_TOOL_SCHEMA,
} from '@/orchestrator/mcpToolSchemas';
import { AGENT_FLAVORS, MODEL_MODES_BY_PROVIDER } from 'happy-wire';
import { readPreviewHtmlFile } from '@/utils/previewHtmlFile';

function toToolSuccess(data: unknown) {
    return {
        content: [
            {
                type: 'text' as const,
                text: JSON.stringify(data, null, 2),
            },
        ],
        isError: false,
    };
}

function toToolError(message: string, details?: unknown) {
    return {
        content: [
            {
                type: 'text' as const,
                text: JSON.stringify({
                    ok: false,
                    error: message,
                    ...(details !== undefined ? { details } : {}),
                }, null, 2),
            },
        ],
        isError: true,
    };
}

// Factory function to create MCP server with tools
function createMcpServer(client: ApiSessionClient, options: { enableHappyTools: boolean; enableOrchestratorTools: boolean }): McpServer {
    const mcp = new McpServer({
        name: "Happy MCP",
        version: "1.0.0",
    });

    if (!options.enableHappyTools) {
        return mcp;
    }

    // Handler that sends title updates via the client
    const handler = async (title: string) => {
        logger.debug('[happyMCP] Changing title to:', title);
        if (client.isTitlePinned) {
            return { success: false, error: 'Title is pinned by user and cannot be changed automatically' };
        }
        try {
            client.sendClaudeSessionMessage({
                type: 'summary',
                summary: title,
                leafUuid: randomUUID()
            });
            return { success: true };
        } catch (error) {
            return { success: false, error: String(error) };
        }
    };

    mcp.registerTool('change_title', {
        description: 'Change the title of the current chat session',
        title: 'Change Chat Title',
        inputSchema: {
            title: z.string().describe('The new title for the chat session'),
        },
    }, async (args) => {
        const response = await handler(args.title);
        logger.debug('[happyMCP] Response:', response);

        if (response.success) {
            return {
                content: [
                    {
                        type: 'text',
                        text: `Successfully changed chat title to: "${args.title}"`,
                    },
                ],
                isError: false,
            };
        } else {
            return {
                content: [
                    {
                        type: 'text',
                        text: `Failed to change chat title: ${response.error || 'Unknown error'}`,
                    },
                ],
                isError: true,
            };
        }
    });

    mcp.registerTool('preview_html', {
        description: 'Preview an HTML page in the client app. Pass the document inline as `html`, or pass `filePath` to preview a local .html file you just generated. The document must be complete and self-contained, with all CSS and JS inlined.',
        title: 'Preview HTML',
        inputSchema: {
            html: z.string().optional().describe('Complete self-contained HTML document string'),
            filePath: z.string().optional().describe('Path to a local .html file to preview. Read by the CLI, so relative paths resolve against the session working directory'),
            title: z.string().optional().describe('Display title for the preview'),
        },
    }, async (args) => {
        logger.debug('[happyMCP] Preview HTML:', args.title || args.filePath || 'Untitled');

        const html = typeof args.html === 'string' && args.html.length > 0 ? args.html : null;
        const filePath = typeof args.filePath === 'string' && args.filePath.length > 0 ? args.filePath : null;

        if (html === null && filePath === null) {
            return {
                content: [{
                    type: 'text',
                    text: 'Failed to preview HTML: pass either `html` or `filePath`.',
                }],
                isError: true,
            };
        }

        // Validate the file up front so the agent hears about a bad path now, rather than the
        // preview silently rendering nothing when the tool call reaches the app.
        if (html === null && filePath !== null) {
            const file = readPreviewHtmlFile(filePath);
            if (!file.ok) {
                return {
                    content: [{
                        type: 'text',
                        text: `Failed to preview HTML: cannot read '${filePath}' — ${file.error}.`,
                    }],
                    isError: true,
                };
            }
        }

        return {
            content: [{
                type: 'text',
                text: `HTML preview ready: ${args.title || 'Untitled'}`,
            }],
            isError: false,
        };
    });

    if (options.enableOrchestratorTools) {
        mcp.registerTool('orchestrator_get_context', ORCHESTRATOR_GET_CONTEXT_TOOL_SCHEMA, async () => {
            try {
                const metadata = client.getMetadataSnapshot();
                const fallback = {
                    controllerSessionId: client.sessionId,
                    machineId: metadata?.machineId ?? null,
                    workingDirectory: metadata?.path ?? null,
                    defaults: {
                        mode: 'async',
                        maxConcurrency: 2,
                        retryMaxAttempts: 1,
                        retryBackoffMs: 0,
                    },
                    providers: [...AGENT_FLAVORS],
                    modelModes: MODEL_MODES_BY_PROVIDER,
                    machines: [],
                };
                try {
                    const response = await client.orchestratorGetContext();
                    const data = response?.data ?? null;
                    if (data) {
                        const machines = data.machines ?? [];
                        const currentMachine = machines.find((m: any) => m.machineId === metadata?.machineId);
                        return toToolSuccess({
                            ok: true,
                            data: {
                                ...fallback,
                                defaults: data.defaults ?? fallback.defaults,
                                providers: currentMachine?.providers ?? data.providers ?? fallback.providers,
                                modelModes: currentMachine?.modelModes ?? data.modelModes ?? fallback.modelModes,
                                machines,
                            },
                        });
                    }
                } catch (_error) {
                    // fallback to local-only context for backward compatibility
                }
                return toToolSuccess({
                    ok: true,
                    data: fallback,
                });
            } catch (error) {
                return toToolError('Failed to load orchestrator context', error instanceof Error ? error.message : String(error));
            }
        });

        mcp.registerTool('orchestrator_submit', ORCHESTRATOR_SUBMIT_TOOL_SCHEMA, async (args) => {
            try {
                const metadata = client.getMetadataSnapshot();
                const submitBody = {
                    title: args.title,
                    controllerSessionId: args.controllerSessionId ?? client.sessionId,
                    controllerMachineId: metadata?.machineId ?? undefined,
                    tasks: applyDefaultWorkingDirectory(args.tasks, metadata?.path, metadata?.machineId),
                    maxConcurrency: args.maxConcurrency,
                    idempotencyKey: args.idempotencyKey,
                    metadata: args.metadata,
                    mode: 'async' as const,
                };

                const submit = await client.orchestratorSubmit(submitBody);
                return toToolSuccess({
                    ok: true,
                    mode: 'async',
                    data: submit?.data ?? null,
                });
            } catch (error) {
                return toToolError('Failed to submit orchestrator run', error instanceof Error ? error.message : String(error));
            }
        });

        mcp.registerTool('orchestrator_pend', ORCHESTRATOR_PEND_TOOL_SCHEMA, async (args) => {
            const startedAt = Date.now();
            const totalTimeoutMs = args.timeoutMs ?? 10 * 60 * 1000;
            let cursor = args.cursor;
            while (true) {
                const elapsed = Date.now() - startedAt;
                const remaining = totalTimeoutMs - elapsed;
                if (remaining <= 0) break;

                try {
                    const response = await client.orchestratorPend(args.runId, {
                        cursor,
                        waitFor: args.waitFor,
                        timeoutMs: Math.min(remaining, 60_000),
                        include: args.include,
                    });
                    return toToolSuccess(response);
                } catch (error: any) {
                    const status = error?.response?.status;
                    if (status === 504 && remaining > 1000) {
                        cursor = undefined; // Reset cursor on 504 and retry
                        continue;
                    }
                    return toToolError('Failed to pend orchestrator run', error instanceof Error ? error.message : String(error));
                }
            }

            // Timeout exhausted — do a final non-blocking fetch
            try {
                const response = await client.orchestratorPend(args.runId, {
                    cursor,
                    waitFor: args.waitFor,
                    timeoutMs: 0,
                    include: args.include,
                });
                return toToolSuccess(response);
            } catch (error) {
                return toToolError('Failed to pend orchestrator run', error instanceof Error ? error.message : String(error));
            }
        });

        mcp.registerTool('orchestrator_list', ORCHESTRATOR_LIST_TOOL_SCHEMA, async (args) => {
            try {
                const response = await client.orchestratorListRuns({
                    status: args.status,
                    limit: args.limit,
                    cursor: args.cursor,
                });
                return toToolSuccess(response);
            } catch (error) {
                return toToolError('Failed to list orchestrator runs', error instanceof Error ? error.message : String(error));
            }
        });

        mcp.registerTool('orchestrator_cancel', ORCHESTRATOR_CANCEL_TOOL_SCHEMA, async (args) => {
            try {
                const response = await client.orchestratorCancel(args.runId, { reason: args.reason });
                return toToolSuccess(response);
            } catch (error) {
                return toToolError('Failed to cancel orchestrator run', error instanceof Error ? error.message : String(error));
            }
        });

        mcp.registerTool('orchestrator_send_message', ORCHESTRATOR_SEND_MESSAGE_TOOL_SCHEMA, async (args) => {
            try {
                const response = await client.orchestratorSendMessage({
                    taskId: args.taskId,
                    message: args.message,
                });
                return toToolSuccess(response);
            } catch (error) {
                return toToolError('Failed to send message to orchestrator task', error instanceof Error ? error.message : String(error));
            }
        });
    }

    return mcp;
}

export async function startHappyServer(client: ApiSessionClient) {
    // Store transports by session ID to support multiple Claude Code connections
    // This is needed when switching between local and remote modes, as each mode
    // spawns a new Claude Code process that needs its own MCP session
    const transports: Map<string, StreamableHTTPServerTransport> = new Map();
    const enableHappyTools = shouldEnableOrchestratorTools();
    const enableOrchestratorTools = enableHappyTools;
    const toolNames = enableHappyTools
        ? ['change_title', 'preview_html', 'orchestrator_get_context', 'orchestrator_submit', 'orchestrator_pend', 'orchestrator_list', 'orchestrator_cancel', 'orchestrator_send_message']
        : [];

    // Capture console.error from Hono to our logger
    const originalConsoleError = console.error;
    console.error = (...args: any[]) => {
        logger.debug("[happyMCP] console.error:", ...args);
        originalConsoleError.apply(console, args);
    };

    //
    // Create the HTTP server with multi-session support
    //
    const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
        const sessionId = req.headers['mcp-session-id'] as string | undefined;
        logger.debug("[happyMCP] Received request:", req.method, req.url, "sessionId:", sessionId);

        try {
            // For POST requests, we need to read the body to check if it's an initialize request
            if (req.method === 'POST') {
                const body = await readRequestBody(req);
                const parsedBody = JSON.parse(body);

                let transport: StreamableHTTPServerTransport;

                if (sessionId && transports.has(sessionId)) {
                    // Reuse existing transport for this session
                    transport = transports.get(sessionId)!;
                    logger.debug("[happyMCP] Reusing transport for session:", sessionId);
                } else if (!sessionId && isInitializeRequest(parsedBody)) {
                    // New initialization request - create new transport and MCP server
                    logger.debug("[happyMCP] New initialize request, creating transport");

                    transport = new StreamableHTTPServerTransport({
                        sessionIdGenerator: () => randomUUID(),
                        onsessioninitialized: (newSessionId: string) => {
                            logger.debug("[happyMCP] Session initialized:", newSessionId);
                            transports.set(newSessionId, transport);
                        }
                    });

                    // Set up cleanup when transport closes
                    transport.onclose = () => {
                        const sid = transport.sessionId;
                        if (sid && transports.has(sid)) {
                            logger.debug("[happyMCP] Transport closed, removing session:", sid);
                            transports.delete(sid);
                        }
                    };

                    transport.onerror = (error: Error) => {
                        logger.debug("[happyMCP] Transport error:", error);
                    };

                    // Create and connect MCP server to this transport
                    const mcp = createMcpServer(client, { enableHappyTools, enableOrchestratorTools });
                    await mcp.connect(transport);

                    // Handle the request with the parsed body
                    await transport.handleRequest(req, res, parsedBody);
                    logger.debug("[happyMCP] Initialize request handled successfully");
                    return;
                } else {
                    // Invalid request - no session ID and not an initialize request
                    logger.debug("[happyMCP] Bad request: no session ID and not initialize");
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        jsonrpc: '2.0',
                        error: {
                            code: -32000,
                            message: 'Bad Request: No valid session ID provided'
                        },
                        id: null
                    }));
                    return;
                }

                // Handle the request with existing transport
                await transport.handleRequest(req, res, parsedBody);
                logger.debug("[happyMCP] Request handled successfully");
            } else if (req.method === 'GET' || req.method === 'DELETE') {
                // GET (SSE) and DELETE requests require a session ID
                if (!sessionId || !transports.has(sessionId)) {
                    logger.debug("[happyMCP] Bad request: invalid session for GET/DELETE");
                    res.writeHead(400, { 'Content-Type': 'text/plain' });
                    res.end('Invalid or missing session ID');
                    return;
                }

                const transport = transports.get(sessionId)!;
                await transport.handleRequest(req, res);
                logger.debug("[happyMCP] GET/DELETE request handled successfully");
            } else {
                res.writeHead(405, { 'Content-Type': 'text/plain' });
                res.end('Method not allowed');
            }
        } catch (error) {
            logger.debug("[happyMCP] Error handling request:", error);
            if (!res.headersSent) {
                res.writeHead(500).end();
            }
        }
    });

    const baseUrl = await new Promise<URL>((resolve) => {
        server.listen(0, "127.0.0.1", () => {
            const addr = server.address() as AddressInfo;
            resolve(new URL(`http://127.0.0.1:${addr.port}`));
        });
    });

    logger.debug("[happyMCP] Server started at:", baseUrl.toString());

    return {
        url: baseUrl.toString(),
        toolNames,
        stop: async () => {
            logger.debug('[happyMCP] Stopping server');
            // Close all active transports
            for (const [sessionId, transport] of transports) {
                logger.debug('[happyMCP] Closing transport for session:', sessionId);
                try {
                    await transport.close();
                } catch (error) {
                    logger.debug('[happyMCP] Error closing transport:', error);
                }
            }
            transports.clear();
            server.close();
        }
    }
}

// Helper function to read request body
function readRequestBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => resolve(body));
        req.on('error', reject);
    });
}
