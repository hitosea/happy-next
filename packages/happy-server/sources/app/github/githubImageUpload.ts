import { randomKey } from "@/utils/randomKey";
import { compressForUpload } from "@/storage/compressImage";
import type { Octokit } from "octokit";

const RELEASE_TAG = "_image-uploads";

interface UploadResult {
    url: string;
    width: number;
    height: number;
}

async function getOrCreateImageRelease(octokit: Octokit, owner: string, repo: string): Promise<number> {
    try {
        const { data } = await octokit.rest.repos.getReleaseByTag({ owner, repo, tag: RELEASE_TAG });
        return data.id;
    } catch (e: any) {
        if (e.status === 404) {
            const { data } = await octokit.rest.repos.createRelease({
                owner,
                repo,
                tag_name: RELEASE_TAG,
                name: "Image uploads",
                body: "Auto-created release for hosting images in issue/PR comments. Do not delete.",
                prerelease: true,
            });
            return data.id;
        }
        throw e;
    }
}

export async function githubImageUpload(
    octokit: Octokit,
    owner: string,
    repo: string,
    imageBuffer: Buffer,
    mimeType: string
): Promise<UploadResult> {
    const compressed = await compressForUpload(imageBuffer, mimeType);

    const key = randomKey("ghimg");
    const extension = compressed.mimeType === "image/png" ? "png" : "jpg";
    const filename = `${key}.${extension}`;

    const releaseId = await getOrCreateImageRelease(octokit, owner, repo);

    const { data: asset } = await octokit.rest.repos.uploadReleaseAsset({
        owner,
        repo,
        release_id: releaseId,
        name: filename,
        data: compressed.buffer as unknown as string,
        headers: {
            "content-type": compressed.mimeType,
            "content-length": compressed.buffer.length,
        },
    });

    return {
        url: asset.browser_download_url,
        width: compressed.width,
        height: compressed.height,
    };
}
