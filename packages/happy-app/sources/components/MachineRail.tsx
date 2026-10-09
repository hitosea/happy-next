import * as React from 'react';
import { View, Pressable, ScrollView, Platform, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Path } from 'react-native-svg';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Text } from '@/components/StyledText';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { isTauriDesktop } from '@/utils/tauri';
import { SessionScopeDot } from './SessionScopeDot';
import { requestSessionListJump } from './sessionListJump';
import { MachineRailContextMenu, menuAt, type ContextMenuEvent, type MachineRailMenu, type MachineRailMenuItem } from './MachineRailContextMenu';
import { useMouseReorder } from '@/hooks/useMouseReorder';
import { MACHINE_AVATAR_COLORS, MACHINE_AVATAR_ICONS, resolveMachineAvatar } from './MachineAvatar';
import { useSetting } from '@/sync/storage';
import { getMachineInitials, type SessionListSelection, type SessionMachineGroup, type SessionScopeDot as Dot } from './sessionListScope';

const BUTTON_SIZE = 34;
// A machine button plus the gap under it: one place in the order while dragging.
const MACHINE_PITCH = BUTTON_SIZE + 12;
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
    // A machine's avatar color, filling the tile in place of the surface; picked, it keeps its color
    // rather than taking the primary fill, and the side indicator alone marks it.
    tint?: string;
    onContextMenu?: (event: ContextMenuEvent) => void;
    // Reordering (web): the slot is grabbed with the mouse, and the tile shows the grab cursor.
    onPointerDown?: (event: any) => void;
    buttonStyle?: StyleProp<ViewStyle>;
    children: React.ReactNode;
};

// Web shows the label as the browser tooltip; native gets it as the accessibility label only.
function setTooltip(label: string) {
    return (element: any) => {
        if (Platform.OS === 'web' && element && typeof element === 'object') element.title = label;
    };
}

