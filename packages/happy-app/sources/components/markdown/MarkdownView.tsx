import { MarkdownSpan, OptionItem as OptionItemData, parseMarkdown } from './parseMarkdown';
import { resolveMarkdownLink } from './markdownLinkUtils';
import { useWebHorizontalScroll } from '@/hooks/useWebHorizontalScroll';
import { Link } from 'expo-router';
import * as React from 'react';
import { Pressable, ScrollView, View, Platform, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../StyledText';
import { Typography } from '@/constants/Typography';
import { SimpleSyntaxHighlighter } from '../SimpleSyntaxHighlighter';
import { Modal } from '@/modal';
import { storeTempText } from '@/sync/persistence';
import { useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { hapticsLight } from '@/components/haptics';
import { showCopiedToast } from '@/components/Toast';
import { MermaidRenderer } from './MermaidRenderer';
import { ImageViewer } from '@/components/ImageViewer';
import { t } from '@/text';

// Option type for callback
export type Option = {
    title: string;
    destructive?: boolean;
};

// Loading state for options - tracks which option is loading (by index)
export type OptionsLoadingState = {
    loadingIndex: number | null;
};

export const MarkdownView = React.memo((props: {
    markdown: string;
    onOptionPress?: (option: Option, allOptions: OptionItemData[]) => void;
    onOptionLongPress?: (option: Option, allOptions: OptionItemData[]) => void;
    optionsLoadingState?: OptionsLoadingState;
    sessionId?: string;
    sessionWorkingDirectory?: string | null;
    sessionHomeDirectory?: string | null;
    hideOptions?: boolean;
}) => {
    const blocks = React.useMemo(() => parseMarkdown(props.markdown), [props.markdown]);

    const allImageUrls = React.useMemo(() => {
        const urls: string[] = [];
        for (const block of blocks) {
            if (block.type === 'image') {
                urls.push(block.url);
            } else if (block.type === 'text' || block.type === 'header') {
                for (const span of block.content) {
                    if (span.imageUrl) urls.push(span.imageUrl);
                }
            }
        }
        return urls;
    }, [blocks]);

    const [viewerVisible, setViewerVisible] = React.useState(false);
    const [viewerIndex, setViewerIndex] = React.useState(0);

    const onImagePress = React.useCallback((url: string) => {
        const idx = allImageUrls.indexOf(url);
        setViewerIndex(idx >= 0 ? idx : 0);
        setViewerVisible(true);
    }, [allImageUrls]);

    const viewerImages = React.useMemo(() => allImageUrls.map((uri) => ({ uri })), [allImageUrls]);

    const selectable = Platform.OS === 'web';
    const router = useRouter();
    const linkContext = React.useMemo(() => ({
        sessionId: props.sessionId,
        sessionWorkingDirectory: props.sessionWorkingDirectory ?? null,
        sessionHomeDirectory: props.sessionHomeDirectory ?? null,
    }), [props.sessionId, props.sessionWorkingDirectory, props.sessionHomeDirectory]);

    const handleLongPress = React.useCallback(() => {
        try {
            const textId = storeTempText(props.markdown);
            router.push(`/text-selection?textId=${textId}`);
        } catch (error) {
            console.error('Error storing text for selection:', error);
            Modal.alert('Error', 'Failed to open text selection. Please try again.');
        }
    }, [props.markdown, router]);

    // Separate blocks into groups: options blocks need to be outside the parent GestureDetector
    // to prevent long press conflicts
    const renderBlockContent = (block: typeof blocks[number], index: number) => {
        if (block.type === 'text') {
            return <RenderTextBlock spans={block.content} key={index} first={index === 0} last={index === blocks.length - 1} selectable={selectable} />;
        } else if (block.type === 'header') {
            return <RenderHeaderBlock level={block.level} spans={block.content} key={index} first={index === 0} last={index === blocks.length - 1} selectable={selectable} />;
        } else if (block.type === 'horizontal-rule') {
            return <View style={style.horizontalRule} key={index} />;
        } else if (block.type === 'list') {
            return <RenderListBlock items={block.items} key={index} first={index === 0} last={index === blocks.length - 1} selectable={selectable} />;
        } else if (block.type === 'numbered-list') {
            return <RenderNumberedListBlock items={block.items} key={index} first={index === 0} last={index === blocks.length - 1} selectable={selectable} />;
        } else if (block.type === 'code-block') {
            return <RenderCodeBlock content={block.content} language={block.language} key={index} first={index === 0} last={index === blocks.length - 1} selectable={selectable} />;
        } else if (block.type === 'mermaid') {
            return <MermaidRenderer content={block.content} key={index} />;
        } else if (block.type === 'options') {
            if (props.hideOptions) return null;
            return <RenderOptionsBlock items={block.items} key={index} first={index === 0} last={index === blocks.length - 1} selectable={selectable} onOptionPress={props.onOptionPress} onOptionLongPress={props.onOptionLongPress} optionsLoadingState={props.optionsLoadingState} />;
        } else if (block.type === 'blockquote') {
            return <RenderBlockquoteBlock content={block.content} key={index} first={index === 0} last={index === blocks.length - 1} selectable={selectable} />;
        } else if (block.type === 'image') {
            return <RenderImageBlock url={block.url} alt={block.alt} key={index} />;
        } else if (block.type === 'table') {
            return <RenderTableBlock headers={block.headers} rows={block.rows} key={index} first={index === 0} last={index === blocks.length - 1} />;
        } else {
            return null;
        }
    };

    const renderContent = () => {
        return (
            <View style={{ width: '100%' }}>
                {blocks.map((block, index) => renderBlockContent(block, index))}
            </View>
        );
    };

    // For web, render everything normally with native text selection
    if (Platform.OS === 'web') {
        return (
            <MarkdownLinkContext.Provider value={linkContext}>
                <MarkdownImageContext.Provider value={onImagePress}>
                    {renderContent()}
                    {viewerImages.length > 0 && (
                        <ImageViewer images={viewerImages} initialIndex={viewerIndex} visible={viewerVisible} onClose={() => setViewerVisible(false)} />
                    )}
                </MarkdownImageContext.Provider>
            </MarkdownLinkContext.Provider>
        );
    }

    // For mobile, we need to render options blocks OUTSIDE
    // the parent GestureDetector to prevent long press conflicts
    const longPressGesture = Gesture.LongPress()
        .minDuration(500)
        .onStart(() => {
            handleLongPress();
        })
        .runOnJS(true);

    // Group consecutive non-options blocks together, render options separately
    const elements: React.ReactNode[] = [];
    let currentNonOptionsGroup: { block: typeof blocks[number], index: number }[] = [];

    const flushNonOptionsGroup = () => {
        if (currentNonOptionsGroup.length > 0) {
            const groupKey = `group-${currentNonOptionsGroup[0].index}`;
            elements.push(
                <GestureDetector gesture={longPressGesture} key={groupKey}>
                    <View style={{ width: '100%' }}>
                        {currentNonOptionsGroup.map(({ block, index }) => renderBlockContent(block, index))}
                    </View>
                </GestureDetector>
            );
            currentNonOptionsGroup = [];
        }
    };

    blocks.forEach((block, index) => {
        if (block.type === 'options') {
            if (props.hideOptions) return;
            // Flush any accumulated non-options blocks first
            flushNonOptionsGroup();
            // Render options block directly without parent GestureDetector
            elements.push(renderBlockContent(block, index));
        } else {
            // Accumulate non-options blocks
            currentNonOptionsGroup.push({ block, index });
        }
    });

    // Flush remaining non-options blocks
    flushNonOptionsGroup();

    return (
        <MarkdownLinkContext.Provider value={linkContext}>
            <MarkdownImageContext.Provider value={onImagePress}>
                <View style={{ width: '100%' }}>
                    {elements}
                </View>
                {viewerImages.length > 0 && (
                    <ImageViewer images={viewerImages} initialIndex={viewerIndex} visible={viewerVisible} onClose={() => setViewerVisible(false)} />
                )}
            </MarkdownImageContext.Provider>
        </MarkdownLinkContext.Provider>
    );
});

const MarkdownLinkContext = React.createContext<{
    sessionId?: string;
    sessionWorkingDirectory?: string | null;
    sessionHomeDirectory?: string | null;
}>({});

const MarkdownImageContext = React.createContext<(url: string) => void>(() => {});

function RenderTextBlock(props: { spans: MarkdownSpan[], first: boolean, last: boolean, selectable: boolean }) {
    const hasImage = props.spans.some((s) => s.imageUrl);
    if (!hasImage) {
        return <Text selectable={props.selectable} style={[style.text, props.first && style.first, props.last && style.last]}><RenderSpans spans={props.spans} baseStyle={style.text} /></Text>;
    }
    // Split around inline images: render text spans as Text, images as Image
    const groups: { type: 'text'; spans: MarkdownSpan[] }[] | { type: 'image'; url: string; alt: string }[] = [];
    let textGroup: MarkdownSpan[] = [];
    for (const span of props.spans) {
        if (span.imageUrl) {
            if (textGroup.length > 0) {
                (groups as any[]).push({ type: 'text', spans: textGroup });
                textGroup = [];
            }
            (groups as any[]).push({ type: 'image', url: span.imageUrl, alt: span.text });
        } else {
            textGroup.push(span);
        }
    }
    if (textGroup.length > 0) {
        (groups as any[]).push({ type: 'text', spans: textGroup });
    }
    return (
        <View style={[props.first && style.first, props.last && style.last]}>
            {(groups as any[]).map((g: any, i: number) =>
                g.type === 'image'
                    ? <RenderInlineImage key={i} url={g.url} alt={g.alt} />
                    : <Text key={i} selectable={props.selectable} style={style.text}><RenderSpans spans={g.spans} baseStyle={style.text} /></Text>
            )}
        </View>
    );
}

function RenderHeaderBlock(props: { level: 1 | 2 | 3 | 4 | 5 | 6, spans: MarkdownSpan[], first: boolean, last: boolean, selectable: boolean }) {
    const s = (style as any)[`header${props.level}`];
    const headerStyle = [style.header, s, props.first && style.first, props.last && style.last];
    return <Text selectable={props.selectable} style={headerStyle}><RenderSpans spans={props.spans} baseStyle={headerStyle} isHeader={true} /></Text>;
}

function RenderListBlock(props: { items: { depth: number, spans: MarkdownSpan[] }[], first: boolean, last: boolean, selectable: boolean }) {
    const listStyle = [style.text, style.list];
    return (
        <View style={{ flexDirection: 'column', marginBottom: 8, gap: 1 }}>
            {props.items.map((item, index) => (
                <Text selectable={props.selectable} style={[listStyle, getListItemStyle(item.depth)]} key={index}>- <RenderSpans spans={item.spans} baseStyle={listStyle} /></Text>
            ))}
        </View>
    );
}

function RenderNumberedListBlock(props: { items: { number: number, depth: number, spans: MarkdownSpan[] }[], first: boolean, last: boolean, selectable: boolean }) {
    const listStyle = [style.text, style.list];
    return (
        <View style={{ flexDirection: 'column', marginBottom: 8, gap: 1 }}>
            {props.items.map((item, index) => (
                <Text selectable={props.selectable} style={[listStyle, getListItemStyle(item.depth)]} key={index}>{item.number.toString()}. <RenderSpans spans={item.spans} baseStyle={listStyle} /></Text>
            ))}
        </View>
    );
}

function getListItemStyle(depth: number) {
    if (depth <= 0) return null;
    return { paddingLeft: Math.min(depth, 6) * 18 };
}

// Canonical display names for common languages. Anything not listed falls back
// to first-letter capitalization (e.g. "scala" -> "Scala").
const LANGUAGE_DISPLAY_NAMES: Record<string, string> = Object.assign(Object.create(null), {
    js: 'JavaScript',
    javascript: 'JavaScript',
    mjs: 'JavaScript',
    cjs: 'JavaScript',
    jsx: 'JSX',
    ts: 'TypeScript',
    typescript: 'TypeScript',
    tsx: 'TSX',
    py: 'Python',
    python: 'Python',
    rb: 'Ruby',
    ruby: 'Ruby',
    go: 'Go',
    golang: 'Go',
    rs: 'Rust',
    rust: 'Rust',
    java: 'Java',
    kt: 'Kotlin',
    kotlin: 'Kotlin',
    swift: 'Swift',
    c: 'C',
    h: 'C',
    cpp: 'C++',
    'c++': 'C++',
    cc: 'C++',
    cs: 'C#',
    csharp: 'C#',
    'c#': 'C#',
    objc: 'Objective-C',
    'objective-c': 'Objective-C',
    php: 'PHP',
    html: 'HTML',
    htm: 'HTML',
    css: 'CSS',
    scss: 'SCSS',
    sass: 'Sass',
    less: 'Less',
    json: 'JSON',
    jsonc: 'JSONC',
    json5: 'JSON5',
    yaml: 'YAML',
    yml: 'YAML',
    toml: 'TOML',
    xml: 'XML',
    md: 'Markdown',
    markdown: 'Markdown',
    sql: 'SQL',
    sh: 'Shell',
    shell: 'Shell',
    bash: 'Bash',
    zsh: 'Zsh',
    ps1: 'PowerShell',
    powershell: 'PowerShell',
    dockerfile: 'Dockerfile',
    makefile: 'Makefile',
    graphql: 'GraphQL',
    gql: 'GraphQL',
    proto: 'Protobuf',
    scala: 'Scala',
    dart: 'Dart',
    r: 'R',
    lua: 'Lua',
    perl: 'Perl',
    pl: 'Perl',
    hs: 'Haskell',
    haskell: 'Haskell',
    ex: 'Elixir',
    elixir: 'Elixir',
    erlang: 'Erlang',
    clj: 'Clojure',
    clojure: 'Clojure',
    vue: 'Vue',
    svelte: 'Svelte',
    ini: 'INI',
    diff: 'Diff',
    tex: 'LaTeX',
    latex: 'LaTeX',
    txt: 'Text',
    text: 'Text',
    plain: 'Text',
    plaintext: 'Text',
});

function formatLanguageLabel(language: string | null): string {
    if (!language) return 'Text';
    const normalized = language.trim().toLowerCase();
    if (!normalized) return 'Text';
    return LANGUAGE_DISPLAY_NAMES[normalized] ?? language;
}

function RenderCodeBlock(props: { content: string, language: string | null, first: boolean, last: boolean, selectable: boolean }) {
    const [isHovered, setIsHovered] = React.useState(false);
    const [isCopyHovered, setIsCopyHovered] = React.useState(false);
    const { scrollViewProps, wheelProps } = useWebHorizontalScroll();
    const { theme } = useUnistyles();

    const displayLanguage = formatLanguageLabel(props.language);

    // Copy icon visibility:
    // - non-web: always at full opacity
    // - web: hidden until the code block is hovered, dimmed (0.6) while hovering
    //   the block, full opacity when hovering the icon itself
    const copyStateStyle = Platform.OS !== 'web'
        ? style.copyButtonVisible
        : !isHovered
            ? style.copyButtonHidden
            : isCopyHovered
                ? style.copyButtonVisible
                : style.copyButtonDimmed;

    const copyCode = React.useCallback(async () => {
        try {
            await Clipboard.setStringAsync(props.content);
            hapticsLight(); showCopiedToast();
        } catch (error) {
            console.error('Failed to copy code:', error);
            Modal.alert(t('common.error'), t('markdown.copyFailed'), [{ text: t('common.ok'), style: 'cancel' }]);
        }
    }, [props.content]);

    return (
        <View
            style={[style.codeBlock, props.first && style.first, props.last && style.last]}
            // @ts-ignore - Web only events
            onMouseEnter={() => setIsHovered(true)}
            // @ts-ignore - Web only events
            onMouseLeave={() => setIsHovered(false)}
            {...wheelProps}
        >
            <View style={style.codeBlockHeader}>
                <Text selectable={props.selectable} style={style.codeLanguage}>{displayLanguage}</Text>
                <Pressable
                    style={[style.copyButton, copyStateStyle]}
                    onPress={copyCode}
                    hitSlop={8}
                    accessibilityLabel={t('common.copy')}
                    // @ts-ignore - Web only events
                    onMouseEnter={() => setIsCopyHovered(true)}
                    // @ts-ignore - Web only events
                    onMouseLeave={() => setIsCopyHovered(false)}
                >
                    <Ionicons name="copy-outline" size={16} color={theme.colors.textSecondary} />
                </Pressable>
            </View>
            <ScrollView
                {...scrollViewProps}
                style={{ flexGrow: 0, flexShrink: 0 }}
                horizontal={true}
                contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16 }}
                showsHorizontalScrollIndicator={false}
            >
                <SimpleSyntaxHighlighter
                    code={props.content}
                    language={props.language}
                    selectable={props.selectable}
                />
            </ScrollView>
        </View>
    );
}

