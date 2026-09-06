import { describe, expect, it } from 'vitest';
import { getNotificationSessionId } from './notificationData';

describe('getNotificationSessionId', () => {
    it('reads Expo notification data', () => {
        expect(getNotificationSessionId({ sessionId: 'session-1' })).toBe('session-1');
    });

    it('reads DooPush JSON-string notification data', () => {
        expect(getNotificationSessionId({
            action: 'open_page',
            data: JSON.stringify({ sessionId: 'session-2', type: 'permission_request' }),
        })).toBe('session-2');
    });

    it('accepts object data and ignores malformed values', () => {
        expect(getNotificationSessionId({ data: { sessionId: 'session-3' } })).toBe('session-3');
        expect(getNotificationSessionId({ data: '{invalid' })).toBeNull();
        expect(getNotificationSessionId(null)).toBeNull();
    });
});
