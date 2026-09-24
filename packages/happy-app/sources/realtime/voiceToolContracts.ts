import { z } from 'zod';
import {
    AGENT_FLAVORS,
    PERMISSION_MODES_BY_AGENT,
    getPermissionModesForAgent,
    isPermissionModeForAgent,
    type AgentFlavor,
} from 'happy-wire';

/**
 * Voice tooling speaks about the same per-agent permission vocabulary as the rest of the
 * app, so it reads happy-wire's table rather than keeping a copy that has to be edited in
 * lockstep.
 */
export const VOICE_PERMISSION_MODES_BY_AGENT = PERMISSION_MODES_BY_AGENT;

export type VoicePermissionAgent = AgentFlavor;
export type VoicePermissionMode = typeof PERMISSION_MODES_BY_AGENT[VoicePermissionAgent][number];

export function resolveVoicePermissionAgent(flavor: string | null | undefined): VoicePermissionAgent {
    const match = AGENT_FLAVORS.find(candidate => candidate === flavor);
    return match ?? 'claude';
}

export function getVoicePermissionModesForAgent(agent: VoicePermissionAgent): readonly string[] {
    return getPermissionModesForAgent(agent);
}

export function isVoicePermissionModeForAgent(agent: VoicePermissionAgent, mode: string): mode is VoicePermissionMode {
    return isPermissionModeForAgent(agent, mode);
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
