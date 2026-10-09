import {
    FILE_UPLOAD_CHUNK_SIZE,
    FILE_UPLOAD_LIMIT,
    type MessageAttachment,
    type OpenFileUploadRequest,
    type OpenFileUploadResponse,
    type FileUploadChunkResponse,
    type CloseFileUploadResponse,
} from 'happy-wire';
import { encodeBase64 } from '@/encryption/base64';
import { sessionOpenFileUpload, sessionWriteFileUploadChunk, sessionCloseFileUpload } from './ops';

/** `unsupported`: the session's CLI predates attachments and needs upgrading. */
export type FileUploadErrorKind = 'too_large' | 'unsupported' | 'failed';

export class FileUploadError extends Error {
    constructor(public kind: FileUploadErrorKind, message?: string) {
        super(message ?? kind);
    }
}

/** A picked file, read a slice at a time so a large one never sits in memory whole. */
export type FileUploadSource = {
    name: string;
    size: number;
    mimeType?: string;
    read: (offset: number, length: number) => Promise<Uint8Array>;
};

export type FileUploadRpc = {
    open: (request: OpenFileUploadRequest) => Promise<OpenFileUploadResponse>;
    chunk: (token: string, offset: number, content: string) => Promise<FileUploadChunkResponse>;
    close: (token: string, commit: boolean) => Promise<CloseFileUploadResponse>;
};

export function sessionFileUploadRpc(sessionId: string): FileUploadRpc {
    return {
        open: (request) => sessionOpenFileUpload(sessionId, request),
        chunk: (token, offset, content) => sessionWriteFileUploadChunk(sessionId, token, offset, content),
        close: (token, commit) => sessionCloseFileUpload(sessionId, token, commit),
    };
}

// A CLI without the handler answers with a bare `{ error }` instead of a typed response
function isMissingHandler(response: unknown): boolean {
    return typeof response === 'object' && response !== null && !('success' in response) && 'error' in response;
}

/**
 * Writes a file into the session's working directory on its machine, through the session's
 * encrypted RPC channel, and returns where it landed. Aborting discards the partial file.
 */
export async function uploadSessionFile(
    source: FileUploadSource,
    rpc: FileUploadRpc,
    signal: AbortSignal,
    onProgress: (sent: number) => void,
): Promise<MessageAttachment> {
    if (source.size > FILE_UPLOAD_LIMIT) throw new FileUploadError('too_large');
    if (signal.aborted) throw new Error('Aborted');
    const opened = await rpc.open({ name: source.name, size: source.size });
    if (isMissingHandler(opened)) throw new FileUploadError('unsupported');
    if (!opened.success) throw new FileUploadError(opened.code === 'too_large' ? 'too_large' : 'failed', opened.error);
    let committed = false;
    try {
        let offset = 0;
        onProgress(0);
        while (offset < source.size) {
            if (signal.aborted) throw new Error('Aborted');
            const bytes = await source.read(offset, Math.min(FILE_UPLOAD_CHUNK_SIZE, source.size - offset));
            if (!bytes.length) throw new FileUploadError('failed', 'File ended early');
            const written = await rpc.chunk(opened.token, offset, encodeBase64(bytes));
            if (!written.success) throw new FileUploadError('failed', written.error);
            if (written.received !== offset + bytes.length) throw new FileUploadError('failed', 'Upload out of step');
            offset = written.received;
            onProgress(offset);
        }
        if (signal.aborted) throw new Error('Aborted');
        const closed = await rpc.close(opened.token, true);
        committed = true;
        if (!closed.success || !closed.path) throw new FileUploadError('failed', closed.success ? 'No path' : closed.error);
        return { name: source.name, path: closed.path, size: source.size, ...(source.mimeType ? { mimeType: source.mimeType } : {}) };
    } finally {
        if (!committed) void rpc.close(opened.token, false).catch(() => {});
    }
}
