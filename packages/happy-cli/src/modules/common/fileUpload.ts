import { execFile } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { appendFile, mkdir, open, readFile, rename, rm, type FileHandle } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import {
    FILE_ATTACHMENTS_DIR,
    FILE_UPLOAD_LIMIT,
    openFileUploadRequestSchema,
    fileUploadChunkRequestSchema,
    closeFileUploadRequestSchema,
    type MessageAttachment,
    type OpenFileUploadResponse,
    type FileUploadChunkResponse,
    type CloseFileUploadResponse,
    type FileUploadFailure,
} from 'happy-wire';
import { logger } from '@/ui/logger';

const execFileAsync = promisify(execFile);
const TTL = 120_000;
const NAME_LIMIT = 200;

class UploadError extends Error {
    constructor(public code: FileUploadFailure['code'], message: string) {
        super(message);
    }
}

function failure(error: unknown): FileUploadFailure {
    return {
        success: false,
        code: error instanceof UploadError ? error.code : 'unavailable',
        error: error instanceof UploadError ? error.message : 'Cannot write the file',
    };
}

/** The file's own name, safe to create on any platform: no directories, no reserved characters. */
export function sanitizeAttachmentName(name: string): string {
    const base = (name.split(/[\\/]/).pop() ?? '')
        .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '_')
        .trim();
    if (!base || base === '.' || base === '..') return 'file';
    if (base.length <= NAME_LIMIT) return base;
    const dot = base.lastIndexOf('.');
    const extension = dot > 0 && base.length - dot <= 16 ? base.slice(dot) : '';
    return base.slice(0, NAME_LIMIT - extension.length) + extension;
}

function folderName(now: Date): string {
    const pad = (value: number) => String(value).padStart(2, '0');
    const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
    const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    return `${date}-${time}-${randomBytes(3).toString('hex')}`;
}

/**
 * Keeps the attachments out of `git status` by listing the folder in the repository's own
 * `info/exclude`, which is never committed. Outside a repository there is nothing to do.
 */
export async function excludeAttachmentsFromGit(workingDirectory: string): Promise<void> {
    const pattern = `${FILE_ATTACHMENTS_DIR.split('/')[0]}/`;
    let excludeFile: string;
    try {
        const { stdout } = await execFileAsync('git', ['rev-parse', '--git-path', 'info/exclude'], { cwd: workingDirectory });
        excludeFile = resolve(workingDirectory, stdout.trim());
    } catch {
        return;
    }
    let current = '';
    try {
        current = await readFile(excludeFile, 'utf8');
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (current.split(/\r?\n/).some((line) => line.trim() === pattern || line.trim() === `/${pattern}`)) return;
    await mkdir(dirname(excludeFile), { recursive: true });
    await appendFile(excludeFile, `${current && !current.endsWith('\n') ? '\n' : ''}${pattern}\n`);
}

/**
 * The prompt the agent sees: the user's text followed by the attached files' paths, which it
 * reads with its own tools. The app shows the text and the files apart, so this never reaches it.
 */
export function appendAttachmentsToPrompt(text: string, attachments: MessageAttachment[] | undefined): string {
    if (!attachments?.length) return text;
    const block = [
        '<attached-files>',
        'The user attached these files to this message. Read them as needed:',
        ...attachments.map((attachment) => `- ${attachment.path}`),
        '</attached-files>',
    ].join('\n');
    return text.trim() ? `${text}\n\n${block}` : block;
}

type Upload = {
    handle: FileHandle;
    folder: string;
    partPath: string;
    path: string;
    size: number;
    received: number;
    timer: ReturnType<typeof setTimeout>;
};

/**
 * Receives files the app attaches to a message, one chunk at a time, into a fresh folder under
 * the session's `.happy-next/attachments`. A file is written as `<name>.part` and only takes its
 * name once every byte has arrived; an abandoned upload is removed with its folder.
 */
export function createFileUploadHandlers(workingDirectory: string) {
    const uploads = new Map<string, Upload>();
    let gitExcluded = false;

    async function discard(token: string) {
        const upload = uploads.get(token);
        if (!upload) return;
        uploads.delete(token);
        clearTimeout(upload.timer);
        await upload.handle.close().catch(() => {});
        await rm(upload.folder, { recursive: true, force: true }).catch(() => {});
    }

    return {
        async open(input: unknown): Promise<OpenFileUploadResponse> {
            try {
                const parsed = openFileUploadRequestSchema.safeParse(input);
                if (!parsed.success) throw new UploadError('denied', 'Invalid upload request');
                if (parsed.data.size > FILE_UPLOAD_LIMIT) throw new UploadError('too_large', 'File exceeds the upload size limit');
                if (!gitExcluded) {
                    gitExcluded = true;
                    await excludeAttachmentsFromGit(workingDirectory).catch((error) => {
                        logger.debug('[fileUpload] Failed to exclude attachments from git:', error);
                    });
                }
                const folder = join(resolve(workingDirectory), FILE_ATTACHMENTS_DIR, folderName(new Date()));
                await mkdir(folder, { recursive: true });
                const path = join(folder, sanitizeAttachmentName(parsed.data.name));
                const partPath = `${path}.part`;
                const handle = await open(partPath, 'wx');
                const token = randomUUID();
                const timer = setTimeout(() => void discard(token), TTL);
                timer.unref();
                uploads.set(token, { handle, folder, partPath, path, size: parsed.data.size, received: 0, timer });
                return { success: true, token, path };
            } catch (error) {
                logger.debug('[fileUpload] Failed to open upload:', error);
                return failure(error);
            }
        },
        async chunk(input: unknown): Promise<FileUploadChunkResponse> {
            const parsed = fileUploadChunkRequestSchema.safeParse(input);
            if (!parsed.success) return failure(new UploadError('denied', 'Invalid chunk request'));
            const upload = uploads.get(parsed.data.token);
            if (!upload) return failure(new UploadError('expired', 'Upload expired; attach the file again'));
            if (parsed.data.offset !== upload.received) return failure(new UploadError('denied', 'Unexpected chunk offset'));
            const bytes = Buffer.from(parsed.data.content, 'base64');
            if (upload.received + bytes.length > upload.size) {
                await discard(parsed.data.token);
                return failure(new UploadError('too_large', 'File is larger than announced'));
            }
            try {
                await upload.handle.write(bytes);
            } catch (error) {
                await discard(parsed.data.token);
                return failure(error);
            }
            upload.received += bytes.length;
            upload.timer.refresh();
            return { success: true, received: upload.received };
        },
        async close(input: unknown): Promise<CloseFileUploadResponse> {
            const parsed = closeFileUploadRequestSchema.safeParse(input);
            if (!parsed.success) return failure(new UploadError('denied', 'Invalid close request'));
            const { token, commit } = parsed.data;
            const upload = uploads.get(token);
            if (!upload) {
                return commit ? failure(new UploadError('expired', 'Upload expired; attach the file again')) : { success: true, path: null };
            }
            if (!commit || upload.received !== upload.size) {
                await discard(token);
                return commit ? failure(new UploadError('denied', 'Upload is incomplete')) : { success: true, path: null };
            }
            uploads.delete(token);
            clearTimeout(upload.timer);
            try {
                await upload.handle.close();
                await rename(upload.partPath, upload.path);
                return { success: true, path: upload.path };
            } catch (error) {
                await rm(upload.folder, { recursive: true, force: true }).catch(() => {});
                return failure(error);
            }
        },
    };
}
