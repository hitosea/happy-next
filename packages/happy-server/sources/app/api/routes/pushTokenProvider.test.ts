import { describe, expect, it } from 'vitest';
import { inferPushTokenProvider } from './pushTokenProvider';

describe('inferPushTokenProvider', () => {
    it.each(['ExponentPushToken[value]', 'ExpoPushToken[value]'])(
        'recognizes Expo token %s',
        (token) => expect(inferPushTokenProvider(token)).toBe('expo'),
    );

    it('treats native device tokens as DooPush tokens', () => {
        expect(inferPushTokenProvider('native-device-token')).toBe('doopush');
    });
});
