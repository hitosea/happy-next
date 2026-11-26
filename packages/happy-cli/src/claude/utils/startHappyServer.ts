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
import { ORCHESTRATOR_PROVIDERS, applyDefaultWorkingDirectory, compactShellTasks } from '@/orchestrator/common';
import {
    ORCHESTRATOR_CANCEL_TOOL_SCHEMA,
    ORCHESTRATOR_EXEC_TOOL_SCHEMA,
    ORCHESTRATOR_TRANSFER_TOOL_SCHEMA,
    ORCHESTRATOR_GET_CONTEXT_TOOL_SCHEMA,
    ORCHESTRATOR_LIST_TOOL_SCHEMA,
    ORCHESTRATOR_PEND_TOOL_SCHEMA,
    ORCHESTRATOR_SEND_MESSAGE_TOOL_SCHEMA,
    ORCHESTRATOR_SUBMIT_TOOL_SCHEMA,
} from '@/orchestrator/mcpToolSchemas';
import { MODEL_MODE_DEFAULT } from 'happy-wire';
import { fillMachineModelModes } from '@/orchestrator/machineModelModes';
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

// The server's own explanation of a refused request (unknown machine, none online, ...) over axios' generic one
function describeRequestError(error: unknown) {
    return (error as any)?.response?.data ?? (error instanceof Error ? error.message : String(error));
}

/**
 * An exec or pend result as the tool returns it: only the task asked for, if one is, with the
 * shell output cut to what one result shows.
 */
function compactTasksResponse(response: any, taskId?: string) {
    const tasks: any[] | undefined = response?.data?.tasks;
    if (!tasks) {
        return response;
    }
    const compacted = compactShellTasks(taskId ? tasks.filter((task) => task.taskId === taskId) : tasks);
    return { ...response, data: { ...response.data, tasks: compacted } };
}

export interface InteractiveQuestionItem {
    question: string;
    header: string;
    options: Array<{ label: string; description: string }>;
    multiSelect: boolean;
}

export interface HappyServerInteractiveTools {
    /** Called when an MCP-backed agent asks the user structured questions (rendered via AskUserQuestionView). */
    askUserQuestion?: (input: { questions: InteractiveQuestionItem[] }) => Promise<{ answers: Record<string, string> } | { cancelled: true }>;
    /** Called when an MCP-backed agent submits a finished Markdown plan for approval (rendered via ExitPlanToolView). */
    exitPlanMode?: (input: { plan: string }) => Promise<{ approved: boolean; feedback?: string }>;
}

export interface HappyServerOptions {
    interactiveTools?: HappyServerInteractiveTools;
}

