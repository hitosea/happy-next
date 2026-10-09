import * as React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet } from 'react-native-unistyles';
import { useSetting } from '@/sync/storage';

/**
 * A machine's preset avatar: one of a few glyphs, white on one of a few colors, picked on the
 * machine's details page and kept in the synced account settings, so it follows the user to every
 * device without touching the machine's own metadata, which the daemon writes too.
 *
 * Machines without one keep their default look, which each place draws itself: the rail's initials,
 * the lists' desktop glyph. `MachineIcon` takes that default as its fallback.
 */
export const MACHINE_AVATAR_ICONS = {
    laptop: 'laptop-outline',
    desktop: 'desktop-outline',
    server: 'server-outline',
    cloud: 'cloud-outline',
    terminal: 'terminal-outline',
    code: 'code-slash-outline',
    chip: 'hardware-chip-outline',
    apple: 'logo-apple',
    linux: 'logo-tux',
    windows: 'logo-windows',
    home: 'home-outline',
    rocket: 'rocket-outline',
} as const satisfies Record<string, React.ComponentProps<typeof Ionicons>['name']>;

export const MACHINE_AVATAR_COLORS = {
    blue: '#007AFF',
    indigo: '#5856D6',
    purple: '#AF52DE',
    pink: '#FF2D55',
    orange: '#FF9500',
    green: '#34C759',
    teal: '#30B0C7',
    gray: '#8E8E93',
} as const;

export type MachineAvatarIcon = keyof typeof MACHINE_AVATAR_ICONS;
export type MachineAvatarColor = keyof typeof MACHINE_AVATAR_COLORS;
export type MachineAvatarPreset = { icon: MachineAvatarIcon; color: MachineAvatarColor };

export const DEFAULT_MACHINE_AVATAR: MachineAvatarPreset = { icon: 'desktop', color: 'blue' };

// Unknown keys, from a newer app or a removed preset, read as no avatar rather than a broken one.
export function resolveMachineAvatar(
    avatars: Record<string, { icon: string; color: string }>,
    machineId: string | null | undefined,
): MachineAvatarPreset | null {
    const stored = machineId ? avatars[machineId] : undefined;
    if (!stored || !Object.hasOwn(MACHINE_AVATAR_ICONS, stored.icon) || !Object.hasOwn(MACHINE_AVATAR_COLORS, stored.color)) return null;
    return stored as MachineAvatarPreset;
}

export function useMachineAvatar(machineId: string | null | undefined): MachineAvatarPreset | null {
    const avatars = useSetting('machineAvatars');
    return resolveMachineAvatar(avatars, machineId);
}

export const MachineAvatar = React.memo(({ avatar, size, statusColor, style }: {
    avatar: MachineAvatarPreset;
    size: number;
    // A small dot at the corner, for lists that showed the machine's state in its glyph's color.
    statusColor?: string;
    style?: StyleProp<ViewStyle>;
}) => {
    const dotSize = Math.max(8, Math.round(size * 0.3));
    return (
        <View
            style={[
                styles.tile,
                { width: size, height: size, borderRadius: Math.round(size * 0.28), backgroundColor: MACHINE_AVATAR_COLORS[avatar.color] },
                style,
            ]}
        >
            <Ionicons name={MACHINE_AVATAR_ICONS[avatar.icon]} size={Math.round(size * 0.58)} color="#FFFFFF" />
            {statusColor && (
                <View
                    style={[
                        styles.statusDot,
                        { width: dotSize, height: dotSize, borderRadius: dotSize / 2, backgroundColor: statusColor },
                    ]}
                />
            )}
        </View>
    );
});

// A machine's avatar where it has one, and the place's own default where it has none.
export const MachineIcon = React.memo(({ machineId, size, fallback, statusColor, style }: {
    machineId: string | null | undefined;
    size: number;
    fallback: React.ReactNode;
    statusColor?: string;
    style?: StyleProp<ViewStyle>;
}) => {
    const avatar = useMachineAvatar(machineId);
    if (!avatar) return <>{fallback}</>;
    return <MachineAvatar avatar={avatar} size={size} statusColor={statusColor} style={style} />;
});

const styles = StyleSheet.create((theme) => ({
    tile: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    statusDot: {
        position: 'absolute',
        right: -2,
        bottom: -2,
        borderWidth: 2,
        borderColor: theme.colors.surface,
    },
}));