// Individual option item component to use hooks properly
const OptionItem = React.memo((props: {
    item: OptionItemData,
    index: number,
    isThisLoading: boolean,
    isDisabled: boolean,
    onPress: () => void,
    onLongPress: () => void,
    onContextMenu?: () => void,
}) => {
    // Use GestureDetector to handle long press, which takes priority over parent GestureDetector
    const longPressGesture = Gesture.LongPress()
        .minDuration(500)
        .onStart(() => {
            if (!props.isDisabled) {
                props.onLongPress();
            }
        })
        .runOnJS(true);

    const tapGesture = Gesture.Tap()
        .onEnd(() => {
            if (!props.isDisabled) {
                props.onPress();
            }
        })
        .runOnJS(true);

    // Race between tap and long press - first one to complete wins
    const composedGesture = Gesture.Race(tapGesture, longPressGesture);

    // Web: right-click mirrors mobile long-press (fill input)
    const webHandlers = Platform.OS === 'web'
        ? {
            onContextMenu: (e: { preventDefault: () => void }) => {
                e.preventDefault();
                if (!props.isDisabled) {
                    props.onContextMenu?.();
                }
            },
        }
        : {};

    return (
        <GestureDetector gesture={composedGesture}>
            <View
                style={[
                    style.optionItem,
                    props.isDisabled && style.optionItemDisabled,
                ]}
                {...webHandlers}
            >
                <Text
                    selectable={false}
                    style={[
                        style.optionText,
                        props.item.destructive && style.optionTextDestructive,
                        props.isDisabled && style.optionTextDisabled,
                    ]}
                >
                    {props.item.title}
                </Text>
                {props.isThisLoading && (
                    <View style={style.optionLoadingOverlay}>
                        <ActivityIndicator size="small" />
                    </View>
                )}
            </View>
        </GestureDetector>
    );
});

