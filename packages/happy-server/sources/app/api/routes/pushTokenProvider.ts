export type PushTokenProvider = 'expo' | 'doopush';

export function inferPushTokenProvider(token: string): PushTokenProvider {
    return token.startsWith('ExponentPushToken[') || token.startsWith('ExpoPushToken[')
        ? 'expo'
        : 'doopush';
}