// Factory function to create MCP server with tools
function createMcpServer(
    client: ApiSessionClient,
    options: {
        enableHappyTools: boolean;
        enableOrchestratorTools: boolean;
        interactiveTools?: HappyServerInteractiveTools;
    },
): McpServer {
    const mcp = new McpServer({
        name: "Happy MCP",
        version: "1.0.0",
    });

    if (options.enableHappyTools) {
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
        description: 'Preview an HTML page in the client app. Prefer writing the page to a .html file and passing `filePath`; use `html` only for short snippets. The document must be self-contained, with all CSS and JS inlined.',
        title: 'Preview HTML',
        inputSchema: {
            html: z.string().optional().describe('Inline HTML document; prefer `filePath`'),
            filePath: z.string().optional().describe('Preferred. Absolute path to a local .html file'),
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
        /**
         * A tool result showing a run ended with every one of its tasks tells the agent all its
         * callback would, so that callback is settled — unless the call was aborted and the agent
         * never sees the result.
         */
        const settleShownRun = (result: any, signal: AbortSignal) => {
            const data = result?.data;
            const shown = data?.terminal === true && !signal.aborted && data.tasks?.length === data.run?.summary?.total;
            if (shown) {
                void client.orchestratorCallbacksAck([{ runId: data.runId, knownAt: data.run.updatedAt }]);
            }
        };

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
                    providers: ORCHESTRATOR_PROVIDERS,
                    // What each provider offers comes from the machines' CLIs (fillMachineModelModes)
                    modelModes: Object.fromEntries(ORCHESTRATOR_PROVIDERS.map((provider) => [provider, [MODEL_MODE_DEFAULT]])),
                    machines: [],
                };
                try {
                    const response = await client.orchestratorGetContext();
                    const data = response?.data ?? null;
                    if (data) {
                        const machines = await fillMachineModelModes(
                            data.machines ?? [],
                            (method, params, timeoutMs) => client.callMachineRpc(method, params, timeoutMs),
                        );
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

        mcp.registerTool('orchestrator_exec', ORCHESTRATOR_EXEC_TOOL_SCHEMA, async (args, extra) => {
            const machineIds = args.allOnline ? 'all_online' as const : args.machineIds;
            if (!machineIds) {
                return toToolError('Pass machineIds, or allOnline: true');
            }
            try {
                const response = await client.orchestratorExec({
                    command: args.command,
                    machineIds,
                    workingDirectory: args.workingDirectory,
                    timeoutMs: args.timeoutMs,
                    waitMs: args.waitMs,
                    maxConcurrency: args.maxConcurrency,
                    title: args.title,
                    controllerSessionId: client.sessionId,
                });
                const result = compactTasksResponse(response);
                settleShownRun(result, extra.signal);
                return toToolSuccess(result);
            } catch (error) {
                return toToolError('Failed to run the command', describeRequestError(error));
            }
        });

        mcp.registerTool('orchestrator_transfer', ORCHESTRATOR_TRANSFER_TOOL_SCHEMA, async (args, extra) => {
            const toMachineIds = args.allOnline ? 'all_online' as const : args.toMachineIds;
            if (!toMachineIds) {
                return toToolError('Pass toMachineIds, or allOnline: true');
            }
            // "current": the machine this session runs on
            const currentMachineId = client.getMetadataSnapshot()?.machineId;
            if (!currentMachineId && [args.fromMachineId, ...(args.toMachineIds ?? [])].includes('current')) {
                return toToolError('This session does not know its machine, so "current" cannot be used; pass machine IDs from orchestrator_get_context');
            }
            const resolveMachineId = (machineId: string) => machineId === 'current' ? currentMachineId! : machineId;
            try {
                const response = await client.orchestratorTransfer({
                    from: { machineId: resolveMachineId(args.fromMachineId), path: args.fromPath },
                    to: { machineIds: toMachineIds === 'all_online' ? toMachineIds : toMachineIds.map(resolveMachineId), path: args.toPath },
                    overwrite: args.overwrite,
                    timeoutMs: args.timeoutMs,
                    waitMs: args.waitMs,
                    title: args.title,
                    controllerSessionId: client.sessionId,
                });
                settleShownRun(response, extra.signal);
                return toToolSuccess(response);
            } catch (error) {
                return toToolError('Failed to transfer', describeRequestError(error));
            }
        });

        mcp.registerTool('orchestrator_pend', ORCHESTRATOR_PEND_TOOL_SCHEMA, async (args, extra) => {
            try {
                const { cursor: _cursor, changed: _changed, ...data } = (await client.orchestratorPend(args.runId)).data;
                const result = compactTasksResponse({
                    ok: true,
                    data: {
                        ...data,
                        next: data.terminal ? undefined : { hint: 'Not finished. End your turn and await <orchestrator-callback>; do not poll.', runId: args.runId },
                    },
                }, args.taskId);
                settleShownRun(result, extra.signal);
                return toToolSuccess(result);
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
                    controllerSessionId: args.controllerSessionId ?? client.sessionId,
                });
                return toToolSuccess(response);
            } catch (error) {
                return toToolError('Failed to send message to orchestrator task', error instanceof Error ? error.message : String(error));
            }
        });
    }
    }

    if (options.interactiveTools?.askUserQuestion) {
        const askHandler = options.interactiveTools.askUserQuestion;
        mcp.registerTool('ask_user_question', {
            description: 'Ask the user one or more structured multiple-choice questions to clarify requirements or gather decisions, and wait for their answers.',
            title: 'Ask User Question',
            inputSchema: {
                questions: z.array(z.object({
                    question: z.string().describe('The clear, specific question to ask the user'),
                    header: z.string().describe('Short label (max 12 chars) shown as a header chip'),
                    options: z.array(z.object({
                        label: z.string().describe('Concise option label'),
                        description: z.string().describe('Explanation of what this option means'),
                    })).min(2).describe('Available choices (the UI automatically adds an Other option)'),
                    multiSelect: z.boolean().default(false).describe('Whether the user may select multiple options'),
                })).min(1).describe('Questions to present to the user'),
            },
        }, async (args) => {
            try {
                const result = await askHandler({ questions: args.questions });
                if ('cancelled' in result) {
                    return toToolError('The user cancelled or dismissed the question');
                }
                return toToolSuccess(result);
            } catch (error) {
                return toToolError('Failed to collect user answers', error instanceof Error ? error.message : String(error));
            }
        });
    }

    if (options.interactiveTools?.exitPlanMode) {
        const exitPlanHandler = options.interactiveTools.exitPlanMode;
        mcp.registerTool('exit_plan_mode', {
            description: 'Submit the completed implementation plan in Markdown for user review and approval before making changes.',
            title: 'Exit Plan Mode',
            inputSchema: {
                plan: z.string().describe('The complete implementation plan in Markdown, starting with a # title'),
            },
        }, async (args) => {
            try {
                const result = await exitPlanHandler({ plan: args.plan });
                if (!result.approved) {
                    return toToolError(result.feedback || 'The user rejected the plan and wants revisions. Remain in plan mode and update the plan.');
                }
                return toToolSuccess({ approved: true, message: 'Plan approved by user. You may now proceed with implementation.' });
            } catch (error) {
                return toToolError('Plan approval was cancelled', error instanceof Error ? error.message : String(error));
            }
        });
    }

    return mcp;
}

export async function startHappyServer(client: ApiSessionClient, serverOptions?: HappyServerOptions) {
    // Store transports by session ID to support multiple Claude Code connections
    // This is needed when switching between local and remote modes, as each mode
    // spawns a new Claude Code process that needs its own MCP session
    const transports: Map<string, StreamableHTTPServerTransport> = new Map();
    const enableHappyTools = shouldEnableOrchestratorTools();
    const enableOrchestratorTools = enableHappyTools;
    const interactiveToolNames = [
        ...(serverOptions?.interactiveTools?.askUserQuestion ? ['ask_user_question'] : []),
        ...(serverOptions?.interactiveTools?.exitPlanMode ? ['exit_plan_mode'] : []),
    ];
    const toolNames = [
        ...(enableHappyTools
            ? ['change_title', 'preview_html', 'orchestrator_get_context', 'orchestrator_submit', 'orchestrator_exec', 'orchestrator_transfer', 'orchestrator_pend', 'orchestrator_list', 'orchestrator_cancel', 'orchestrator_send_message']
            : []),
        ...interactiveToolNames,
    ];

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
                    const mcp = createMcpServer(client, {
                        enableHappyTools,
                        enableOrchestratorTools,
                        interactiveTools: serverOptions?.interactiveTools,
                    });
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
