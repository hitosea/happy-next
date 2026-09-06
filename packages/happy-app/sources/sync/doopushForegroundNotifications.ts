import * as Notifications from 'expo-notifications';
import { AppState } from 'react-native';
import type { DooPushMessage } from 'doopush-react-native-sdk';

type DooPushForegroundApi = Pick<
    typeof import('doopush-react-native-sdk').DooPush,
    'addMessageListener' | 'setExpoNotificationRelayEnabled'
>;

let messageSubscription: { remove(): void } | null = null;
const FOREGROUND_MESSAGE_DEDUP_WINDOW_MS = 30_000;
const presentedMessageIds = new Map<string, number>();

function getMessageIdentity(message: DooPushMessage): string | null {
    if (message.messageId) {
        return `message:${message.messageId}`;
    }
    if (message.dedupKey) {
        return `dedup:${message.dedupKey}`;
    }
    if (message.pushLogId) {
        return `push-log:${message.pushLogId}`;
    }
    return null;
}

function claimMessageIdentity(message: DooPushMessage, now: number): string | null | undefined {
    for (const [identity, presentedAt] of presentedMessageIds) {
        if (now - presentedAt >= FOREGROUND_MESSAGE_DEDUP_WINDOW_MS) {
            presentedMessageIds.delete(identity);
        }
    }

    const identity = getMessageIdentity(message);
    if (!identity) {
        return undefined;
    }
    if (presentedMessageIds.has(identity)) {
        return null;
    }
    presentedMessageIds.set(identity, now);
    return identity;
}

export async function presentDooPushForegroundNotification(
    message: DooPushMessage,
    appState: string = AppState.currentState,
): Promise<boolean> {
    if (
        appState !== 'active'
        || message.vendor !== 'fcm'
        || (!message.title && !message.body)
    ) {
        return false;
    }

    const claimedIdentity = claimMessageIdentity(message, Date.now());
    if (claimedIdentity === null) {
        return false;
    }

    try {
        await Notifications.scheduleNotificationAsync({
            content: {
                title: message.title,
                body: message.body,
                data: message.data,
                sound: 'default',
            },
            trigger: null,
        });
    } catch (error) {
        if (claimedIdentity) {
            presentedMessageIds.delete(claimedIdentity);
        }
        throw error;
    }
    return true;
}

export function setupDooPushForegroundNotifications(dooPush: DooPushForegroundApi): void {
    // The SDK relay emits a custom broadcast that expo-notifications does not
    // consume. Keep native display for background delivery and bridge only the
    // foreground FCM event into Expo's existing notification handler.
    dooPush.setExpoNotificationRelayEnabled(false);
    if (messageSubscription) {
        return;
    }

    messageSubscription = dooPush.addMessageListener((message) => {
        void presentDooPushForegroundNotification(message).catch((error) => {
            console.warn('Failed to present DooPush foreground notification', error);
        });
    });
}
