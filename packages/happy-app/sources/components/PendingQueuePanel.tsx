import { Octicons, Ionicons } from '@expo/vector-icons';
import { Modal } from '@/modal';
import type { PendingMessage } from '@/sync/storageTypes';
import { t } from '@/text';
import * as React from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { layout } from './layout';
import { PendingMessageDetailModal } from './PendingMessageDetailModal';
import { getPendingPreviewText, getPendingScheduleInfo, truncatePendingPreview } from './pendingQueuePanelUtils';

type PendingActionType = 'send-now' | 'pin' | 'delete' | 'resume';

type PendingQueuePanelProps = {
    sessionId: string;
    messages: PendingMessage[];
    canManage: boolean;
    onSendNow: (pendingId: string) => Promise<void> | void;
    onPin: (pendingId: string) => Promise<void> | void;
    onDelete: (pendingId: string) => Promise<void> | void;
    onPause: (pendingId: string) => Promise<void> | void;
    onSaveEdit: (pendingId: string, newText: string) => Promise<void> | void;
    onReschedule?: (pendingId: string) => void;
};

export const PendingQueuePanel: React.FC<PendingQueuePanelProps> = React.memo(({ sessionId, messages, canManage, onSendNow, onPin, onDelete, onPause, onSaveEdit, onReschedule }) => {
    const { theme } = useUnistyles();
    const [pendingAction, setPendingAction] = React.useState<{ pendingId: string; action: PendingActionType } | null>(null);
    const scrollRef = React.useRef<ScrollView>(null);
    const prevCountRef = React.useRef(messages.length);

    React.useEffect(() => {
        if (messages.length > prevCountRef.current) {
            requestAnimationFrame(() => {
                scrollRef.current?.scrollToEnd({ animated: true });
            });
        }
        prevCountRef.current = messages.length;
    }, [messages.length]);

    const runAction = React.useCallback(async (pendingId: string, action: PendingActionType, handler: (id: string) => Promise<void> | void) => {
        if (pendingAction !== null) {
            return;
        }

        setPendingAction({ pendingId, action });
        try {
            await handler(pendingId);
        } finally {
            setPendingAction((current) => {
                if (current?.pendingId === pendingId && current.action === action) {
                    return null;
                }
                return current;
            });
        }
    }, [pendingAction]);

    const openDetail = React.useCallback((message: PendingMessage) => {
        Modal.show({
            component: PendingMessageDetailModal,
            props: {
                sessionId,
                message,
                canManage,
                onSendNow,
                onPin,
                onDelete,
                onPause,
                onSaveEdit,
                onReschedule,
            },
        });
    }, [sessionId, canManage, onSendNow, onPin, onDelete, onPause, onSaveEdit, onReschedule]);

    if (messages.length === 0) {
        return null;
    }

    return (
        <View style={styles.container}>
            <View style={styles.innerContainer}>
                <View style={styles.headerRow}>
                    <Text style={styles.title}>{t('pendingQueue.title')}</Text>
                    <Text style={styles.count}>{messages.length}</Text>
                </View>

                <ScrollView
                    ref={scrollRef}
                    style={styles.list}
                    contentContainerStyle={styles.listContent}
                    keyboardShouldPersistTaps="handled"
                    showsVerticalScrollIndicator
                >
                    {messages.map((message) => {
                        const loadingAction = pendingAction?.pendingId === message.id ? pendingAction.action : null;
                        const isDisabled = pendingAction !== null;
                        const isPaused = message.pausedAt !== null;
                        const schedule = getPendingScheduleInfo(message.deliverAt);

                        return (
                            <View key={message.id} style={styles.itemRow}>
                                <Pressable
                                    style={styles.itemTextColumn}
                                    onPress={() => openDetail(message)}
                                    accessibilityLabel={t('pendingQueue.detailTitle')}
                                >
                                    <View style={styles.previewRow}>
                                        {isPaused && (
                                            <Ionicons name="pause" size={15} color={theme.colors.textSecondary} />
                                        )}
                                        {message.imageCount > 0 && (
                                            <View style={styles.imageBadge}>
                                                <Octicons name="image" size={13} color={theme.colors.textSecondary} />
                                                {message.imageCount > 1 && (
                                                    <Text style={styles.imageBadgeCount}>x{message.imageCount}</Text>
                                                )}
                                            </View>
                                        )}
                                        {message.fileCount > 0 && (
                                            <View style={styles.imageBadge}>
                                                <Octicons name="file" size={13} color={theme.colors.textSecondary} />
                                                {message.fileCount > 1 && (
                                                    <Text style={styles.imageBadgeCount}>x{message.fileCount}</Text>
                                                )}
                                            </View>
                                        )}
                                        <Text
                                            style={[
                                                styles.preview,
                                                message.pinnedAt !== null && !isPaused && styles.previewPinned,
                                                isPaused && styles.previewPaused,
                                                { flexShrink: 1 },
                                            ]}
                                            numberOfLines={2}
                                        >
                                            {truncatePendingPreview(getPendingPreviewText(message.previewText, t('pendingQueue.empty')))}
                                        </Text>
                                    </View>
                                    {schedule && (
                                        <Text style={[styles.scheduleLabel, schedule.due && styles.scheduleLabelDue]} numberOfLines={1}>
                                            {schedule.due ? t('pendingQueue.scheduledDue') : t('pendingQueue.scheduledAt', { time: schedule.time })}
                                        </Text>
                                    )}
                                </Pressable>

                                {canManage && (
                                    <View style={styles.actions}>
                                        {isPaused ? (
                                            <Pressable
                                                style={[styles.iconButton, isDisabled && styles.iconButtonDisabled]}
                                                onPress={() => void runAction(message.id, 'resume', onPause)}
                                                accessibilityLabel={t('pendingQueue.resume')}
                                                hitSlop={8}
                                                disabled={isDisabled}
                                            >
                                                {loadingAction === 'resume'
                                                    ? <ActivityIndicator size={14} color={theme.colors.textLink} />
                                                    : <Ionicons name="play" size={16} color={theme.colors.textLink} />}
                                            </Pressable>
                                        ) : (
                                            <>
                                                <Pressable
                                                    style={[styles.iconButton, isDisabled && styles.iconButtonDisabled]}
                                                    onPress={() => void runAction(message.id, 'send-now', onSendNow)}
                                                    accessibilityLabel={t('pendingQueue.sendNow')}
                                                    hitSlop={8}
                                                    disabled={isDisabled}
                                                >
                                                    {loadingAction === 'send-now'
                                                        ? <ActivityIndicator size={14} color={theme.colors.textLink} />
                                                        : <Octicons name="paper-airplane" size={16} color={theme.colors.textLink} />}
                                                </Pressable>

                                                <Pressable
                                                    style={[styles.iconButton, isDisabled && styles.iconButtonDisabled]}
                                                    onPress={() => void runAction(message.id, 'pin', onPin)}
                                                    accessibilityLabel={t('pendingQueue.pin')}
                                                    hitSlop={8}
                                                    disabled={isDisabled}
                                                >
                                                    {loadingAction === 'pin'
                                                        ? <ActivityIndicator size={14} color={theme.colors.textSecondary} />
                                                        : <Octicons
                                                            name="move-to-top"
                                                            size={16}
                                                            color={message.pinnedAt !== null ? theme.colors.textLink : theme.colors.textSecondary}
                                                        />}
                                                </Pressable>
                                            </>
                                        )}

                                        <Pressable
                                            style={[styles.iconButton, isDisabled && styles.iconButtonDisabled]}
                                            onPress={() => void runAction(message.id, 'delete', onDelete)}
                                            accessibilityLabel={t('pendingQueue.delete')}
                                            hitSlop={8}
                                            disabled={isDisabled}
                                        >
                                            {loadingAction === 'delete'
                                                ? <ActivityIndicator size={14} color={theme.colors.textDestructive} />
                                                : <Octicons name="trash" size={16} color={theme.colors.textDestructive} />}
                                        </Pressable>
                                    </View>
                                )}
                            </View>
                        );
                    })}
                </ScrollView>
            </View>
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    container: {
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: theme.colors.divider,
        backgroundColor: theme.colors.surface,
        paddingHorizontal: 12,
        paddingTop: 8,
        paddingBottom: 8,
        alignItems: 'center',
    },
    innerContainer: {
        width: '100%',
        maxWidth: layout.maxWidth,
        gap: 8,
    },
    headerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    title: {
        color: theme.colors.text,
        fontSize: 13,
        fontWeight: '600',
    },
    count: {
        color: theme.colors.textSecondary,
        fontSize: 12,
        fontWeight: '500',
    },
    list: {
        maxHeight: 180,
    },
    listContent: {
        gap: 8,
    },
    itemRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider,
        borderRadius: 10,
        paddingHorizontal: 10,
        paddingVertical: 8,
    },
    itemTextColumn: {
        flexBasis: 0,
        flexGrow: 1,
    },
    previewRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    imageBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 2,
    },
    imageBadgeCount: {
        color: theme.colors.textSecondary,
        fontSize: 11,
        fontWeight: '600',
    },
    preview: {
        color: theme.colors.text,
        fontSize: 13,
        lineHeight: 18,
    },
    previewPinned: {
        fontWeight: '700',
    },
    previewPaused: {
        color: theme.colors.textSecondary,
    },
    scheduleLabel: {
        color: theme.colors.textLink,
        fontSize: 11,
        fontWeight: '600',
        marginTop: 2,
    },
    scheduleLabelDue: {
        color: theme.colors.textSecondary,
    },
    actions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        marginLeft: 4,
    },
    iconButton: {
        width: 24,
        height: 24,
        alignItems: 'center',
        justifyContent: 'center',
    },
    iconButtonDisabled: {
        opacity: 0.4,
    },
}));
