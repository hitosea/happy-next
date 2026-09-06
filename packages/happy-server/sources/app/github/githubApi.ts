import { Octokit } from "octokit";
import { db } from "@/storage/db";
import { decryptString } from "@/modules/encrypt";
import { refreshGithubToken } from "./githubTokenRefresh";

const REFRESH_BUFFER_MS = 5 * 60 * 1000; // refresh 5 minutes before expiry

/**
 * Creates an authenticated Octokit instance for a user.
 *
 * Flow:
 * 1. Look up the user's linked GitHub account (token + expiry)
 * 2. If the token expires within 5 minutes, proactively refresh it
 * 3. Install a request hook that retries once on 401 after refreshing
 * 4. Return the Octokit instance
 *
 * Throws if the user has no GitHub connection or no stored token.
 */
export async function getUserOctokit(userId: string): Promise<Octokit> {
    const account = await db.account.findUniqueOrThrow({
        where: { id: userId },
        select: { githubUser: { select: { token: true, expiresAt: true } } }
    });

    if (!account.githubUser?.token) {
        throw new GitHubNotConnectedError();
    }

    // Proactive refresh: token expires within buffer window
    if (account.githubUser.expiresAt && account.githubUser.expiresAt.getTime() < Date.now() + REFRESH_BUFFER_MS) {
        const newToken = await refreshGithubToken(userId);
        if (newToken) {
            return createOctokitWithRetry(userId, newToken);
        }
    }

    const accessToken = decryptString(['user', userId, 'github', 'token'], account.githubUser.token);
    return createOctokitWithRetry(userId, accessToken);
}

function createOctokitWithRetry(userId: string, token: string): Octokit {
    const octokit = new Octokit({ auth: token });

    // Reactive fallback: on 401, attempt one refresh + retry
    (octokit.hook as any).wrap("request", async (request: any, options: any) => {
        try {
            return await request(options);
        } catch (error: any) {
            if (error.status !== 401) throw error;

            const newToken = await refreshGithubToken(userId);
            if (!newToken) throw error;

            options.headers = { ...options.headers, authorization: `token ${newToken}` };
            return await request(options);
        }
    });

    return octokit;
}

export class GitHubNotConnectedError extends Error {
    constructor() {
        super('GitHub account not connected');
        this.name = 'GitHubNotConnectedError';
    }
}
