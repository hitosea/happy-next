import * as React from 'react';
import { View, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Item } from '@/components/Item';
import { Text } from '@/components/StyledText';
import { Typography } from '@/constants/Typography';
import { useSettingMutable } from '@/sync/storage';
import { t } from '@/text';
import {
    DEFAULT_MACHINE_AVATAR,
    MACHINE_AVATAR_COLORS,
    MACHINE_AVATAR_ICONS,
    MachineAvatar,
    resolveMachineAvatar,
    type MachineAvatarColor,
    type MachineAvatarIcon,
    type MachineAvatarPreset,
} from './MachineAvatar';

/**
 * The machine details page's avatar row: tapped, it opens the presets in place, a row of glyphs and
 * a row of colors, picked separately and saved as they are tapped. Restoring the default drops the
 * machine's entry, so it goes back to the initials and desktop glyph it had before.
 *
 * Meant as an `ItemGroup` child, which hands it `showDivider`; the row and the presets keep their
 * own dividers.
 */
export const MachineAvatarPicker = React.memo(({ machineId }: { machineId: string; showDivider?: boolean }) => {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const [avatars, setAvatars] = useSettingMutable('machineAvatars');
    const [expanded, setExpanded] = React.useState(false);
    const avatar = resolveMachineAvatar(avatars, machineId);

    const save = (next: MachineAvatarPreset | null) => {
        const { [machineId]: _previous, ...rest } = avatars;
        setAvatars(next ? { ...rest, [machineId]: next } : rest);
    };
    const pickIcon = (icon: MachineAvatarIcon) => save({ icon, color: avatar?.color ?? DEFAULT_MACHINE_AVATAR.color });
    const pickColor = (color: MachineAvatarColor) => save({ icon: avatar?.icon ?? DEFAULT_MACHINE_AVATAR.icon, color });

    return (
        <View>
            <Item
                title={t('machine.avatar')}
                subtitle={t('machine.avatarDescription')}
                icon={avatar
                    ? <MachineAvatar avatar={avatar} size={29} />
                    : <Ionicons name="desktop-outline" size={29} color="#5856D6" />}
                rightElement={<Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={theme.colors.textSecondary} />}
                showChevron={false}
                showDivider={expanded}
                onPress={() => setExpanded(value => !value)}
            />
            {expanded && (
                <View style={styles.presets}>
                    <Text style={styles.caption}>{t('machine.avatarIcon')}</Text>
                    <View style={styles.grid}>
                        {(Object.keys(MACHINE_AVATAR_ICONS) as MachineAvatarIcon[]).map(icon => {
                            const selected = avatar?.icon === icon;
                            return (
                                <Pressable
                                    key={icon}
                                    accessibilityRole="button"
                                    accessibilityLabel={icon}
                                    accessibilityState={{ selected }}
                                    onPress={() => pickIcon(icon)}
                                    style={({ pressed }) => [
                                        styles.iconCell,
                                        selected && { backgroundColor: MACHINE_AVATAR_COLORS[avatar.color] },
                                        pressed && !selected && styles.pressed,
                                    ]}
                                >
                                    <Ionicons
                                        name={MACHINE_AVATAR_ICONS[icon]}
                                        size={22}
                                        color={selected ? '#FFFFFF' : theme.colors.textSecondary}
                                    />
                                </Pressable>
                            );
                        })}
                    </View>
                    <Text style={styles.caption}>{t('machine.avatarColor')}</Text>
                    <View style={styles.grid}>
                        {(Object.keys(MACHINE_AVATAR_COLORS) as MachineAvatarColor[]).map(color => {
                            const selected = avatar?.color === color;
                            return (
                                <Pressable
                                    key={color}
                                    accessibilityRole="button"
                                    accessibilityLabel={color}
                                    accessibilityState={{ selected }}
                                    onPress={() => pickColor(color)}
                                    style={({ pressed }) => [
                                        styles.colorCell,
                                        selected && styles.colorCellSelected,
                                        pressed && styles.pressed,
                                    ]}
                                >
                                    <View style={[styles.colorSwatch, { backgroundColor: MACHINE_AVATAR_COLORS[color] }]}>
                                        {selected && <Ionicons name="checkmark" size={18} color="#FFFFFF" />}
                                    </View>
                                </Pressable>
                            );
                        })}
                    </View>
                    {avatar && (
                        <Pressable onPress={() => save(null)} hitSlop={8} style={styles.reset}>
                            <Text style={styles.resetText}>{t('machine.avatarReset')}</Text>
                        </Pressable>
                    )}
                </View>
            )}
        </View>
    );
});

const stylesheet = StyleSheet.create((theme) => ({
    presets: {
        paddingHorizontal: 16,
        paddingTop: 12,
        paddingBottom: 16,
        gap: 10,
    },
    caption: {
        fontSize: 13,
        color: theme.colors.textSecondary,
        ...Typography.default(),
    },
    grid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 10,
    },
    iconCell: {
        width: 44,
        height: 44,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.surfaceHighest,
    },
    colorCell: {
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 2,
        borderColor: 'transparent',
    },
    colorCellSelected: {
        borderColor: theme.colors.text,
    },
    colorSwatch: {
        width: 34,
        height: 34,
        borderRadius: 17,
        alignItems: 'center',
        justifyContent: 'center',
    },
    pressed: {
        opacity: 0.6,
    },
    reset: {
        alignSelf: 'flex-start',
        paddingVertical: 4,
    },
    resetText: {
        fontSize: 15,
        color: theme.colors.textLink,
        ...Typography.default(),
    },
}));