function RenderOptionsBlock(props: {
    items: OptionItemData[],
    first: boolean,
    last: boolean,
    selectable: boolean,
    onOptionPress?: (option: Option, allOptions: OptionItemData[]) => void,
    onOptionLongPress?: (option: Option, allOptions: OptionItemData[]) => void,
    optionsLoadingState?: OptionsLoadingState
}) {
    const isLoading = props.optionsLoadingState?.loadingIndex !== null && props.optionsLoadingState?.loadingIndex !== undefined;

    const handleLongPress = React.useCallback((item: OptionItemData) => {
        // Only trigger long press on mobile
        if (Platform.OS !== 'web') {
            // Haptic feedback
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            props.onOptionLongPress?.(item, props.items);
        }
    }, [props.onOptionLongPress, props.items]);

    const handleContextMenu = React.useCallback((item: OptionItemData) => {
        props.onOptionLongPress?.(item, props.items);
    }, [props.onOptionLongPress, props.items]);

    return (
        <View style={[style.optionsContainer, props.first && style.first, props.last && style.last]}>
            <View style={style.optionsInner}>
                {props.items.map((item, index) => {
                    const isThisLoading = props.optionsLoadingState?.loadingIndex === index;
                    const isDisabled = isLoading && !isThisLoading;

                    if (props.onOptionPress) {
                        return (
                            <OptionItem
                                key={index}
                                item={item}
                                index={index}
                                isThisLoading={isThisLoading}
                                isDisabled={isDisabled}
                                onPress={() => props.onOptionPress?.(item, props.items)}
                                onLongPress={() => handleLongPress(item)}
                                onContextMenu={() => handleContextMenu(item)}
                            />
                        );
                    } else {
                        return (
                            <View key={index} style={style.optionItem}>
                                <Text selectable={props.selectable} style={[
                                    style.optionText,
                                    item.destructive && style.optionTextDestructive,
                                ]}>{item.title}</Text>
                            </View>
                        );
                    }
                })}
            </View>
        </View>
    );
}

