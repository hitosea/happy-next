import * as React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { requireNativeViewManager, requireOptionalNativeModule } from 'expo-modules-core';
import { isRunningOnMac } from '@/utils/platform';
import type { ActionMenuItem } from './ActionMenu';
import { NativeMenu as FallbackMenu, type NativeMenuProps } from './NativeMenu';

type MenuButtonElement = {
    type: 'action' | 'group';
    id?: string;
    title?: string;
    systemImage?: string;
    destructive?: boolean;
    disabled?: boolean;
    checked?: boolean;
    inline?: boolean;
    children?: MenuButtonElement[];
};

type MenuButtonProps = {
    menu: { items: MenuButtonElement[] };
    /** The menu opens on a tap instead of a long press, and `onPrimaryAction` is not sent. */
    opensOnTap?: boolean;
    // Not `onPress`: React Native has a bubbling `topPress` already, and a direct one of the same name throws
    onPrimaryAction?: () => void;
    onSelectAction: (event: { nativeEvent: { id: string } }) => void;
    onMenuOpen?: () => void;
    onMenuClose?: () => void;
    style?: StyleProp<ViewStyle>;
};

// `modules/context-menu`; a binary built before it has the menu button (or before the button
// opened on a tap) falls back to the sheet.
const menuButtonModule = isRunningOnMac() ? null : requireOptionalNativeModule<{ supportsTapMenu?: boolean }>('HappyMenuButton');
const MenuButton: React.ComponentType<MenuButtonProps> | null = menuButtonModule?.supportsTapMenu
    ? requireNativeViewManager('HappyMenuButton')
    : null;

/** The rows as the native menu's sections, a new one at each `startsSection`. */
function menuButtonItems(items: ActionMenuItem[]): MenuButtonElement[] {
    const sections: MenuButtonElement[] = [];
    items.forEach((item, index) => {
        if (index === 0 || item.startsSection) {
            sections.push({ type: 'group', inline: true, children: [] });
        }
        sections[sections.length - 1].children!.push({
            type: 'action',
            id: String(index),
            title: item.label,
            systemImage: item.icon?.sfSymbol,
            destructive: item.destructive,
            disabled: item.disabled,
            checked: item.selected,
        });
    });
    return sections;
}

/**
 * A trigger that opens its menu as a native iOS menu, out of the trigger in the system's own glass:
 * a clear UIKit button laid over the content (see `HappyMenuButtonModule`), whose menu opens on a
 * tap, or on a long press with a haptic, a tap then calling `onPress` as on a native bar button.
 * The rows are the page's `ActionMenuItem`s in their given order, top-down whichever way the menu
 * opens, so its `ActionMenuModal` keeps serving Catalyst, older binaries and the other platforms.
 *
 * A row carrying `selected: true` shows the system's checkmark, so a choice of one value reads as
 * a picker; destructive rows are red. Rows cannot be coloured or muted in a native menu, so `color`
 * and `secondary` are dropped.
 */
export const NativeMenu = React.memo((props: NativeMenuProps) => {
    const { items, activation = 'press', onPress, onOpenChange, disabled, style, children } = props;
    // Handlers are looked up when the event arrives, so they are always the latest render's
    const latestRef = React.useRef({ items, onPress, onOpenChange });
    latestRef.current = { items, onPress, onOpenChange };
    const menu = React.useMemo(() => ({ items: menuButtonItems(items) }), [items]);
    const handlePress = React.useCallback(() => latestRef.current.onPress?.(), []);
    const handleSelect = React.useCallback((event: { nativeEvent: { id: string } }) => {
        latestRef.current.items[Number(event.nativeEvent.id)]?.onPress();
    }, []);
    const handleOpen = React.useCallback(() => latestRef.current.onOpenChange?.(true), []);
    const handleClose = React.useCallback(() => latestRef.current.onOpenChange?.(false), []);

    if (!MenuButton) {
        return <FallbackMenu {...props} />;
    }
    if (disabled) {
        return <View style={style}>{children}</View>;
    }
    return (
        <View style={style}>
            {children}
            <MenuButton
                style={StyleSheet.absoluteFill}
                menu={menu}
                opensOnTap={activation === 'press'}
                onPrimaryAction={handlePress}
                onSelectAction={handleSelect}
                onMenuOpen={handleOpen}
                onMenuClose={handleClose}
            />
        </View>
    );
});
NativeMenu.displayName = 'NativeMenu';
