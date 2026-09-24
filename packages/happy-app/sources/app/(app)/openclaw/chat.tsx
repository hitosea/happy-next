/**
 * OpenClaw Chat Page
 *
 * Chat view for an OpenClaw session.
 * Handles message display, input, and real-time streaming.
 *
 * Uses a single messages list approach:
 * - User messages are added directly to the list with status tracking
 * - Streaming AI responses are managed as a temporary message in the list
 * - On completion, the entire list is replaced with server history (single atomic update)
 */

import React from 'react';
import {
    View,
    Text,
    Pressable,
    ActivityIndicator,
    Platform,
    Animated,
    Easing,
    type ScrollViewProps,
} from 'react-native';
import { KeyboardChatScrollView } from 'react-native-keyboard-controller';
import { AgentContentView } from '@/components/AgentContentView';
import { randomUUID } from 'expo-crypto';
import { Image } from 'expo-image';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { useLocalSearchParams, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { t } from '@/text';
import { Typography } from '@/constants/Typography';
import { layout } from '@/components/layout';
import { MarkdownView } from '@/components/markdown/MarkdownView';
import { MultiTextInput, KeyPressEvent } from '@/components/MultiTextInput';
import { LegendList, type LegendListRef, type LegendListRenderItemProps } from '@legendapp/list/react-native';
import { useSoftHeaderInset } from '@/components/navigation/softHeader';
import { useOpenClawConnection } from '@/openclaw/connection';
import { useOpenClawMachine } from '@/sync/storage';
import type { OpenClawChatMessage, OpenClawChatEvent, OpenClawContentBlock, OpenClawToolStreamEvent, OpenClawSession } from '@/openclaw/types';
import type { BottomSheetModal } from '@gorhom/bottom-sheet';
import { SessionDetailModal } from '@/components/openclaw/SessionDetailModal';

// Special ID for streaming message
const STREAMING_MESSAGE_ID = '__streaming__';

// Local message type with status tracking
type MessageStatus = 'sending' | 'sent' | 'failed';

interface LocalMessage extends OpenClawChatMessage {
    localId: string;
    status?: MessageStatus;
    isStreaming?: boolean;
    errorMessage?: string;
    activeToolCalls?: Record<string, { name: string; status: 'running' | 'completed' | 'failed' }>;
}

/** Room under the header above the oldest message, and the first-frame size hint for LegendList. */
const LIST_TOP_GAP = 32;
const ESTIMATED_ITEM_SIZE = 120;

/**
 * iOS scroll view for the chat list: while the keyboard is up it keeps its own frame and lifts the
 * content (keyboard-controller's chat-style native inset), so the top edge stays beneath the header and
 * keeps drawing the scroll-edge effect. The composer is a sibling below the list inside AgentContentView's
 * KeyboardStickyView, so only the home-indicator inset still sits over the keyboard — subtract it.
 */
const ChatScrollView = React.forwardRef<
    React.ElementRef<typeof KeyboardChatScrollView>,
    ScrollViewProps & { bottomInset: number }
>(({ bottomInset, ...props }, ref) => (
    <KeyboardChatScrollView
        ref={ref}
        automaticallyAdjustContentInsets={false}
        contentInsetAdjustmentBehavior="never"
        keyboardDismissMode="interactive"
        keyboardLiftBehavior="always"
        offset={bottomInset}
        {...props}
    />
));
ChatScrollView.displayName = 'ChatScrollView';

const keyExtractor = (item: LocalMessage) => item.localId;

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        backgroundColor: theme.colors.surface,
    },
    messageList: {
        flex: 1,
    },
    messageListContent: {
        paddingHorizontal: 16,
        paddingTop: 8,
        paddingBottom: 16,
        maxWidth: layout.maxWidth,
        alignSelf: 'center',
        width: '100%',
        rowGap: 12,
    },
    messageBubble: {
        flexShrink: 1,
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderRadius: 16,
    },
    userBubble: {
        backgroundColor: theme.colors.button.primary.background,
        borderBottomRightRadius: 4,
    },
    assistantBubble: {
        backgroundColor: theme.colors.surfacePressed,
        borderBottomLeftRadius: 4,
    },
    messageText: {
        fontSize: 16,
        lineHeight: 22,
        ...Typography.default(),
    },
    userMessageText: {
        color: theme.colors.button.primary.tint,
    },
    inputContainer: {
        paddingHorizontal: 16,
        paddingVertical: 8,
        backgroundColor: theme.colors.surface,
        alignItems: 'center',
    },
    inputInner: {
        width: '100%',
        maxWidth: layout.maxWidth,
    },
    inputPanel: {
        backgroundColor: theme.colors.input.background,
        borderRadius: 16,
        paddingHorizontal: 12,
        paddingVertical: 8,
        flexDirection: 'row',
        alignItems: 'flex-end',
        gap: 8,
    },
    inputWrapper: {
        flex: 1,
    },
    sendButton: {
        width: 32,
        height: 32,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
    },
    sendButtonActive: {
        backgroundColor: theme.colors.button.primary.background,
    },
    sendButtonDisabled: {
        backgroundColor: theme.colors.surfacePressed,
    },
    messageRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 6,
        maxWidth: '85%',
    },
    messageRowUser: {
        alignSelf: 'flex-end',
    },
    messageRowAssistant: {
        alignSelf: 'flex-start',
    },
    statusContainer: {
        width: 28,
        height: 30,
        marginTop: 6,
        alignItems: 'center',
        justifyContent: 'center',
    },
    emptyContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 24,
    },
    emptyTitle: {
        fontSize: 18,
        color: theme.colors.text,
        marginBottom: 8,
        textAlign: 'center',
        ...Typography.default('semiBold'),
    },
    emptyDescription: {
        fontSize: 14,
        color: theme.colors.textSecondary,
        textAlign: 'center',
        ...Typography.default(),
    },
    readingIndicator: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 4,
        paddingVertical: 6,
        gap: 4,
    },
    readingDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: theme.colors.textSecondary,
    },
    // Typing indicator for streaming messages - inside bubble at bottom right
    typingIndicator: {
        position: 'absolute',
        right: 8,
        bottom: 6,
    },
}));

