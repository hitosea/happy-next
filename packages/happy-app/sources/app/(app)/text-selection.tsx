import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRouter, useLocalSearchParams, Stack } from 'expo-router';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { retrieveTempText } from '@/sync/persistence';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import * as Clipboard from 'expo-clipboard';
import { Modal } from '@/modal';
import { hapticsLight } from '@/components/haptics';
import { showCopiedToast } from '@/components/Toast';
import { Ionicons } from '@expo/vector-icons';
import { SelectableTextView } from '@/components/SelectableTextView';
import { FileViewTabs, type FileViewTab } from '@/components/FilePreview/FileViewTabs';
import { SandboxDocument } from '@/components/FilePreview/SandboxDocument';
import { buildMarkdownDocument } from '@/components/FilePreview/staticDocument';
import { layout } from '@/components/layout';
import { messageDocumentView } from '@/components/messageDocument';

/**
 * A block of message text too large to sit in the chat list, opened as its own screen.
 *
 * Two tabs, the same pair the file browser offers for a Markdown file: the rendered document, and
 * the text as it was authored. Which one it opens on, and what the header calls the screen, depends
 * on what opened it — see `messageDocument.ts`, which reads the `from` param every collapsed row
 * sends. Long-press flows send nothing and get the screen this has always been.
 */
type DocumentTab = 'source' | 'preview';

export default function TextSelectionScreen() {
    const router = useRouter();
    const { textId, from } = useLocalSearchParams<{ textId: string; from?: string }>();
    const view = messageDocumentView(from);
    const { theme, rt } = useUnistyles();
    const insets = useSafeAreaInsets();
    const [fullText, setFullText] = React.useState<string>('');
    const [loading, setLoading] = React.useState(true);
    const [mode, setMode] = React.useState<DocumentTab>(view.tab);
    const [renderError, setRenderError] = React.useState(false);
    const [attempt, setAttempt] = React.useState(0);
    const bottomPadding = insets.bottom + 16;

    const documentHtml = React.useMemo(
        () => buildMarkdownDocument(fullText, rt.themeName === 'dark'),
        [fullText, rt.themeName]
    );

    const handleCopyAll = React.useCallback(async () => {
        if (!fullText) {
            Modal.alert(t('common.error'), t('textSelection.noTextToCopy'));
            return;
        }

        try {
            await Clipboard.setStringAsync(fullText);
            hapticsLight(); showCopiedToast();
        } catch (error) {
            Modal.alert(t('common.error'), t('textSelection.failedToCopy'));
        }
    }, [fullText]);

    // `retrieveTempText` consumes the entry it returns, so a second run of this effect for the same
    // id would find nothing and report the text as expired. Keep what we read instead.
    const retrieved = React.useRef<{ id: string; text: string } | null>(null);

    React.useEffect(() => {
        if (!textId) {
            Modal.alert(t('common.error'), t('textSelection.noTextProvided'), [
                { text: t('common.ok'), onPress: () => router.back() }
            ]);
            return;
        }

        if (retrieved.current?.id !== textId) {
            const content = retrieveTempText(textId);
            if (content !== null) retrieved.current = { id: textId, text: content };
        }
        const content = retrieved.current?.id === textId ? retrieved.current.text : null;
        if (content !== null) {
            setFullText(content);
        } else {
            Modal.alert(t('common.error'), t('textSelection.textNotFound'), [
                { text: t('common.ok'), onPress: () => router.back() }
            ]);
        }
        setLoading(false);
    }, [textId, router]);

    if (loading) {
        return (
            <View style={styles.container}>
                <Text style={[styles.loadingText, { color: theme.colors.textSecondary }]}>
                    {t('common.loading')}
                </Text>
            </View>
        );
    }

    const tabs: FileViewTab<DocumentTab>[] = [
        { value: 'preview', label: t('files.preview.title') },
        { value: 'source', label: t('files.preview.source') },
    ];

    return (
        <View style={[styles.container, { backgroundColor: theme.colors.surface }]}>
            <Stack.Screen
                options={{
                    headerTitle: t(view.titleKey),
                    headerRight: () => (
                        <Pressable
                            onPress={handleCopyAll}
                            style={({ pressed }) => [
                                {
                                    width: 38,
                                    height: 38,
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    opacity: pressed ? 0.7 : 1,
                                }
                            ]}
                            disabled={loading || !fullText}
                        >
                            <Ionicons
                                name="copy-outline"
                                size={20}
                                color={loading || !fullText ? theme.colors.textSecondary : theme.colors.header.tint}
                            />
                        </Pressable>
                    ),
                }}
            />
            <FileViewTabs tabs={tabs} value={mode} onChange={setMode} />
            {mode === 'preview' ? (
                renderError ? (
                    <View style={styles.previewError}>
                        <Text style={{ color: theme.colors.textSecondary, textAlign: 'center' }}>
                            {t('files.preview.renderError')}
                        </Text>
                        <Pressable onPress={() => setAttempt((value) => value + 1)} style={styles.previewRetry}>
                            <Ionicons name="refresh-outline" size={20} color={theme.colors.text} />
                            <Text style={{ color: theme.colors.text, fontSize: 14 }}>{t('files.preview.retry')}</Text>
                        </Pressable>
                    </View>
                ) : (
                    <SandboxDocument
                        key={attempt}
                        html={documentHtml}
                        dark={rt.themeName === 'dark'}
                        title={t('textSelection.title')}
                        onError={() => setRenderError(true)}
                    />
                )
            ) : (
                <SelectableTextView text={fullText} bottomPadding={bottomPadding} />
            )}
        </View>
    );
}

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        backgroundColor: theme.colors.surface,
        // Same content column every other screen uses, so a line of text does not run the width
        // of a desktop window.
        maxWidth: layout.maxWidth,
        width: '100%',
        alignSelf: 'center',
    },
    loadingText: {
        ...Typography.default(),
        fontSize: 16,
        textAlign: 'center',
        marginTop: 50,
    },
    previewError: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        padding: 24,
    },
    previewRetry: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
}));
