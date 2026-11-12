import { describe, expect, it } from 'vitest';
import { messageLandmark } from './messageLandmark';

const output = (data: unknown) => ({ role: 'agent', content: { type: 'output', data } });
const call = (name: string, id = 'call-1') => output({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name }] } });
const result = (toolUseId = 'call-1') => output({ type: 'user', isSidechain: false, message: { content: [{ type: 'tool_result', tool_use_id: toolUseId, content: 'out' }] } });

describe('messageLandmark', () => {
    it('marks a typed prompt, and only one', () => {
        expect(messageLandmark({ role: 'user', content: { type: 'text', text: 'hello' } })).toBe('prompt');
        expect(messageLandmark({ role: 'user', content: { type: 'mixed', text: 'look', images: [] } })).toBe('prompt');
        expect(messageLandmark({ role: 'user', content: { type: 'text', text: 'summary' }, meta: { isCompactSummary: true } })).toBeNull();
        expect(messageLandmark({ role: 'user', content: { type: 'text', text: '[Request interrupted by user]' } })).toBeNull();
        expect(messageLandmark({ role: 'user', content: { type: 'text', text: '   ' } })).toBeNull();
    });

    it('marks the two calls the rail draws and resolves their results', () => {
        const names = new Map<string, string>();
        expect(messageLandmark(call('AskUserQuestion'), names)).toBe('question');
        expect(messageLandmark(result(), names)).toBe('question-answer');
        expect(messageLandmark(call('mcp__happy__preview_html', 'call-2'), names)).toBe('preview');
        expect(messageLandmark(result('call-2'), names)).toBe('preview-answer');
    });

    it('marks nothing for other calls, unknown results and subagents', () => {
        const names = new Map<string, string>([['call-1', 'Bash']]);
        expect(messageLandmark(call('Bash'), names)).toBeNull();
        expect(messageLandmark(result(), names)).toBeNull();
        expect(messageLandmark(result('never-seen'))).toBeNull();
        expect(messageLandmark(output({ type: 'assistant', isSidechain: true, message: { content: [{ type: 'tool_use', id: 'x', name: 'AskUserQuestion' }] } }))).toBeNull();
    });

    it('marks acp and codex tool traffic', () => {
        const names = new Map<string, string>();
        expect(messageLandmark({ role: 'agent', content: { type: 'acp', data: { type: 'tool-call', callId: 'c1', name: 'preview_html', input: {}, id: 'c1' } } }, names)).toBe('preview');
        expect(messageLandmark({ role: 'agent', content: { type: 'acp', data: { type: 'tool-result', callId: 'c1', output: '', id: 'r1' } } }, names)).toBe('preview-answer');
        expect(messageLandmark({ role: 'agent', content: { type: 'codex', data: { type: 'tool-call', callId: 'c2', name: 'AskUserQuestion', input: {} } } }, names)).toBe('question');
        expect(messageLandmark({ role: 'agent', content: { type: 'codex', data: { type: 'tool-call-result', callId: 'c2', output: '' } } }, names)).toBe('question-answer');
    });

    it('marks session envelopes', () => {
        const envelope = (role: string, ev: unknown, extra = {}) => ({ role: 'session', content: { type: 'session', data: { role, ev, ...extra } } });
        const names = new Map<string, string>();
        expect(messageLandmark(envelope('user', { t: 'text', text: 'hi' }), names)).toBe('prompt');
        expect(messageLandmark(envelope('agent', { t: 'text', text: 'hi' }), names)).toBeNull();
        expect(messageLandmark(envelope('agent', { t: 'text', text: 'hi' }, { subagent: 'a' }), names)).toBeNull();
        expect(messageLandmark(envelope('agent', { t: 'tool-call-start', call: 'e1', name: 'AskUserQuestion' }), names)).toBe('question');
        expect(messageLandmark(envelope('agent', { t: 'tool-call-end', call: 'e1' }), names)).toBe('question-answer');
    });

    it('marks nothing else', () => {
        expect(messageLandmark(null)).toBeNull();
        expect(messageLandmark({ role: 'user', content: { type: 'event', data: {} } })).toBeNull();
        expect(messageLandmark({ role: 'agent', content: { type: 'thinking', data: {} } })).toBeNull();
    });
});
