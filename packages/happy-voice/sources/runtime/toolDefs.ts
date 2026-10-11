/**
 * The 12 voice tools, in OpenAI/Ark `tools` format. The happy-server tool
 * bridge routes by name (voice-tool:<name>), so tool names and parameter
 * schemas must stay stable; descriptions are free to refine for the model.
 */

export interface OpenAiTool {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
    };
}

const emptyParams = {
    type: 'object' as const,
    properties: {},
    required: [] as string[],
    additionalProperties: false,
};

export const TOOL_DEFINITIONS: OpenAiTool[] = [
    {
        type: 'function',
        function: {
            name: 'messageHappyCode',
            description:
                'Forward a message to the coding agent (Happy). Use for code/project tasks, or when the user explicitly asks to send something. For app operations — sessions, settings, navigation — use the dedicated tools instead.',
            parameters: {
                type: 'object',
                properties: {
                    message: { type: 'string', description: 'Message to forward to Happy' },
                },
                required: ['message'],
                additionalProperties: false,
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'processPermissionRequest',
            description: 'Allow or deny the pending permission request.',
            parameters: {
                type: 'object',
                properties: {
                    decision: { type: 'string', enum: ['allow', 'deny'] },
                },
                required: ['decision'],
                additionalProperties: false,
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'listSessions',
            description: 'List all coding sessions. Returns the full ordered list (with ids and names) as text and opens a session picker for the user. Use a returned id for a follow-up switchSession or deleteSessionTool call.',
            parameters: {
                type: 'object',
                properties: {
                    includeOffline: {
                        type: 'boolean',
                        description: 'Include offline sessions. Defaults to false.',
                    },
                },
                required: [],
                additionalProperties: false,
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'switchSession',
            description: 'Switch to a different coding session. Omit sessionId to let the user pick from a list; pass sessionId (from listSessions, or a session name) to switch directly.',
            parameters: {
                type: 'object',
                properties: {
                    sessionId: { type: 'string', description: 'Optional. Target session ID from listSessions, or session name. Omit to open the picker.' },
                },
                required: [],
                additionalProperties: false,
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'createSession',
            description: 'Create a new coding session. Directory and machine are chosen automatically from the active session, or the user\'s most recent path.',
            parameters: emptyParams,
        },
    },
    {
        type: 'function',
        function: {
            name: 'changeSessionSettings',
            description: 'Change the active session\'s permission mode.',
            parameters: {
                type: 'object',
                properties: {
                    mode: {
                        type: 'string',
                        description: 'Permission mode for the active session agent. Claude: default, acceptEdits, plan, auto, bypassPermissions. Codex: default, read-only, on-failure, full-auto. Gemini: default, auto_edit, plan, yolo. Qoder: default, acceptEdits, auto, dontAsk, yolo. On an invalid value the tool returns valid modes.',
                    },
                },
                required: ['mode'],
                additionalProperties: false,
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'getSessionStatus',
            description: 'Get current status from the active coding session.',
            parameters: emptyParams,
        },
    },
    {
        type: 'function',
        function: {
            name: 'getLatestAssistantReply',
            description:
                'Use when the user asks what Happy just replied. Returns the latest assistant text from the active coding session.',
            parameters: {
                type: 'object',
                properties: {
                    maxChars: {
                        type: 'integer',
                        minimum: 1,
                        maximum: 2000,
                        description: 'Max characters to return',
                    },
                },
                required: [],
                additionalProperties: false,
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'deleteSessionTool',
            description: 'Archive (delete) a coding session. Omit sessionId to let the user pick from a list; pass sessionId (from listSessions, or a session name) to archive it after a short confirmation.',
            parameters: {
                type: 'object',
                properties: {
                    sessionId: { type: 'string', description: 'Optional. Target session ID from listSessions or session name. Omit to open the picker.' },
                },
                required: [],
                additionalProperties: false,
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'navigateHome',
            description: 'Navigate to the home screen and leave the current conversation.',
            parameters: emptyParams,
        },
    },
    {
        type: 'function',
        function: {
            name: 'endVoiceConversation',
            description: 'End the current voice conversation.',
            parameters: emptyParams,
        },
    },
    {
        type: 'function',
        function: {
            name: 'cancelPendingAction',
            description: 'Cancel the pending voice confirmation or session picker. Use when the user says "cancel" / "stop" / "算了" while one is open.',
            parameters: emptyParams,
        },
    },
];

const VALID_TOOL_NAMES = new Set(TOOL_DEFINITIONS.map((t) => t.function.name));

export function isKnownTool(name: string): boolean {
    return VALID_TOOL_NAMES.has(name);
}
