import { db } from "@/storage/db";
import { Context } from "@/context";
import { encryptString } from "@/modules/encrypt";
import { uploadImage } from "@/storage/uploadImage";
import { separateName } from "@/utils/separateName";
import { GitHubProfile } from "@/app/api/types";
import { allocateUserSeq } from "@/storage/seq";
import { buildUpdateAccountUpdate, eventRouter } from "@/app/events/eventRouter";
import { randomKeyNaked } from "@/utils/randomKeyNaked";
import { githubDisconnect } from "./githubDisconnect";
import { getNameFromGitHubProfile } from "./githubName";

/**
 * Connects a GitHub account to a user profile.
 * 
 * Flow:
 * 1. Check if already connected to same account - refresh profile if yes
 * 2. If GitHub account is connected to another user - disconnect it first
 * 3. Upload avatar to S3 (non-transactional operation)
 * 4. In transaction: persist GitHub account and link to user with GitHub username
 * 5. Send socket update after transaction completes
 * 
 * @param ctx - Request context containing user ID
 * @param githubProfile - GitHub profile data from OAuth
 * @param accessToken - GitHub access token for API access
 * @param tokenMeta - Optional refresh token and expiry from GitHub OAuth
 */
export async function githubConnect(
    ctx: Context,
    githubProfile: GitHubProfile,
    accessToken: string,
    tokenMeta?: { refreshToken?: string; expiresIn?: number }
): Promise<void> {
    const userId = ctx.uid;
    const githubUserId = githubProfile.id.toString();

    // Step 1: Check if user is already connected to this exact GitHub account
    const currentUser = await db.account.findFirstOrThrow({
        where: { id: userId },
        select: { githubUserId: true, username: true }
    });
    const isAlreadyConnectedToSameGitHub = currentUser.githubUserId === githubUserId;

    // Step 2: Check if GitHub account is connected to another user
    if (!isAlreadyConnectedToSameGitHub) {
        const existingConnection = await db.account.findFirst({
            where: {
                githubUserId: githubUserId,
                NOT: { id: userId }
            }
        });
        if (existingConnection) {
            const disconnectCtx: Context = Context.create(existingConnection.id);
            await githubDisconnect(disconnectCtx);
        }
    }

    // Step 3: Upload avatar to S3 (outside transaction for performance)
    const imageResponse = await fetch(githubProfile.avatar_url);
    const imageBuffer = await imageResponse.arrayBuffer();
    const avatar = await uploadImage(userId, 'avatars', 'github', githubProfile.avatar_url, Buffer.from(imageBuffer));

    const name = getNameFromGitHubProfile(githubProfile);

    // Step 4: Start transaction for atomic database operations
    await db.$transaction(async (tx) => {

        // Upsert GitHub user record with encrypted token
        const meta = tokenMetaFields(userId, tokenMeta);
        await tx.githubUser.upsert({
            where: { id: githubUserId },
            update: {
                profile: githubProfile,
                token: encryptString(['user', userId, 'github', 'token'], accessToken),
                ...meta,
            },
            create: {
                id: githubUserId,
                profile: githubProfile,
                token: encryptString(['user', userId, 'github', 'token'], accessToken),
                ...meta,
            }
        });

        // Link GitHub account to user
        await tx.account.update({
            where: { id: userId },
            data: {
                githubUserId: githubUserId,
                username: githubProfile.login,
                firstName: name.firstName,
                lastName: name.lastName,
                avatar: avatar
            }
        });
    });

    // Step 5: Send update via socket (after transaction completes)
    const updSeq = await allocateUserSeq(userId);
    const updatePayload = buildUpdateAccountUpdate(userId, {
        github: githubProfile,
        username: githubProfile.login,
        firstName: name.firstName,
        lastName: name.lastName,
        avatar: avatar
    }, updSeq, randomKeyNaked(12));

    eventRouter.emitUpdate({
        userId,
        payload: updatePayload,
        recipientFilter: { type: 'user-scoped-only' }
    });
}

function tokenMetaFields(userId: string, meta?: { refreshToken?: string; expiresIn?: number }) {
    if (!meta) return {};
    return {
        ...(meta.refreshToken && {
            refreshToken: encryptString(['user', userId, 'github', 'refreshToken'], meta.refreshToken),
        }),
        ...(meta.expiresIn && {
            expiresAt: new Date(Date.now() + meta.expiresIn * 1000),
        }),
    };
}
