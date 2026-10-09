import * as React from 'react';
import { Platform, Pressable, useWindowDimensions, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Text } from '@/components/StyledText';
import { Typography } from '@/constants/Typography';
import { SessionContextMenuPortal } from './SessionContextMenuPortal';

/**
 * The machine rail's right-click menu, web only: on a machine it offers that machine's actions, on
 * the rail around them its display options. Native has no right button, and the rail's buttons keep
 * their long press free.
 *
 * Opened at the cursor and dismissed the way `SessionContextMenu` is — a press or right-click
 * elsewhere, Escape, or any scroll — and drawn to match it, so the sidebar's menus read as one.
 */
export type MachineRailMenuItem = {
    label: string;
    icon: React.ComponentProps<typeof Ionicons>['name'];
    onPress: () => void;
    disabled?: boolean;
};

export type MachineRailMenu = { x: number; y: number; items: MachineRailMenuItem[] };

export type ContextMenuEvent = {
    preventDefault: () => void;
    stopPropagation: () => void;
    nativeEvent: { pageX: number; pageY: number; clientX?: number; clientY?: number };
};

export function menuAt(event: ContextMenuEvent, items: MachineRailMenuItem[]): MachineRailMenu {
    event.preventDefault();
    event.stopPropagation();
    return {
        x: event.nativeEvent.clientX ?? event.nativeEvent.pageX,
        y: event.nativeEvent.clientY ?? event.nativeEvent.pageY,
        items,
    };
}

const MENU_WIDTH = 212;
const ITEM_HEIGHT = 42;
const MENU_PADDING = 4;
const EDGE_GAP = 8;
const ICON_SIZE = 18;

export function MachineRailContextMenu({ menu, onClose }: { menu: MachineRailMenu | null; onClose: () => void }) {
    const { theme } = useUnistyles();
    const { width, height } = useWindowDimensions();
    const [hovered, setHovered] = React.useState<number | null>(null);
    const menuRef = React.useRef<HTMLElement | null>(null);

    React.useEffect(() => {
        setHovered(null);
        if (Platform.OS !== 'web' || menu === null || typeof document === 'undefined') return;

        const isInsideMenu = (target: EventTarget | null) => target instanceof Node && !!menuRef.current?.contains(target);
        const handlePointerDown = (event: PointerEvent) => {
            if (!isInsideMenu(event.target)) onClose();
        };
        const handleContextMenuOutside = (event: MouseEvent) => {
            if (isInsideMenu(event.target)) {
                event.preventDefault();
                return;
            }
            // Left alone rather than prevented: right-clicking another button opens its own menu.
            onClose();
        };
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        const handleScroll = () => onClose();

        document.addEventListener('pointerdown', handlePointerDown, true);
        document.addEventListener('contextmenu', handleContextMenuOutside, true);
        document.addEventListener('keydown', handleKeyDown, true);
        window.addEventListener('scroll', handleScroll, true);
        return () => {
            document.removeEventListener('pointerdown', handlePointerDown, true);
            document.removeEventListener('contextmenu', handleContextMenuOutside, true);
            document.removeEventListener('keydown', handleKeyDown, true);
            window.removeEventListener('scroll', handleScroll, true);
        };
    }, [menu, onClose]);

    if (Platform.OS !== 'web' || menu === null) return null;

    const menuHeight = menu.items.length * ITEM_HEIGHT + MENU_PADDING * 2;
    const left = Math.max(EDGE_GAP, Math.min(menu.x, width - MENU_WIDTH - EDGE_GAP));
    const top = Math.max(EDGE_GAP, Math.min(menu.y, height - menuHeight - EDGE_GAP));

    return (
        <SessionContextMenuPortal>
            <View
                ref={(node) => { menuRef.current = node as unknown as HTMLElement | null; }}
                pointerEvents="auto"
                style={[styles.menu, { left, top }]}
            >
                {menu.items.map((item, index) => (
                    <Pressable
                        key={item.label}
                        disabled={item.disabled}
                        onHoverIn={() => setHovered(index)}
                        onHoverOut={() => setHovered(current => current === index ? null : current)}
                        onPress={(event) => {
                            event.stopPropagation?.();
                            onClose();
                            item.onPress();
                        }}
                        style={({ pressed }) => [
                            styles.item,
                            (pressed || hovered === index) && { backgroundColor: theme.colors.surfacePressed },
                            item.disabled && styles.disabled,
                        ]}
                    >
                        <Ionicons name={item.icon} size={ICON_SIZE} color={theme.colors.textSecondary} />
                        <Text style={styles.itemText} numberOfLines={1}>{item.label}</Text>
                    </Pressable>
                ))}
            </View>
        </SessionContextMenuPortal>
    );
}

const styles = StyleSheet.create((theme) => ({
    menu: {
        position: 'absolute',
        width: MENU_WIDTH,
        paddingVertical: MENU_PADDING,
        borderRadius: 10,
        backgroundColor: theme.colors.surface,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider,
        shadowColor: theme.colors.shadow.color,
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.22,
        shadowRadius: 20,
        elevation: 12,
        overflow: 'hidden',
    },
    item: {
        height: ITEM_HEIGHT,
        paddingHorizontal: 12,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    itemText: {
        flex: 1,
        fontSize: 14,
        color: theme.colors.text,
        ...Typography.default(),
    },
    disabled: {
        opacity: 0.45,
    },
}));
