import * as React from 'react';
import { View, Pressable, ScrollView, Platform, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Text } from '@/components/StyledText';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { isTauriDesktop } from '@/utils/tauri';
import { SessionScopeDot } from './SessionScopeDot';
import { getMachineInitials, type SessionListSelection, type SessionMachineGroup, type SessionScopeDot as Dot } from './sessionListScope';

const BUTTON_SIZE = 34;
export const MACHINE_RAIL_WIDTH = 56;

type RailButtonProps = {
    label: string;
    active: boolean;
    onPress: () => void;
    online?: boolean;
    dot?: Dot;
    // An action rather than a scope: no tile behind it until hovered or shown, and only the plain tile
    // when shown, so it never reads as a second scope picked beside the machine.
    plain?: boolean;
    slotStyle?: StyleProp<ViewStyle>;
    children: React.ReactNode;
};

// Web shows the label as the browser tooltip; native gets it as the accessibility label only.
function setTooltip(label: string) {
    return (element: any) => {
        if (Platform.OS === 'web' && element && typeof element === 'object') element.title = label;
    };
}

const RailButton = React.memo(({ label, active, onPress, online, dot = 'none', plain, slotStyle, children }: RailButtonProps) => {
    const styles = stylesheet;
    return (
        <View style={[styles.buttonSlot, slotStyle]}>
            {active && !plain && <View style={styles.activeIndicator} />}
            <Pressable
                ref={setTooltip(label)}
                accessibilityRole="button"
                accessibilityLabel={label}
                accessibilityState={{ selected: active }}
                onPress={onPress}
                style={({ hovered, pressed }: any) => [
                    styles.button,
                    plain && !active && !hovered && !pressed && styles.buttonPlain,
                    active && !plain && styles.buttonActive,
                    // An offline machine steps back so the online ones stand out, unless it is the one shown.
                    online === false && !active && !hovered && styles.buttonOffline,
                ]}
            >
                {children}
                {dot !== 'none' && (
                    <View style={styles.statusDotSlot}>
                        <SessionScopeDot dot={dot} size={8} />
                    </View>
                )}
            </Pressable>
        </View>
    );
});

