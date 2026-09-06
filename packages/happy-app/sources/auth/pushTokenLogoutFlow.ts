import type { AuthCredentials } from '@/auth/tokenStorage';
import { stopPushTokenRegistration } from '@/sync/sync';
import { unregisterCurrentPushToken } from '@/sync/pushTokenLogout';

export async function preparePushTokensForLogout(credentials: AuthCredentials): Promise<void> {
    await stopPushTokenRegistration();
    try {
        await unregisterCurrentPushToken(credentials);
    } catch (error) {
        // The server owns token expiry and transfer safeguards. A temporary
        // cleanup failure must not keep credentials on a device being signed out.
        console.warn('Failed to unregister push tokens during logout', error);
    }
}
