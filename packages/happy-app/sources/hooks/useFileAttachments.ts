import * as React from 'react';
import { Platform } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { File as FsFile } from 'expo-file-system';
import { randomUUID } from 'expo-crypto';
import { FILE_UPLOAD_LIMIT, type MessageAttachment } from 'happy-wire';
import { Modal } from '@/modal';
import { t } from '@/text';
import {
    FileUploadError,
    sessionFileUploadRpc,
    uploadSessionFile,
    type FileUploadErrorKind,
    type FileUploadSource,
} from '@/sync/uploadSessionFile';

export const MAX_FILE_ATTACHMENTS = 10;

/** A file in the composer: uploading to the session's machine, ready to send, or failed. */
export type ComposerFile = {
    id: string;
    name: string;
    size: number;
    status: 'uploading' | 'ready' | 'failed';
    /** Bytes written so far while uploading. */
    sent: number;
    attachment?: MessageAttachment;
    error?: FileUploadErrorKind;
};

type Picked = { name: string; size: number; mimeType?: string; uri: string; file?: File };

function openSource(picked: Picked): { source: FileUploadSource; close: () => void } {
    const base = { name: picked.name, size: picked.size, mimeType: picked.mimeType };
    if (picked.file) {
        const file = picked.file;
        return {
            source: { ...base, read: async (offset, length) => new Uint8Array(await file.slice(offset, offset + length).arrayBuffer()) },
            close: () => {},
        };
    }
    let handle: ReturnType<FsFile['open']> | null = null;
    return {
        source: {
            ...base,
            read: async (offset, length) => {
                handle ??= new FsFile(picked.uri).open();
                handle.offset = offset;
                return handle.readBytes(length);
            },
        },
        close: () => {
            try { handle?.close(); } catch { /* Nothing left to release. */ }
            handle = null;
        },
    };
}

// The picker copies native files into the cache; the copy goes once the file leaves the composer
function discardCopy(picked: Pick<Picked, 'uri' | 'file'> | undefined) {
    if (!picked || picked.file || Platform.OS === 'web') return;
    try {
        const copy = new FsFile(picked.uri);
        if (copy.exists) copy.delete();
    } catch { /* The cache is cleared by the system eventually. */ }
}

/**
 * Files attached in the composer. Each one starts uploading to the session's machine as soon as
 * it is picked, one at a time, so by the time the message is sent only its paths travel with it.
 */
export function useFileAttachments(sessionId: string) {
    const [files, setFiles] = React.useState<ComposerFile[]>([]);
    const filesRef = React.useRef(files);
    filesRef.current = files;
    const picked = React.useRef(new Map<string, Picked>());
    const controllers = React.useRef(new Map<string, AbortController>());
    const queue = React.useRef<Promise<void>>(Promise.resolve());

    const update = React.useCallback((id: string, patch: Partial<ComposerFile>) => {
        setFiles((current) => current.map((file) => file.id === id ? { ...file, ...patch } : file));
    }, []);

    const enqueue = React.useCallback((id: string) => {
        const controller = new AbortController();
        controllers.current.set(id, controller);
        queue.current = queue.current.then(async () => {
            const item = picked.current.get(id);
            if (!item || controller.signal.aborted) return;
            const { source, close } = openSource(item);
            try {
                const attachment = await uploadSessionFile(source, sessionFileUploadRpc(sessionId), controller.signal, (sent) => {
                    if (!controller.signal.aborted) update(id, { sent });
                });
                if (!controller.signal.aborted) update(id, { status: 'ready', sent: item.size, attachment });
            } catch (error) {
                if (controller.signal.aborted) return;
                const kind = error instanceof FileUploadError ? error.kind : 'failed';
                console.error('[FileAttachments] Upload failed:', error);
                update(id, { status: 'failed', error: kind });
                if (kind === 'unsupported') Modal.alert(t('common.error'), t('session.files.cliTooOld'));
            } finally {
                close();
                if (controllers.current.get(id) === controller) controllers.current.delete(id);
            }
        });
    }, [sessionId, update]);

    const pickFiles = React.useCallback(async () => {
        const room = MAX_FILE_ATTACHMENTS - filesRef.current.length;
        if (room <= 0) {
            Modal.alert(t('common.error'), t('session.files.limitReached', { count: MAX_FILE_ATTACHMENTS }));
            return;
        }
        let result: DocumentPicker.DocumentPickerResult;
        try {
            result = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
        } catch (error) {
            console.error('[FileAttachments] Pick failed:', error);
            Modal.alert(t('common.error'), t('session.files.pickFailed'));
            return;
        }
        if (result.canceled) return;

        const added: ComposerFile[] = [];
        const tooLarge: string[] = [];
        for (const asset of result.assets) {
            const size = asset.file?.size ?? asset.size ?? (() => {
                try { return new FsFile(asset.uri).size; } catch { return null; }
            })();
            if (size === null || size === undefined) continue;
            if (size > FILE_UPLOAD_LIMIT) {
                tooLarge.push(asset.name);
                discardCopy(asset);
                continue;
            }
            if (added.length >= room) {
                discardCopy(asset);
                continue;
            }
            const id = randomUUID();
            picked.current.set(id, { name: asset.name, size, mimeType: asset.mimeType, uri: asset.uri, file: asset.file });
            added.push({ id, name: asset.name, size, status: 'uploading', sent: 0 });
        }
        if (tooLarge.length) {
            Modal.alert(t('common.error'), t('session.files.tooLarge', { names: tooLarge.join(', '), limit: FILE_UPLOAD_LIMIT / 1024 / 1024 }));
        } else if (added.length < result.assets.length) {
            Modal.alert(t('common.error'), t('session.files.limitReached', { count: MAX_FILE_ATTACHMENTS }));
        }
        if (!added.length) return;
        setFiles((current) => [...current, ...added]);
        for (const file of added) enqueue(file.id);
    }, [enqueue]);

    const retryFile = React.useCallback((id: string) => {
        if (!picked.current.has(id)) return;
        update(id, { status: 'uploading', sent: 0, error: undefined });
        enqueue(id);
    }, [enqueue, update]);

    const forget = React.useCallback((id: string) => {
        controllers.current.get(id)?.abort();
        controllers.current.delete(id);
        discardCopy(picked.current.get(id));
        picked.current.delete(id);
    }, []);

    const removeFile = React.useCallback((id: string) => {
        forget(id);
        setFiles((current) => current.filter((file) => file.id !== id));
    }, [forget]);

    const clearFiles = React.useCallback(() => {
        for (const id of [...picked.current.keys()]) forget(id);
        setFiles([]);
    }, [forget]);

    React.useEffect(() => () => {
        for (const id of [...picked.current.keys()]) forget(id);
    }, [forget]);

    const attachments = React.useMemo(
        () => files.flatMap((file) => file.status === 'ready' && file.attachment ? [file.attachment] : []),
        [files],
    );

    return {
        files,
        attachments,
        isUploading: files.some((file) => file.status === 'uploading'),
        hasFailed: files.some((file) => file.status === 'failed'),
        pickFiles,
        retryFile,
        removeFile,
        clearFiles,
    };
}