export const MachineRail = React.memo(({
    groups,
    selection,
    onSelect,
    hasShared,
    hasSharedByMe,
    sharedDot,
    sharedByMeDot,
    sessionCount,
    settingsActive,
    onSettings,
    header,
}: {
    groups: SessionMachineGroup[];
    selection: SessionListSelection;
    onSelect: (selection: SessionListSelection) => void;
    hasShared: boolean;
    hasSharedByMe: boolean;
    sharedDot: Dot;
    sharedByMeDot: Dot;
    sessionCount: number;
    settingsActive: boolean;
    onSettings: () => void;
    // Sits above the rail's buttons, where the web sidebar keeps the app logo.
    header?: React.ReactNode;
}) => {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const machines = groups.filter(group => !group.unknown);
    const iconColor = (active: boolean) => active ? theme.colors.button.primary.tint : theme.colors.text;

    return (
        <View style={[styles.rail, !!header && styles.railWithHeader]}>
            {header}
            <RailButton
                label={`${t('sessionScope.allMachines')} · ${t('sessionScope.sessionCount', { count: sessionCount })}`}
                active={selection === 'all'}
                onPress={() => onSelect('all')}
                // Browser only: this lines the button up with the search field beside it. The desktop app
                // (also web) keeps the default position.
                slotStyle={Platform.OS === 'web' && !isTauriDesktop() ? { marginTop: -2 } : undefined}
            >
                <Ionicons name="grid-outline" size={16} color={iconColor(selection === 'all')} />
            </RailButton>
            <View style={styles.separator} />
            <ScrollView
                style={styles.machines}
                contentContainerStyle={styles.machinesContent}
                showsVerticalScrollIndicator={false}
            >
                {machines.map(group => {
                    const active = selection === group.id;
                    const status = group.online ? t('status.online') : t('status.offline');
                    return (
                        <RailButton
                            key={group.id}
                            label={`${group.name} · ${status} · ${t('sessionScope.sessionCount', { count: group.sessions.length })}`}
                            active={active}
                            online={group.online}
                            dot={group.dot}
                            onPress={() => onSelect(group.id)}
                        >
                            <Text
                                numberOfLines={1}
                                style={[styles.initials, { color: iconColor(active) }]}
                            >
                                {getMachineInitials(group.name)}
                            </Text>
                        </RailButton>
                    );
                })}
                {(hasShared || hasSharedByMe) && <View style={styles.separator} />}
                {hasShared && (
                    <RailButton
                        label={t('session.sharing.sharedWithMeSessions')}
                        active={selection === 'shared'}
                        dot={sharedDot}
                        onPress={() => onSelect('shared')}
                    >
                        <Ionicons name="people-outline" size={16} color={iconColor(selection === 'shared')} />
                    </RailButton>
                )}
                {hasSharedByMe && (
                    <RailButton
                        label={t('session.sharing.sharedByMeSessions')}
                        active={selection === 'sharedByMe'}
                        dot={sharedByMeDot}
                        onPress={() => onSelect('sharedByMe')}
                    >
                        <Ionicons name="share-outline" size={16} color={iconColor(selection === 'sharedByMe')} />
                    </RailButton>
                )}
            </ScrollView>
            <View style={styles.footer}>
                <View style={styles.separator} />
                <RailButton
                    label={t('tabs.settings')}
                    active={settingsActive}
                    plain
                    onPress={onSettings}
                >
                    <Image
                        source={require('@/assets/images/navigation/setting.png')}
                        contentFit="contain"
                        style={{ width: 20, height: 20 }}
                        tintColor={theme.colors.text}
                    />
                </RailButton>
            </View>
        </View>
    );
});

const stylesheet = StyleSheet.create((theme) => ({
    rail: {
        width: MACHINE_RAIL_WIDTH,
        paddingTop: 10,
        paddingBottom: 12,
        alignItems: 'center',
        gap: 12,
        borderRightWidth: StyleSheet.hairlineWidth,
        borderRightColor: theme.colors.divider,
    },
    railWithHeader: {
        paddingTop: 0,
    },
    machines: {
        flex: 1,
        alignSelf: 'stretch',
    },
    machinesContent: {
        alignItems: 'center',
        gap: 12,
        paddingVertical: 2,
    },
    footer: {
        alignItems: 'center',
        gap: 12,
    },
    separator: {
        width: 24,
        height: StyleSheet.hairlineWidth,
        backgroundColor: theme.colors.divider,
    },
    buttonSlot: {
        width: MACHINE_RAIL_WIDTH,
        alignItems: 'center',
        justifyContent: 'center',
    },
    activeIndicator: {
        position: 'absolute',
        left: 0,
        width: 3,
        height: 16,
        borderTopRightRadius: 3,
        borderBottomRightRadius: 3,
        backgroundColor: theme.colors.button.primary.background,
    },
    button: {
        width: BUTTON_SIZE,
        height: BUTTON_SIZE,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
        // The dark surface is the sidebar's own color, so the buttons take the next step up there.
        backgroundColor: theme.dark ? theme.colors.surfaceHighest : theme.colors.surface,
    },
    buttonPlain: {
        backgroundColor: 'transparent',
    },
    buttonActive: {
        backgroundColor: theme.colors.button.primary.background,
    },
    buttonOffline: {
        opacity: 0.45,
    },
    initials: {
        fontSize: 11,
        ...Typography.default('semiBold'),
    },
    statusDotSlot: {
        position: 'absolute',
        right: -3,
        top: -3,
        padding: 2,
        borderRadius: 6,
        backgroundColor: theme.colors.groupped.background,
    },
}));
