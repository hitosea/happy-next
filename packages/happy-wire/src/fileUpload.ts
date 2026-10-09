import { z } from 'zod';

export const FILE_UPLOAD_LIMIT = 20 * 1024 * 1024;
export const FILE_UPLOAD_CHUNK_SIZE = 192 * 1024;
/** Where a session's attachments land, relative to its working directory. */
export const FILE_ATTACHMENTS_DIR = '.happy-next/attachments';

/** A file the user attached to a message, already written to the session's machine. */
export const messageAttachmentSchema = z.object({
    name: z.string(),
    /** Absolute path on the session's machine. */
    path: z.string(),
    size: z.number(),
    mimeType: z.string().optional(),
});
export type MessageAttachment = z.infer<typeof messageAttachmentSchema>;

export const openFileUploadRequestSchema = z.object({
    name: z.string().min(1).max(255),
    size: z.number().int().nonnegative(),
});
export type OpenFileUploadRequest = z.infer<typeof openFileUploadRequestSchema>;

export const fileUploadChunkRequestSchema = z.object({
    token: z.string().uuid(),
    offset: z.number().int().nonnegative(),
    // Base64 of at most one chunk
    content: z.string().max(Math.ceil(FILE_UPLOAD_CHUNK_SIZE / 3) * 4),
});
export type FileUploadChunkRequest = z.infer<typeof fileUploadChunkRequestSchema>;

/** `commit` keeps the file once every byte has arrived; otherwise the partial file is discarded. */
export const closeFileUploadRequestSchema = z.object({
    token: z.string().uuid(),
    commit: z.boolean(),
});
export type CloseFileUploadRequest = z.infer<typeof closeFileUploadRequestSchema>;

export type FileUploadErrorCode = 'unavailable' | 'too_large' | 'denied' | 'expired';
export type FileUploadFailure = {
    success: false;
    code: FileUploadErrorCode;
    error: string;
};
export type OpenFileUploadResponse = FileUploadFailure | { success: true; token: string; path: string };
export type FileUploadChunkResponse = FileUploadFailure | { success: true; received: number };
export type CloseFileUploadResponse = FileUploadFailure | { success: true; path: string | null };
