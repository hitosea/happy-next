import { describe, expect, it } from 'vitest';
import { claudeSystemNotice, rateLimitWarning } from './claudeSystemNotices';
import { normalizeRawMessage } from './typesRaw';

function output(data: Record<string, unknown>) {
    return {
        role: 'agent',
        content: { type: 'output', data: { uuid: 'uuid-1', ...data } },
    };
}

describe('rateLimitWarning', () => {
    it('turns an allowed_warning into a notice keyed by its window', () => {
        const event = rateLimitWarning({
            status: 'allowed_warning',
            rateLimitType: 'seven_day',
            utilization: 0.31,
            resetsAt: 1794816000,
        });
        expect(event?.type).toBe('message');
        if (event?.type !== 'message') return;
        expect(event.message).toContain('weekly limit 31% used');
        expect(event.key).toBe('claude-usage:seven_day:1794816000');
    });

    it('says nothing for allowed or rejected windows', () => {
        expect(rateLimitWarning({ status: 'allowed', utilization: 0.9 })).toBeNull();
        expect(rateLimitWarning({ status: 'rejected', utilization: 1 })).toBeNull();
        expect(rateLimitWarning(null)).toBeNull();
    });

    it('reaches the app as an event message', () => {
        const normalized = normalizeRawMessage('m1', null, 1000, output({
            type: 'rate_limit_event',
            rate_limit_info: { status: 'allowed_warning', rateLimitType: 'five_hour', utilization: 0.42, resetsAt: 1794303000 },
        }) as any);
        expect(normalized?.role).toBe('event');
        if (normalized?.role !== 'event' || normalized.content.type !== 'message') return;
        expect(normalized.content.message).toContain('5-hour limit 42% used');
    });
});

describe('claudeSystemNotice', () => {
    it('shows an informational line, collapsed to one line', () => {
        const notice = claudeSystemNotice({ subtype: 'informational', content: 'First line.\n  Second line.' });
        expect(notice).toEqual({ kind: 'event', event: { type: 'message', message: 'First line. Second line.' } });
    });

    it('leaves the usage-limit wording to the limit row', () => {
        expect(claudeSystemNotice({ subtype: 'informational', content: 'Usage limit reached · continuing automatically at 2:30pm · esc to cancel' })).toBeNull();
    });

    it('shows only the first retry of a burst', () => {
        const first = claudeSystemNotice({
            subtype: 'api_error',
            error: { formatted: 'Connection dropped (ECONNRESET)' },
            retryAttempt: 1,
            maxRetries: 10,
        });
        expect(first).toEqual({ kind: 'event', event: { type: 'message', message: 'Connection dropped (ECONNRESET) · retrying (1/10)' } });
        expect(claudeSystemNotice({ subtype: 'api_error', error: { formatted: 'Connection dropped' }, retryAttempt: 3, maxRetries: 10 })).toBeNull();
    });

    it('summarises a refusal fallback without the essay', () => {
        const notice = claudeSystemNotice({
            subtype: 'model_refusal_fallback',
            originalModel: 'claude-opus-5-5',
            fallbackModel: 'claude-opus-4-8',
            apiRefusalCategory: 'cyber',
            content: 'a long explanation',
        });
        expect(notice).toEqual({
            kind: 'event',
            event: { type: 'message', message: "Opus 5.5's safeguards declined this request (cyber); Opus 4.8 is answering instead." },
        });
    });

    it('keeps a denial only when it carries a reason', () => {
        expect(claudeSystemNotice({ subtype: 'permission_denied', tool_name: 'Bash' })).toBeNull();
        expect(claudeSystemNotice({ subtype: 'permission_denied', tool_name: 'Bash', message: 'Blocked by project rules.' })).toEqual({
            kind: 'event',
            event: { type: 'message', message: 'Permission denied for Bash: Blocked by project rules.' },
        });
    });

    it('reports oversized instruction files', () => {
        const notice = claudeSystemNotice({ subtype: 'instruction_size_warning', total_chars: 50000, total_limit_chars: 40000, file_count: 3 });
        if (notice?.kind !== 'event' || notice.event.type !== 'message') throw new Error('expected a notice');
        expect(notice.event.message).toContain('50000 characters across 3 files');
    });

    it('reports killed background agents', () => {
        expect(claudeSystemNotice({ subtype: 'agents_killed' })).toEqual({
            kind: 'event',
            event: { type: 'message', message: 'Background agents were stopped.' },
        });
    });

    it('maps task progress and completion to the task card', () => {
        expect(claudeSystemNotice({
            subtype: 'task_progress',
            tool_use_id: 'tool-1',
            description: 'Finding API routes',
        })).toEqual({ kind: 'task-progress', toolUseId: 'tool-1', description: 'Finding API routes' });

        expect(claudeSystemNotice({
            subtype: 'task_notification',
            tool_use_id: 'tool-1',
            status: 'failed',
            reason: 'crashed',
        })).toEqual({ kind: 'task-finished', toolUseId: 'tool-1', status: 'failed', summary: 'crashed' });
    });

    it('shows a notice the CLI wrote itself', () => {
        expect(claudeSystemNotice({ subtype: 'happy_notice', content: 'Reached the maximum number of turns; this turn was stopped.' }))
            .toEqual({ kind: 'event', event: { type: 'message', message: 'Reached the maximum number of turns; this turn was stopped.' } });
    });

    it('ignores system records with nothing to show', () => {
        expect(claudeSystemNotice({ subtype: 'init' })).toBeNull();
        expect(claudeSystemNotice({ subtype: 'task_started', tool_use_id: 'tool-1' })).toBeNull();
    });
});

describe('normalizeRawMessage system mapping', () => {
    it('turns a task progress record into a tool-call update', () => {
        const normalized = normalizeRawMessage('m2', null, 2000, output({
            type: 'system',
            subtype: 'task_progress',
            tool_use_id: 'tool-1',
            description: 'Finding API routes',
        }) as any);
        expect(normalized?.role).toBe('agent');
        if (normalized?.role !== 'agent') return;
        const call = normalized.content[0];
        expect(call.type).toBe('tool-call');
        if (call.type !== 'tool-call') return;
        expect(call.id).toBe('tool-1');
        expect(call.progress).toBe(true);
        expect(call.input).toEqual({ description: 'Finding API routes' });
    });

    it('turns a task notification into a finishing update', () => {
        const normalized = normalizeRawMessage('m3', null, 2000, output({
            type: 'system',
            subtype: 'task_notification',
            tool_use_id: 'tool-1',
            status: 'completed',
            summary: 'done',
        }) as any);
        if (normalized?.role !== 'agent') throw new Error('expected an agent message');
        const call = normalized.content[0];
        if (call.type !== 'tool-call') throw new Error('expected a tool call');
        expect(call.taskStatus).toBe('completed');
        expect(call.taskSummary).toBe('done');
    });

    it('leaves init and status records dropped', () => {
        expect(normalizeRawMessage('m4', null, 2000, output({ type: 'system', subtype: 'init' }) as any)).toBeNull();
        expect(normalizeRawMessage('m5', null, 2000, output({ type: 'system', subtype: 'status', status: 'compacting' }) as any)).toBeNull();
    });
});
