import { describe, expect, it } from 'vitest';
import { textGroupAround } from './messageTextGroup';
import type { AgentTextMessage, Message, UserTextMessage } from '@/sync/typesMessage';

function user(id: string): UserTextMessage {
    return { kind: 'user-text', id, localId: null, createdAt: 0, text: id };
}

function agent(id: string, overrides: Partial<AgentTextMessage> = {}): AgentTextMessage {
    return { kind: 'agent-text', id, localId: null, createdAt: 0, text: id, ...overrides };
}

function tool(id: string): Message {
    return {
        kind: 'tool-call',
        id,
        localId: null,
        createdAt: 0,
        tool: { name: 'Read', state: 'completed', input: {}, createdAt: 0, startedAt: 0, completedAt: 0, description: null },
        children: [],
    };
}

function event(id: string): Message {
    return { kind: 'agent-event', id, createdAt: 0, event: { type: 'message', message: id } };
}

// Newest first, the order the store keeps them in.
const turn: Message[] = [agent('a5'), agent('a4'), tool('t3'), agent('a2'), agent('a1'), user('u1')];

describe('textGroupAround', () => {
    it('joins every run of texts with nothing between them, from any row of the run', () => {
        expect(textGroupAround(turn, 'a1', true)).toBe('a1\n\na2');
        expect(textGroupAround(turn, 'a2', true)).toBe('a1\n\na2');
        expect(textGroupAround(turn, 'a4', true)).toBe('a4\n\na5');
        expect(textGroupAround(turn, 'a5', true)).toBe('a4\n\na5');
    });

    it('leaves a lone text to itself', () => {
        expect(textGroupAround([agent('a2'), tool('t1'), agent('a1'), user('u1')], 'a2', true)).toBe('a2');
    });

    it('ends a run at shown thinking, notices and prompts', () => {
        const thinking = [agent('a2'), agent('think', { isThinking: true }), agent('a1')];
        expect(textGroupAround(thinking, 'a2', true)).toBe('a2');
        expect(textGroupAround([agent('a2'), event('e1'), agent('a1')], 'a2', true)).toBe('a2');
        expect(textGroupAround([agent('a2'), user('u2'), agent('a1')], 'a1', true)).toBe('a1');
    });

    it('reads across thinking the list hides', () => {
        const thinking = [agent('a2'), agent('think', { isThinking: true }), agent('a1')];
        expect(textGroupAround(thinking, 'a2', false)).toBe('a1\n\na2');
    });

    it('answers null for a row that is missing or not a text', () => {
        expect(textGroupAround(turn, 'missing', true)).toBeNull();
        expect(textGroupAround(turn, 't3', true)).toBeNull();
    });
});
