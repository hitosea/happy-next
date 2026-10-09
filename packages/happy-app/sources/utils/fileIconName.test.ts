import { describe, expect, it } from 'vitest';
import { getIcon } from '@peoplesgrocers/seti-ui-file-icons';
import { getSetiFileName, isPresentation } from './fileIconName';

const iconOf = (fileName: string) => getIcon(getSetiFileName(fileName));

describe('getSetiFileName', () => {
    it('keeps names Seti already resolves', () => {
        for (const name of ['report.pdf', 'notes.docx', 'sheet.xlsx', 'song.mp3', 'npm-debug.log', 'README.txt', 'server.key', 'Dockerfile', 'index.d.ts']) {
            expect(getSetiFileName(name)).toBe(name);
        }
    });

    it('draws common types Seti misses as their closest known type', () => {
        expect(iconOf('backup.tgz')).toEqual(getIcon('a.zip'));
        expect(iconOf('backup.tar.gz')).toEqual(getIcon('a.zip'));
        expect(iconOf('memo.m4a')).toEqual(getIcon('a.mp3'));
        expect(iconOf('IMG_0001.HEIC')).toEqual(getIcon('a.png'));
        expect(iconOf('server.log')).toEqual(getIcon('a.txt'));
    });

    it('matches extensions case-insensitively', () => {
        expect(iconOf('SCAN.PDF')).toEqual(getIcon('a.pdf'));
        expect(iconOf('Budget.XLSX')).toEqual(getIcon('a.xlsx'));
    });

    it('leaves unknown and extensionless names on the default icon', () => {
        expect(iconOf('data.qqq')).toEqual(getIcon(''));
        expect(getSetiFileName('NOTES')).toBe('NOTES');
    });
});

describe('isPresentation', () => {
    it('recognizes slide decks', () => {
        expect(isPresentation('deck.pptx')).toBe(true);
        expect(isPresentation('OLD.PPT')).toBe(true);
        expect(isPresentation('report.pdf')).toBe(false);
        expect(isPresentation('sheet.xlsx')).toBe(false);
    });

    it('treats .key as Keynote only for attachments', () => {
        expect(isPresentation('server.key')).toBe(false);
        expect(isPresentation('talk.key', true)).toBe(true);
    });
});
