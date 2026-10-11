import * as React from 'react';
import { Animated, Modal, Pressable, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Text } from '@/components/StyledText';
import { Typography } from '@/constants/Typography';
import type { DropdownMenuProps } from './DropdownMenu';

const MENU_WIDTH = 180;
const MENU_GAP = 4;
// Beside the trigger the gap matches the session hover card's (`SessionHoverCard.tsx`).
const SIDE_GAP = 8;
const WINDOW_MARGIN = 8;

// `bottom` is the distance from the window's bottom edge, for a popover that opens upward.
type Anchor = { top?: number; bottom?: number; left: number };

/**
 * The web's dropdown: a popover under the button (left-aligned with it), above it (centred on it) or beside it on the right
 * (top-aligned with it), kept inside the window.
 * A click outside or Escape closes it; picking a row closes it, then runs the row.
 */
export const DropdownMenu = React.memo(({ items, accessibilityLabel, style, hoveredStyle, openOnHover = false, placement = 'bottom', children }: DropdownMenuProps) => {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const triggerRef = React.useRef<View | null>(null);
    const [anchor, setAnchor] = React.useState<Anchor | null>(null);
    const menuRef = React.useRef<View | null>(null);
    const progress = React.useRef(new Animated.Value(0)).current;

    const open = React.useCallback(() => {
        const element = triggerRef.current as unknown as HTMLElement | null;
        const rect = element?.getBoundingClientRect?.();
        if (!rect) return;
        const left = placement === 'right'
            ? rect.right + SIDE_GAP
            : placement === 'topCenter'
                ? rect.left + (rect.width - MENU_WIDTH) / 2
                : rect.left;
        setAnchor({
            ...(placement === 'topCenter'
                ? { bottom: window.innerHeight - rect.top + MENU_GAP }
                : { top: placement === 'right' ? rect.top : rect.bottom + MENU_GAP }),
            left: Math.max(WINDOW_MARGIN, Math.min(left, window.innerWidth - MENU_WIDTH - WINDOW_MARGIN)),
        });
    }, [placement]);
    const close = React.useCallback(() => setAnchor(null), []);

    React.useEffect(() => {
        if (!anchor || !openOnHover) return;
        progress.setValue(0);
        const animation = Animated.timing(progress, { toValue: 1, duration: 160, useNativeDriver: false });
        animation.start();
        return () => animation.stop();
    }, [anchor, openOnHover, progress]);

    React.useEffect(() => {
        if (!anchor || !openOnHover) return;
        let closeTimer: ReturnType<typeof setTimeout> | undefined;
        const cancelClose = () => {
            clearTimeout(closeTimer);
            closeTimer = undefined;
        };
        // The modal covers the trigger, so use screen coordinates to keep both hover regions active.
        const onPointerMove = (event: PointerEvent) => {
            if (event.pointerType !== 'mouse') return;
            const overMenu = [triggerRef.current, menuRef.current].some((ref) => {
                const rect = (ref as unknown as HTMLElement | null)?.getBoundingClientRect?.();
                return rect && event.clientX >= rect.left - SIDE_GAP && event.clientX <= rect.right + SIDE_GAP
                    && event.clientY >= rect.top - MENU_GAP && event.clientY <= rect.bottom + MENU_GAP;
            });
            if (overMenu) cancelClose();
            else if (closeTimer === undefined) closeTimer = setTimeout(close, 150);
        };
        const onPointerLeave = () => close();
        document.addEventListener('pointermove', onPointerMove);
        document.documentElement.addEventListener('pointerleave', onPointerLeave);
        return () => {
            cancelClose();
            document.removeEventListener('pointermove', onPointerMove);
            document.documentElement.removeEventListener('pointerleave', onPointerLeave);
        };
    }, [anchor, openOnHover, close]);

    return (
        <>
            <Pressable
                ref={triggerRef}
                accessibilityRole="button"
                accessibilityLabel={accessibilityLabel}
                accessibilityState={{ expanded: anchor !== null }}
                onPress={open}
                onHoverIn={openOnHover ? open : undefined}
                style={({ hovered, pressed }: any) => [style, (hovered || pressed || anchor !== null) && hoveredStyle]}
            >
                {children}
            </Pressable>
            <Modal visible={anchor !== null} transparent animationType="none" onRequestClose={close}>
                <Pressable style={styles.backdrop} onPress={close} accessibilityLabel={accessibilityLabel} />
                {anchor && (
                    <Animated.View ref={menuRef} accessibilityRole="menu" style={[
                        styles.menu,
                        { top: anchor.top, bottom: anchor.bottom, left: anchor.left },
                        openOnHover && {
                            opacity: progress,
                            transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [-4, 0] }) }],
                        },
                    ]}>
                        {items.map((item) => (
                            <Pressable
                                key={item.label}
                                accessibilityRole="menuitem"
                                disabled={item.disabled}
                                onPress={() => {
                                    close();
                                    item.onPress();
                                }}
                                style={({ hovered, pressed }: any) => [
                                    styles.item,
                                    (hovered || pressed) && !item.disabled && styles.itemHovered,
                                ]}
                            >
                                <Text
                                    numberOfLines={1}
                                    style={[
                                        styles.itemText,
                                        item.destructive && { color: theme.colors.textDestructive },
                                        item.disabled && styles.itemTextDisabled,
                                    ]}
                                >
                                    {item.label}
                                </Text>
                            </Pressable>
                        ))}
                    </Animated.View>
                )}
            </Modal>
        </>
    );
});

const stylesheet = StyleSheet.create((theme) => ({
    backdrop: {
        ...StyleSheet.absoluteFillObject,
    },
    menu: {
        position: 'absolute',
        width: MENU_WIDTH,
        padding: 4,
        borderRadius: 10,
        backgroundColor: theme.dark ? theme.colors.surfaceHighest : theme.colors.surface,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider,
        boxShadow: '0 6px 24px rgba(0, 0, 0, 0.18)',
    },
    item: {
        height: 32,
        justifyContent: 'center',
        paddingHorizontal: 10,
        borderRadius: 6,
    },
    itemHovered: {
        backgroundColor: theme.colors.surfacePressed,
    },
    itemText: {
        fontSize: 13,
        color: theme.colors.text,
        ...Typography.default(),
    },
    itemTextDisabled: {
        color: theme.colors.textSecondary,
        opacity: 0.6,
    },
}));
