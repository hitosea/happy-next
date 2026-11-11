import { z } from 'zod';
import { getFilePreviewType } from './filePreview';

export const openToolImagePreviewRequestSchema = z.object({
    callId: z.string().min(1).max(512),
}).strict();

export type OpenToolImagePreviewRequest = z.infer<typeof openToolImagePreviewRequestSchema>;

// Where each image-bearing tool keeps the path it reads. `view_image` only ever shows images, so
// its path is taken as-is; file readers are filtered by extension because the CLI writes one record
// per call — without the filter every text read would leave one behind. The CLI registers by this
// table and the app renders by it, so a call the CLI did not register shows as "no registered
// image" rather than a picture.
const imageTools: Record<string, { field: string; imageExtensionRequired: boolean }> = {
    'view_image': { field: 'path', imageExtensionRequired: false },
    'image_generation': { field: 'path', imageExtensionRequired: false },
    'Read': { field: 'file_path', imageExtensionRequired: true },
    'read': { field: 'file_path', imageExtensionRequired: true },
};

/**
 * Path an image-bearing tool call points at, or null when the call has no previewable image.
 * Gemini sends the path inside `locations` instead of `file_path`.
 */
export function getToolImagePath(toolName: string, input: unknown): string | null {
    const tool = imageTools[toolName];
    if (!tool || !input || typeof input !== 'object') return null;
    const record = input as Record<string, any>;
    const candidate = record[tool.field] ?? record.locations?.[0]?.path;
    if (typeof candidate !== 'string' || !candidate.trim()) return null;
    if (tool.imageExtensionRequired && getFilePreviewType(candidate)?.kind !== 'image') return null;
    return candidate;
}
