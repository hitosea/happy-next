import { describe, expect, it, vi } from 'vitest';
import { FILE_UPLOAD_CHUNK_SIZE, FILE_UPLOAD_LIMIT } from 'happy-wire';

vi.mock('./ops', () => ({}));

import { FileUploadError, uploadSessionFile, type FileUploadRpc, type FileUploadSource } from './uploadSessionFile';

const TOKEN = '00000000-0000-4000-8000-000000000000';

function source(size: number): FileUploadSource {
    const data = new Uint8Array(size).map((_, i) => i % 251);
    return { name: 'a.bin', size, read: async (offset, length) => data.slice(offset, offset + length) };
}

function rpc(overrides: Partial<FileUploadRpc> = {}) {
    const received: number[] = [];
    const calls = {
        open: vi.fn<FileUploadRpc['open']>(async () => ({ success: true, token: TOKEN, path: '/w/a.bin' })),
        chunk: vi.fn<FileUploadRpc['chunk']>(async (_token, offset, content) => {
            const length = atob(content).length;
            received.push(length);
            return { success: true, received: offset + length };
        }),
        close: vi.fn<FileUploadRpc['close']>(async (_token, commit) => ({ success: true, path: commit ? '/w/a.bin' : null })),
        ...overrides,
    };
    return { calls, received };
}

describe('uploadSessionFile', () => {
    it('sends the file in chunks, then commits it', async () => {
        const { calls, received } = rpc();
        const progress: number[] = [];
        const size = FILE_UPLOAD_CHUNK_SIZE * 2 + 5;
        const result = await uploadSessionFile(source(size), calls, new AbortController().signal, (sent) => progress.push(sent));
        expect(result).toEqual({ name: 'a.bin', path: '/w/a.bin', size });
        expect(received).toEqual([FILE_UPLOAD_CHUNK_SIZE, FILE_UPLOAD_CHUNK_SIZE, 5]);
        expect(progress.at(-1)).toBe(size);
        expect(calls.close).toHaveBeenCalledTimes(1);
        expect(calls.close).toHaveBeenCalledWith(TOKEN, true);
    });

    it('refuses an oversized file without opening an upload', async () => {
        const { calls } = rpc();
        await expect(uploadSessionFile({ ...source(0), size: FILE_UPLOAD_LIMIT + 1 }, calls, new AbortController().signal, () => {}))
            .rejects.toMatchObject({ kind: 'too_large' });
        expect(calls.open).not.toHaveBeenCalled();
    });

    it('reports a CLI without the handler as unsupported', async () => {
        const { calls } = rpc({ open: vi.fn(async () => ({ error: 'Method not found' }) as never) });
        const error = await uploadSessionFile(source(3), calls, new AbortController().signal, () => {}).catch((e) => e);
        expect(error).toBeInstanceOf(FileUploadError);
        expect(error.kind).toBe('unsupported');
    });

    it('discards the partial file when a chunk fails or the upload is aborted', async () => {
        const failing = rpc({ chunk: vi.fn(async () => ({ success: false as const, code: 'expired' as const, error: 'gone' })) });
        await expect(uploadSessionFile(source(3), failing.calls, new AbortController().signal, () => {})).rejects.toMatchObject({ kind: 'failed' });
        expect(failing.calls.close).toHaveBeenCalledWith(TOKEN, false);

        const controller = new AbortController();
        const aborted = rpc();
        await expect(uploadSessionFile(source(FILE_UPLOAD_CHUNK_SIZE * 2), aborted.calls, controller.signal, (sent) => {
            if (sent > 0) controller.abort();
        })).rejects.toThrow('Aborted');
        expect(aborted.calls.close).toHaveBeenCalledWith(TOKEN, false);
    });
});
