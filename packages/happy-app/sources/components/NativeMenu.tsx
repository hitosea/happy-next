import * as React from 'react';
import { Pressable, type StyleProp, type ViewStyle } from 'react-native';
import type { ActionMenuItem } from './ActionMenu';

export type NativeMenuProps = {
    /** The menu's rows, the same ones an `ActionMenuModal` takes. */
    items: ActionMenuItem[];
    /** Opens the menu on a tap (`press`) or a long press (`longPress`). */
    activation?: 'press' | 'longPress';
    /**
     * The trigger sits at the bottom of the screen, so the menu opens above it. iOS puts the first
     * row nearest the trigger, which reads bottom-up there; this keeps `items` reading top-down.
     */
    opensUpward?: boolean;
    /** Leaves the trigger as it is, without opening anything (a busy or unavailable action). */
    disabled?: boolean;
    /** Outer size and placement of the trigger; `children` fill it. */
    style?: StyleProp<ViewStyle>;
    /** Where the native menu is unavailable: show the page's `ActionMenuModal` instead. */
    onFallbackOpen: () => void;
    children: React.ReactNode;
};

/**
 * A trigger that opens its menu natively where it can (see `NativeMenu.ios.tsx`). Here it is a
 * plain pressable that hands over to the page's own `ActionMenuModal`.
 */
export const NativeMenu = React.memo(({ activation = 'press', disabled, style, onFallbackOpen, children }: NativeMenuProps) => (
    <Pressable
        style={style}
        disabled={disabled}
        onPress={activation === 'press' ? onFallbackOpen : undefined}
        onLongPress={activation === 'longPress' ? onFallbackOpen : undefined}
    >
        {children}
    </Pressable>
));
NativeMenu.displayName = 'NativeMenu';
