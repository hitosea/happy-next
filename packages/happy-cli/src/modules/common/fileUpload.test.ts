import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { FILE_ATTACHMENTS_DIR, FILE_UPLOAD_CHUNK_SIZE, FILE_UPLOAD_LIMIT } from 'happy-wire';
import { appendAttachmentsToPrompt, createFileUploadHandlers, excludeAttachmentsFromGit, sanitizeAttachmentName } from './fileUpload';

const exec = promisify(execFile);
let root: string;
let handlers: ReturnType<typeof createFileUploadHandlers>;

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'happy-upload-'));
    handlers = createFileUploadHandlers(root);
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

async function upload(name: string, data: Buffer) {
    const opened = await handlers.open({ name, size: data.length });
    if (!opened.success) throw new Error(opened.error);
    for (let offset = 0; offset < data.length; offset += FILE_UPLOAD_CHUNK_SIZE) {
        const content = data.subarray(offset, offset + FILE_UPLOAD_CHUNK_SIZE).toString('base64');
        const chunk = await handlers.chunk({ token: opened.token, offset, content });
        if (!chunk.success) throw new Error(chunk.error);
    }
    return { opened, closed: await handlers.close({ token: opened.token, commit: true }) };
}

describe('file upload handlers', () => {
    it('writes a multi-chunk file under the attachments folder', async () => {
        const data = Buffer.alloc(FILE_UPLOAD_CHUNK_SIZE * 2 + 17, 7);
        const { opened, closed } = await upload('report.pdf', data);
        expect(closed).toEqual({ success: true, path: opened.success ? opened.path : null });
        const path = closed.success ? closed.path! : '';
        expect(path.startsWith(join(root, FILE_ATTACHMENTS_DIR))).toBe(true);
        expect(path.endsWith('/report.pdf')).toBe(true);
        expect(await readFile(path)).toEqual(data);
        expect(await readdir(dirname(path))).toEqual(['report.pdf']);
    });

    it('accepts an empty file', async () => {
        const { closed } = await upload('empty.txt', Buffer.alloc(0));
        expect(closed.success && (await readFile(closed.path!)).length).toBe(0);
    });

    it('keeps two files with the same name apart', async () => {
        const first = await upload('a.txt', Buffer.from('one'));
        const second = await upload('a.txt', Buffer.from('two'));
        expect(first.closed.success && second.closed.success).toBe(true);
        if (first.closed.success && second.closed.success) expect(first.closed.path).not.toBe(second.closed.path);
    });

    it('refuses files over the limit and chunks beyond the announced size', async () => {
        expect(await handlers.open({ name: 'big.bin', size: FILE_UPLOAD_LIMIT + 1 })).toMatchObject({ success: false, code: 'too_large' });
        const opened = await handlers.open({ name: 'small.bin', size: 2 });
        if (!opened.success) throw new Error(opened.error);
        expect(await handlers.chunk({ token: opened.token, offset: 0, content: Buffer.from('abc').toString('base64') }))
            .toMatchObject({ success: false, code: 'too_large' });
        expect(await handlers.chunk({ token: opened.token, offset: 0, content: '' })).toMatchObject({ success: false, code: 'expired' });
    });

    it('rejects out-of-order chunks and incomplete commits', async () => {
        const opened = await handlers.open({ name: 'a.txt', size: 4 });
        if (!opened.success) throw new Error(opened.error);
        expect(await handlers.chunk({ token: opened.token, offset: 2, content: 'YWI=' })).toMatchObject({ success: false, code: 'denied' });
        expect(await handlers.chunk({ token: opened.token, offset: 0, content: 'YWI=' })).toEqual({ success: true, received: 2 });
        expect(await handlers.close({ token: opened.token, commit: true })).toMatchObject({ success: false, code: 'denied' });
        expect(await readdir(join(root, FILE_ATTACHMENTS_DIR))).toEqual([]);
    });

    it('removes an abandoned upload with its folder', async () => {
        const opened = await handlers.open({ name: 'a.txt', size: 4 });
        if (!opened.success) throw new Error(opened.error);
        expect(await handlers.close({ token: opened.token, commit: false })).toEqual({ success: true, path: null });
        expect(await readdir(join(root, FILE_ATTACHMENTS_DIR))).toEqual([]);
    });
});

describe('sanitizeAttachmentName', () => {
    it.each([
        ['../../etc/passwd', 'passwd'],
        ['C:\\Users\\me\\notes.md', 'notes.md'],
        ['..', 'file'],
        ['', 'file'],
        ['a<b>:c?.txt', 'a_b__c_.txt'],
        ['.env', '.env'],
    ])('%j → %j', (input, expected) => {
        expect(sanitizeAttachmentName(input)).toBe(expected);
    });

    it('shortens long names but keeps the extension', () => {
        const name = sanitizeAttachmentName(`${'x'.repeat(300)}.pdf`);
        expect(name.length).toBe(200);
        expect(name.endsWith('.pdf')).toBe(true);
    });
});

describe('excludeAttachmentsFromGit', () => {
    it('adds the folder to info/exclude once', async () => {
        await exec('git', ['init', '-q'], { cwd: root });
        await excludeAttachmentsFromGit(root);
        await excludeAttachmentsFromGit(root);
        const exclude = await readFile(join(root, '.git', 'info', 'exclude'), 'utf8');
        expect(exclude.split('\n').filter((line) => line === '.happy-next/')).toHaveLength(1);
    });

    it('does nothing outside a repository', async () => {
        await expect(excludeAttachmentsFromGit(root)).resolves.toBeUndefined();
    });
});

describe('appendAttachmentsToPrompt', () => {
    const attachments = [{ name: 'a.pdf', path: '/w/.happy-next/attachments/x/a.pdf', size: 1 }];

    it('leaves text without attachments untouched', () => {
        expect(appendAttachmentsToPrompt('hi', undefined)).toBe('hi');
        expect(appendAttachmentsToPrompt('hi', [])).toBe('hi');
    });

    it('lists the paths after the text, or alone', () => {
        expect(appendAttachmentsToPrompt('summarize', attachments)).toBe(
            'summarize\n\n<attached-files>\nThe user attached these files to this message. Read them as needed:\n- /w/.happy-next/attachments/x/a.pdf\n</attached-files>'
        );
        expect(appendAttachmentsToPrompt('  ', attachments).startsWith('<attached-files>')).toBe(true);
    });
});
