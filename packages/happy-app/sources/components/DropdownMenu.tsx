import * as React from 'react';
import { type StyleProp, type ViewStyle } from 'react-native';
import type { ActionMenuItem } from './ActionMenu';
import { ActionMenuModal } from './ActionMenuModal';
import { NativeMenu } from './NativeMenu';

export type DropdownMenuProps = {
    items: ActionMenuItem[];
    accessibilityLabel: string;
    /** The trigger button's own look; `children` fill it. */
    style?: StyleProp<ViewStyle>;
    /** Applied over `style` while the pointer is over the trigger (web). */
    hoveredStyle?: StyleProp<ViewStyle>;
    /** Open on mouse hover and animate the popover (web). */
    openOnHover?: boolean;
    /** Where the popover sits relative to the trigger: under it (default) or beside it on the right (web). */
    placement?: 'bottom' | 'right';
    children: React.ReactNode;
};

/**
 * A button whose menu drops down from it. Native iOS opens the system pull-down menu (see
 * `NativeMenu.ios.tsx`); where there is none the rows show in an `ActionMenuModal`. The web
 * anchors its own popover under the button (`DropdownMenu.web.tsx`).
 */
export const DropdownMenu = React.memo(({ items, accessibilityLabel, style, children }: DropdownMenuProps) => {
    const [visible, setVisible] = React.useState(false);
    return (
        <>
            <NativeMenu items={items} style={style} onFallbackOpen={() => setVisible(true)}>
                {children}
            </NativeMenu>
            <ActionMenuModal
                visible={visible}
                items={items}
                title={accessibilityLabel}
                onClose={() => setVisible(false)}
                deferItemPress
            />
        </>
    );
});
