import * as React from 'react';
import { Text, useWindowDimensions, View, type ViewProps } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';
import { TooltipLayer } from './TooltipLayer';

const LONG_PRESS_VISIBLE_MS = 1500;
// A longer label (a model's description, say) stays up long enough to be read, up to a limit.
const LONG_PRESS_MS_PER_CHAR = 40;
const LONG_PRESS_MAX_VISIBLE_MS = 6000;
// One line at first; a label too long for it shows whole once the tooltip has been up this long.
const EXPAND_AFTER_MS = 1000;
const GAP = 6;
const EDGE = 8;
const MAX_WIDTH = 240;
// A side tooltip may take the room beside its anchor, up to this, so a long label fits one line more often.
const SIDE_MAX_WIDTH = 600;

type Rect = { x: number; y: number; width: number; height: number };

/** What the control spreads on its Pressable to drive the tooltip. */
export type TooltipTrigger = {
    onHoverIn: () => void;
    onHoverOut: () => void;
    onPressIn: () => void;
    onLongPress: () => void;
};

type TooltipProps = {
    label: string;
    /** `above` the control (below when there is no room), or to the `side` of it, for a row in a list. */
    placement?: 'above' | 'side';
    /** The wrapper's, for a list that measures its rows. */
    onLayout?: ViewProps['onLayout'];
    /**
     * Spread `trigger` on the control's Pressable. `anchorRef` may go on a part of it (a row's label),
     * so a side tooltip sits next to that part rather than the whole row (still centred on the row).
     */
    children: (trigger: TooltipTrigger, anchorRef: React.RefObject<any>) => React.ReactNode;
};

/**
 * A short label shown next to a control: while a mouse or trackpad hovers it (the web, iPad), or for a
 * moment after a long press on touch, which then does not press the control. It shows one line, cut
 * short if need be, and the whole label after a second. It renders above everything in the window, so
 * the containers that clip do not cut it. The control still names itself for accessibility.
 */
export function Tooltip({ label, placement: side = 'above', onLayout, children }: TooltipProps) {
    const wrapperRef = React.useRef<View>(null);
    const anchorRef = React.useRef<View>(null);
    const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const [anchor, setAnchor] = React.useState<Rect | null>(null);
    const [size, setSize] = React.useState<{ width: number; height: number } | null>(null);
    // The bubble's height while it shows one line: a side tooltip keeps that line centred on the anchor.
    const [oneLineHeight, setOneLineHeight] = React.useState<number | null>(null);
    const [expanded, setExpanded] = React.useState(false);
    const { width: windowWidth, height: windowHeight } = useWindowDimensions();

    const clearTimer = React.useCallback(() => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = null;
    }, []);
    const hide = React.useCallback(() => {
        clearTimer();
        setAnchor(null);
        setSize(null);
        setOneLineHeight(null);
    }, [clearTimer]);
    // Across from the part `anchorRef` is on, if any, and level with the whole control: a row's tooltip
    // sits beside its label and centred on the row the hover highlights.
    const show = React.useCallback((hideAfterMs?: number) => {
        wrapperRef.current?.measureInWindow((controlX, y, controlWidth, height) => {
            const place = (x: number, width: number) => {
                setAnchor({ x, y, width, height });
                if (hideAfterMs !== undefined) {
                    clearTimer();
                    timer.current = setTimeout(hide, hideAfterMs);
                }
            };
            if (anchorRef.current) anchorRef.current.measureInWindow((x: number, _y: number, width: number) => place(x, width));
            else place(controlX, controlWidth);
        });
    }, [clearTimer, hide]);
    React.useEffect(() => clearTimer, [clearTimer]);
    React.useEffect(() => {
        setExpanded(false);
        if (!anchor) return;
        const expandTimer = setTimeout(() => setExpanded(true), EXPAND_AFTER_MS);
        return () => clearTimeout(expandTimer);
    }, [anchor]);

    const trigger = React.useMemo<TooltipTrigger>(() => ({
        onHoverIn: () => {
            clearTimer();
            show();
        },
        onHoverOut: hide,
        onPressIn: hide,
        onLongPress: () => show(Math.min(LONG_PRESS_VISIBLE_MS + label.length * LONG_PRESS_MS_PER_CHAR, LONG_PRESS_MAX_VISIBLE_MS)),
    }), [clearTimer, hide, show, label]);

    // To the side: right of the anchor when the widest bubble fits there, else left when it fits there,
    // else the roomier side. The bubble may then take that side's room, up to SIDE_MAX_WIDTH. Decided
    // from the anchor alone, so the bubble's measured size never changes the side.
    const roomRight = anchor ? windowWidth - EDGE - (anchor.x + anchor.width + GAP) : 0;
    const roomLeft = anchor ? anchor.x - GAP - EDGE : 0;
    const onRight = roomRight >= MAX_WIDTH || (roomLeft < MAX_WIDTH && roomRight >= roomLeft);
    const maxWidth = side === 'side' ? Math.min(SIDE_MAX_WIDTH, onRight ? roomRight : roomLeft) : MAX_WIDTH;

    // Measured at first with the bubble unseen, then placed: to the side, its first line centred on the
    // anchor's height, so more lines grow it downward (moved up only as far as the window needs); or
    // above the control, centred on it, below it when there is no room above. Kept inside
    // the window either way.
    let placement: { left: number; top: number } | null = null;
    if (anchor && size && side === 'side') {
        const top = Math.min(
            Math.max(anchor.y + anchor.height / 2 - (oneLineHeight ?? size.height) / 2, EDGE),
            Math.max(EDGE, windowHeight - EDGE - size.height),
        );
        // Not rounded: the bubble and a row are both of even height, so centred it is a whole number of
        // points from the row's edges wherever the row sits, even mid-scroll.
        placement = { left: Math.round(onRight ? anchor.x + anchor.width + GAP : anchor.x - GAP - size.width), top };
    } else if (anchor && size) {
        const left = Math.min(
            Math.max(anchor.x + anchor.width / 2 - size.width / 2, EDGE),
            Math.max(EDGE, windowWidth - EDGE - size.width),
        );
        const above = anchor.y - GAP - size.height;
        placement = { left: Math.round(left), top: Math.round(above >= EDGE ? above : anchor.y + anchor.height + GAP) };
    }

    return (
        <View ref={wrapperRef} collapsable={false} onLayout={onLayout}>
            {children(trigger, anchorRef)}
            {anchor && (
                <TooltipLayer>
                    <View
                        style={[styles.bubble, { maxWidth }, placement ?? styles.bubbleMeasuring]}
                        onLayout={(event) => {
                            const { width, height } = event.nativeEvent.layout;
                            if (!size || size.width !== width || size.height !== height) setSize({ width, height });
                            if (!expanded && oneLineHeight !== height) setOneLineHeight(height);
                        }}
                    >
                        <Text style={styles.label} numberOfLines={expanded ? undefined : 1}>{label}</Text>
                    </View>
                </TooltipLayer>
            )}
        </View>
    );
}

const styles = StyleSheet.create((theme) => ({
    bubble: {
        position: 'absolute',
        paddingHorizontal: 8,
        // With the 16 line and the 1 border, one line is 28 tall: even, like the rows a side tooltip is
        // centred on. Whole points only: a 0.5 border is drawn 1 wide on a 1x screen, which made it 29.
        paddingVertical: 5,
        borderRadius: 6,
        backgroundColor: theme.colors.surface,
        borderWidth: 1,
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
