import * as React from 'react';
import { View, Text, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import type { MessageAttachment } from 'happy-wire';
import { Typography } from '@/constants/Typography';
import { FileIcon } from '@/components/FileIcon';
import type { ComposerFile } from '@/hooks/useFileAttachments';
import { t } from '@/text';

export function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Seti glyphs fill about 5/8 of their box, so this draws them as large as the upload spinner;
// the transparent margin overflows the 24-wide icon slot.
const FILE_ICON_SIZE = 28;

function encodeFilePath(path: string): string {
    return btoa(new TextEncoder().encode(path).reduce((s, b) => s + String.fromCharCode(b), ''));
}

/** The composer's attached files: uploading with progress, ready, or failed and tappable to retry. */
export const ComposerFiles = React.memo(function ComposerFiles(props: {
    files: ComposerFile[];
    onRemove: (id: string) => void;
    onRetry: (id: string) => void;
}) {
    const { theme } = useUnistyles();
    if (props.files.length === 0) return null;
    return (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.composerList} contentContainerStyle={styles.composerContent}>
            {props.files.map((file) => {
                const failed = file.status === 'failed';
                const subtitle = failed
                    ? (file.error === 'unsupported' ? t('session.files.cliTooOldShort') : t('session.files.failedTapToRetry'))
                    : file.status === 'uploading'
                        ? `${Math.floor(file.size ? (file.sent / file.size) * 100 : 0)}%`
                        : formatFileSize(file.size);
                return (
                    <View key={file.id} style={styles.chipWrapper}>
                        <Pressable
                            style={[styles.chip, failed && styles.chipFailed]}
                            onPress={failed && file.error !== 'unsupported' ? () => props.onRetry(file.id) : undefined}
                        >
                            <View style={styles.chipIcon}>
                                {file.status === 'uploading'
                                    ? <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                                    : failed
                                        ? <Ionicons name="alert-circle-outline" size={20} color={theme.colors.deleteAction} />
                                        : <FileIcon fileName={file.name} size={FILE_ICON_SIZE} attachment />}
                            </View>
                            <View style={styles.chipText}>
                                <Text style={styles.chipName} numberOfLines={1}>{file.name}</Text>
                                <Text style={[styles.chipSubtitle, failed && styles.chipSubtitleFailed]} numberOfLines={1}>{subtitle}</Text>
                            </View>
                        </Pressable>
                        <Pressable style={styles.removeButton} onPress={() => props.onRemove(file.id)} hitSlop={8}>
                            <View style={styles.removeIcon}>
                                <View style={styles.removeLine1} />
                                <View style={styles.removeLine2} />
                            </View>
                        </Pressable>
                    </View>
                );
            })}
        </ScrollView>
    );
});

/** Files a sent message carries; each opens in the session's file viewer, read from its machine. */
export const MessageAttachments = React.memo(function MessageAttachments(props: {
    sessionId: string;
    attachments: MessageAttachment[];
}) {
    const router = useRouter();
    return (
        <View style={styles.messageList}>
            {props.attachments.map((attachment, index) => (
                <Pressable
                    key={`${attachment.path}-${index}`}
                    style={styles.card}
                    onPress={() => router.push(`/session/${props.sessionId}/file?path=${encodeURIComponent(encodeFilePath(attachment.path))}`)}
                >
                    <View style={styles.cardIcon}>
                        <FileIcon fileName={attachment.name} size={FILE_ICON_SIZE} attachment />
                    </View>
                    <View style={styles.chipText}>
                        <Text style={styles.chipName} numberOfLines={1}>{attachment.name}</Text>
                        <Text style={styles.chipSubtitle} numberOfLines={1}>{formatFileSize(attachment.size)}</Text>
                    </View>
                </Pressable>
            ))}
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    composerList: {
        maxHeight: 64,
    },
    composerContent: {
        paddingHorizontal: 8,
        paddingVertical: 8,
        gap: 8,
        flexDirection: 'row',
    },
    chipWrapper: {
        position: 'relative',
    },
    chip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        width: 180,
        height: 48,
        paddingHorizontal: 10,
        borderRadius: 8,
        backgroundColor: theme.colors.surfaceHighest,
    },
    chipFailed: {
        borderWidth: 1,
        borderColor: theme.colors.deleteAction,
    },
    chipIcon: {
        width: 24,
        alignItems: 'center',
    },
    chipText: {
        flex: 1,
        minWidth: 0,
    },
    chipName: {
        ...Typography.default('semiBold'),
        fontSize: 13,
        color: theme.colors.text,
    },
    chipSubtitle: {
        ...Typography.default(),
        fontSize: 12,
        color: theme.colors.textSecondary,
    },
    chipSubtitleFailed: {
        color: theme.colors.deleteAction,
    },
    removeButton: {
        position: 'absolute',
        top: -6,
        right: -6,
        width: 20,
        height: 20,
        borderRadius: 10,
        backgroundColor: theme.colors.deleteAction,
        justifyContent: 'center',
        alignItems: 'center',
    },
    removeIcon: {
        width: 10,
        height: 10,
        justifyContent: 'center',
        alignItems: 'center',
    },
    removeLine1: {
        position: 'absolute',
        width: 10,
        height: 2,
        backgroundColor: 'white',
        transform: [{ rotate: '45deg' }],
    },
    removeLine2: {
        position: 'absolute',
        width: 10,
        height: 2,
        backgroundColor: 'white',
        transform: [{ rotate: '-45deg' }],
    },
    messageList: {
        marginTop: 8,
        marginBottom: 4,
        gap: 6,
    },
    card: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        minWidth: 200,
        maxWidth: 280,
        paddingHorizontal: 10,
        paddingVertical: 8,
        borderRadius: 8,
        backgroundColor: theme.colors.surface,
    },
    cardIcon: {
        width: 24,
        alignItems: 'center',
    },
}));
