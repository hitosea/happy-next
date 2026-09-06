function asRecord(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

function readSessionId(value: unknown): string | null {
    const sessionId = asRecord(value)?.sessionId;
    return typeof sessionId === 'string' ? sessionId : null;
}

export function getNotificationSessionId(data: unknown): string | null {
    const directSessionId = readSessionId(data);
    if (directSessionId) {
        return directSessionId;
    }

    const nestedData = asRecord(data)?.data;
    if (typeof nestedData !== 'string') {
        return readSessionId(nestedData);
    }

    try {
        return readSessionId(JSON.parse(nestedData));
    } catch {
        return null;
    }
}
