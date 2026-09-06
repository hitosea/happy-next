import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    scheduleNotificationAsync: vi.fn(),
}));

vi.mock('expo-notifications', () => ({
    scheduleNotificationAsync: mocks.scheduleNotificationAsync,
}));

vi.mock('react-native', () => ({
    AppState: { currentState: 'active' },
}));

import { presentDooPushForegroundNotification } from './doopushForegroundNotifications';

const fcmMessage = {
    vendor: 'fcm' as const,
    messageId: 'fcm-message-1',
    title: 'Ready',
    body: 'Waiting for your input',
    data: {
        action: 'open_page',
        data: JSON.stringify({ sessionId: 'session-1' }),
    },
};

describe('presentDooPushForegroundNotification', () => {
    beforeEach(() => {
        mocks.scheduleNotificationAsync.mockReset();
        mocks.scheduleNotificationAsync.mockResolvedValue('notification-1');
    });

    it('bridges an active FCM message into an immediate Expo notification', async () => {
        await expect(presentDooPushForegroundNotification(fcmMessage, 'active')).resolves.toBe(true);

        expect(mocks.scheduleNotificationAsync).toHaveBeenCalledWith({
            content: {
                title: 'Ready',
                body: 'Waiting for your input',
                data: fcmMessage.data,
                sound: 'default',
            },
            trigger: null,
        });
    });

    it('presents duplicate SDK callbacks only once', async () => {
        const duplicateMessage = { ...fcmMessage, messageId: 'duplicate-message' };

        await expect(Promise.all([
            presentDooPushForegroundNotification(duplicateMessage, 'active'),
            presentDooPushForegroundNotification(duplicateMessage, 'active'),
        ])).resolves.toEqual([true, false]);

        expect(mocks.scheduleNotificationAsync).toHaveBeenCalledOnce();
    });

    it('allows a failed presentation to be retried', async () => {
        const retryableMessage = { ...fcmMessage, messageId: 'retryable-message' };
        mocks.scheduleNotificationAsync.mockRejectedValueOnce(new Error('scheduling failed'));

        await expect(presentDooPushForegroundNotification(retryableMessage, 'active')).rejects.toThrow('scheduling failed');
        await expect(presentDooPushForegroundNotification(retryableMessage, 'active')).resolves.toBe(true);

        expect(mocks.scheduleNotificationAsync).toHaveBeenCalledTimes(2);
    });

    it('leaves background delivery to the native SDK', async () => {
        await expect(presentDooPushForegroundNotification(fcmMessage, 'background')).resolves.toBe(false);
        expect(mocks.scheduleNotificationAsync).not.toHaveBeenCalled();
    });

    it('does not duplicate OEM notifications', async () => {
        await expect(presentDooPushForegroundNotification({
            ...fcmMessage,
            vendor: 'oppo',
        }, 'active')).resolves.toBe(false);
        expect(mocks.scheduleNotificationAsync).not.toHaveBeenCalled();
    });

    it('ignores messages without display content', async () => {
        await expect(presentDooPushForegroundNotification({
            vendor: 'fcm',
            data: {},
        }, 'active')).resolves.toBe(false);
        expect(mocks.scheduleNotificationAsync).not.toHaveBeenCalled();
    });
});
