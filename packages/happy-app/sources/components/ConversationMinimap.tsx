import * as React from 'react';
import { Animated, Easing, Platform, Pressable, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { MinimapMessage } from '@/sync/typesMessage';
import {
    MARKER_HEIGHT,
    MARKER_SLOT_HEIGHT,
    MARKER_WIDTH,
    getHoverScale,
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
/**
 * The container ends right at the chat list's scrollbar strip, so the rail's hit area reaches all
 * the way to it; the marks are drawn this far in from that edge.
 */
const MARK_INSET = 8;
/** Where the card's right edge sits, measured in from the container; the rail is to its right. */
const CARD_RIGHT = 44;
/** While the card is up the rail narrows to the strip right of it, so it never covers the card. */
const HIT_WIDTH_BESIDE_CARD = CARD_RIGHT;
/** At rest the rail catches the pointer from the strip to as far left as it did before the inset. */
const HIT_WIDTH_AT_REST = HIT_WIDTH + MARK_INSET;
/** The hovered mark stops just short of 4× so it stays clear of the card's edge beside it. */
const MARK_MAX_WIDTH = MARKER_WIDTH * 4 - 2;
const MIN_CONTENT_WIDTH = 840;
/** Breathing room the rail keeps from the card's top and bottom edges, per side. */
const RAIL_EDGE_INSET = 12;

/**
 * The hover card's entrance and exit: a fade rather than a pop. The layer mounts on first show and
 * then stays, so coming back only reverses the fade instead of rebuilding the card.
 */
function HoverCardLayer({ visible, children }: { visible: boolean; children: React.ReactNode }) {
    const progress = React.useRef(new Animated.Value(0)).current;
    // Once shown, the card stays mounted and only fades: building every row again on each hover is
    // what made the card stutter in, and a hidden card costs nothing while nothing about it changes.
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
        }).start();
    }, [visible, progress]);

    if (!mounted) {
        return null;
    }

    return (
        <Animated.View
            pointerEvents={visible ? 'auto' : 'none'}
            aria-hidden={!visible}
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
 * Right-edge rail with its hover card beside it. Reaching the rail brings up the card; running the
 * pointer along the rail scrubs, and the card glides to the hovered mark's row. Scrolling the card
 * moves the other way: the rail follows, lighting the marks of the rows the card shows. It sits just
 * inside the chat list's scrollbar strip, which it would otherwise cover and take the drags of.
 */
function WebMinimap(props: ConversationMinimapProps) {
    const { theme } = useUnistyles();
    // An index into `props.userMessages`, not into the drawn window: the hover card lists every
    // landmark, so a row there and a mark on the rail have to name the same landmark.
    const [hoveredIndex, setHoveredIndex] = React.useState<number | null>(null);
    const [cardVisible, setCardVisible] = React.useState(false);
    const [availableHeight, setAvailableHeight] = React.useState(0);
    // The rows the card shows, as indexes into `props.userMessages`; null while the card is away.
    const [cardRange, setCardRange] = React.useState<{ first: number; last: number } | null>(null);
    // The pointer is on the rail: it leads, the card follows it, and the rail's window holds still
    // so the marks do not slide from under the pointer as the card scrolls.
    const [pointerOnRail, setPointerOnRail] = React.useState(false);
    const handleVisibleRange = React.useCallback((first: number, last: number) => {
        setCardRange((prev) => (prev && prev.first === first && prev.last === last ? prev : { first, last }));
    }, []);

    // Moving from the rail into the card crosses a gap, so the card outlives the rail's leave for a
    // moment; entering it cancels the hide.
    const hideTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const cancelHide = React.useCallback(() => {
        if (hideTimer.current !== null) {
            clearTimeout(hideTimer.current);
            hideTimer.current = null;
        }
    }, []);
    // A drag on the card's scroll thumb may carry the pointer outside the card; it stays up until
    // the drag lets go, and hides then only if the pointer let go outside it.
    const thumbDraggingRef = React.useRef(false);
    const scheduleHide = React.useCallback(() => {
        cancelHide();
        if (thumbDraggingRef.current) return;
        hideTimer.current = setTimeout(() => {
            hideTimer.current = null;
            setHoveredIndex(null);
            setCardVisible(false);
            setCardRange(null);
        }, 180);
    }, [cancelHide]);
    React.useEffect(() => cancelHide, [cancelHide]);
    const handleThumbDrag = React.useCallback((dragging: boolean, pointerInside: boolean) => {
        thumbDraggingRef.current = dragging;
        if (!dragging && !pointerInside) scheduleHide();
    }, [scheduleHide]);

    // Where the rail rests: the landmark the reader is on, or the newest one when the list has not
    // named it yet — the rail is read from the bottom of the conversation far more often than not.
    const activeIndex = React.useMemo(() => {
        const index = props.userMessages.findIndex((item) => item.message.id === props.activeMessageId);
        return index >= 0 ? index : Math.max(0, props.userMessages.length - 1);
    }, [props.userMessages, props.activeMessageId]);

    const listMessages = React.useMemo(() => props.userMessages.map((item) => item.message), [props.userMessages]);
    const onJumpRef = React.useRef(props.onJumpToMessage);
    onJumpRef.current = props.onJumpToMessage;
    const handleJump = React.useCallback((message: MinimapMessage) => {
        onJumpRef.current(message);
    }, []);

    const cardMaxHeight = Math.max(180, Math.min(availableHeight, 420));
    // The rail keeps one pitch whatever the count: few landmarks make a short rail rather than marks
    // stretched apart to fill the card. It fits inside the card (its rows plus padding, capped) with
    // a narrow band of card left above and below; more marks than that band holds slide the window.
    const cardHeight = Math.min(
        LIST_CARD_VERTICAL_PADDING * 2 + props.userMessages.length * LIST_ROW_HEIGHT,
        cardMaxHeight,
    );
    const railBand = Math.max(MARKER_SLOT_HEIGHT, cardHeight - RAIL_EDGE_INSET * 2);
    const railSlots = Math.min(props.userMessages.length, Math.max(1, Math.floor(railBand / MARKER_SLOT_HEIGHT)));
    const railPitch = MARKER_SLOT_HEIGHT;
    const railHeight = railPitch * railSlots;

    // While the card is up the rail follows the card's scroll, centred on the rows it shows; at rest
    // it follows the reader.
    const railFocus = cardVisible && cardRange !== null
        ? Math.floor((cardRange.first + cardRange.last) / 2)
        : activeIndex;

    const frozenStartRef = React.useRef(0);
    const visibleWindow = React.useMemo(() => {
        const total = props.userMessages.length;
        const maxStart = Math.max(0, total - railSlots);
        const start = pointerOnRail
            ? Math.min(frozenStartRef.current, maxStart)
            : windowStartFor(railFocus, railSlots, total);
        return { start, end: start + railSlots, items: props.userMessages.slice(start, start + railSlots) };
    }, [props.userMessages, railFocus, railSlots, pointerOnRail]);
    frozenStartRef.current = visibleWindow.start;

    const railHitWidth = cardVisible ? HIT_WIDTH_BESIDE_CARD : HIT_WIDTH_AT_REST;
    const webHoverHandlers = {
        onMouseMove: (event: any) => {
            const rect = event.currentTarget?.getBoundingClientRect?.();
            if (!rect || visibleWindow.items.length === 0) return;
            cancelHide();
            setCardVisible(true);
            setPointerOnRail(true);
            const y = event.clientY - rect.top;
            const nextIndex = Math.max(0, Math.min(visibleWindow.items.length - 1, Math.floor(y / railPitch)));
            setHoveredIndex(visibleWindow.start + nextIndex);
        },
        onMouseLeave: () => {
            setPointerOnRail(false);
            scheduleHide();
        },
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
                right: proxyStripWidthPx(),
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
                    width: railHitWidth,
                    height: railHeight,
                    alignItems: 'flex-end',
                    justifyContent: 'center',
                    zIndex: 1,
                }}
            >
                <View
                    pointerEvents="none"
                    style={{
                        position: 'absolute',
                        top: 0,
                        bottom: 0,
                        right: MARK_INSET,
                        width: 1,
                        borderRadius: 1,
                        backgroundColor: theme.colors.transparent,
                        opacity: 0.55,
                    }}
                />

                {visibleWindow.items.map((item, itemIndex) => {
                    const index = visibleWindow.start + itemIndex;
                    // As before the card: the reader's mark is lit only while nothing is hovered,
                    // and while the pointer is on the rail only the hovered mark is.
                    const isActive = hoveredIndex === null && item.message.id === props.activeMessageId;
                    const isHovered = hoveredIndex === index;
                    const hoverScale = hoveredIndex === null ? 1 : getHoverScale(Math.abs(hoveredIndex - index));
                    // Every landmark is drawn as the same mark; hovering — or the screen reader —
                    // is what tells a question and a preview apart from a prompt.
                    const jumpLabel = item.message.kind === 'ask-user-question'
                        ? 'Jump to question'
                        : item.message.kind === 'preview-html'
                            ? 'Jump to preview'
                            : 'Jump to user message';
                    return (
                        <Pressable
                            key={item.message.id}
                            onPress={() => props.onJumpToMessage(item.message)}
                            onHoverIn={() => setHoveredIndex(index)}
                            accessibilityRole="button"
                            accessibilityLabel={jumpLabel}
                            style={{
                                width: railHitWidth,
                                height: railPitch,
                                paddingRight: MARK_INSET,
                                alignItems: 'flex-end',
                                justifyContent: 'center',
                                cursor: 'pointer' as any,
                            }}
                        >
                            <View
                                style={{
                                    width: Math.min(MARK_MAX_WIDTH, MARKER_WIDTH * hoverScale),
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
                    );
                })}
            </View>

            <View
                style={{
                    position: 'absolute',
                    // Beside the rail rather than under it, ending where the narrowed rail begins,
                    // so the pointer crosses straight from one to the other.
                    right: CARD_RIGHT,
                    top: 0,
                    bottom: 0,
                    justifyContent: 'center',
                    pointerEvents: 'box-none',
                }}
            >
                <HoverCardLayer visible={cardVisible}>
                    <View {...{ onMouseEnter: cancelHide, onMouseLeave: scheduleHide }}>
                        <MinimapListCard
                            messages={listMessages}
                            activeMessageId={props.activeMessageId}
                            hoveredIndex={hoveredIndex}
                            onHoverIndex={setHoveredIndex}
                            onJump={handleJump}
                            maxHeight={cardMaxHeight}
                            visible={cardVisible}
                            followHovered={pointerOnRail}
                            onVisibleRange={handleVisibleRange}
                            onThumbDrag={handleThumbDrag}
                        />
                    </View>
                </HoverCardLayer>
            </View>
        </View>
    );
}