// Animated dot component for smooth animations (used in ReadingIndicator)
const AnimatedDot = React.memo(({ delay }: { delay: number }) => {
    const opacity = React.useRef(new Animated.Value(0.3)).current;

    React.useEffect(() => {
        const animation = Animated.loop(
            Animated.sequence([
                Animated.delay(delay),
                Animated.timing(opacity, {
                    toValue: 1,
                    duration: 300,
                    easing: Easing.ease,
                    useNativeDriver: true,
                }),
                Animated.timing(opacity, {
                    toValue: 0.3,
                    duration: 300,
                    easing: Easing.ease,
                    useNativeDriver: true,
                }),
                Animated.delay(600 - delay),
            ])
        );
        animation.start();
        return () => animation.stop();
    }, [opacity, delay]);

    return (
        <Animated.View style={[styles.readingDot, { opacity }]} />
    );
});

// Reading indicator with animated dots (used when waiting for first content)
const ReadingIndicator = React.memo(() => {
    return (
        <View style={[styles.messageRow, styles.messageRowAssistant]}>
            <View style={[styles.messageBubble, styles.assistantBubble]}>
                <View style={styles.readingIndicator}>
                    <AnimatedDot delay={0} />
                    <AnimatedDot delay={200} />
                    <AnimatedDot delay={400} />
                </View>
            </View>
        </View>
    );
});

// Typing indicator shown at the end of streaming messages
const TypingIndicator = React.memo(() => {
    const { theme } = useUnistyles();
    return (
        <View style={styles.typingIndicator}>
            <ActivityIndicator size={14} color={theme.colors.textSecondary} />
        </View>
    );
});

// Collapsible thinking block
const ThinkingBlock = React.memo(({ thinking }: { thinking: string }) => {
    const { theme } = useUnistyles();
    const [expanded, setExpanded] = React.useState(false);
    const preview = thinking.length > 50 ? thinking.slice(0, 50) + '...' : thinking;

    return (
        <Pressable
            onPress={() => setExpanded((v) => !v)}
            style={{
                backgroundColor: theme.colors.surfacePressed,
                borderRadius: 8,
                padding: 8,
                marginBottom: 4,
                opacity: 0.8,
            }}
        >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Text style={{ fontSize: 12, color: theme.colors.textSecondary }}>
                    {'\ud83d\udcad ' + t('openclaw.thinking')}
                </Text>
                {!expanded && (
                    <Text
                        numberOfLines={1}
                        style={{ fontSize: 12, color: theme.colors.textSecondary, flex: 1, ...Typography.default() }}
                    >
                        {preview}
                    </Text>
                )}
                <Text style={{ fontSize: 10, color: theme.colors.textSecondary }}>
                    {expanded ? '\u25bc' : '\u25b6'}
                </Text>
            </View>
            {expanded && (
                <View style={{ marginTop: 6 }}>
                    <MarkdownView markdown={thinking} />
                </View>
            )}
        </Pressable>
    );
});

