export const SESSION_APPEARANCE_KV_KEY = 'session-appearance:v1';
export const SESSION_APPEARANCE_SCHEMA_VERSION = 1 as const;

export const SESSION_MARKER_COLORS = [
    'red',
    'orange',
    'yellow',
    'green',
    'blue',
    'purple',
    'gray',
] as const;

export type SessionMarkerColor = typeof SESSION_MARKER_COLORS[number];

// An entry exists while it carries at least one mark: a colour, a pin, or both.
export interface SessionAppearanceEntry {
    color?: SessionMarkerColor;
    // When the session was pinned to the top of the list; pinned sessions sort newest pin first.
    pinnedAt?: number;
    updatedAt: number;
}

export interface SessionAppearanceDocument {
    schemaVersion: typeof SESSION_APPEARANCE_SCHEMA_VERSION;
    updatedAt: number;
    sessions: Record<string, SessionAppearanceEntry>;
}

// Only the marks a patch names change: `undefined` leaves one as it is, `null` clears it.
export interface SessionAppearancePatch {
    sessionId: string;
    color?: SessionMarkerColor | null;
    pinnedAt?: number | null;
    updatedAt: number;
}

const markerColorSet = new Set<string>(SESSION_MARKER_COLORS);

function isMarkerColor(value: unknown): value is SessionMarkerColor {
    return typeof value === 'string' && markerColorSet.has(value);
}

function isTimestamp(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function toBase64Utf8(value: string): string {
    const bytes = new TextEncoder().encode(value);
    let binary = '';
    for (let index = 0; index < bytes.length; index += 1) {
        binary += String.fromCharCode(bytes[index]!);
    }
    return typeof btoa === 'function'
        ? btoa(binary)
        : Buffer.from(binary, 'binary').toString('base64');
}

function fromBase64Utf8(value: string): string {
    const binary = typeof atob === 'function'
        ? atob(value)
        : Buffer.from(value, 'base64').toString('binary');
    return new TextDecoder().decode(Uint8Array.from(binary, character => character.charCodeAt(0)));
}

export function createEmptySessionAppearance(now: number = Date.now()): SessionAppearanceDocument {
    return {
        schemaVersion: SESSION_APPEARANCE_SCHEMA_VERSION,
        updatedAt: now,
        sessions: {},
    };
}

export function normalizeSessionAppearance(input: unknown, now: number = Date.now()): SessionAppearanceDocument {
    if (!input || typeof input !== 'object') return createEmptySessionAppearance(now);

    const raw = input as Record<string, unknown>;
    const rawSessions = raw.sessions && typeof raw.sessions === 'object'
        ? raw.sessions as Record<string, unknown>
        : {};
    const sessions: Record<string, SessionAppearanceEntry> = {};

    for (const [sessionId, rawEntry] of Object.entries(rawSessions)) {
        if (!sessionId.trim() || !rawEntry || typeof rawEntry !== 'object') continue;
        const entry = rawEntry as Record<string, unknown>;
        const color = isMarkerColor(entry.color) ? entry.color : undefined;
        const pinnedAt = isTimestamp(entry.pinnedAt) ? entry.pinnedAt : undefined;
        if (!color && pinnedAt === undefined) continue;
        sessions[sessionId] = {
            ...(color ? { color } : {}),
            ...(pinnedAt !== undefined ? { pinnedAt } : {}),
            updatedAt: isTimestamp(entry.updatedAt) ? entry.updatedAt : now,
        };
    }

    return {
        schemaVersion: SESSION_APPEARANCE_SCHEMA_VERSION,
        updatedAt: isTimestamp(raw.updatedAt) ? raw.updatedAt : now,
        sessions,
    };
}

export function applySessionAppearancePatch(
    document: SessionAppearanceDocument,
    patch: SessionAppearancePatch,
): SessionAppearanceDocument {
    const normalized = normalizeSessionAppearance(document, patch.updatedAt);
    const sessionId = patch.sessionId.trim();
    if (!sessionId) return normalized;

    const sessions = { ...normalized.sessions };
    const { updatedAt: _, ...marks } = sessions[sessionId] ?? {};
    if (patch.color !== undefined) {
        if (patch.color === null) delete marks.color;
        else marks.color = patch.color;
    }
    if (patch.pinnedAt !== undefined) {
        if (patch.pinnedAt === null) delete marks.pinnedAt;
        else marks.pinnedAt = patch.pinnedAt;
    }
    if (marks.color || marks.pinnedAt !== undefined) {
        sessions[sessionId] = { ...marks, updatedAt: patch.updatedAt };
    } else {
        delete sessions[sessionId];
    }

    return {
        schemaVersion: SESSION_APPEARANCE_SCHEMA_VERSION,
        updatedAt: Math.max(normalized.updatedAt, patch.updatedAt),
        sessions,
    };
}

export function applySessionAppearancePatches(
    document: SessionAppearanceDocument,
    patches: SessionAppearancePatch[],
): SessionAppearanceDocument {
    return patches.reduce(applySessionAppearancePatch, document);
}

export function encodeSessionAppearanceValue(document: SessionAppearanceDocument): string {
    return toBase64Utf8(JSON.stringify(normalizeSessionAppearance(document, document.updatedAt)));
}

export function decodeSessionAppearanceValue(value: string | null | undefined): SessionAppearanceDocument {
    if (!value) return createEmptySessionAppearance();
    try {
        return normalizeSessionAppearance(JSON.parse(fromBase64Utf8(value)));
    } catch {
        return createEmptySessionAppearance();
    }
}
