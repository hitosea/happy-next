import type { AgentEvent } from './typesRaw';

/**
 * Claude Code's `system` channel carries notices that never reach the conversation today: the
 * normalizer dropped every system record, so only the compaction boundary and init were ever read.
 * These helpers turn the ones worth showing into a one-line notice, and the background-task ones
 * into updates for the Task card that spawned them.
 *
 * Records arrive from the CLI verbatim, so every field is read defensively — an older or newer
 * Claude Code may name or omit things differently, and a wrong guess must never hide the notice.
 */

export type ClaudeSystemNotice =
    | { kind: 'event'; event: AgentEvent }
    | { kind: 'task-progress'; toolUseId: string; description: string }
    | { kind: 'task-finished'; toolUseId: string; status: string; summary: string | null };

function record(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function text(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function number(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function notice(message: string, key?: string): ClaudeSystemNotice {
    return { kind: 'event', event: { type: 'message', message, ...(key ? { key } : {}) } };
}

function oneLine(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
}

function friendlyModel(value: unknown): string | null {
    const id = text(value);
    if (!id) return null;
    const bare = id.replace(/^claude-/, '').replace(/-\d{8}$/, '');
    const [family, ...rest] = bare.split('-');
    if (!family) return id;
    return `${family[0].toUpperCase()}${family.slice(1)}${rest.length ? ` ${rest.join('.')}` : ''}`;
}

/**
 * A warning that a rate-limit window is running low. Claude Code emits an event every time a
 * rounded percentage moves, so the caller shows one per window: `key` names the window and the
 * reset it belongs to, and the next window (a new reset) warns again.
 */
export function rateLimitWarning(rateLimitInfo: unknown): AgentEvent | null {
    const info = record(rateLimitInfo);
    if (!info || info.status !== 'allowed_warning') return null;

    const type = text(info.rateLimitType) ?? 'usage';
    const resetsAt = number(info.resetsAt);
    const utilization = number(info.utilization);
    const label = type === 'five_hour'
        ? '5-hour limit'
        : type === 'seven_day'
            ? 'weekly limit'
            : type === 'seven_day_opus'
                ? 'weekly Opus limit'
                : type === 'seven_day_sonnet'
                    ? 'weekly Sonnet limit'
                    : `${type.replace(/_/g, ' ')} limit`;

    const percent = utilization === null ? null : Math.round(utilization * 100);
    const reset = resetsAt === null ? '' : `, resets ${new Date(resetsAt * 1000).toLocaleString()}`;
    const used = percent === null ? '' : ` ${percent}% used`;

    return {
        type: 'message',
        message: `Claude usage: ${label}${used}${reset}.`,
        key: `claude-usage:${type}:${resetsAt ?? 'unknown'}`,
    };
}

export function claudeSystemNotice(data: Record<string, unknown>): ClaudeSystemNotice | null {
    const subtype = text(data.subtype);
    if (!subtype) return null;

    if (subtype === 'informational') {
        const content = text(data.content);
        // The usage-limit notice has its own row (limit-reached); repeating it here would double it.
        if (!content || /^usage limit reached\b/i.test(content)) return null;
        return notice(oneLine(content));
    }

    if (subtype === 'api_error') {
        // Only the first retry of a burst is news; the rest say the same thing with a bigger number.
        if (number(data.retryAttempt) !== 1) return null;
        const error = record(data.error);
        const reason = text(error?.formatted) ?? text(error?.message);
        if (!reason) return null;
        const attempt = number(data.retryAttempt);
        const max = number(data.maxRetries);
        const progress = attempt !== null && max !== null && max > 0 ? ` (${attempt}/${max})` : '';
        return notice(`${oneLine(reason)} · retrying${progress}`);
    }

    if (subtype === 'model_refusal_fallback' || subtype === 'model_refusal_no_fallback') {
        const from = friendlyModel(data.originalModel);
        const to = subtype === 'model_refusal_fallback' ? friendlyModel(data.fallbackModel) : null;
        const category = text(data.apiRefusalCategory);
        const flagged = category ? ` (${category})` : '';
        if (to) {
            return notice(`${from ?? 'The model'}'s safeguards declined this request${flagged}; ${to} is answering instead.`);
        }
        return notice(`${from ?? 'The model'}'s safeguards declined this request${flagged}.`);
    }

    if (subtype === 'model_fallback' || subtype === 'model_consent_fallback') {
        const from = friendlyModel(data.originalModel);
        const to = friendlyModel(data.fallbackModel);
        if (!to) return null;
        return notice(`${from ?? 'The requested model'} is unavailable; using ${to} instead.`);
    }

    if (subtype === 'permission_denied') {
        const tool = text(data.tool_name);
        // A denial the reader made shows on the tool card itself; only a denial carrying a reason
        // addable to that card is worth a row, and one without a reason is already fully explained.
        const reason = text(data.message) ?? text(data.decision_reason);
        if (!reason) return null;
        return notice(`Permission denied${tool ? ` for ${tool}` : ''}: ${oneLine(reason)}`);
    }

    if (subtype === 'instruction_size_warning') {
        const chars = number(data.total_chars);
        const limit = number(data.total_limit_chars);
        const files = number(data.file_count);
        if (chars === null || limit === null) return null;
        const across = files !== null && files > 1 ? ` across ${files} files` : '';
        return notice(`Instruction files are large: ${chars} characters${across}, over the ${limit}-character limit — Claude may read them more slowly.`);
    }

    if (subtype === 'agents_killed') {
        return notice('Background agents were stopped.');
    }

    if (subtype === 'happy_notice') {
        const content = text(data.content);
        return content ? notice(oneLine(content)) : null;
    }

    if (subtype === 'task_progress') {
        const toolUseId = text(data.tool_use_id);
        const description = text(data.description) ?? text(data.summary);
        if (!toolUseId || !description) return null;
        return { kind: 'task-progress', toolUseId, description: oneLine(description) };
    }

    if (subtype === 'task_notification') {
        const toolUseId = text(data.tool_use_id);
        const status = text(data.status);
        if (!toolUseId || !status) return null;
        return { kind: 'task-finished', toolUseId, status, summary: text(data.summary) ?? text(data.reason) };
    }

    return null;
}
