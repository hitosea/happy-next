import * as React from 'react';
import { Animated, Easing, Platform, Pressable, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { MinimapMessage } from '@/sync/typesMessage';
import {
    MARKER_HEIGHT,
    MARKER_SLOT_HEIGHT,
    MARKER_WIDTH,
    MIN_ITEMS,
    windowStartFor,
} from './minimapScrubber';
import { LIST_CARD_VERTICAL_PADDING, LIST_CARD_WIDTH, LIST_ROW_HEIGHT, MinimapListCard } from './minimapPreview';
import { ConversationMinimapTouch } from './ConversationMinimapTouch';
import { proxyStripWidthPx } from './proxyScrollbarWidth';

export type ConversationMinimapItem = {
    message: MinimapMessage;
};

/** The moments a touch at the screen edge is reported at, once for each. */
export type ConversationMinimapEdgeTouchPhase = 'start' | 'move' | 'end';

/**
 * How the summoning swipe is reported from outside the rail, by a `View` that can see the touches the
 * message list is handling. The coordinates are in window space; see `ConversationMinimapTouch.onEdgeTouch`.
 */
export type ConversationMinimapEdgeTouch = (
    phase: ConversationMinimapEdgeTouchPhase,
    pageX: number,
    pageY: number,
) => void;

export type ConversationMinimapProps = {
    userMessages: ConversationMinimapItem[];
    /**
     * The landmark the reader is on, as the message list reports it — or `null` before the list has
     * said. The rail draws exactly one lit mark, so this is one id and not a set; see
     * `currentLandmark` for how the list decides which.
     */
    activeMessageId: string | null;
    /**
     * Move the reader to this landmark. A list that has to page older messages in before it can move
     * answers late, and reports that by returning a promise; see the touch rail, which stays up until
     * it settles.
     */
    onJumpToMessage: (message: MinimapMessage) => void | Promise<void>;
    contentWidth: number;
    /**
     * Touch has no hover, and the rail cannot watch the screen edge itself without taking the edge away
     * from the message list — a touch zone is a touch zone. So it listens from the outside instead: the
     * host screen hands it the edge's touches through here, and the rail decides what they mean. Not
     * used on web, where the rail is driven by hover.
     */
    onRegisterMinimapEdgeTouch?: (listener: ConversationMinimapEdgeTouch | null) => void;
};

const HIT_WIDTH = 44;
const MIN_CONTENT_WIDTH = 840;
/** Breathing room the rail keeps from the card's top and bottom edges, per side. */
const RAIL_EDGE_INSET = 12;

// The rail grows a mark only a little on hover: the hover card now runs under the rail, so a mark
// that swelled to several times its resting width would reach across the card's rows.
const RAIL_HOVER_SCALES = [1.8, 1.5, 1.25];
function railHoverScale(distance: number) {
    return RAIL_HOVER_SCALES[distance] ?? 1;
}

/**
 * The hover card's entrance and exit: the layer stays mounted through the fade-out so leaving the
 * rail is a transition rather than a pop. Coming straight back reverses the fade instead of
 * re-mounting, since an interrupted timing reports `finished: false`.
 */
function HoverCardLayer({ visible, children }: { visible: boolean; children: React.ReactNode }) {
    const progress = React.useRef(new Animated.Value(0)).current;
    const [mounted, setMounted] = React.useState(visible);

    React.useEffect(() => {
        if (visible) {
            setMounted(true);
            Animated.timing(progress, {
                toValue: 1,
                duration: 150,
                easing: Easing.out(Easing.cubic),
                useNativeDriver: false,
            }).start();
            return;
        }
        Animated.timing(progress, {
            toValue: 0,
            duration: 120,
            easing: Easing.in(Easing.cubic),
            useNativeDriver: false,
        }).start(({ finished }) => {
            if (finished) setMounted(false);
        });
    }, [visible, progress]);

    if (!mounted) {
        return null;
    }

    return (
        <Animated.View
            pointerEvents={visible ? 'auto' : 'none'}
            style={{
                opacity: progress,
                transform: [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
            }}
        >
            {children}
        </Animated.View>
    );
}

// Memoized: the session view around it re-renders on every keystroke in the composer.
export const ConversationMinimap = React.memo(function ConversationMinimap(props: ConversationMinimapProps) {
    // A phone has no hover, so touch gets a rail that is swiped in from the right edge instead.
    if (Platform.OS !== 'web') {
        return <ConversationMinimapTouch {...props} />;
    }
    return <WebMinimap {...props} />;
});

/**
 * Right-edge rail: the pointer is the scrubber, the preview follows the hovered mark. It sits just
 * inside the chat list's scrollbar strip, which it would otherwise cover and take the drags of.
 */
function WebMinimap(props: ConversationMinimapProps) {
    const { theme } = useUnistyles();
    // An index into `props.userMessages`, not into the drawn window: the hover card lists every
    // landmark, so a row there and a mark on the rail have to name the same landmark.
    const [hoveredIndex, setHoveredIndex] = React.useState<number | null>(null);
    const [cardVisible, setCardVisible] = React.useState(false);
    const [availableHeight, setAvailableHeight] = React.useState(0);

    // Moving from the rail into the card crosses a gap, so the card outlives the rail's leave for a
    // moment; entering it cancels the hide.
    const hideTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const cancelHide = React.useCallback(() => {
        if (hideTimer.current !== null) {
            clearTimeout(hideTimer.current);
            hideTimer.current = null;
        }
    }, []);
    const scheduleHide = React.useCallback(() => {
        cancelHide();
        hideTimer.current = setTimeout(() => {
            hideTimer.current = null;
            setHoveredIndex(null);
            setCardVisible(false);
        }, 180);
    }, [cancelHide]);
    React.useEffect(() => cancelHide, [cancelHide]);

    // Where the rail rests: the landmark the reader is on, or the newest one when the list has not
    // named it yet — the rail is read from the bottom of the conversation far more often than not.
    const activeIndex = React.useMemo(() => {
        const index = props.userMessages.findIndex((item) => item.message.id === props.activeMessageId);
        return index >= 0 ? index : Math.max(0, props.userMessages.length - 1);
    }, [props.userMessages, props.activeMessageId]);

    const cardMaxHeight = Math.max(180, Math.min(availableHeight, 420));
    // The rail is the card's index, so the two share one height: the card's own (its rows plus
    // padding, capped) is what the rail has to cover. Few landmarks leave the 10px pitch too short,
    // so the slots stretch evenly over that height; once more marks arrive than a 10px pitch can
    // lay out, the pitch returns to 10 and the window slides instead.
    const cardHeight = Math.min(
        LIST_CARD_VERTICAL_PADDING * 2 + props.userMessages.length * LIST_ROW_HEIGHT,
        cardMaxHeight,
    );
    const railSlots = Math.min(props.userMessages.length, Math.max(1, Math.floor(cardHeight / MARKER_SLOT_HEIGHT)));
    // Spread the slots over the card, but never wider than one card row, and leave a narrow band of
    // card above and below: a rail that touches both edges reads as a border rather than an index.
    const railBand = Math.max(MARKER_SLOT_HEIGHT, cardHeight - RAIL_EDGE_INSET * 2);
    const railPitch = Math.min(LIST_ROW_HEIGHT, railBand / railSlots);
    const railHeight = railPitch * railSlots;

    const visibleWindow = React.useMemo(() => {
        const total = props.userMessages.length;
        const start = windowStartFor(activeIndex, railSlots, total);
        return { start, end: start + railSlots, items: props.userMessages.slice(start, start + railSlots) };
    }, [props.userMessages, activeIndex, railSlots]);

    React.useEffect(() => {
        setHoveredIndex(null);
    }, [visibleWindow.start, visibleWindow.end]);

    const webHoverHandlers = {
        onMouseMove: (event: any) => {
            const rect = event.currentTarget?.getBoundingClientRect?.();
            if (!rect || visibleWindow.items.length === 0) return;
            cancelHide();
            setCardVisible(true);
            const y = event.clientY - rect.top;
            const nextIndex = Math.max(0, Math.min(visibleWindow.items.length - 1, Math.floor(y / railPitch)));
            setHoveredIndex(visibleWindow.start + nextIndex);
        },
        onMouseLeave: scheduleHide,
    };

    if (props.contentWidth < MIN_CONTENT_WIDTH || props.userMessages.length < MIN_ITEMS) {
        return null;
    }

    return (
        <View
            pointerEvents="box-none"
            onLayout={(event) => setAvailableHeight(event.nativeEvent.layout.height)}
            style={{
                position: 'absolute',
                top: '15%',
                bottom: '15%',
                right: proxyStripWidthPx() + 8,
                width: HIT_WIDTH + LIST_CARD_WIDTH + 16,
                alignItems: 'flex-end',
                marginTop: -56, // offset for the top bar
                justifyContent: 'center',
                zIndex: 1001,
            }}
        >
            <View
                {...webHoverHandlers}
                style={{
                    width: HIT_WIDTH,
                    height: railHeight,
                    alignItems: 'flex-end',
                    justifyContent: 'center',
                    // Sits a little in from the card's right edge rather than on the very edge.
                    marginRight: 4,
                    // The hover card runs under the rail; the rail stays on top so its marks —
                    // and their hovered state — remain visible over the card.
                    zIndex: 1,
                }}
            >
                <View
                    pointerEvents="none"
                    style={{
                        position: 'absolute',
                        top: 0,
                        bottom: 0,
                        right: 0,
                        width: 1,
                        borderRadius: 1,
                        backgroundColor: theme.colors.transparent,
                        opacity: 0.55,
                    }}
                />

                {visibleWindow.items.map((item, itemIndex) => {
                    const index = visibleWindow.start + itemIndex;
                    const isActive = hoveredIndex === null && item.message.id === props.activeMessageId;
                    const hoverScale = hoveredIndex === null ? 1 : railHoverScale(Math.abs(hoveredIndex - index));
                    const isHovered = hoveredIndex === index;
                    const markerWidth = MARKER_WIDTH * hoverScale;
                    // AskUserQuestion markers are drawn exactly like prompts: the rail is a neutral
                    // map of landmarks, and hovering is what tells you which mark is a question.
                    // Every landmark is drawn as the same mark; hovering — or the screen reader —
                    // is what tells a question and a preview apart from a prompt.
                    const jumpLabel = item.message.kind === 'ask-user-question'
                        ? 'Jump to question'
                        : item.message.kind === 'preview-html'
                            ? 'Jump to preview'
                            : 'Jump to user message';
                    return (
                        <View key={item.message.id} style={{ position: 'relative', width: HIT_WIDTH, height: railPitch, alignItems: 'flex-end', justifyContent: 'center' }}>
                            <Pressable
                                onPress={() => props.onJumpToMessage(item.message)}
                                onHoverIn={() => setHoveredIndex(index)}
                                accessibilityRole="button"
                                accessibilityLabel={jumpLabel}
                                style={{
                                    width: HIT_WIDTH,
                                    height: railPitch,
                                    alignItems: 'flex-end',
                                    justifyContent: 'center',
                                    cursor: 'pointer' as any,
                                }}
                            >
                                <View
                                    style={{
                                        width: markerWidth,
                                        height: MARKER_HEIGHT,
                                        borderRadius: 4,
                                        backgroundColor: isActive || isHovered ? theme.colors.text : theme.colors.textSecondary,
                                        opacity: isActive ? 0.95 : isHovered ? 0.9 : 0.45,
                                        transitionProperty: 'width, opacity, background-color',
                                        transitionDuration: '140ms',
                                        transitionTimingFunction: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
                                    } as any}
                                />
                            </Pressable>
                        </View>
                    );
                })}
            </View>

            <View
                style={{
                    position: 'absolute',
                    // The card runs to the rail's own edge and under it; the rail is drawn on
                    // top, so the marks read as part of the card rather than beside it. The
                    // negative offset spends the gap the container keeps from the scrollbar,
                    // bringing the card up to the strip without touching it.
                    right: -8,
                    top: 0,
                    bottom: 0,
                    justifyContent: 'center',
                    pointerEvents: 'box-none',
                }}
            >
                <HoverCardLayer visible={cardVisible}>
                    <View {...{ onMouseEnter: cancelHide, onMouseLeave: scheduleHide }}>
                        <MinimapListCard
                            messages={props.userMessages.map((item) => item.message)}
                            activeMessageId={props.activeMessageId}
                            hoveredIndex={hoveredIndex}
                            onHoverIndex={setHoveredIndex}
                            onJump={(message) => props.onJumpToMessage(message)}
                            maxHeight={cardMaxHeight}
                        />
                    </View>
                </HoverCardLayer>
            </View>
        </View>
    );
}