function RenderBlockquoteBlock(props: { content: { depth: number, spans: MarkdownSpan[], list?: 'bullet' }[], first: boolean, last: boolean, selectable: boolean }) {
    return (
        <View style={[style.blockquote, props.first && style.first, props.last && style.last]}>
            {props.content.map((paragraph, index) => (
                <Text selectable={props.selectable} style={[style.blockquoteText, getBlockquoteItemStyle(paragraph.depth)]} key={index}>
                    {paragraph.list === 'bullet' ? '- ' : null}
                    <RenderSpans spans={paragraph.spans} baseStyle={style.blockquoteText} />
                </Text>
            ))}
        </View>
    );
}

function getBlockquoteItemStyle(depth: number) {
    if (depth <= 1) return null;
    return {
        borderLeftWidth: 3,
        borderLeftColor: 'rgba(142, 142, 147, 0.45)',
        paddingLeft: 12,
        marginLeft: Math.min(depth - 1, 5) * 18,
    };
}

function RenderImageBlock(props: { url: string; alt: string }) {
    const [aspectRatio, setAspectRatio] = React.useState(16 / 9);
    const onImagePress = React.useContext(MarkdownImageContext);
    return (
        <Pressable style={style.imageBlock} onPress={() => onImagePress(props.url)}>
            <Image
                source={{ uri: props.url }}
                style={{ width: '100%', aspectRatio, borderRadius: 8 }}
                contentFit="contain"
                transition={200}
                onLoad={(e) => {
                    const { width, height } = e.source;
                    if (width && height) setAspectRatio(width / height);
                }}
            />
        </Pressable>
    );
}

