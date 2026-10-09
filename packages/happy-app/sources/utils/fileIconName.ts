import { getIcon } from '@peoplesgrocers/seti-ui-file-icons';

// Common types Seti has no icon for, drawn as the closest type it knows.
const SETI_ALIASES: Record<string, string> = {
    tar: 'zip', gz: 'zip', tgz: 'zip', '7z': 'zip', rar: 'zip', bz2: 'zip', xz: 'zip',
    m4a: 'mp3', aac: 'mp3',
    heic: 'png', heif: 'png',
    log: 'txt',
};

const DEFAULT_SVG = getIcon('').svg;

function extensionOf(fileName: string): string | null {
    const dot = fileName.lastIndexOf('.');
    return dot === -1 ? null : fileName.slice(dot + 1).toLowerCase();
}

/** The name to look up in Seti. Names Seti already resolves keep their icon; misses are retried by lowercased, aliased extension. */
export function getSetiFileName(fileName: string): string {
    const ext = extensionOf(fileName);
    if (ext === null || getIcon(fileName).svg !== DEFAULT_SVG) return fileName;
    return `file.${SETI_ALIASES[ext] ?? ext}`;
}

/** Seti has no slide deck icon. `.key` is a private key in a repo, but an attached file is far more likely Keynote. */
export function isPresentation(fileName: string, attachment = false): boolean {
    const ext = extensionOf(fileName);
    return ext === 'ppt' || ext === 'pptx' || (attachment && ext === 'key');
}
