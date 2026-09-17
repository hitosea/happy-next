import { randomKey } from "@/utils/randomKey";
import { processImage } from "@/storage/processImage";
import { s3bucket, s3client, s3public } from "@/storage/files";
import { db } from "@/storage/db";
import { compressForUpload } from "@/storage/compressImage";

interface UploadChatImageResult {
    url: string;
    path: string;
    width: number;
    height: number;
    thumbhash: string;
    mimeType: string;
}

/**
 * Uploads a chat image to S3 and returns the public URL and metadata.
 *
 * Images are stored under `public/users/{ownerId}/chat/{sessionId}/`. The owner
 * is the session account holder, not the uploader: in shared sessions a
 * recipient with edit access uploads images too, and the file should live in
 * the session owner's directory to keep all session materials together.
 *
 * The DB row is attributed to the owner (not the uploader) for the same reason.
 *
 * @param ownerId - The session owner ID (directory + DB attribution)
 * @param sessionId - The chat session ID for organizing uploads
 * @param imageBuffer - The raw image data as a Buffer
 * @param mimeType - The MIME type of the image (image/png or image/jpeg)
 * @returns Upload result with URL, path, dimensions, thumbhash, and mime type
 */
export async function chatImageUpload(
    ownerId: string,
    sessionId: string,
    imageBuffer: Buffer,
    mimeType: string
): Promise<UploadChatImageResult> {
    // Compress image server-side if needed (resize + JPEG quality)
    const compressed = await compressForUpload(imageBuffer, mimeType);

    // Process image to get thumbhash
    const processed = await processImage(compressed.buffer);

    // Generate unique filename
    const key = randomKey("img");
    const extension = compressed.mimeType === "image/png" ? "png" : "jpg";
    const filename = `${key}.${extension}`;
    const path = `public/users/${ownerId}/chat/${sessionId}/${filename}`;

    // Upload to S3
    await s3client.putObject(s3bucket, path, compressed.buffer, compressed.buffer.length, {
        "Content-Type": compressed.mimeType,
    });

    // Record in database
    await db.uploadedFile.create({
        data: {
            accountId: ownerId,
            path,
            width: compressed.width,
            height: compressed.height,
            thumbhash: processed.thumbhash,
        },
    });

    return {
        url: `${s3public}/${path}`,
        path,
        width: compressed.width,
        height: compressed.height,
        thumbhash: processed.thumbhash,
        mimeType: compressed.mimeType,
    };
}
