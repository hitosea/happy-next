import { describe, expect, it } from 'vitest';
import { qoderElicitationAnswer, qoderQuestionsFromInput, qoderQuestionsFromSchema } from './askUserQuestion';

// As qodercli 1.1.86 sends them over ACP.
const input = {
    description: 'Ask user',
    questions: [
        {
            header: 'Fruit',
            multiSelect: false,
            question: 'Which fruit would you like?',
            options: [
                { label: 'Apple', description: 'A crisp, sweet red fruit.' },
                { label: 'Banana', description: 'A curved, yellow fruit.' },
            ],
        },
        {
            header: 'Colors',
            multiSelect: true,
            question: 'Which colors do you like?',
            options: [
                { label: 'Red', description: 'Fire trucks.' },
                { label: 'Blue', description: 'The sky.' },
                { label: 'Green', description: 'Grass.' },
            ],
        },
    ],
};

const request = {
    mode: 'form' as const,
    sessionId: 's1',
    toolCallId: 'call_1',
    message: 'Answer Questions',
    requestedSchema: {
        type: 'object' as const,
        title: 'Answer Questions',
        properties: {
            q0: {
                type: 'string',
                title: 'Fruit',
                description: 'Which fruit would you like?\nApple: A crisp, sweet red fruit.\nBanana: A curved, yellow fruit.',
                oneOf: [{ const: 'Apple', title: 'Apple' }, { const: 'Banana', title: 'Banana' }],
            },
            q1: {
                type: 'array',
                title: 'Colors',
                description: 'Which colors do you like?\nRed: Fire trucks.\nBlue: The sky.\nGreen: Grass.',
                items: { anyOf: [{ const: 'Red', title: 'Red' }, { const: 'Blue', title: 'Blue' }, { const: 'Green', title: 'Green' }] },
            },
        },
        required: ['q0', 'q1'],
    },
};

describe('Qoder AskUserQuestion', () => {
    it('reads the questions of a tool call', () => {
        const questions = qoderQuestionsFromInput(input);
        expect(questions).toEqual(input.questions.map(({ header, multiSelect, question, options }) => ({ header, multiSelect, question, options })));
        expect(qoderQuestionsFromInput({ description: 'Ask user' })).toBeNull();
    });

    it('rebuilds the same questions from the elicitation form', () => {
        expect(qoderQuestionsFromSchema(request)).toEqual(qoderQuestionsFromInput(input));
    });

    it('answers the form from the answers the app gives by question text', () => {
        const questions = qoderQuestionsFromInput(input)!;
        expect(qoderElicitationAnswer(questions, {
            'Which fruit would you like?': 'Durian',
            'Which colors do you like?': 'Blue, Green, teal',
        })).toEqual({ action: 'accept', content: { q0: 'Durian', q1: ['Blue', 'Green', 'teal'] } });
    });

    it('leaves a question the app did not answer empty', () => {
        const questions = qoderQuestionsFromInput(input)!;
        expect(qoderElicitationAnswer(questions, {})).toEqual({ action: 'accept', content: { q0: '', q1: [] } });
    });
});
