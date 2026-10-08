import { describe, expect, it } from 'vitest';
import { getSessionJumpPriority, pickNextJumpSession } from './sessionListJump';

const session = (extra: Record<string, unknown> = {}) => ({ id: 's', presence: 'online', thinking: false, agentState: null, ...extra }) as any;
const none = { unread: false, delegating: false, hasDraft: false };

describe('getSessionJumpPriority', () => {
    it('ranks permission > unread > thinking > delegating > draft', () => {
        const all = { unread: true, delegating: true, hasDraft: true };
        expect(getSessionJumpPriority(session({ agentState: { requests: { r: {} } }, thinking: true }), all)).toBe(0);
        expect(getSessionJumpPriority(session({ thinking: true }), all)).toBe(1);
        expect(getSessionJumpPriority(session({ thinking: true }), { ...all, unread: false })).toBe(2);
        expect(getSessionJumpPriority(session(), { ...none, delegating: true, hasDraft: true })).toBe(3);
        expect(getSessionJumpPriority(session(), { ...none, hasDraft: true })).toBe(4);
        expect(getSessionJumpPriority(session(), none)).toBeNull();
    });

    it('ignores permission requests and thinking of offline sessions', () => {
        expect(getSessionJumpPriority(session({ presence: 123, thinking: true, agentState: { requests: { r: {} } } }), none)).toBeNull();
    });
});

describe('pickNextJumpSession', () => {
    const candidates = [
        { id: 'draft', priority: 4 },
        { id: 'unread-1', priority: 1 },
        { id: 'perm', priority: 0 },
        { id: 'unread-2', priority: 1 },
    ];

    it('starts with the most urgent, then steps through by priority and list order, wrapping', () => {
        expect(pickNextJumpSession(candidates, null)).toBe('perm');
        expect(pickNextJumpSession(candidates, 'perm')).toBe('unread-1');
        expect(pickNextJumpSession(candidates, 'unread-1')).toBe('unread-2');
        expect(pickNextJumpSession(candidates, 'unread-2')).toBe('draft');
        expect(pickNextJumpSession(candidates, 'draft')).toBe('perm');
    });

    it('restarts when the last jump no longer qualifies, and is null with nothing to jump to', () => {
        expect(pickNextJumpSession(candidates, 'gone')).toBe('perm');
        expect(pickNextJumpSession([], 'perm')).toBeNull();
    });
});