const RailButton = React.memo(({ label, active, onPress, online, dot = 'none', plain, slotStyle, tint, onContextMenu, onPointerDown, buttonStyle, children }: RailButtonProps) => {
    const styles = stylesheet;
    return (
        <View
            style={[styles.buttonSlot, slotStyle]}
            {...(onPointerDown ? { onPointerDown } : {})}
        >
            {active && !plain && <View style={styles.activeIndicator} />}
            <Pressable
                ref={setTooltip(label)}
                accessibilityRole="button"
                accessibilityLabel={label}
                accessibilityState={{ selected: active }}
                onPress={onPress}
                // Spread rather than written inline: `onContextMenu` is a DOM prop the React Native types do not carry.
                {...(onContextMenu ? { onContextMenu } : {})}
                style={({ hovered, pressed }: any) => [
                    styles.button,
                    plain && !active && !hovered && !pressed && styles.buttonPlain,
                    active && !plain && !tint && styles.buttonActive,
                    tint !== undefined && { backgroundColor: tint },
                    // An offline machine steps back so the online ones stand out, unless it is the one shown.
                    online === false && !active && !hovered && styles.buttonOffline,
                    buttonStyle,
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

// The rail's footer icons, on the 24 grid of navigation.sketch with its 1.5 round stroke: the gear is
// that file's setting path, and the info circle sits a little inside the gear's height so the two
// weigh the same to the eye.
const GEAR_PATH = 'M9.671 4.136C9.785 2.935 10.794 2.017 12 2.017C13.207 2.017 14.216 2.935 14.33 4.136C14.397 4.896 14.831 5.575 15.491 5.957C16.152 6.338 16.957 6.373 17.649 6.051C18.745 5.553 20.04 5.969 20.643 7.011C21.245 8.054 20.958 9.383 19.979 10.084C19.355 10.522 18.983 11.237 18.983 12C18.983 12.762 19.355 13.477 19.979 13.915C20.958 14.616 21.245 15.945 20.643 16.988C20.04 18.03 18.745 18.446 17.649 17.948C16.957 17.626 16.152 17.661 15.491 18.042C14.831 18.424 14.397 19.103 14.33 19.863C14.216 21.064 13.207 21.982 12 21.982C10.794 21.982 9.785 21.064 9.671 19.863C9.604 19.103 9.17 18.423 8.509 18.042C7.848 17.66 7.043 17.625 6.351 17.948C5.255 18.446 3.96 18.03 3.357 16.988C2.755 15.945 3.042 14.616 4.021 13.915C4.645 13.477 5.017 12.762 5.017 12C5.017 11.237 4.645 10.522 4.021 10.084C3.044 9.383 2.757 8.054 3.359 7.013C3.961 5.971 5.254 5.555 6.35 6.051C7.042 6.373 7.847 6.338 8.508 5.957C9.168 5.575 9.602 4.896 9.671 4.136Z';

const STROKE = { strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

const SettingsIcon = ({ size, color }: { size: number; color: string }) => (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <Path d={GEAR_PATH} stroke={color} {...STROKE} />
        <Circle cx={12} cy={12} r={3} stroke={color} {...STROKE} />
    </Svg>
);

const InfoIcon = ({ size, color }: { size: number; color: string }) => (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <Circle cx={12} cy={12} r={9.25} stroke={color} {...STROKE} />
        <Path d="M12 11.25V16.25" stroke={color} {...STROKE} />
        <Circle cx={12} cy={8} r={1} fill={color} />
    </Svg>
);

const DETAILS_ANIMATION_MS = 180;
// The button plus the footer gap before it; the slot pulls the gap back with a negative margin, so
// collapsed it takes no room at all.
const DETAILS_SLOT_HEIGHT = BUTTON_SIZE + 12;

// The picked machine's details button, above settings: it opens out of the gap while a machine is
// picked and folds back into it otherwise, keeping the last machine drawn while it folds.
const MachineDetailsButton = React.memo(({ machine, active, onPress }: {
    machine: SessionMachineGroup | undefined;
    active: boolean;
    onPress: (machineId: string) => void;
}) => {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const [shownMachine, setShownMachine] = React.useState(machine);
    const progress = useSharedValue(machine ? 1 : 0);

    React.useEffect(() => {
        if (machine) setShownMachine(machine);
        progress.value = withTiming(machine ? 1 : 0, { duration: DETAILS_ANIMATION_MS });
    }, [machine, progress]);

    const animatedStyle = useAnimatedStyle(() => ({
        height: progress.value * DETAILS_SLOT_HEIGHT,
        opacity: progress.value,
        transform: [{ scale: 0.6 + 0.4 * progress.value }],
    }));

    if (!shownMachine) return null;
    return (
        <Animated.View
            style={[styles.detailsSlot, animatedStyle]}
            pointerEvents={machine ? 'auto' : 'none'}
            accessibilityElementsHidden={!machine}
            importantForAccessibility={machine ? 'auto' : 'no-hide-descendants'}
        >
            <RailButton
                label={`${t('sessionScope.machineDetails')} · ${shownMachine.name}`}
                active={active}
                plain
                onPress={() => onPress(shownMachine.id)}
            >
                <InfoIcon size={20} color={theme.colors.text} />
            </RailButton>
        </Animated.View>
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
    machineDetailsActive,
    onMachineDetails,
    onNewSession,
    onOpenTerminal,
    hideIdleMachines,
    onHideIdleMachinesChange,
    onReorderMachines,
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
    // Shown above settings while a machine is picked, opening that machine's page.
    machineDetailsActive: boolean;
    onMachineDetails: (machineId: string) => void;
    // The right-click menus (web): a machine's actions, and the rail's own display option.
    onNewSession: (machineId: string) => void;
    onOpenTerminal: (machineId: string) => void;
    hideIdleMachines: boolean;
    onHideIdleMachinesChange: (hide: boolean) => void;
    // The machines on the rail in the order they were dragged into.
    onReorderMachines: (machineIds: string[]) => void;
    // Sits above the rail's buttons, where the web sidebar keeps the app logo.
    header?: React.ReactNode;
}) => {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const machineAvatars = useSetting('machineAvatars');
    const machines = groups.filter(group => !group.unknown);
    const selectedMachine = machines.find(group => group.id === selection);
    const iconColor = (active: boolean) => active ? theme.colors.button.primary.tint : theme.colors.text;
    // Tapping the machine already shown, or All machines when shown, reveals the next session that
    // wants a look, like double-tapping the phone's sessions tab; any other tap switches to it.
    const selectOrJump = (next: SessionListSelection) => {
        if (next === selection) requestSessionListJump();
        else onSelect(next);
    };

    // Reordering, entered from the right-click menus: the machine buttons are dragged with the mouse
    // instead of picked, until Done in the menu, Escape, or a click anywhere off the machines.
    const [reordering, setReordering] = React.useState(false);
    const canReorder = Platform.OS === 'web' && machines.length >= 2;
    const machinesRef = React.useRef<HTMLElement | null>(null);
    const machineIds = React.useMemo(() => machines.map(group => group.id), [machines]);
    const reorder = useMouseReorder(machineIds, MACHINE_PITCH, onReorderMachines);
    React.useEffect(() => {
        if (!canReorder) setReordering(false);
    }, [canReorder]);
    React.useEffect(() => {
        if (!reordering || typeof document === 'undefined') return;
        const handlePointerDown = (event: PointerEvent) => {
            // A right-click is left to open the menu, which offers Done.
            if (event.button !== 0) return;
            if (!(event.target instanceof Node && machinesRef.current?.contains(event.target))) setReordering(false);
        };
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setReordering(false);
        };
        document.addEventListener('pointerdown', handlePointerDown, true);
        document.addEventListener('keydown', handleKeyDown, true);
        return () => {
            document.removeEventListener('pointerdown', handlePointerDown, true);
            document.removeEventListener('keydown', handleKeyDown, true);
        };
    }, [reordering]);

    const [menu, setMenu] = React.useState<MachineRailMenu | null>(null);
    const closeMenu = React.useCallback(() => setMenu(null), []);
    const reorderItem: MachineRailMenuItem[] = !canReorder ? [] : reordering
        ? [{ label: t('sessionScope.reorderMachinesDone'), icon: 'checkmark-outline', onPress: () => setReordering(false) }]
        : [{ label: t('sessionScope.reorderMachines'), icon: 'swap-vertical-outline', onPress: () => setReordering(true) }];
    const openMachineMenu = (group: SessionMachineGroup) => (event: ContextMenuEvent) => setMenu(menuAt(event, [
        { label: t('sessionScope.newSession'), icon: 'add-circle-outline', onPress: () => onNewSession(group.id) },
        { label: t('sessionScope.openTerminal'), icon: 'terminal-outline', disabled: !group.online, onPress: () => onOpenTerminal(group.id) },
        { label: t('sessionScope.machineDetails'), icon: 'information-circle-outline', onPress: () => onMachineDetails(group.id) },
        ...reorderItem,
    ]));
    // Anywhere on the rail outside a machine button: the items name what they will do next.
    const openRailMenu = (event: ContextMenuEvent) => setMenu(menuAt(event, [
        hideIdleMachines
            ? { label: t('sessionScope.showIdleMachines'), icon: 'eye-outline', onPress: () => onHideIdleMachinesChange(false) }
            : { label: t('sessionScope.hideIdleMachines'), icon: 'eye-off-outline', onPress: () => onHideIdleMachinesChange(true) },
        ...reorderItem,
    ]));

    return (
        <View
            style={[styles.rail, !!header && styles.railWithHeader]}
            {...(Platform.OS === 'web' ? { onContextMenu: openRailMenu } : {})}
        >
            {header}
            <RailButton
                label={`${t('sessionScope.allMachines')} · ${t('sessionScope.sessionCount', { count: sessionCount })}`}
                active={selection === 'all'}
                onPress={() => selectOrJump('all')}
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
                <View
                    ref={(node) => { machinesRef.current = node as unknown as HTMLElement | null; }}
                    style={[styles.machineList, reordering && styles.machineListReordering]}
                >
                    {machines.map((group, index) => {
                        const active = selection === group.id;
                        const avatar = resolveMachineAvatar(machineAvatars, group.id);
                        const status = group.online ? t('status.online') : t('status.offline');
                        const dragged = reorder.drag?.id === group.id;
                        return (
                            <RailButton
                                key={group.id}
                                label={`${group.name} · ${status} · ${t('sessionScope.sessionCount', { count: group.sessions.length })}`}
                                active={active}
                                online={group.online}
                                dot={group.dot}
                                onPress={reordering ? noop : () => selectOrJump(group.id)}
                                tint={avatar ? MACHINE_AVATAR_COLORS[avatar.color] : undefined}
                                onContextMenu={openMachineMenu(group)}
                                onPointerDown={reordering ? (event) => reorder.start(group.id, event) : undefined}
                                slotStyle={reordering && reorder.drag ? [
                                    { transform: [{ translateY: reorder.offsetOf(group.id, index) }] },
                                    dragged ? styles.slotDragged : styles.slotShifting,
                                ] : undefined}
                                buttonStyle={reordering ? (reorder.drag ? styles.buttonGrabbing : styles.buttonGrab) : undefined}
                            >
                                {avatar ? (
                                    <Ionicons name={MACHINE_AVATAR_ICONS[avatar.icon]} size={19} color="#FFFFFF" />
                                ) : (
                                    <Text
                                        numberOfLines={1}
                                        style={[styles.initials, { color: iconColor(active) }]}
                                    >
                                        {getMachineInitials(group.name)}
                                    </Text>
                                )}
                            </RailButton>
                        );
                    })}
                </View>
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
                <MachineDetailsButton
                    machine={selectedMachine}
                    active={machineDetailsActive}
                    onPress={onMachineDetails}
                />
                <RailButton
                    label={t('tabs.settings')}
                    active={settingsActive}
                    plain
                    onPress={onSettings}
                >
                    <SettingsIcon size={20} color={theme.colors.text} />
                </RailButton>
            </View>
            <MachineRailContextMenu menu={menu} onClose={closeMenu} />
        </View>
    );
});

const noop = () => {};

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
    // Spelled out at rest, so reordering eases in from and back to these. The border is always
    // there, unseen until reordering, with the margins taking back its width so it moves nothing.
    machineList: {
        alignSelf: 'stretch',
        alignItems: 'center',
        gap: 12,
        marginHorizontal: -1,
        marginTop: -1,
        marginBottom: -1,
        paddingVertical: 0,
        borderRadius: 12,
        borderWidth: 1,
        borderStyle: 'dashed',
        borderColor: 'transparent',
        ...Platform.select({
            web: {
                transitionProperty: 'margin, padding, border-color',
                transitionDuration: '180ms',
                transitionTimingFunction: 'ease-out',
            } as any,
        }),
    },
    // Marks the machines as being reordered with a dashed outline, which no tile color blends into.
    // The outline and padding are pulled back below; above, the scroll view's own padding is all
    // there is to pull into (any further and the scroll view clips the outline's top), so the
    // machines ease down a little.
    machineListReordering: {
        marginHorizontal: 6,
        marginTop: -2,
        marginBottom: -6,
        paddingVertical: 4,
        borderColor: theme.colors.textSecondary,
    },
    slotDragged: {
        zIndex: 1,
    },
    // Web: the machines stepping aside glide into place rather than jump.
    slotShifting: {
        transitionProperty: 'transform',
        transitionDuration: '150ms',
    } as any,
    buttonGrab: {
        cursor: 'grab',
    } as any,
    buttonGrabbing: {
        cursor: 'grabbing',
    } as any,
    footer: {
        alignItems: 'center',
        gap: 12,
    },
    detailsSlot: {
        marginBottom: -16,
        overflow: 'hidden',
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