function RenderInlineImage(props: { url: string; alt: string }) {
    const [aspectRatio, setAspectRatio] = React.useState(16 / 9);
    const onImagePress = React.useContext(MarkdownImageContext);
    return (
        <Pressable style={style.inlineImage} onPress={() => onImagePress(props.url)}>
            <Image
                source={{ uri: props.url }}
                style={{ width: '100%', aspectRatio, borderRadius: 6 }}
                contentFit="contain"
                transition={200}
                onLoad={(e) => {
                    const { width, height } = e.source;
                    if (width && height) setAspectRatio(width / height);
                }}
            />
        </Pressable>
    );
}

function RenderSpans(props: { spans: MarkdownSpan[], baseStyle?: any, isHeader?: boolean, disableCodeLineHeight?: boolean }) {
    const linkContext = React.useContext(MarkdownLinkContext);
    return (<>
        {props.spans.map((span, index) => {
            const isCode = span.styles.includes('code');
            const isBoldItalic = span.styles.includes('bold') && span.styles.includes('italic');
            const spanStyles = span.styles.map((s) => {
                if (isBoldItalic && (s === 'bold' || s === 'italic')) {
                    return null;
                }
                if ((props.isHeader || props.disableCodeLineHeight) && s === 'code') {
                    return style.codeHeader;
                }
                if (isCode && s === 'bold') {
                    return style.codeBold;
                }
                if (isCode && s === 'italic') {
                    return style.codeItalic;
                }
                return (style as any)[s];
            });
            if (isBoldItalic) {
                spanStyles.push(isCode ? style.codeBoldItalic : style.boldItalic);
            }
            if (span.url) {
                const link = resolveMarkdownLink({
                    rawUrl: span.url,
                    sessionId: linkContext.sessionId,
                    sessionWorkingDirectory: linkContext.sessionWorkingDirectory,
                    sessionHomeDirectory: linkContext.sessionHomeDirectory,
                });
                return (
                    <Link
                        key={index}
                        href={link.href as any}
                        target={link.target}
                        style={style.linkWrapper}
                    >
                        <Text style={[style.link, spanStyles]}>{span.text}</Text>
                    </Link>
                );
            } else {
                return <Text key={index} selectable style={spanStyles}>{span.text}</Text>
            }
        })}
    </>)
}