// One-line tool call summary, optionally paired with a result
const ToolCallSummary = React.memo(({ name, args, resultStatus }: {
    name?: string;
    args?: unknown;
    resultStatus?: 'completed' | 'failed' | 'running' | null;
}) => {
    const { theme } = useUnistyles();
    const toolName = name ?? t('openclaw.toolCall');

    let argSummary = '';
    if (args && typeof args === 'object' && !Array.isArray(args)) {
        const entries = Object.entries(args as Record<string, unknown>);
        if (entries.length > 0) {
            const [, value] = entries[0];
            const raw = typeof value === 'string' ? value : JSON.stringify(value);
            argSummary = raw.length > 40 ? raw.slice(0, 40) + '...' : raw;
        }
    }

    const statusLabel = resultStatus === 'completed' ? t('openclaw.toolCompleted')
        : resultStatus === 'failed' ? t('openclaw.toolFailed')
        : resultStatus === 'running' ? t('openclaw.toolRunning')
        : '';

    const statusColor = resultStatus === 'failed'
        ? theme.colors.status.disconnected
        : theme.colors.textSecondary;

    return (
        <View style={{
            flexDirection: 'row',
            alignItems: 'center',
            paddingVertical: 3,
            gap: 4,
        }}>
            <Text style={{ fontSize: 13, color: theme.colors.textSecondary }}>
                {'\ud83d\udd27 ' + toolName}
            </Text>
            {argSummary ? (
                <Text
                    numberOfLines={1}
                    style={{ fontSize: 13, color: theme.colors.textSecondary, flex: 1, ...Typography.default() }}
                >
                    {'\u00b7 ' + argSummary}
                </Text>
            ) : null}
            {statusLabel ? (
                <Text style={{ fontSize: 13, color: statusColor, marginLeft: 'auto' }}>
                    {statusLabel}
                </Text>
            ) : null}
        </View>
    );
});

// Standalone tool result (when no matching toolcall exists)
const ToolResultSummary = React.memo(({ name, isError }: {
    name?: string;
    isError?: boolean;
}) => {
    const { theme } = useUnistyles();
    return (
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 3, gap: 4 }}>
            <Text style={{ fontSize: 13, color: theme.colors.textSecondary }}>
                {'\ud83d\udccb ' + t('openclaw.toolResult')}
                {name ? ` \u00b7 ${name}` : ''}
            </Text>
            <Text style={{
                fontSize: 13,
                color: isError ? theme.colors.status.disconnected : theme.colors.textSecondary,
                marginLeft: 'auto',
            }}>
                {isError ? '\u2717' : '\u2713'}
            </Text>
        </View>
    );
});

// Inline image from base64 data, or placeholder for omitted/unavailable images
const ImageBlock = React.memo(({ data, mimeType, omitted, bytes }: { data?: string; mimeType?: string; omitted?: boolean; bytes?: number }) => {
    const { theme } = useUnistyles();
    if (omitted) {
        const sizeLabel = bytes ? ` (${Math.round(bytes / 1024)}KB)` : '';
        return (
            <View style={{
                padding: 12,
                backgroundColor: theme.colors.surfacePressed,
                borderRadius: 8,
                alignItems: 'center',
            }}>
                <Text style={{ fontSize: 13, color: theme.colors.textSecondary }}>
                    {'\ud83d\uddbc\ufe0f ' + t('openclaw.imageUnavailable') + sizeLabel}
                </Text>
            </View>
        );
    }
    if (!data || !mimeType) {
        return (
            <View style={{
                padding: 12,
                backgroundColor: theme.colors.surfacePressed,
                borderRadius: 8,
                alignItems: 'center',
            }}>
                <Text style={{ fontSize: 13, color: theme.colors.textSecondary }}>
                    {t('openclaw.imageUnavailable')}
                </Text>
            </View>
        );
    }
    return (
        <Image
            source={{ uri: `data:${mimeType};base64,${data}` }}
            contentFit="contain"
            style={{
                width: '100%',
                aspectRatio: 1,
                maxHeight: 300,
                borderRadius: 8,
            }}
        />
    );
});

// Normalize block type variants to canonical form
function normalizeBlockType(type: string): string {
    const t = type.toLowerCase();
    if (t === 'toolcall' || t === 'tool_call' || t === 'tool_use' || t === 'tooluse') return 'toolcall';
    if (t === 'tool_result' || t === 'toolresult') return 'tool_result';
    return t;
}

// Check if a role is a tool result role
function isToolResultRole(role: string): boolean {
    const r = role.toLowerCase();
    return r === 'toolresult' || r === 'tool_result' || r === 'tool' || r === 'function';
}

// Resolve tool arguments from various field names
function resolveToolArgs(block: Record<string, unknown>): unknown {
    return block.arguments ?? block.input ?? block.args;
}

// Resolve tool use ID from various field names
function resolveToolUseId(block: Record<string, unknown>): string | undefined {
    const id = block.id ?? block.tool_use_id ?? block.toolUseId;
    return typeof id === 'string' && id.trim() ? id.trim() : undefined;
}

// Resolve image data — handle both direct data and source object
function resolveImageData(block: Record<string, unknown>): { data?: string; mimeType?: string; omitted?: boolean; bytes?: number } {
    if (block.omitted) {
        return { omitted: true, bytes: typeof block.bytes === 'number' ? block.bytes : undefined };
    }
    if (typeof block.data === 'string' && typeof block.mimeType === 'string') {
        return { data: block.data, mimeType: block.mimeType };
    }
    // Anthropic image format: source.type="base64", source.media_type, source.data
    const source = block.source as { type?: string; media_type?: string; data?: string } | undefined;
    if (source && typeof source.data === 'string' && typeof source.media_type === 'string') {
        return { data: source.data, mimeType: source.media_type };
    }
    return {};
}

