import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ sessionArchive: vi.fn(), updateSessionActivity: vi.fn(), clearSessionMessageCache: vi.fn() }));
vi.mock('./ops', () => ({ sessionArchive: mocks.sessionArchive }));
vi.mock('./storage', () => ({ storage: { getState: () => ({ sessions: {}, updateSessionActivity: mocks.updateSessionActivity }) } }));
vi.mock('./sync', () => ({ sync: { clearSessionMessageCache: mocks.clearSessionMessageCache } }));
vi.mock('@/text', () => ({ t: (key: string) => key }));
import { archiveSessionFromApp } from './archiveSessionFromApp';
import type { Session } from './storageTypes';

const live = { id: 's1', active: true, metadata: { flavor: 'claude', machineId: 'm1' } } as unknown as Session;

describe('archiveSessionFromApp', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    it('fails, and puts a live session back, when the archive cannot be recorded', async () => {
        mocks.sessionArchive.mockResolvedValue({ success: false, message: 'archive-metadata-update-failed' });
        await expect(archiveSessionFromApp(live)).rejects.toThrow('archive-metadata-update-failed');
        expect(mocks.sessionArchive).toHaveBeenCalledWith('s1');
        expect(mocks.updateSessionActivity).toHaveBeenNthCalledWith(1, 's1', false);
        expect(mocks.updateSessionActivity).toHaveBeenNthCalledWith(2, 's1', true);
        expect(mocks.clearSessionMessageCache).not.toHaveBeenCalled();
    });

    it('archives a live session whose stop succeeds', async () => {
        mocks.sessionArchive.mockResolvedValue({ success: true });
        await expect(archiveSessionFromApp(live)).resolves.toEqual({ nativeArchiveError: undefined });
        expect(mocks.updateSessionActivity).toHaveBeenCalledTimes(1);
        expect(mocks.clearSessionMessageCache).toHaveBeenCalledWith('s1');
    });
});
