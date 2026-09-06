import sharp from "sharp";

const MAX_DIMENSION = 1568;
const MAX_SIZE_BYTES = 1.5 * 1024 * 1024;
const JPEG_QUALITY = 80;

export async function compressForUpload(imageBuffer: Buffer, mimeType: string): Promise<{ buffer: Buffer; width: number; height: number; mimeType: string }> {
    const meta = await sharp(imageBuffer).metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;

    const needsResize = width > MAX_DIMENSION || height > MAX_DIMENSION;
    const needsCompress = imageBuffer.length > MAX_SIZE_BYTES;

    if (!needsResize && !needsCompress) {
        return { buffer: imageBuffer, width, height, mimeType };
    }

    let pipeline = sharp(imageBuffer);
    if (needsResize) {
        pipeline = pipeline.resize(MAX_DIMENSION, MAX_DIMENSION, { fit: "inside", withoutEnlargement: true });
    }

    const output = await pipeline.jpeg({ quality: JPEG_QUALITY }).toBuffer({ resolveWithObject: true });
    return {
        buffer: output.data,
        width: output.info.width,
        height: output.info.height,
        mimeType: "image/jpeg",
    };
}