// Table rendering: column-first layout for natural column widths, with synchronized row heights.
// First pass measures each row's max height across columns, second render applies uniform heights.
function RenderTableBlock(props: {
    headers: MarkdownSpan[][],
    rows: MarkdownSpan[][][],
    first: boolean,
    last: boolean,
}) {
    const columnCount = props.headers.length;
    const rowCount = props.rows.length;
    const totalRows = 1 + rowCount; // header + data rows

    // Track measured heights: rowHeights[rowIndex] = max height across all columns
    const [rowHeights, setRowHeights] = React.useState<(number | undefined)[]>(() => new Array(totalRows).fill(undefined));
    const measuredRef = React.useRef<number[][]>(
        Array.from({ length: totalRows }, () => new Array(columnCount).fill(0))
    );
    const rowLockedRef = React.useRef<boolean[]>(new Array(totalRows).fill(false));
    const containerWidthRef = React.useRef(0);

    const resetMeasurements = React.useCallback(() => {
        const arr: number[][] = [];
        for (let i = 0; i < totalRows; i++) arr.push(new Array(columnCount).fill(0));
        measuredRef.current = arr;
        rowLockedRef.current = new Array(totalRows).fill(false);
        setRowHeights(new Array(totalRows).fill(undefined));
    }, [totalRows, columnCount]);

    // Reset measurement state whenever table shape changes
    React.useEffect(() => {
        resetMeasurements();
    }, [resetMeasurements]);

    const handleContainerLayout = React.useCallback((e: any) => {
        const width = Math.round(e.nativeEvent.layout.width || 0);
        if (width <= 0) {
            containerWidthRef.current = 0;
            return;
        }

        // A width change indicates a new layout pass context; re-measure from scratch.
        if (containerWidthRef.current !== width) {
            containerWidthRef.current = width;
            resetMeasurements();
        }
    }, [resetMeasurements]);

    const handleCellLayout = React.useCallback((rowIndex: number, colIndex: number, height: number) => {
        if (containerWidthRef.current <= 0) return;
        if (rowLockedRef.current[rowIndex]) return;
        const normalizedHeight = Math.ceil(height);
        if (normalizedHeight <= 1) return;

        const grid = measuredRef.current;
        if (!grid[rowIndex]) return;
        grid[rowIndex][colIndex] = normalizedHeight;

        // Lock row height after we have one valid measurement from every column.
        if (!grid[rowIndex].every((h) => h > 0)) return;
        const maxH = Math.max(...grid[rowIndex]);
        rowLockedRef.current[rowIndex] = true;
        setRowHeights(old => {
            if (old[rowIndex] === maxH) return old;
            const next = [...old];
            next[rowIndex] = maxH;
            return next;
        });
    }, []);

    const isLastRow = (rowIndex: number) => rowIndex === rowCount - 1;
    const { scrollViewProps, wheelProps } = useWebHorizontalScroll();

    return (
        <View
            style={[style.tableContainer, props.first && style.first, props.last && style.last]}
            onLayout={handleContainerLayout}
            {...wheelProps}
        >
            <ScrollView
                {...scrollViewProps}
                horizontal
                showsHorizontalScrollIndicator={Platform.OS !== 'web'}
                nestedScrollEnabled={true}
                style={style.tableScrollView}
            >
                <View style={style.tableContent}>
                    {props.headers.map((headerSpans, colIndex) => (
                        <View
                            key={`column-${colIndex}`}
                            style={[
                                style.tableColumn,
                                colIndex < columnCount - 1 && style.tableCellRightBorder
                            ]}
                        >
                            {/* Header cell */}
                            <View
                                style={[
                                    style.tableCell,
                                    style.tableHeaderCell,
                                    rowHeights[0] != null ? { height: rowHeights[0] } : undefined,
                                ]}
                                onLayout={(e) => handleCellLayout(0, colIndex, e.nativeEvent.layout.height)}
                            >
                                <Text style={style.tableHeaderText}>
                                    <RenderSpans spans={headerSpans} baseStyle={style.tableHeaderText} disableCodeLineHeight={true} />
                                </Text>
                            </View>
                            {/* Data cells */}
                            {props.rows.map((row, rowIndex) => (
                                <View
                                    key={`cell-${rowIndex}-${colIndex}`}
                                    style={[
                                        style.tableCell,
                                        isLastRow(rowIndex) && style.tableCellLast,
                                        rowHeights[rowIndex + 1] != null ? { height: rowHeights[rowIndex + 1] } : undefined,
                                    ]}
                                    onLayout={(e) => handleCellLayout(rowIndex + 1, colIndex, e.nativeEvent.layout.height)}
                                >
                                    <Text style={style.tableCellText}>
                                        <RenderSpans spans={row[colIndex] ?? []} baseStyle={style.tableCellText} disableCodeLineHeight={true} />
                                    </Text>
                                </View>
                            ))}
                        </View>
                    ))}
                </View>
            </ScrollView>
        </View>
    );
}