// Build renderable block list from message content, pairing toolcall with tool_result
function buildContentBlocks(
    content: OpenClawContentBlock[],
    phase?: 'commentary' | 'final_answer',
    activeToolCalls?: Record<string, { name: string; status: 'running' | 'completed' | 'failed' }>,
): React.ReactNode[] {
    const nodes: React.ReactNode[] = [];

    // Build a map of tool_result by id for pairing
    const resultMap = new Map<string, { is_error?: boolean }>();
    for (const block of content) {
        const raw = block as unknown as Record<string, unknown>;
        if (normalizeBlockType(block.type) === 'tool_result') {
            const id = resolveToolUseId(raw);
            if (id) {
                resultMap.set(id, { is_error: Boolean(raw.is_error ?? raw.isError) });
            }
        }
    }

    const pairedResultIds = new Set<string>();
    const hasFinalAnswer = phase === 'final_answer';

    for (let i = 0; i < content.length; i++) {
        const block = content[i];
        const raw = block as unknown as Record<string, unknown>;
        const normalized = normalizeBlockType(block.type);

        switch (normalized) {
            case 'text':
                if (hasFinalAnswer || !phase) {
                    const text = typeof raw.text === 'string' ? raw.text : '';
                    if (text.trim()) {
                        nodes.push(<MarkdownView key={`text-${i}`} markdown={text} />);
                    }
                }
                break;

            case 'thinking': {
                const thinking = typeof raw.thinking === 'string' ? raw.thinking : '';
                if (thinking.trim()) {
                    nodes.push(<ThinkingBlock key={`thinking-${i}`} thinking={thinking} />);
                }
                break;
            }

            case 'toolcall': {
                const id = resolveToolUseId(raw);
                const result = id ? resultMap.get(id) : undefined;
                if (id && result) {
                    pairedResultIds.add(id);
                }
                const liveStatus = id ? activeToolCalls?.[id]?.status : undefined;
                const resultStatus = result
                    ? (result.is_error ? 'failed' as const : 'completed' as const)
                    : (liveStatus ?? null);
                nodes.push(
                    <ToolCallSummary
                        key={`tool-${i}`}
                        name={typeof raw.name === 'string' ? raw.name : undefined}
                        args={resolveToolArgs(raw)}
                        resultStatus={resultStatus}
                    />
                );
                break;
            }

            case 'tool_result': {
                const id = resolveToolUseId(raw);
                if (!id || !pairedResultIds.has(id)) {
                    nodes.push(
                        <ToolResultSummary
                            key={`result-${i}`}
                            name={typeof raw.name === 'string' ? raw.name : undefined}
                            isError={Boolean(raw.is_error ?? raw.isError)}
                        />
                    );
                }
                break;
            }

            case 'image': {
                const img = resolveImageData(raw);
                nodes.push(<ImageBlock key={`img-${i}`} data={img.data} mimeType={img.mimeType} omitted={img.omitted} bytes={img.bytes} />);
                break;
            }

            // Unknown block types: skip silently
        }
    }

    // Append live tool calls not yet in content blocks
    if (activeToolCalls) {
        for (const [id, tool] of Object.entries(activeToolCalls)) {
            const hasInContent = content.some((b) => {
                const n = normalizeBlockType(b.type);
                return n === 'toolcall' && resolveToolUseId(b as unknown as Record<string, unknown>) === id;
            });
            if (!hasInContent) {
                nodes.push(
                    <ToolCallSummary
                        key={`live-tool-${id}`}
                        name={tool.name}
                        resultStatus={tool.status}
                    />
                );
            }
        }
    }

    return nodes;
}

interface MessageItemProps {
    message: LocalMessage;
    onRetry?: (localId: string) => void;
}

