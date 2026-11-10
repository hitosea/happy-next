import * as React from 'react';
import { Text, useWindowDimensions, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';
import { TooltipLayer } from './TooltipLayer';

const SHOW_DELAY_MS = 400;
const LONG_PRESS_VISIBLE_MS = 1500;
const GAP = 6;
const EDGE = 8;

type Rect = { x: number; y: number; width: number; height: number };

/** What the control spreads on its Pressable to drive the tooltip. */
export type TooltipTrigger = {
    onHoverIn: () => void;
    onHoverOut: () => void;
    onPressIn: () => void;
    onLongPress: () => void;
};

/**
 * A short label shown above a control: after a moment's hover with a mouse or trackpad (the web,
 * iPad), or for a moment after a long press on touch, which then does not press the control. It
 * renders above everything in the window, so the containers that clip do not cut it. The control
 * still names itself for accessibility.
 */
export function Tooltip({ label, children }: { label: string; children: (trigger: TooltipTrigger) => React.ReactNode }) {
    const anchorRef = React.useRef<View>(null);
    const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const [anchor, setAnchor] = React.useState<Rect | null>(null);
    const [size, setSize] = React.useState<{ width: number; height: number } | null>(null);
    const { width: windowWidth } = useWindowDimensions();

    const clearTimer = React.useCallback(() => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = null;
    }, []);
    const hide = React.useCallback(() => {
        clearTimer();
        setAnchor(null);
        setSize(null);
    }, [clearTimer]);
    const show = React.useCallback((hideAfterMs?: number) => {
        anchorRef.current?.measureInWindow((x, y, width, height) => {
            setAnchor({ x, y, width, height });
            if (hideAfterMs !== undefined) {
                clearTimer();
                timer.current = setTimeout(hide, hideAfterMs);
            }
        });
    }, [clearTimer, hide]);
    React.useEffect(() => clearTimer, [clearTimer]);

    const trigger = React.useMemo<TooltipTrigger>(() => ({
        onHoverIn: () => {
            clearTimer();
            timer.current = setTimeout(() => show(), SHOW_DELAY_MS);
        },
        onHoverOut: hide,
        onPressIn: hide,
        onLongPress: () => show(LONG_PRESS_VISIBLE_MS),
    }), [clearTimer, hide, show]);

    // Measured at first with the bubble unseen, then placed above the control, centred on it and
    // kept inside the window; below it when there is no room above.
    let placement: { left: number; top: number } | null = null;
    if (anchor && size) {
        const left = Math.min(
            Math.max(anchor.x + anchor.width / 2 - size.width / 2, EDGE),
            Math.max(EDGE, windowWidth - EDGE - size.width),
        );
        const above = anchor.y - GAP - size.height;
        placement = { left, top: above >= EDGE ? above : anchor.y + anchor.height + GAP };
    }

    return (
        <View ref={anchorRef} collapsable={false}>
            {children(trigger)}
            {anchor && (
                <TooltipLayer>
                    <View
                        style={[styles.bubble, placement ?? styles.bubbleMeasuring]}
                        onLayout={(event) => {
                            const { width, height } = event.nativeEvent.layout;
                            if (!size || size.width !== width || size.height !== height) setSize({ width, height });
                        }}
                    >
                        <Text style={styles.label} numberOfLines={2}>{label}</Text>
                    </View>
                </TooltipLayer>
            )}
        </View>
    );
}

const styles = StyleSheet.create((theme) => ({
    bubble: {
        position: 'absolute',
        maxWidth: 240,
        paddingHorizontal: 8,
        paddingVertical: 5,
        borderRadius: 6,
        backgroundColor: theme.colors.surface,
        borderWidth: 0.5,
        borderColor: theme.colors.modal.border,
        shadowColor: theme.colors.shadow.color,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: theme.colors.shadow.opacity,
        shadowRadius: 6,
        elevation: 8,
    },
    bubbleMeasuring: {
        left: 0,
        top: 0,
        opacity: 0,
    },
    label: {
        fontSize: 12,
        lineHeight: 16,
        color: theme.colors.text,
        ...Typography.default(),
    },
}));
