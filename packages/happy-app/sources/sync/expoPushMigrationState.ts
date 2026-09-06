import { MMKV } from 'react-native-mmkv';

const migrationStorage = new MMKV({ id: 'push-token-migration' });
const EXPO_FALLBACK_TOKEN_KEY = 'expo-fallback-token';

export function getStoredExpoFallbackToken(): string | null {
    return migrationStorage.getString(EXPO_FALLBACK_TOKEN_KEY) ?? null;
}

export function clearStoredExpoFallbackToken(token: string): void {
    if (getStoredExpoFallbackToken() === token) {
        migrationStorage.delete(EXPO_FALLBACK_TOKEN_KEY);
    }
}

export function markExpoFallbackRegistered(token: string): void {
    migrationStorage.set(EXPO_FALLBACK_TOKEN_KEY, token);
}