const MessageItem = React.memo(({ message, onRetry }: MessageItemProps) => {
    const { theme } = useUnistyles();
    const isUser = message.role === 'user';
    const isToolResult = isToolResultRole(message.role);
    const isFailed = message.status === 'failed';
    const isSending = message.status === 'sending';
    const isStreaming = message.isStreaming;

    const getTextContent = (): string => {
        if (typeof message.content === 'string') return message.content;
        return message.content
            .filter((block) => block.type === 'text' && 'text' in block && typeof (block as { text?: unknown }).text === 'string')
            .map((block) => (block as { text: string }).text)
            .join('\n');
    };

    const renderBlockContent = () => {
        if (typeof message.content === 'string') {
            if (!message.content.trim()) return null;
            return <MarkdownView markdown={message.content} />;
        }

        const blocks = buildContentBlocks(
            message.content,
            message.phase,
            message.activeToolCalls,
        );

        if (blocks.length === 0 && !isStreaming) return null;
        return <>{blocks}</>;
    };

    if (isStreaming) {
        const hasContent = typeof message.content === 'string'
            ? message.content.trim().length > 0
            : message.content.length > 0;
        if (!hasContent && !message.activeToolCalls) {
            return <ReadingIndicator />;
        }
    }

    const renderStatusIndicator = () => {
        if (!isUser) return null;
        if (isSending) {
            return (
                <View style={styles.statusContainer}>
                    <ActivityIndicator size={14} color={theme.colors.textSecondary} />
                </View>
            );
        }
        if (isFailed) {
            return (
                <Pressable
                    style={styles.statusContainer}
                    onPress={() => onRetry?.(message.localId)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                    <Ionicons name="alert-circle" size={20} color={theme.colors.status.disconnected} />
                </Pressable>
            );
        }
        return null;
    };

    // User messages — plain text bubble
    if (isUser) {
        const textContent = getTextContent();
        return (
            <View style={[styles.messageRow, styles.messageRowUser]}>
                {renderStatusIndicator()}
                <View style={[styles.messageBubble, styles.userBubble, isFailed && { opacity: 0.7 }]}>
                    <Text style={[styles.messageText, styles.userMessageText]}>
                        {textContent}
                    </Text>
                </View>
            </View>
        );
    }

    // Tool result messages (role: "toolResult" / "tool_result" / "tool" / "function")
    // These are standalone messages representing tool execution results
    if (isToolResult) {
        const toolName = message.toolName ?? message.tool_name ?? t('openclaw.toolCall');
        const isError = Boolean(message.isError);
        return (
            <View style={[styles.messageRow, styles.messageRowAssistant]}>
                <View style={[styles.messageBubble, styles.assistantBubble, { gap: 4 }]}>
                    <ToolCallSummary
                        name={toolName}
                        resultStatus={isError ? 'failed' : 'completed'}
                    />
                </View>
            </View>
        );
    }

    // Assistant messages — render content blocks
    const assistantContent = renderBlockContent();
    if (!assistantContent && !isStreaming) return null;

    return (
        <View style={[styles.messageRow, styles.messageRowAssistant]}>
            <View style={[styles.messageBubble, styles.assistantBubble, { gap: 4 }]}>
                {assistantContent}
                {isStreaming && <TypingIndicator />}
            </View>
        </View>
    );
});

export default function OpenClawChatPage() {
    const { theme } = useUnistyles();
    const safeArea = useSafeAreaInsets();
    const { machineId, sessionKey, sessionName: sessionNameParam } = useLocalSearchParams<{
        machineId: string;
        sessionKey: string;
        sessionName?: string;
    }>();

    // Get machine data
    const machine = useOpenClawMachine(machineId ?? '');

    // Ref for handling chat events - must be before useOpenClawConnection
    const handleChatEventRef = React.useRef<(event: OpenClawChatEvent) => void>(() => {});
    const handleToolStreamRef = React.useRef<(event: OpenClawToolStreamEvent) => void>(() => {});

    // Stable callback for onEvent - uses ref to always call latest handler
    const onEventCallback = React.useCallback((event: string, payload: unknown) => {
        if (event === 'chat' && payload) {
            const p = payload as Record<string, unknown>;
            if (p.state && p.sessionKey) {
                handleChatEventRef.current(payload as OpenClawChatEvent);
            }
        } else if (event === 'agent' && payload) {
            const p = payload as Record<string, unknown>;

            if (p.stream === 'assistant' && p.data && p.sessionKey) {
                const data = p.data as { delta?: string; text?: string; thinking?: string };
                const blocks: OpenClawContentBlock[] = [];
                if (data.thinking) {
                    blocks.push({ type: 'thinking', thinking: data.thinking });
                }
                if (data.text) {
                    blocks.push({ type: 'text', text: data.text });
                }
                if (blocks.length > 0) {
                    handleChatEventRef.current({
                        state: 'delta',
                        sessionKey: p.sessionKey as string,
                        runId: p.runId as string,
                        seq: 0,
                        message: { role: 'assistant', content: blocks },
                    });
                }
            } else if (p.stream === 'tool' && p.data && p.sessionKey) {
                const data = p.data as { phase?: string; name?: string; toolCallId?: string; args?: Record<string, unknown>; isError?: boolean };
                if (data.toolCallId && data.phase) {
                    handleToolStreamRef.current({
                        sessionKey: p.sessionKey as string,
                        runId: p.runId as string,
                        toolCallId: data.toolCallId,
                        phase: data.phase as 'start' | 'update' | 'result',
                        name: data.name,
                        args: data.args,
                        isError: data.isError,
                    });
                }
            } else if (p.stream === 'lifecycle' && p.data) {
                const data = p.data as { state?: string; error?: string };
                if (data.state === 'completed') {
                    handleChatEventRef.current({
                        state: 'final',
                        sessionKey: p.sessionKey as string,
                        runId: p.runId as string,
                        seq: 0,
                    });
                } else if (data.state === 'error') {
                    handleChatEventRef.current({
                        state: 'error',
                        sessionKey: p.sessionKey as string,
                        runId: (p.runId as string | undefined) ?? '',
                        errorMessage: data.error,
                        seq: 0,
                    });
                } else if (data.state === 'aborted') {
                    handleChatEventRef.current({
                        state: 'aborted',
                        sessionKey: p.sessionKey as string,
                        runId: (p.runId as string | undefined) ?? '',
                        seq: 0,
                    });
                }
            }
        }
    }, []);

    // Connection hook
    const {
        isConnected,
        isConnecting,
        send,
    } = useOpenClawConnection(machineId ?? '', {
        autoConnect: true,
        onEvent: onEventCallback,
    });

    // Session info bottom sheet — fetched on demand from sessions.list
    const detailModalRef = React.useRef<BottomSheetModal>(null);
    const [sessionDetail, setSessionDetail] = React.useState<OpenClawSession | null>(null);
    const [loadingDetail, setLoadingDetail] = React.useState(false);

    const handleOpenInfo = React.useCallback(async () => {
        detailModalRef.current?.present();
        if (!isConnected) return;
        setLoadingDetail(true);
        try {
            const result = await send('sessions.list', { includeGlobal: true });
            if (result.ok && result.payload) {
                const list = (result.payload as { sessions?: OpenClawSession[] }).sessions ?? [];
                setSessionDetail(list.find((s) => s.key === sessionKey) ?? null);
            }
        } catch {
            // Ignore — the sheet still shows whatever data we have
        } finally {
            setLoadingDetail(false);
        }
    }, [isConnected, send, sessionKey]);

    // Single source of truth: messages list
    // Contains: history messages + pending user message + streaming AI message
    const [messages, setMessages] = React.useState<LocalMessage[]>([]);
    const [inputText, setInputText] = React.useState('');
    // Initial loading state: true until first history fetch completes
    const [isLoading, setIsLoading] = React.useState(true);

    // Track current run for streaming (not used for rendering, only for event filtering)
    const chatRunIdRef = React.useRef<string | null>(null);

    const listRef = React.useRef<LegendListRef>(null);
    const softHeaderInset = useSoftHeaderInset();

    // iOS lifts the list content under the keyboard itself (see ChatScrollView); other platforms keep
    // LegendList's default scroll component.
    const renderScrollComponent = React.useCallback(
        (props: ScrollViewProps) => <ChatScrollView {...props} bottomInset={safeArea.bottom} />,
        [safeArea.bottom]
    );

    // Extract text from message content
    const extractText = (message: unknown): string | null => {
        if (!message || typeof message !== 'object') return null;
        const msg = message as { content?: unknown };
        if (!msg.content) return null;
        if (typeof msg.content === 'string') return msg.content;
        if (Array.isArray(msg.content)) {
            const textBlocks = msg.content
                .filter((block: Record<string, unknown>) =>
                    block && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string'
                )
                .map((block: Record<string, unknown>) => block.text as string);
            return textBlocks.length > 0 ? textBlocks.join('\n') : null;
        }
        return null;
    };

    // Fetch chat history and replace messages list
    const fetchHistory = React.useCallback(async () => {
        try {
            const result = await send('chat.history', { sessionKey, limit: 100 });
            if (!result || !result.ok) {
                // Request failed, keep existing messages
                return;
            }
            const history = (result.payload as { messages?: OpenClawChatMessage[] }).messages ?? [];
            // Convert to LocalMessage format - use stable IDs based on index + role + timestamp
            const localMessages: LocalMessage[] = history.map((msg, index) => ({
                ...msg,
                localId: `${msg.role}-${index}-${msg.timestamp ?? index}`,
                status: msg.role === 'user' ? 'sent' : undefined,
            }));
            // Single atomic update - replaces entire list
            setMessages(localMessages);
            // Clear run ID
            chatRunIdRef.current = null;
        } catch (err) {
            console.error('Failed to fetch chat history:', err);
        }
    }, [send, sessionKey]);

    // Handle incoming chat events
    const handleChatEvent = React.useCallback((event: OpenClawChatEvent) => {
        if (event.sessionKey !== sessionKey) return;

        if (event.runId && chatRunIdRef.current && event.runId !== chatRunIdRef.current) {
            if (event.state === 'final') {
                fetchHistory();
            }
            return;
        }

        switch (event.state) {
            case 'delta': {
                const msg = event.message;
                if (!msg) break;
                setMessages((prev) => {
                    const lastMsg = prev[prev.length - 1];
                    if (lastMsg?.isStreaming) {
                        // Cumulative guard for string content (gateway sends cumulative text)
                        if (typeof msg.content === 'string' && typeof lastMsg.content === 'string') {
                            if (msg.content.length < lastMsg.content.length) return prev;
                        }
                        return [
                            ...prev.slice(0, -1),
                            { ...lastMsg, content: msg.content },
                        ];
                    }
                    return [
                        ...prev,
                        {
                            role: 'assistant',
                            content: msg.content,
                            localId: STREAMING_MESSAGE_ID,
                            timestamp: Date.now(),
                            isStreaming: true,
                        },
                    ];
                });
                break;
            }

            case 'final':
                fetchHistory();
                break;

            case 'aborted':
            case 'error':
                setMessages((prev) => prev.filter((m) => !m.isStreaming));
                chatRunIdRef.current = null;
                if (event.errorMessage) {
                    console.error('[OpenClaw Chat] error:', event.errorMessage);
                }
                break;
        }
    }, [sessionKey, fetchHistory]);

    // Keep ref updated with latest handleChatEvent
    handleChatEventRef.current = handleChatEvent;

    const handleToolStream = React.useCallback((event: OpenClawToolStreamEvent) => {
        if (event.sessionKey !== sessionKey) return;
        // Only handle start and result — update phase has no visual effect in simplified rendering
        if (event.phase === 'update') return;

        setMessages((prev) => {
            const lastMsg = prev[prev.length - 1];
            if (!lastMsg?.isStreaming) return prev;

            const toolCalls = { ...lastMsg.activeToolCalls };
            if (event.phase === 'start') {
                toolCalls[event.toolCallId] = { name: event.name ?? 'tool', status: 'running' };
            } else if (event.phase === 'result') {
                toolCalls[event.toolCallId] = {
                    name: toolCalls[event.toolCallId]?.name ?? event.name ?? 'tool',
                    status: event.isError ? 'failed' : 'completed',
                };
            }

            return [
                ...prev.slice(0, -1),
                { ...lastMsg, activeToolCalls: toolCalls },
            ];
        });
    }, [sessionKey]);

    handleToolStreamRef.current = handleToolStream;

    // Fetch chat history when connected
    React.useEffect(() => {
        if (isConnected && sessionKey) {
            setIsLoading(true);
            fetchHistory().finally(() => setIsLoading(false));
        }
    }, [isConnected, sessionKey, fetchHistory]);

    // Check if currently streaming
    const isStreaming = messages.some((msg) => msg.isStreaming);

    // Send a message
    const sendMessage = React.useCallback(async (localId: string, text: string) => {
        const runId = randomUUID();

        // Send to gateway
        const result = await send('chat.send', {
            sessionKey,
            message: text,
            idempotencyKey: runId,
        });

        if (!result || !result.ok) {
            // Mark message as failed
            setMessages((prev) =>
                prev.map((msg) =>
                    msg.localId === localId
                        ? { ...msg, status: 'failed' as MessageStatus, errorMessage: result?.error }
                        : msg
                )
            );
        } else {
            // Mark message as sent, set up for streaming
            chatRunIdRef.current = runId;
            setMessages((prev) => {
                const updated = prev.map((msg) =>
                    msg.localId === localId
                        ? { ...msg, status: 'sent' as MessageStatus }
                        : msg
                );
                // Add streaming placeholder
                return [
                    ...updated,
                    {
                        role: 'assistant' as const,
                        content: '',
                        localId: STREAMING_MESSAGE_ID,
                        timestamp: Date.now(),
                        isStreaming: true,
                    },
                ];
            });
        }
    }, [sessionKey, send]);

    // Handle new message send
    const handleSend = React.useCallback(async () => {
        const text = inputText.trim();
        if (!text || !isConnected || isStreaming) {
            return;
        }

        // Create user message with sending status
        const localId = randomUUID();
        const userMessage: LocalMessage = {
            role: 'user',
            content: text,
            timestamp: Date.now(),
            localId,
            status: 'sending',
        };

        // Add to messages list
        setMessages((prev) => [...prev, userMessage]);
        setInputText('');

        // Jump to the newest message: the reader may be up in the history when they send.
        setTimeout(() => {
            void listRef.current?.scrollToEnd({ animated: true });
        }, 50);

        // Send the message
        await sendMessage(localId, text);
    }, [inputText, isConnected, isStreaming, sendMessage]);

    // Handle retry for failed messages
    const handleRetry = React.useCallback((localId: string) => {
        const message = messages.find((msg) => msg.localId === localId);
        if (!message || message.status !== 'failed') return;

        // Update status to sending
        setMessages((prev) =>
            prev.map((msg) =>
                msg.localId === localId
                    ? { ...msg, status: 'sending' as MessageStatus, errorMessage: undefined }
                    : msg
            )
        );

        const text = extractText(message) ?? '';

        sendMessage(localId, text);
    }, [messages, sendMessage]);

    // Handle keyboard shortcuts: Enter to send, Shift+Enter for newline
    const handleKeyPress = React.useCallback((event: KeyPressEvent): boolean => {
        if (Platform.OS === 'web' && event.key === 'Enter' && !event.shiftKey) {
            if (inputText.trim() && isConnected && !isStreaming) {
                handleSend();
                return true;
            }
        }
        return false;
    }, [inputText, isConnected, isStreaming, handleSend]);

    // Session name for header title (decode URL encoding)
    const sessionName = sessionNameParam
        ? decodeURIComponent(sessionNameParam)
        : sessionKey
            ? decodeURIComponent(sessionKey)
            : t('openclaw.sessions');
    // Machine name for header subtitle
    const machineName = machine?.metadata?.name;

    const canSend = inputText.trim().length > 0 && isConnected && !isStreaming;

    // The oldest end of the conversation: the room the overlay header and its soft edge need
    // above the first message. The list is bottom-aligned, so this is a list header rather than a
    // content inset.
    const listHeader = React.useMemo(() => (
        <View style={{ height: softHeaderInset + LIST_TOP_GAP }} />
    ), [softHeaderInset]);

    // Content: message list (only when we have messages)
    const content = messages.length > 0 ? (
        <LegendList<LocalMessage>
            ref={listRef}
            style={styles.messageList}
            contentContainerStyle={styles.messageListContent}
            data={messages}
            keyExtractor={keyExtractor}
            renderItem={({ item }: LegendListRenderItemProps<LocalMessage>) => (
                <MessageItem
                    message={item}
                    onRetry={handleRetry}
                />
            )}
            estimatedItemSize={ESTIMATED_ITEM_SIZE}
            estimatedHeaderSize={softHeaderInset + LIST_TOP_GAP}
            // Bottom-aligned, opening on the newest message and following the tail while the reader
            // is at it — what replaced `inverted`. `maintainVisibleContentPosition` keeps the
            // reader's place when a message arrives while they are up in the history.
            alignItemsAtEnd
            initialScrollAtEnd
            maintainScrollAtEnd
            maintainVisibleContentPosition
            ListHeaderComponent={listHeader}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'none'}
            renderScrollComponent={Platform.OS === 'ios' ? renderScrollComponent : undefined}
        />
    ) : null;

    // Placeholder: loading or empty state
    const placeholder = isLoading ? (
        <View style={styles.emptyContainer}>
            <ActivityIndicator size="large" color={theme.colors.textSecondary} />
        </View>
    ) : messages.length === 0 ? (
        <View style={styles.emptyContainer}>
            <Ionicons name="chatbubbles-outline" size={48} color={theme.colors.textSecondary} />
            <Text style={[styles.emptyTitle, { marginTop: 16 }]}>
                {t('openclaw.noSessions')}
            </Text>
            <Text style={styles.emptyDescription}>
                {t('openclaw.noSessionsDescription')}
            </Text>
        </View>
    ) : null;

    // Input area
    const input = (
        <View style={[styles.inputContainer, { paddingBottom: safeArea.bottom + 16 }]}>
            <View style={styles.inputInner}>
                <View style={styles.inputPanel}>
                    <View style={styles.inputWrapper}>
                        <MultiTextInput
                            value={inputText}
                            onChangeText={setInputText}
                            placeholder={t('session.inputPlaceholder')}
                            maxHeight={150}
                            lineHeight={24}
                            paddingTop={4}
                            paddingBottom={4}
                            onKeyPress={handleKeyPress}
                        />
                    </View>
                    <Pressable
                        style={({ pressed }) => [
                            styles.sendButton,
                            canSend ? styles.sendButtonActive : styles.sendButtonDisabled,
                            pressed && canSend && { opacity: 0.7 },
                        ]}
                        onPress={handleSend}
                        disabled={!canSend}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                        <Ionicons
                            name="arrow-up"
                            size={18}
                            color={canSend ? theme.colors.button.primary.tint : theme.colors.textSecondary}
                        />
                    </Pressable>
                </View>
            </View>
        </View>
    );

    return (
        <View style={styles.container}>
            <Stack.Screen
                options={{
                    headerTitle: sessionName,
                    headerSubtitle: machineName,
                    headerRight: () => (
                        <Pressable
                            onPress={handleOpenInfo}
                            style={{ width: 38, height: 38, alignItems: 'center', justifyContent: 'center' }}
                            hitSlop={8}
                        >
                            <Ionicons name="information-circle-outline" size={24} color={theme.colors.header.tint} />
                        </Pressable>
                    ),
                }}
            />
            <SessionDetailModal
                ref={detailModalRef}
                session={sessionDetail}
                machineName={machineName}
                loading={loadingDetail}
            />
            <AgentContentView
                content={content}
                input={input}
                placeholder={placeholder}
            />
        </View>
    );
}
