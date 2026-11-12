import { describe, expect, it } from 'vitest';
import { isThinkingOnly, messageKind } from './messageKind';

const output = (data: unknown) => ({ role: 'agent', content: { type: 'output', data } });

describe('messageKind', () => {
    it('puts every user record under text', () => {
        expect(messageKind({ role: 'user', content: { type: 'text', text: 'hi' } })).toBe('text');
        expect(messageKind({ role: 'user', content: { type: 'text', text: 'summary' }, meta: { isCompactSummary: true } })).toBe('text');
    });

    it('sorts Claude replies by whether they hold text', () => {
        expect(messageKind(output({ type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'x' }, { type: 'text', text: 'one' }] } }))).toBe('text');
        expect(messageKind(output({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash' }] } }))).toBe('other');
        expect(messageKind(output({ type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'x' }] } }))).toBe('other');
        expect(messageKind(output({ type: 'assistant', isSidechain: true, message: { content: [{ type: 'text', text: 'x' }] } }))).toBe('other');
    });

    it('keeps transcript prompts and leaves tool results out', () => {
        expect(messageKind(output({ type: 'user', message: { content: 'typed' } }))).toBe('text');
        expect(messageKind(output({ type: 'user', message: { content: [{ type: 'text', text: 'typed' }] } }))).toBe('text');
        expect(messageKind(output({ type: 'user', message: { content: [{ type: 'tool_result', content: 'out' }] } }))).toBe('other');
        expect(messageKind(output({ type: 'summary' }))).toBe('other');
    });

    it('sorts codex and acp records', () => {
        expect(messageKind({ role: 'agent', content: { type: 'codex', data: { type: 'message', message: 'done' } } })).toBe('text');
        expect(messageKind({ role: 'agent', content: { type: 'acp', data: { type: 'tool-call', name: 'x' } } })).toBe('other');
    });

    it('sorts session envelopes', () => {
        const envelope = (ev: unknown, extra = {}) => ({ role: 'session', content: { type: 'session', data: { ev, ...extra } } });
        expect(messageKind(envelope({ t: 'text', text: 'hi' }))).toBe('text');
        expect(messageKind(envelope({ t: 'text', text: 'hmm', thinking: true }))).toBe('other');
        expect(messageKind(envelope({ t: 'text', text: 'x' }, { subagent: 'a' }))).toBe('other');
        expect(messageKind(envelope({ t: 'tool-call-start' }))).toBe('other');
        expect(messageKind({ role: 'agent', content: { type: 'session', data: { ev: { t: 'text', text: 'hi' } } } })).toBe('text');
    });

    it('puts events and anything unknown under other', () => {
        expect(messageKind({ role: 'agent', content: { type: 'event', data: { type: 'ready' } } })).toBe('other');
        expect(messageKind(null)).toBe('other');
    });
});

describe('isThinkingOnly', () => {
    it('holds only the records whose every block is thinking', () => {
        expect(isThinkingOnly(output({ type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'x' }] } }))).toBe(true);
        expect(isThinkingOnly(output({ type: 'assistant', message: { content: [{ type: 'thinking', thinking: '' }, { type: 'redacted_thinking', data: 'x' }] } }))).toBe(true);
        expect(isThinkingOnly(output({ type: 'assistant', message: { content: [] } }))).toBe(false);
        expect(isThinkingOnly(output({ type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'x' }, { type: 'text', text: 'one' }] } }))).toBe(false);
        expect(isThinkingOnly(output({ type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'x' }, { type: 'tool_use', name: 'Bash' }] } }))).toBe(false);
        expect(isThinkingOnly(output({ type: 'assistant', isSidechain: true, message: { content: [{ type: 'thinking', thinking: 'x' }] } }))).toBe(false);
        expect(isThinkingOnly(output({ type: 'user', message: { content: 'typed' } }))).toBe(false);
    });

    it('holds acp thinking but never acp or codex reasoning', () => {
        expect(isThinkingOnly({ role: 'agent', content: { type: 'acp', data: { type: 'thinking', text: 'hmm' } } })).toBe(true);
        expect(isThinkingOnly({ role: 'agent', content: { type: 'acp', data: { type: 'thinking', text: '' } } })).toBe(false);
        expect(isThinkingOnly({ role: 'agent', content: { type: 'acp', data: { type: 'reasoning', text: 'hmm' } } })).toBe(false);
        expect(isThinkingOnly({ role: 'agent', content: { type: 'acp', data: { type: 'message', message: 'done' } } })).toBe(false);
        expect(isThinkingOnly({ role: 'agent', content: { type: 'codex', data: { type: 'reasoning', text: 'hmm' } } })).toBe(false);
    });

    it('holds thinking envelopes and leaves the rest', () => {
        const envelope = (ev: unknown, extra = {}) => ({ role: 'session', content: { type: 'session', data: { ev, ...extra } } });
        expect(isThinkingOnly(envelope({ t: 'text', text: 'hmm', thinking: true }))).toBe(true);
        expect(isThinkingOnly(envelope({ t: 'text', text: '', thinking: true }))).toBe(false);
        expect(isThinkingOnly(envelope({ t: 'text', text: 'hi' }))).toBe(false);
        expect(isThinkingOnly(envelope({ t: 'text', text: 'hmm', thinking: true }, { subagent: 'a' }))).toBe(false);
        expect(isThinkingOnly({ role: 'agent', content: { type: 'session', data: { ev: { t: 'text', text: 'hmm', thinking: true } } } })).toBe(true);
        expect(isThinkingOnly({ role: 'user', content: { type: 'text', text: 'hi' } })).toBe(false);
        expect(isThinkingOnly(null)).toBe(false);
    });
});
