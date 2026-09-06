import { AuthCredentials } from '@/auth/tokenStorage';
import { getServerUrl } from './serverConfig';

export async function registerPushToken(
    credentials: AuthCredentials,
    token: string,
    provider: 'expo' | 'doopush',
    installationId: string,
    signal?: AbortSignal,
): Promise<void> {
    const API_ENDPOINT = getServerUrl();
    const response = await fetch(`${API_ENDPOINT}/v1/push-tokens`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${credentials.token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ token, provider, installationId }),
        signal,
    });

    if (!response.ok) {
        throw new Error(`Failed to register push token: ${response.status}`);
    }

    const data = await response.json();
    if (!data.success) {
        throw new Error('Failed to register push token');
    }
}

export async function deletePushToken(
    credentials: AuthCredentials,
    token: string,
    signal?: AbortSignal,
): Promise<void> {
    const API_ENDPOINT = getServerUrl();
    const response = await fetch(`${API_ENDPOINT}/v1/push-tokens/${encodeURIComponent(token)}`, {
        method: 'DELETE',
        headers: {
            'Authorization': `Bearer ${credentials.token}`
        },
        signal,
    });

    if (!response.ok) {
        throw new Error(`Failed to delete push token: ${response.status}`);
    }
}

export async function resetBadgeCount(credentials: AuthCredentials): Promise<void> {
    const API_ENDPOINT = getServerUrl();
    try {
        await fetch(`${API_ENDPOINT}/v1/badge/reset`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${credentials.token}`,
                'Content-Type': 'application/json'
            }
        });
    } catch {
        // Best-effort: don't block app lifecycle if server is unreachable
    }
}
