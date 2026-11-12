import * as React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { AskUserQuestionMessage, MinimapMessage, readAskUserQuestionAnswer, UserTextMessage } from '@/sync/typesMessage';
import { formatMessageTime } from '@/utils/messageTime';
import { t } from '@/text';
import { computeScrollIntoView } from './scrollIntoView';

export const PREVIEW_WIDTH = 260;
/** Wider than the tooltip: the list is read row by row, so a row gets more room than a preview. */
export const LIST_CARD_WIDTH = 300;
/** Each row in the hover card is one line of the same height, so the rail can mirror the card. */
export const LIST_ROW_HEIGHT = 36;
export const LIST_CARD_VERTICAL_PADDING = 6;
const MAX_PREVIEW_CHARS = 180;

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

/** What hovering (web) or landing on a landmark (touch) shows about it. */
export function MinimapPreviewCard({ message, style, expand = false }: { message: MinimapMessage; style?: any; expand?: boolean }) {
    const previewLabel = getPreviewLabel(message);
    const previewDetail = getPreviewDetail(message);
    return (
        <View
            pointerEvents="none"
            style={[{
                width: PREVIEW_WIDTH,
                borderRadius: 12,
                paddingHorizontal: 12,
                paddingVertical: 10,
                backgroundColor: 'rgba(18, 18, 20, 0.88)',
                borderWidth: 1,
                borderColor: 'rgba(255, 255, 255, 0.12)',
                shadowColor: '#000',
                shadowOpacity: 0.25,
                shadowRadius: 14,
                shadowOffset: { width: 0, height: 8 },
            }, style]}
        >
            <Text style={{ color: 'rgba(255,255,255,0.72)', fontSize: 11, marginBottom: 6 }}>
                {formatMessageTime(message.createdAt)}
            </Text>
            {previewLabel ? (
                <Text numberOfLines={expand ? undefined : 1} style={{ color: 'rgba(255,255,255,0.72)', fontSize: 11, fontWeight: '600', marginBottom: 4 }}>
                    {previewLabel}
                </Text>
            ) : null}
            <Text numberOfLines={expand ? undefined : 5} style={{ color: '#fff', fontSize: 13, lineHeight: 18 }}>
                {getPreviewText(message, expand)}
            </Text>
            {previewDetail ? (
                <Text numberOfLines={expand ? undefined : 2} style={{ color: 'rgba(255,255,255,0.64)', fontSize: 11, marginTop: 7 }}>
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
};

/**
 * The rail's landmarks as a scrolling list, shown while the pointer rests on the rail: the rail is a
 * map without names, so this is where a mark can be read before it is jumped to. The row under the
 * pointer is named in full by a preview card beside the list.
 */
export function MinimapListCard({ messages, activeMessageId, hoveredIndex, onHoverIndex, onJump, maxHeight }: MinimapListCardProps) {
    const { theme } = useUnistyles();
    const scrollRef = React.useRef<ScrollView>(null);
    const [scrollY, setScrollY] = React.useState(0);
    // The row the pointer is on in this list, as opposed to `hoveredIndex`, which may come from the
    // rail: the tooltip names a row only once the pointer is actually over it.
    const [rowIndex, setRowIndex] = React.useState<number | null>(null);
    const scrollYRef = React.useRef(0);
    const viewportRef = React.useRef(maxHeight);

    // A mark hovered on the rail scrolls the list to its own row, so the two surfaces always name
    // the same landmark. Hovering a row that is already visible returns null and leaves the list be.
    const scrollHoveredIntoView = React.useCallback(() => {
        if (hoveredIndex === null) return;
        const nextY = computeScrollIntoView({
            selectedIndex: hoveredIndex,
            itemHeight: LIST_ROW_HEIGHT,
            currentScrollY: scrollYRef.current,
            viewportHeight: viewportRef.current,
        });
        if (nextY !== null) {
            scrollRef.current?.scrollTo({ y: nextY, animated: false });
        }
    }, [hoveredIndex]);
    React.useEffect(() => scrollHoveredIntoView(), [scrollHoveredIntoView]);

    const tooltipTop = rowIndex === null
        ? 0
        : Math.max(0, Math.min(rowIndex * LIST_ROW_HEIGHT - scrollY, Math.max(0, maxHeight - 96)));
    const tooltipMessage = rowIndex !== null ? messages[rowIndex] : undefined;

    return (
        <View style={{ width: LIST_CARD_WIDTH }}>
            <View
                style={{
                    width: LIST_CARD_WIDTH,
                    maxHeight,
                    borderRadius: 14,
                    backgroundColor: 'rgba(18, 18, 20, 0.94)',
                    borderWidth: 1,
                    borderColor: 'rgba(255, 255, 255, 0.12)',
                    shadowColor: '#000',
                    shadowOpacity: 0.25,
                    shadowRadius: 14,
                    shadowOffset: { width: 0, height: 8 },
                    overflow: 'hidden',
                }}
            >
                <ScrollView
                    ref={scrollRef}
                    style={{ maxHeight }}
                    contentContainerStyle={{ paddingVertical: LIST_CARD_VERTICAL_PADDING }}
                    showsVerticalScrollIndicator
                    scrollEventThrottle={16}
                    onScroll={(event) => {
                        const y = event.nativeEvent.contentOffset.y;
                        scrollYRef.current = y;
                        setScrollY(y);
                    }}
                    onLayout={(event) => {
                        viewportRef.current = event.nativeEvent.layout.height;
                    }}
                    onContentSizeChange={scrollHoveredIntoView}
                >
                    {messages.map((message, index) => {
                        const isActive = message.id === activeMessageId;
                        const isHovered = hoveredIndex === index;
                        return (
                            <Pressable
                                key={message.id}
                                onPress={() => onJump(message)}
                                onHoverIn={() => {
                                    setRowIndex(index);
                                    onHoverIndex(index);
                                }}
                                accessibilityRole="button"
                                accessibilityLabel={getRowLabel(message)}
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
                                        color: isActive ? theme.colors.textLink : isHovered ? '#fff' : 'rgba(255,255,255,0.72)',
                                    }}
                                >
                                    {getRowLabel(message)}
                                </Text>
                            </Pressable>
                        );
                    })}
                </ScrollView>
            </View>
            {tooltipMessage ? (
                <MinimapPreviewCard
                    expand
                    message={tooltipMessage}
                    style={{ position: 'absolute', right: LIST_CARD_WIDTH + 10, top: tooltipTop }}
                />
            ) : null}
        </View>
    );
}
