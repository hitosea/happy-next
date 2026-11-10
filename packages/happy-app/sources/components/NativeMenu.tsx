import * as React from 'react';
import { Pressable, type StyleProp, type ViewStyle } from 'react-native';
import type { ActionMenuItem } from './ActionMenu';

export type NativeMenuProps = {
    /** The menu's rows, the same ones an `ActionMenuModal` takes. */
    items: ActionMenuItem[];
    /** Opens the menu on a tap (`press`) or a long press (`longPress`). */
    activation?: 'press' | 'longPress';
    /** What a tap does while the menu opens on a long press. */
    onPress?: () => void;
    /**
     * The native menu has shown (`true`) or started going away (`false`), so the page can keep the
     * tap that dismisses it from landing on what is under it. Not called by the fallback here.
     */
    onOpenChange?: (open: boolean) => void;
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
export const NativeMenu = React.memo(({ activation = 'press', onPress, disabled, style, onFallbackOpen, children }: NativeMenuProps) => (
    <Pressable
        style={style}
        disabled={disabled}
        onPress={activation === 'press' ? onFallbackOpen : onPress}
        onLongPress={activation === 'longPress' ? onFallbackOpen : undefined}
    >
        {children}
    </Pressable>
));
NativeMenu.displayName = 'NativeMenu';
