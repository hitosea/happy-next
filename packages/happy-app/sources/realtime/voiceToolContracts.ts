import { z } from 'zod';

export const VOICE_PERMISSION_MODES_BY_AGENT = {
    claude: ['default', 'acceptEdits', 'plan', 'auto', 'bypassPermissions'],
    codex: ['default', 'read-only', 'on-failure', 'full-auto'],
    gemini: ['default', 'auto_edit', 'plan', 'yolo'],
    qoder: ['default', 'acceptEdits', 'auto', 'dontAsk', 'yolo'],
} as const;

export type VoicePermissionAgent = keyof typeof VOICE_PERMISSION_MODES_BY_AGENT;
export type VoicePermissionMode = typeof VOICE_PERMISSION_MODES_BY_AGENT[VoicePermissionAgent][number];

export function resolveVoicePermissionAgent(flavor: string | null | undefined): VoicePermissionAgent {
    if (flavor === 'codex' || flavor === 'gemini' || flavor === 'qoder') return flavor;
    return 'claude';
}

export function getVoicePermissionModesForAgent(agent: VoicePermissionAgent): readonly string[] {
    return VOICE_PERMISSION_MODES_BY_AGENT[agent];
}

export function isVoicePermissionModeForAgent(agent: VoicePermissionAgent, mode: string): mode is VoicePermissionMode {
    return getVoicePermissionModesForAgent(agent).includes(mode);
}

export const messageHappyCodeParametersSchema = z.object({
    message: z.string().min(1, 'Message cannot be empty'),
});

export const processPermissionRequestParametersSchema = z.object({
    decision: z.enum(['allow', 'deny']),
});

export const listSessionsParametersSchema = z.object({
    includeOffline: z.boolean().optional(),
});

export const switchSessionParametersSchema = z.object({
    sessionId: z.string().min(1).optional(),
});

export const changeSessionSettingsParametersSchema = z.object({
    mode: z.string(),
});

export const getLatestAssistantReplyParametersSchema = z.object({
    maxChars: z.number().int().positive().max(2000).optional(),
});

export const deleteSessionParametersSchema = z.object({
    sessionId: z.string().min(1).optional(),
});
