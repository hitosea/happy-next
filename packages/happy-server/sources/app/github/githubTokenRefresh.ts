import { db } from "@/storage/db";
import { encryptString, decryptString } from "@/modules/encrypt";

/**
 * Refreshes a user's GitHub access token using their stored refresh token.
 *
 * Flow:
 * 1. Look up refresh token from DB, decrypt it
 * 2. Exchange refresh token for new access + refresh tokens via GitHub OAuth
 * 3. Encrypt and persist both new tokens + new expiry
 * 4. Return the new access token (plain text) so callers can use it immediately
 *
 * Concurrent calls for the same user are deduplicated — only one refresh
 * request is made and all callers receive the same result.
 */

const inflightRefreshes = new Map<string, Promise<string | null>>();

export async function refreshGithubToken(userId: string): Promise<string | null> {
    const existing = inflightRefreshes.get(userId);
    if (existing) return existing;

    const promise = doRefresh(userId);
    inflightRefreshes.set(userId, promise);
    try {
        return await promise;
    } finally {
        inflightRefreshes.delete(userId);
    }
}

async function doRefresh(userId: string): Promise<string | null> {
    const account = await db.account.findUniqueOrThrow({
        where: { id: userId },
        select: { githubUser: { select: { id: true, refreshToken: true } } }
    });

    if (!account.githubUser?.refreshToken) return null;

    const refreshToken = decryptString(
        ['user', userId, 'github', 'refreshToken'],
        account.githubUser.refreshToken
    );

    const clientId = process.env.GITHUB_CLIENT_ID;
    const clientSecret = process.env.GITHUB_CLIENT_SECRET;
    if (!clientId || !clientSecret) return null;

    const res = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
            client_id: clientId,
            client_secret: clientSecret,
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
        }),
    });

    const data = await res.json() as {
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
        error?: string;
    };

    if (data.error || !data.access_token) return null;

    const githubUserId = account.githubUser.id;

    await db.githubUser.update({
        where: { id: githubUserId },
        data: {
            token: encryptString(['user', userId, 'github', 'token'], data.access_token),
            ...(data.refresh_token && {
                refreshToken: encryptString(['user', userId, 'github', 'refreshToken'], data.refresh_token),
            }),
            ...(data.expires_in && {
                expiresAt: new Date(Date.now() + data.expires_in * 1000),
            }),
        },
    });

    return data.access_token;
}