const style = StyleSheet.create((theme) => ({

    // Plain text

    text: {
        ...Typography.default(),
        fontSize: 16,
        lineHeight: 24, // Reduced from 28 to 24
        marginTop: 8,
        marginBottom: 8,
        color: theme.colors.text,
        fontWeight: '400',
    },

    italic: {
        fontStyle: 'italic',
    },
    bold: {
        ...(Platform.OS === 'web' ? { fontWeight: '700' as const } : Typography.default('semiBold')),
    },
    boldItalic: {
        ...(Platform.OS === 'web' ? { fontWeight: '700' as const } : Typography.default('semiBold')),
        fontStyle: 'italic',
    },
    strikethrough: {
        textDecorationLine: 'line-through',
    },
    underline: {
        textDecorationLine: 'underline',
    },
    semibold: {
        fontWeight: '600',
    },
    code: {
        ...Typography.mono(),
        fontSize: 16,
        lineHeight: 21,  // Reduced from 24 to 21
        backgroundColor: theme.colors.surfaceHighest,
        color: theme.colors.text,
    },
    codeHeader: {
        ...Typography.mono(),
        fontSize: 16,
        backgroundColor: theme.colors.surfaceHighest,
        color: theme.colors.text,
    },
    codeBold: {
        ...Typography.mono('semiBold'),
    },
    codeItalic: {
        ...Typography.mono('italic'),
        fontStyle: 'italic',
    },
    codeBoldItalic: {
        ...Typography.mono('semiBold'),
        fontStyle: 'italic',
    },
    link: {
        ...Typography.default(),
        color: theme.colors.textLink,
        fontWeight: '400',
    },
    linkWrapper: {
        textDecorationLine: 'none',
    },

    // Headers

    header: {
        ...Typography.default('semiBold'),
        color: theme.colors.text,
    },
    header1: {
        fontSize: 24,
        lineHeight: 32,
        fontWeight: '800',
        marginTop: 20,
        marginBottom: 10
    },
    header2: {
        fontSize: 20,
        lineHeight: 28,
        fontWeight: '700',
        marginTop: 16,
        marginBottom: 8
    },
    header3: {
        fontSize: 18,
        lineHeight: 26,
        fontWeight: '700',
        marginTop: 14,
        marginBottom: 8,
    },
    header4: {
        fontSize: 16,
        lineHeight: 24,
        fontWeight: '600',
        marginTop: 8,
        marginBottom: 8,
    },
    header5: {
        fontSize: 16,
        lineHeight: 24,  // Reduced from 28 to 24
        fontWeight: '600'
    },
    header6: {
        fontSize: 16,
        lineHeight: 24, // Reduced from 28 to 24
        fontWeight: '600'
    },

    //
    // List
    //

    list: {
        ...Typography.default(),
        color: theme.colors.text,
        marginTop: 0,
        marginBottom: 0,
    },

    //
    // Common
    //

    first: {
        // marginTop: 0
    },
    last: {
        // marginBottom: 0
    },

    //
    // Code Block
    //

    codeBlock: {
        backgroundColor: theme.colors.surfaceHighest,
        borderRadius: 8,
        marginVertical: 8,
        position: 'relative',
        zIndex: 1,
        maxWidth: '100%',
    },
    codeBlockHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingLeft: 16,
        paddingRight: 8,
        paddingTop: 8,
        minHeight: 28,
    },
    codeLanguage: {
        ...Typography.mono(),
        color: theme.colors.textSecondary,
        fontSize: 12,
        marginBottom: 0,
        opacity: 0.8,
    },
    codeText: {
        ...Typography.mono(),
        color: theme.colors.text,
        fontSize: 14,
        lineHeight: 20,
    },
    blockquote: {
        borderLeftWidth: 3,
        borderLeftColor: theme.colors.textSecondary,
        paddingLeft: 12,
        marginVertical: 8,
        gap: 8,
    },
    blockquoteText: {
        ...Typography.default(),
        fontSize: 16,
        lineHeight: 24,
        color: theme.colors.textSecondary,
    },
    imageBlock: {
        marginVertical: 8,
        borderRadius: 8,
        overflow: 'hidden',
        maxWidth: '100%',
        backgroundColor: theme.colors.divider,
    },
    inlineImage: {
        marginVertical: 4,
        borderRadius: 6,
        backgroundColor: theme.colors.divider,
        overflow: 'hidden',
        maxWidth: '100%',
    },
    horizontalRule: {
        height: 1,
        backgroundColor: theme.colors.divider,
        marginTop: 8,
        marginBottom: 8,
    },
    copyButton: {
        padding: 4,
        borderRadius: 4,
        cursor: 'pointer',
    },
    copyButtonHidden: {
        opacity: 0,
        pointerEvents: 'none',
    },
    copyButtonDimmed: {
        opacity: 0.8,
    },
    copyButtonVisible: {
        opacity: 1,
    },

    //
    // Options Block
    //

    optionsContainer: {
        marginVertical: 8,
    },
    optionsInner: {
        flexDirection: 'column',
        gap: 8,
        alignSelf: 'flex-start',
        maxWidth: '100%',
    },
    optionItem: {
        backgroundColor: theme.colors.surfaceHighest,
        borderRadius: 8,
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        flexDirection: 'row',
        alignItems: 'flex-start',
    },
    optionItemDisabled: {
        opacity: 0.5,
    },
    optionText: {
        ...Typography.default(),
        flexShrink: 1,
        fontSize: 16,
        lineHeight: 24,
        color: theme.colors.text,
    },
    optionTextDestructive: {
        color: theme.colors.textDestructive,
    },
    optionTextDisabled: {
        opacity: 0.6,
    },
    optionLoadingOverlay: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: theme.colors.surfaceHighest,
        opacity: 0.8,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
    },

    //
    // Table
    //

    tableContainer: {
        marginVertical: 8,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        borderRadius: 8,
        overflow: 'hidden',
        alignSelf: 'flex-start',
        maxWidth: '100%',
    },
    tableScrollView: {
        flexGrow: 0,
    },
    tableContent: {
        flexDirection: 'row',
    },
    tableColumn: {
        flexDirection: 'column',
    },
    tableCell: {
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.divider,
        alignItems: 'flex-start',
        justifyContent: 'center',
    },
    tableCellRightBorder: {
        borderRightWidth: 1,
        borderRightColor: theme.colors.divider,
    },
    tableCellLast: {
        borderBottomWidth: 0,
    },
    tableHeaderCell: {
        backgroundColor: theme.colors.surfaceHigh,
    },
    tableHeaderText: {
        ...Typography.default('semiBold'),
        color: theme.colors.text,
        fontSize: 16,
        lineHeight: 24,
    },
    tableCellText: {
        ...Typography.default(),
        color: theme.colors.text,
        fontSize: 16,
        lineHeight: 24,
    },

    // Add global style for Web platform (Unistyles supports this via compiler plugin)
    ...(Platform.OS === 'web' ? {
        // Web-only CSS styles
        _____web_global_styles: {}
    } : {}),
}));
