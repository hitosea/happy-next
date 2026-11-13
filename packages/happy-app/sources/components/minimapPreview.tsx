import * as React from 'react';
import { Animated, LayoutChangeEvent, Pressable, ScrollView, Text, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { AskUserQuestionMessage, MinimapMessage, readAskUserQuestionAnswer, UserTextMessage } from '@/sync/typesMessage';
import { formatMessageTime } from '@/utils/messageTime';
import { t } from '@/text';

export const PREVIEW_WIDTH = 260;
/** Wider than the tooltip: the list is read row by row, so a row gets more room than a preview. */
export const LIST_CARD_WIDTH = 300;
/** Each row in the hover card is one line of the same height, so the rail can mirror the card. */
export const LIST_ROW_HEIGHT = 36;
export const LIST_CARD_VERTICAL_PADDING = 6;
const MAX_PREVIEW_CHARS = 180;
/** How fast the list glides after the rail: about 95% of the way in three of these. */
const GLIDE_TIME_CONSTANT_MS = 45;

/**
 * The minimap's cards in each scheme: a dark glass card on a dark screen, a light one on a light
 * screen. Two fixed objects rather than colours read off the theme at each use, so memoized rows
 * see the same strings until the scheme itself changes.
 */
const DARK_PALETTE = {
    previewBackground: 'rgba(18, 18, 20, 0.88)',
    cardBackground: 'rgba(18, 18, 20, 0.94)',
    border: 'rgba(255, 255, 255, 0.12)',
    shadowOpacity: 0.25,
    text: '#fff',
    textMuted: 'rgba(255, 255, 255, 0.72)',
    textFaint: 'rgba(255, 255, 255, 0.64)',
    highlight: 'rgba(255, 255, 255, 0.09)',
    thumb: 'rgba(255, 255, 255, 0.22)',
    thumbActive: 'rgba(255, 255, 255, 0.45)',
};
type MinimapPalette = typeof DARK_PALETTE;
const LIGHT_PALETTE: MinimapPalette = {
    previewBackground: 'rgba(255, 255, 255, 0.96)',
    cardBackground: 'rgba(255, 255, 255, 0.97)',
    border: 'rgba(0, 0, 0, 0.08)',
    shadowOpacity: 0.12,
    text: 'rgba(0, 0, 0, 0.88)',
    textMuted: 'rgba(0, 0, 0, 0.6)',
    textFaint: 'rgba(0, 0, 0, 0.5)',
    highlight: 'rgba(0, 0, 0, 0.06)',
    thumb: 'rgba(0, 0, 0, 0.18)',
    thumbActive: 'rgba(0, 0, 0, 0.36)',
};
function useMinimapPalette() {
    const { theme } = useUnistyles();
    return theme.dark ? DARK_PALETTE : LIGHT_PALETTE;
}

function truncatePreview(raw: string) {
    return raw.length > MAX_PREVIEW_CHARS ? `${raw.slice(0, MAX_PREVIEW_CHARS - 1)}…` : raw;
}

function getPromptPreviewText(message: UserTextMessage, expand = false) {
    const raw = (message.displayText || message.text || '').replace(/\s+/g, ' ').trim();
    if (!raw) return '(empty message)';
    return expand ? raw : truncatePreview(raw);
}

/** One line per question so a multi-question prompt stays readable in the preview. */
function getQuestionPreviewText(message: AskUserQuestionMessage, expand = false) {
    const raw = message.questions.map((question) => question.question.trim()).filter(Boolean).join('\n');
    return expand ? raw : truncatePreview(raw);
}

function getPreviewText(message: MinimapMessage, expand = false) {
    if (message.kind === 'ask-user-question') return getQuestionPreviewText(message, expand);
    if (message.kind === 'preview-html') {
        // The card is named by its title; an untitled one says what it is instead of showing blank.
        const title = message.title?.trim() || t('tools.names.previewHtml');
        return expand ? title : truncatePreview(title);
    }
    return getPromptPreviewText(message, expand);
}

/** The one line a row in the hover card gets, flat enough to be cut by the row's own width. */
function getRowLabel(message: MinimapMessage) {
    if (message.kind === 'ask-user-question') {
        const first = message.questions[0]?.question ?? '';
        return first.replace(/\s+/g, ' ').trim() || t('tools.names.question');
    }
    if (message.kind === 'preview-html') {
        return message.title?.trim() || t('tools.names.previewHtml');
    }
    return getPromptPreviewText(message);
}

/**
 * Small heading above the preview body: the first question's header for a single question, the
 * question count otherwise; a preview's name when its title is about to follow. Prompts have no
 * heading.
 */
function getPreviewLabel(message: MinimapMessage) {
    if (message.kind === 'preview-html') {
        return message.title?.trim() ? t('tools.names.previewHtml') : null;
    }
    if (message.kind !== 'ask-user-question') return null;
    if (message.questions.length > 1) {
        return t('tools.askUserQuestion.multipleQuestions', { count: message.questions.length });
    }
    return message.questions[0]?.header?.trim() || t('tools.names.question');
}

/** Secondary preview line: attachments for a prompt, the chosen answers for a question, nothing for the
 * one card the agent made. */
function getPreviewDetail(message: MinimapMessage) {
    if (message.kind === 'ask-user-question') {
        const chosen = message.answers;
        if (!chosen) return null;
        const answers = message.questions
            .map((question) => readAskUserQuestionAnswer(chosen, question))
            .filter((answer): answer is string => !!answer);
        return answers.length > 0 ? t('tools.askUserQuestion.answered', { answer: answers.join(' · ') }) : null;
    }
    // Only prompts carry attachments; questions reported theirs above, previews have none.
    if (message.kind !== 'user-text') return null;
    const images = message.images ?? [];
    if (images.length === 0) return null;
    const kinds = Array.from(new Set(images.map((image) => image.mimeType || 'image')));
    const kindText = kinds.length === 1 ? kinds[0] : kinds.join(', ');
    return `${images.length} attachment${images.length === 1 ? '' : 's'} · ${kindText}`;
}

const PREVIEW_BODY_LINE_HEIGHT = 18;
/** Room the card's padding, time, heading and detail lines take beside the body, at most. */
const PREVIEW_CHROME_HEIGHT = 100;

type MinimapPreviewCardProps = {
    message: MinimapMessage;
    style?: any;
    /** Show the whole text instead of a five-line excerpt — still cut to `maxHeight` when one is given. */
    expand?: boolean;
    /** The tallest the card may grow; a longer body is cut short with an ellipsis. */
    maxHeight?: number;
    onLayout?: (event: LayoutChangeEvent) => void;
};

/** What hovering (web) or landing on a landmark (touch) shows about it. */
export function MinimapPreviewCard({ message, style, expand = false, maxHeight, onLayout }: MinimapPreviewCardProps) {
    const palette = useMinimapPalette();
    const previewLabel = getPreviewLabel(message);
    const previewDetail = getPreviewDetail(message);
    // Cut by whole lines, so a long body ends on an ellipsis rather than half a line at the edge.
    const bodyLines = !expand
        ? 5
        : maxHeight === undefined
            ? undefined
            : Math.max(3, Math.floor((maxHeight - PREVIEW_CHROME_HEIGHT) / PREVIEW_BODY_LINE_HEIGHT));
    const detailLines = expand && maxHeight === undefined ? undefined : 2;
    return (
        <View
            pointerEvents="none"
            onLayout={onLayout}
            style={[{
                width: PREVIEW_WIDTH,
                maxHeight,
                overflow: 'hidden',
                borderRadius: 12,
                paddingHorizontal: 12,
                paddingVertical: 10,
                backgroundColor: palette.previewBackground,
                borderWidth: 1,
                borderColor: palette.border,
                shadowColor: '#000',
                shadowOpacity: palette.shadowOpacity,
                shadowRadius: 14,
                shadowOffset: { width: 0, height: 8 },
            }, style]}
        >
            <Text style={{ color: palette.textMuted, fontSize: 11, marginBottom: 6 }}>
                {formatMessageTime(message.createdAt)}
            </Text>
            {previewLabel ? (
                <Text numberOfLines={expand ? undefined : 1} style={{ color: palette.textMuted, fontSize: 11, fontWeight: '600', marginBottom: 4 }}>
                    {previewLabel}
                </Text>
            ) : null}
            <Text numberOfLines={bodyLines} style={{ color: palette.text, fontSize: 13, lineHeight: PREVIEW_BODY_LINE_HEIGHT }}>
                {getPreviewText(message, expand)}
            </Text>
            {previewDetail ? (
                <Text numberOfLines={detailLines} style={{ color: palette.textFaint, fontSize: 11, marginTop: 7 }}>
                    {previewDetail}
                </Text>
            ) : null}
        </View>
    );
}

export type MinimapListCardProps = {
    messages: MinimapMessage[];
    activeMessageId: string | null;
    /** The landmark the pointer is on, as an index into `messages`; a row or a rail mark. */
    hoveredIndex: number | null;
    onHoverIndex: (index: number | null) => void;
    onJump: (message: MinimapMessage) => void;
    maxHeight: number;
    /** Whether the card is showing; it stays mounted while away, and opens on the reader's row. */
    visible: boolean;
    /**
     * The hover comes from the rail: the list glides to bring the hovered row to its middle. A hover
     * from the list's own rows never scrolls it.
     */
    followHovered: boolean;
    /** The first and last rows the list shows, reported as it scrolls so the rail can follow. */
    onVisibleRange: (first: number, last: number) => void;
    /**
     * A drag on the scroll thumb began or ended. The pointer may leave the card mid-drag, so the
     * card must not hide meanwhile; `pointerInside` says where the drag let go.
     */
    onThumbDrag?: (dragging: boolean, pointerInside: boolean) => void;
};

/** Inset of the scroll track from the card's top, bottom and right edges. */
const THUMB_INSET = 4;
const THUMB_WIDTH = 6;
/** The thumb thickens under the pointer, growing inwards from the card's edge. */
const THUMB_ACTIVE_WIDTH = 8;
/** Gap between the thumb and the card's right edge. */
const THUMB_RIGHT = 3;
/** The strip that catches the pointer, wider than the thumb so it is easy to take. */
const THUMB_HIT_WIDTH = 12;
const THUMB_MIN_HEIGHT = 24;

type ScrollThumbProps = {
    scrollY: Animated.Value;
    viewportHeight: number;
    contentHeight: number;
    onDragScroll: (y: number) => void;
    getScrollY: () => number;
    onDrag?: (dragging: boolean, pointerInside: boolean) => void;
    containerRef: React.RefObject<View | null>;
};

/**
 * The list's own scroll thumb, drawn the same in every browser and always shown while the list
 * overflows, instead of a system bar that differs per platform and fades away. It sits along the
 * card's right edge, outside the rail's marks, and is moved by the list's scroll through an animated
 * value, so scrolling does not re-render anything. Dragging it scrolls the list. Web only, like the
 * card itself.
 */
function ScrollThumb({ scrollY, viewportHeight, contentHeight, onDragScroll, getScrollY, onDrag, containerRef }: ScrollThumbProps) {
    const palette = useMinimapPalette();
    const [hovered, setHovered] = React.useState(false);
    const [dragging, setDragging] = React.useState(false);
    const cleanupRef = React.useRef<(() => void) | null>(null);
    React.useEffect(() => () => cleanupRef.current?.(), []);

    const maxScroll = contentHeight - viewportHeight;
    const trackHeight = viewportHeight - THUMB_INSET * 2;
    if (maxScroll <= 1 || trackHeight <= THUMB_MIN_HEIGHT) {
        return null;
    }
    const thumbHeight = Math.max(THUMB_MIN_HEIGHT, trackHeight * (viewportHeight / contentHeight));
    const travel = trackHeight - thumbHeight;
    const translateY = scrollY.interpolate({
        inputRange: [0, maxScroll],
        outputRange: [0, travel],
        extrapolate: 'clamp',
    });

    const onMouseDown = (event: any) => {
        if (typeof window === 'undefined' || event.button !== 0) return;
        // Keep the drag from selecting the rows' text.
        event.preventDefault();
        event.stopPropagation();
        const startY = event.clientY;
        const startScroll = getScrollY();
        const scrollPerPixel = travel > 0 ? maxScroll / travel : 0;
        const onMove = (move: MouseEvent) => {
            const next = Math.max(0, Math.min(maxScroll, startScroll + (move.clientY - startY) * scrollPerPixel));
            onDragScroll(next);
        };
        const onUp = (up: MouseEvent) => {
            cleanupRef.current?.();
            const node = containerRef.current as unknown as { contains?: (target: unknown) => boolean } | null;
            onDrag?.(false, !!node?.contains?.(up.target));
        };
        cleanupRef.current = () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
            cleanupRef.current = null;
            setDragging(false);
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
        setDragging(true);
        onDrag?.(true, true);
    };

    const active = hovered || dragging;
    return (
        <View
            pointerEvents="box-none"
            style={{ position: 'absolute', top: THUMB_INSET, bottom: THUMB_INSET, right: THUMB_RIGHT, width: THUMB_HIT_WIDTH }}
        >
            <Animated.View
                {...{
                    onMouseDown,
                    onMouseEnter: () => setHovered(true),
                    onMouseLeave: () => setHovered(false),
                }}
                style={{
                    width: THUMB_HIT_WIDTH,
                    height: thumbHeight,
                    alignItems: 'flex-end',
                    cursor: 'default' as any,
                    transform: [{ translateY }],
                }}
            >
                <View
                    style={{
                        width: active ? THUMB_ACTIVE_WIDTH : THUMB_WIDTH,
                        height: '100%',
                        // Fully round ends at either width.
                        borderRadius: 999,
                        backgroundColor: active ? palette.thumbActive : palette.thumb,
                        transitionProperty: 'width, background-color',
                        transitionDuration: '120ms',
                    } as any}
                />
            </Animated.View>
        </View>
    );
}

type ListRowProps = {
    message: MinimapMessage;
    index: number;
    isActive: boolean;
    isHovered: boolean;
    linkColor: string;
    palette: MinimapPalette;
    onHover: (index: number) => void;
    onJump: (message: MinimapMessage) => void;
};

// Memoized: a hover moves only two rows' state, and a card can list hundreds of landmarks.
const ListRow = React.memo(function ListRow({ message, index, isActive, isHovered, linkColor, palette, onHover, onJump }: ListRowProps) {
    const label = React.useMemo(() => getRowLabel(message), [message]);
    return (
        <Pressable
            onPress={() => onJump(message)}
            onHoverIn={() => onHover(index)}
            accessibilityRole="button"
            accessibilityLabel={label}
            style={{
                height: LIST_ROW_HEIGHT,
                marginHorizontal: 4,
                paddingLeft: 10,
                // The rail draws over the card's right edge, so the rows stop
                // short of it and stay clear of the marks.
                paddingRight: 26,
                justifyContent: 'center',
                cursor: 'pointer' as any,
            }}
        >
            <Text
                numberOfLines={1}
                style={{
                    fontSize: 13,
                    color: isActive ? linkColor : isHovered ? palette.text : palette.textMuted,
                    transitionProperty: 'color',
                    transitionDuration: '140ms',
                } as any}
            >
                {label}
            </Text>
        </Pressable>
    );
});

/**
 * The rail's landmarks as a scrolling list, shown when the pointer reaches the rail: the rail is a
 * map without names, so this is where a mark can be read before it is jumped to. The row under the
 * pointer is named in full by a preview card beside the list.
 */
// Memoized: the rail re-renders as the list scrolls, and this list can hold hundreds of rows.
export const MinimapListCard = React.memo(function MinimapListCard({ messages, activeMessageId, hoveredIndex, onHoverIndex, onJump, maxHeight, visible, followHovered, onVisibleRange, onThumbDrag }: MinimapListCardProps) {
    const { theme } = useUnistyles();
    const linkColor = theme.colors.textLink;
    const palette = useMinimapPalette();
    const scrollRef = React.useRef<ScrollView>(null);
    // The row the pointer is on in this list, as opposed to `hoveredIndex`, which may come from the
    // rail: the tooltip names a row only once the pointer is actually over it. Its top is fixed when
    // the row is entered, so scrolling does not re-render the list on every frame.
    const [tooltip, setTooltip] = React.useState<{ index: number; top: number } | null>(null);
    const scrollYRef = React.useRef(0);
    const viewportRef = React.useRef(maxHeight);
    // The scroll position again, for the thumb: set on every scroll without a render.
    const scrollAnim = React.useRef(new Animated.Value(0)).current;
    // What sizes the thumb; changes only when the card or its rows do.
    const [scrollMetrics, setScrollMetrics] = React.useState({ viewport: 0, content: 0 });
    const cardRef = React.useRef<View>(null);
    // The tooltip's own height, so a tall one is lifted to end with the card instead of hanging below.
    const [tooltipHeight, setTooltipHeight] = React.useState(0);
    // The list card's drawn height: a few landmarks make a card shorter than `maxHeight`.
    const [cardHeight, setCardHeight] = React.useState(maxHeight);
    const onHoverIndexRef = React.useRef(onHoverIndex);
    onHoverIndexRef.current = onHoverIndex;

    // The card hides by clearing the hover; a tooltip left over would greet the next visit.
    React.useEffect(() => {
        if (hoveredIndex === null) setTooltip(null);
    }, [hoveredIndex]);

    const contentHeightRef = React.useRef(0);
    // The hover the previous render saw: null means the card was hidden, so the highlight arrives
    // with the card instead of sliding over from where it last was.
    const prevHoveredRef = React.useRef<number | null>(null);
    const cameFromHidden = prevHoveredRef.current === null;
    React.useEffect(() => {
        prevHoveredRef.current = hoveredIndex;
    }, [hoveredIndex]);

    const onVisibleRangeRef = React.useRef(onVisibleRange);
    onVisibleRangeRef.current = onVisibleRange;
    const reportRange = React.useCallback(() => {
        if (messages.length === 0) return;
        const y = scrollYRef.current - LIST_CARD_VERTICAL_PADDING;
        const last = messages.length - 1;
        const first = Math.max(0, Math.min(last, Math.floor(y / LIST_ROW_HEIGHT)));
        const lastShown = Math.max(first, Math.min(last, Math.floor((y + viewportRef.current - 1) / LIST_ROW_HEIGHT)));
        onVisibleRangeRef.current(first, lastShown);
    }, [messages.length]);

    // Each time the card comes up it opens on the reader's own row, in the middle of the list —
    // the list is then browsed by scrolling, which the rail follows.
    const activeIndex = React.useMemo(() => {
        const index = messages.findIndex((message) => message.id === activeMessageId);
        return index >= 0 ? index : messages.length - 1;
    }, [messages, activeMessageId]);
    const activeIndexRef = React.useRef(activeIndex);
    activeIndexRef.current = activeIndex;
    const centreActive = React.useCallback(() => {
        const viewport = viewportRef.current;
        const maxScroll = Math.max(0, contentHeightRef.current - viewport);
        const rowCentre = LIST_CARD_VERTICAL_PADDING + activeIndexRef.current * LIST_ROW_HEIGHT + LIST_ROW_HEIGHT / 2;
        const target = Math.max(0, Math.min(maxScroll, rowCentre - viewport / 2));
        scrollYRef.current = target;
        scrollAnim.setValue(target);
        scrollRef.current?.scrollTo({ y: target, animated: false });
        reportRange();
    }, [reportRange, scrollAnim]);

    // The list glides after the rail instead of jumping: each frame closes a share of the gap to the
    // target, so a pointer that changes its mind mid-way just moves the target and the motion bends
    // towards it rather than queueing behind a finished animation.
    const glideTargetRef = React.useRef<number | null>(null);
    const glideFrameRef = React.useRef<number | null>(null);
    const lastFrameTimeRef = React.useRef(0);
    const stopGlide = React.useCallback(() => {
        if (glideFrameRef.current !== null) {
            cancelAnimationFrame(glideFrameRef.current);
            glideFrameRef.current = null;
        }
        glideTargetRef.current = null;
    }, []);
    React.useEffect(() => stopGlide, [stopGlide]);
    const glideTo = React.useCallback((target: number) => {
        glideTargetRef.current = target;
        if (glideFrameRef.current !== null) return;
        lastFrameTimeRef.current = performance.now();
        const step = (now: number) => {
            const goal = glideTargetRef.current;
            if (goal === null) {
                glideFrameRef.current = null;
                return;
            }
            const dt = Math.min(64, now - lastFrameTimeRef.current);
            lastFrameTimeRef.current = now;
            const current = scrollYRef.current;
            const gap = goal - current;
            const next = Math.abs(gap) < 0.5 ? goal : current + gap * (1 - Math.exp(-dt / GLIDE_TIME_CONSTANT_MS));
            scrollYRef.current = next;
            scrollAnim.setValue(next);
            scrollRef.current?.scrollTo({ y: next, animated: false });
            reportRange();
            if (next === goal) {
                glideFrameRef.current = null;
                glideTargetRef.current = null;
                return;
            }
            glideFrameRef.current = requestAnimationFrame(step);
        };
        glideFrameRef.current = requestAnimationFrame(step);
    }, [reportRange, scrollAnim]);

    // A mark hovered on the rail brings its row to the middle of the list, so the list streams past
    // as the pointer runs down the rail; the first and last rows settle against the ends.
    React.useEffect(() => {
        if (!followHovered || hoveredIndex === null || contentHeightRef.current === 0) return;
        const viewport = viewportRef.current;
        const maxScroll = Math.max(0, contentHeightRef.current - viewport);
        const rowCentre = LIST_CARD_VERTICAL_PADDING + hoveredIndex * LIST_ROW_HEIGHT + LIST_ROW_HEIGHT / 2;
        glideTo(Math.max(0, Math.min(maxScroll, rowCentre - viewport / 2)));
    }, [followHovered, hoveredIndex, glideTo]);

    const scrollFromThumb = React.useCallback((y: number) => {
        stopGlide();
        scrollRef.current?.scrollTo({ y, animated: false });
    }, [stopGlide]);
    const getScrollY = React.useCallback(() => scrollYRef.current, []);
    React.useEffect(() => {
        if (visible) centreActive();
    }, [visible, centreActive]);

    const handleRowHover = React.useCallback((index: number) => {
        // The pointer is in the list now; a glide still running would pull the rows from under it.
        stopGlide();
        const top = LIST_CARD_VERTICAL_PADDING + index * LIST_ROW_HEIGHT - scrollYRef.current;
        setTooltip((prev) => (prev && prev.index === index && prev.top === top ? prev : { index, top }));
        onHoverIndexRef.current(index);
    }, [stopGlide]);

    // One highlight slides between rows rather than each row lighting up on its own, so the eye
    // follows the move. It keeps its last row while fading out, and comes back in place.
    const highlightIndexRef = React.useRef(0);
    if (hoveredIndex !== null) highlightIndexRef.current = hoveredIndex;
    const highlightTop = LIST_CARD_VERTICAL_PADDING + highlightIndexRef.current * LIST_ROW_HEIGHT;

    const tooltipMessage = tooltip !== null ? messages[tooltip.index] : undefined;
    const tooltipTop = tooltip === null
        ? 0
        : Math.max(0, Math.min(tooltip.top, Math.min(cardHeight, maxHeight) - tooltipHeight));

    return (
        <View style={{ width: LIST_CARD_WIDTH }}>
            <View
                ref={cardRef}
                onLayout={(event) => setCardHeight(event.nativeEvent.layout.height)}
                style={{
                    width: LIST_CARD_WIDTH,
                    maxHeight,
                    borderRadius: 14,
                    backgroundColor: palette.cardBackground,
                    borderWidth: 1,
                    borderColor: palette.border,
                    shadowColor: '#000',
                    shadowOpacity: palette.shadowOpacity,
                    shadowRadius: 14,
                    shadowOffset: { width: 0, height: 8 },
                    overflow: 'hidden',
                }}
            >
                <ScrollView
                    ref={scrollRef}
                    style={{ maxHeight }}
                    contentContainerStyle={{ paddingVertical: LIST_CARD_VERTICAL_PADDING }}
                    // The system bar differs per browser and fades out; the card draws its own thumb.
                    showsVerticalScrollIndicator={false}
                    scrollEventThrottle={16}
                    onScroll={(event) => {
                        // While gliding the glide owns the position: a scroll event reports the
                        // frame before, and taking it would pull the list back a step each frame.
                        if (glideFrameRef.current !== null) return;
                        const y = event.nativeEvent.contentOffset.y;
                        scrollYRef.current = y;
                        scrollAnim.setValue(y);
                        reportRange();
                    }}
                    onLayout={(event) => {
                        const height = event.nativeEvent.layout.height;
                        viewportRef.current = height;
                        setScrollMetrics((prev) => (prev.viewport === height ? prev : { ...prev, viewport: height }));
                        reportRange();
                    }}
                    onContentSizeChange={(_width, height) => {
                        // The first measure can land after the card was asked to show; open on
                        // the reader's row once the list knows how tall it is.
                        const firstMeasure = contentHeightRef.current === 0;
                        contentHeightRef.current = height;
                        setScrollMetrics((prev) => (prev.content === height ? prev : { ...prev, content: height }));
                        if (firstMeasure && visible) centreActive();
                    }}
                >
                    <View
                        pointerEvents="none"
                        style={{
                            position: 'absolute',
                            top: 0,
                            left: 4,
                            right: 4,
                            height: LIST_ROW_HEIGHT,
                            borderRadius: 8,
                            backgroundColor: palette.highlight,
                            opacity: hoveredIndex === null ? 0 : 1,
                            transform: [{ translateY: highlightTop }],
                            transitionProperty: cameFromHidden ? 'opacity' : 'transform, opacity',
                            transitionDuration: '140ms',
                            transitionTimingFunction: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
                        } as any}
                    />
                    {messages.map((message, index) => (
                        <ListRow
                            key={message.id}
                            message={message}
                            index={index}
                            isActive={message.id === activeMessageId}
                            isHovered={hoveredIndex === index}
                            linkColor={linkColor}
                            palette={palette}
                            onHover={handleRowHover}
                            onJump={onJump}
                        />
                    ))}
                </ScrollView>
                <ScrollThumb
                    scrollY={scrollAnim}
                    viewportHeight={scrollMetrics.viewport}
                    contentHeight={scrollMetrics.content}
                    onDragScroll={scrollFromThumb}
                    getScrollY={getScrollY}
                    onDrag={onThumbDrag}
                    containerRef={cardRef}
                />
            </View>
            {tooltipMessage && tooltip ? (
                <MinimapPreviewCard
                    expand
                    message={tooltipMessage}
                    maxHeight={maxHeight}
                    onLayout={(event) => setTooltipHeight(event.nativeEvent.layout.height)}
                    style={{ position: 'absolute', right: LIST_CARD_WIDTH + 10, top: tooltipTop }}
                />
            ) : null}
        </View>
    );
});
