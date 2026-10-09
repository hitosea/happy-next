import * as React from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, ContextMenu, Host, Picker, Rectangle } from '@expo/ui/swift-ui';
import { foregroundStyle, opacity } from '@expo/ui/swift-ui/modifiers';
import { useUnistyles } from 'react-native-unistyles';
import { isRunningOnMac } from '@/utils/platform';
import { NativeMenu as FallbackMenu, type NativeMenuProps } from './NativeMenu';

/**
 * A trigger that opens its menu as a native iOS menu: a tap opens it from the trigger in the
 * system's own glass (a SwiftUI `Menu`), a long press lifts the trigger with the menu beside it
 * (`contextMenu`). The rows are the page's `ActionMenuItem`s, so its `ActionMenuModal` keeps serving
 * Catalyst and the other platforms.
 *
 * A menu whose rows all carry `selected` is a choice of one value, shown as an inline picker with
 * the system's checkmark; any other is a list of actions, destructive ones in red. Rows cannot be
 * coloured or muted in a native menu, so `color` and `secondary` are dropped.
 *
 * The trigger's content stays a React Native view; the menu's own trigger is a SwiftUI shape laid
 * over it, all but transparent (fully clear shapes are not hit-tested) and tinted toward the
 * theme's background so it does not show as a grey patch on it. Hosting the content inside
 * SwiftUI instead loses it: once its row scrolls out of view and back, SwiftUI rebuilds the trigger
 * and the React Native view it had adopted is gone.
 */
export const NativeMenu = React.memo((props: NativeMenuProps) => {
    const { activation = 'press', opensUpward, disabled, style, children } = props;
    // iOS orders the rows outward from the trigger; reversed, a menu above it still reads top-down
    const items = opensUpward ? [...props.items].reverse() : props.items;
    const { theme } = useUnistyles();

    if (isRunningOnMac()) {
        return <FallbackMenu {...props} />;
    }
    if (disabled) {
        return <View style={style}>{children}</View>;
    }

    const isChoice = items.length > 0 && items.every((item) => typeof item.selected === 'boolean');
    return (
        <View style={style}>
            {children}
            <Host style={StyleSheet.absoluteFill}>
                <ContextMenu activationMethod={activation === 'press' ? 'singlePress' : 'longPress'}>
                    <ContextMenu.Items>
                        {isChoice ? (
                            <Picker
                                variant="inline"
                                options={items.map((item) => item.label)}
                                selectedIndex={items.findIndex((item) => item.selected)}
                                onOptionSelected={({ nativeEvent }) => items[nativeEvent.index]?.onPress()}
                            />
                        ) : (
                            items.map((item, index) => (
                                <Button
                                    // eslint-disable-next-line react/no-array-index-key
                                    key={index}
                                    role={item.destructive ? 'destructive' : 'default'}
                                    disabled={item.disabled}
                                    onPress={item.onPress}
                                >
                                    {item.label}
                                </Button>
                            ))
                        )}
                    </ContextMenu.Items>
                    <ContextMenu.Trigger>
                        <Rectangle modifiers={[foregroundStyle(theme.dark ? 'black' : 'white'), opacity(0.011)]} />
                    </ContextMenu.Trigger>
                </ContextMenu>
            </Host>
        </View>
    );
});
NativeMenu.displayName = 'NativeMenu';
