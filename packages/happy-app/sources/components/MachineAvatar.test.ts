import { describe, expect, it, vi } from 'vitest';

vi.mock('@/sync/storage', () => ({ useSetting: () => ({}) }));
vi.mock('react-native-unistyles', () => ({ StyleSheet: { create: () => ({}) } }));
vi.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
vi.mock('react-native', () => ({ View: () => null }));

import { resolveMachineAvatar } from './MachineAvatar';

describe('resolveMachineAvatar', () => {
    const avatars = {
        a: { icon: 'server', color: 'green' },
        b: { icon: 'constructor', color: 'green' },
        c: { icon: 'server', color: 'chartreuse' },
    };

    it('returns the stored preset', () => {
        expect(resolveMachineAvatar(avatars, 'a')).toEqual({ icon: 'server', color: 'green' });
    });

    it('treats a missing machine, a missing id, or unknown keys as no avatar', () => {
        expect(resolveMachineAvatar(avatars, 'zz')).toBeNull();
        expect(resolveMachineAvatar(avatars, null)).toBeNull();
        expect(resolveMachineAvatar(avatars, 'b')).toBeNull();
        expect(resolveMachineAvatar(avatars, 'c')).toBeNull();
    });
});
