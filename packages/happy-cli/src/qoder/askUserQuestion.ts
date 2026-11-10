/**
 * Qoder's AskUserQuestion in Happy.
 *
 * qodercli offers AskUserQuestion only to ACP clients that declare `elicitation.form`.
 * A call shows up twice: as a tool call (kind `other`, `_meta.qoder.toolName`
 * "AskUserQuestion", the usual `{ questions }` input), then as an `elicitation/create`
 * request with the same toolCallId, one form field per question: `q<i>`, a string for a
 * single choice and an array for a multiple one. qodercli joins an array with ", " and
 * takes any string, so an answer typed under "Other" goes through as it is.
 *
 * The app's question card answers by question text, a multiple choice joined with ", ".
 */

import type { AcpElicitationField, AcpElicitationRequest, AcpElicitationResponse } from '@/agent/acp/AcpBackend';

export const QODER_ASK_USER_QUESTION = 'AskUserQuestion';

export interface QoderQuestion {
    question: string;
    header: string;
    options: { label: string; description: string }[];
    multiSelect: boolean;
}

/** The form field holding the answer to question `index`. */
const fieldKey = (index: number) => `q${index}`;

/** The questions of a tool call's input, or null when it has none. */
export function qoderQuestionsFromInput(input: unknown): QoderQuestion[] | null {
    const questions = (input as { questions?: unknown } | null | undefined)?.questions;
    if (!Array.isArray(questions) || questions.length === 0) return null;
    return questions.map((raw) => {
        const q = (raw ?? {}) as Record<string, unknown>;
        const options = Array.isArray(q.options) ? q.options : [];
        return {
            question: String(q.question ?? ''),
            header: String(q.header ?? ''),
            options: options.map((option) => ({
                label: String((option as { label?: unknown })?.label ?? ''),
                description: String((option as { description?: unknown })?.description ?? ''),
            })),
            multiSelect: q.multiSelect === true,
        };
    });
}

/**
 * The questions rebuilt from the form, for a request whose tool call was not seen.
 * qodercli describes each field as the question followed by one "label: description"
 * line per option.
 */
export function qoderQuestionsFromSchema(request: AcpElicitationRequest): QoderQuestion[] {
    const properties = request.requestedSchema?.properties ?? {};
    const questions: QoderQuestion[] = [];
    for (let index = 0; properties[fieldKey(index)]; index++) {
        const field: AcpElicitationField = properties[fieldKey(index)];
        const multiSelect = field.type === 'array';
        const choices = (multiSelect ? field.items?.anyOf : field.oneOf) ?? [];
        const lines = (field.description ?? '').split('\n');
        const optionLines = lines.slice(-choices.length || lines.length);
        const question = choices.length ? lines.slice(0, lines.length - choices.length).join('\n') : field.description ?? '';
        questions.push({
            question: question || field.title || '',
            header: field.title ?? '',
            options: choices.map((choice, i) => {
                const prefix = `${choice.const}: `;
                return { label: choice.const, description: optionLines[i]?.startsWith(prefix) ? optionLines[i].slice(prefix.length) : '' };
            }),
            multiSelect,
        });
    }
    return questions;
}

/** The form answer qodercli reads, from the app's answers keyed by question text. */
export function qoderElicitationAnswer(questions: QoderQuestion[], answers: Record<string, string>): AcpElicitationResponse {
    const content: Record<string, string | string[]> = {};
    questions.forEach((question, index) => {
        const answer = (answers[question.question] ?? '').trim();
        content[fieldKey(index)] = question.multiSelect ? answer.split(', ').map((part) => part.trim()).filter(Boolean) : answer;
    });
    return { action: 'accept', content };
}
