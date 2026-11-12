// The minimap landmarks a sender marks a record with, in the clear beside its ciphertext, so a
// reader can ask the server for just the rows the conversation rail draws marks for instead of
// downloading and decrypting the whole history.

import { userPromptText } from './userPrompt';

export const messageLandmarks = ['prompt', 'question', 'question-answer', 'preview', 'preview-answer'] as const;
export type MessageLandmark = typeof messageLandmarks[number];

const ASK_USER_QUESTION_TOOL = 'AskUserQuestion';
const PREVIEW_HTML_TOOL = 'preview_html';

/** `preview_html` in every spelling an agent produces it under (`mcp__happy__preview_html`, …). */
function normalizeToolName(name: string): string {
    return name.replace(/__/g, ':').replace(/^mcp:/, '').replace(/^happy:/, '');
}

function landmarkOfCall(name: string): MessageLandmark | null {
    if (name === ASK_USER_QUESTION_TOOL) return 'question';
    return normalizeToolName(name) === PREVIEW_HTML_TOOL ? 'preview' : null;
}

function landmarkOfResult(name: string): MessageLandmark | null {
    if (name === ASK_USER_QUESTION_TOOL) return 'question-answer';
    return normalizeToolName(name) === PREVIEW_HTML_TOOL ? 'preview-answer' : null;
}

type RecordShape = { role?: unknown; content?: any; meta?: any } | null;

/**
 * The landmark a record is, or null for the rest of the conversation.
 *
 * A call is the landmark the rail marks; its result is marked too (`question-answer`,
 * `preview-answer`) because a preview only becomes a card once its call has a result and a
 * question's answers live there. A result carries no tool name, so `toolNames` — the sender's
 * map of call id to tool name, which this fills as it sees calls — is what tells them apart.
 */
export function messageLandmark(record: unknown, toolNames: Map<string, string> = new Map()): MessageLandmark | null {
    const message = record as RecordShape;
    if (!message || typeof message !== 'object') return null;

    if (message.role === 'user') {
        if (message.meta?.isCompactSummary === true) return null;
        const content = message.content;
        if (content?.type !== 'text' && content?.type !== 'mixed') return null;
        return typeof content.text === 'string' && userPromptText(content.text) !== null ? 'prompt' : null;
    }

    if (message.role === 'session') return envelopeLandmark(message.content?.data, toolNames);
    if (message.role !== 'agent') return null;

    const { type, data } = message.content ?? {};
    if (type === 'output') {
        if (data?.isSidechain === true) return null;
        const blocks: any[] = Array.isArray(data?.message?.content) ? data.message.content : [];
        let result: MessageLandmark | null = null;
        for (const block of blocks) {
            if (block?.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string') {
                toolNames.set(block.id, block.name);
                result = result ?? landmarkOfCall(block.name);
            } else if (block?.type === 'tool_result' && typeof block.tool_use_id === 'string') {
                const name = toolNames.get(block.tool_use_id);
                if (name !== undefined) result = result ?? landmarkOfResult(name);
            }
        }
        return result;
    }
    if (type === 'acp' || type === 'codex') {
        if (data?.type === 'tool-call') {
            const id = typeof data.callId === 'string' ? data.callId : data.id;
            if (typeof id === 'string' && typeof data.name === 'string') toolNames.set(id, data.name);
            return typeof data.name === 'string' ? landmarkOfCall(data.name) : null;
        }
        if (data?.type === 'tool-result' || data?.type === 'tool-call-result') {
            const id = typeof data.callId === 'string' ? data.callId : data.tool_use_id;
            const name = typeof id === 'string' ? toolNames.get(id) : undefined;
            return name !== undefined ? landmarkOfResult(name) : null;
        }
        return null;
    }
    if (type === 'session') return envelopeLandmark(data, toolNames);

    return null;
}

function envelopeLandmark(envelope: any, toolNames: Map<string, string>): MessageLandmark | null {
    if (!envelope || typeof envelope !== 'object' || envelope.subagent) return null;
    const event = envelope.ev;
    if (!event || typeof event !== 'object') return null;
    if (event.t === 'text') {
        if (envelope.role !== 'user' || event.thinking === true) return null;
        return typeof event.text === 'string' && userPromptText(event.text) !== null ? 'prompt' : null;
    }
    if (event.t === 'tool-call-start') {
        if (typeof event.call === 'string' && typeof event.name === 'string') toolNames.set(event.call, event.name);
        return typeof event.name === 'string' ? landmarkOfCall(event.name) : null;
    }
    if (event.t === 'tool-call-end' && typeof event.call === 'string') {
        const name = toolNames.get(event.call);
        return name !== undefined ? landmarkOfResult(name) : null;
    }
    return null;
}
