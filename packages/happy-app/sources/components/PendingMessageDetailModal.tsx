/**
 * PendingMessageDetailModal
 *
 * Shown via Modal.show() when a pending (queued) message row is tapped. Two modes:
 *  - view: full text rendered with the shared SelectableTextView (same selectable,
 *    syntax-highlighted rendering as the text-selection screen) + actions (copy,
 *    edit, pause/resume, send now, pin, delete).
 *  - edit: in-place editing. Entering edit auto-pauses the message so it can't be
 *    dispatched mid-edit; saving keeps it as a draft (user resumes/sends explicitly).
 *
 * The component subscribes to the live pending message by id, so pause/pin toggles
 * reflect immediately and the sheet auto-closes if the message is dispatched/deleted.
 *
 * Heights are derived from the viewport so the text area shrinks (and scrolls
 * internally) on short screens — the action menu is never clipped.
 */

import * as Clipboard from 'expo-clipboard';
import { Octicons, Ionicons } from '@expo/vector-icons';
import * as React from 'react';
import { Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { showCopiedToast, showToast } from '@/components/Toast';
import { hapticsLight } from '@/components/haptics';
import { SelectableTextView } from '@/components/SelectableTextView';
import { useSessionPendingMessages } from '@/sync/storage';
import type { PendingMessage } from '@/sync/storageTypes';
import { t } from '@/text';
import { getPendingPreviewText, getPendingScheduleInfo } from './pendingQueuePanelUtils';

const HEADER_H = 44;
const CANCEL_H = 57;
const ROW_H = 48;
const SLACK = 12;
const BANNER_H = 38;
const EDIT_FOOTER_H = 50;

interface PendingMessageDetailModalProps {
    sessionId: string;
    message: PendingMessage;
    canManage: boolean;
    onSendNow: (pendingId: string) => Promise<void> | void;
    onPin: (pendingId: string) => Promise<void> | void;
    onDelete: (pendingId: string) => Promise<void> | void;
    onPause: (pendingId: string) => Promise<void> | void;
    onSaveEdit: (pendingId: string, newText: string) => Promise<void> | void;
    onReschedule?: (pendingId: string) => void;
    onClose: () => void;
}

export function PendingMessageDetailModal({
    sessionId,
    message,
    canManage,
    onSendNow,
    onPin,
    onDelete,
    onPause,
    onSaveEdit,
    onReschedule,
    onClose,
}: PendingMessageDetailModalProps) {
    const { theme } = useUnistyles();
    const safeArea = useSafeAreaInsets();
    const { height: windowHeight, width: windowWidth } = useWindowDimensions();
    const available = windowHeight - safeArea.top - safeArea.bottom - 24;
    // BaseModal centers content (no stretch), so the sheet width is otherwise
    // driven by intrinsic child width — and the WebView has none, collapsing the
    // card. Pin an explicit pixel width derived from the screen.
    const sheetWidth = Math.min(420, windowWidth - 16);

    // Live message: reflects pause/pin toggles and external dispatch/delete.
    const live = useSessionPendingMessages(sessionId).find((m) => m.id === message.id) ?? null;
    const m = live ?? message;
    const isPaused = m.pausedAt !== null;
    const schedule = getPendingScheduleInfo(m.deliverAt);

    const [editing, setEditing] = React.useState(false);
    const [draft, setDraft] = React.useState(m.previewText);
    // Real content height reported by SelectableTextView; null until first measure.
    const [measuredText, setMeasuredText] = React.useState<number | null>(null);
    // Tracks whether *we* paused on entering edit, so cancel can revert it.
    const autoPausedRef = React.useRef(false);

    // If the message gets dispatched or deleted elsewhere, close the sheet.
    React.useEffect(() => {
        if (live === null) {
            onClose();
        }
    }, [live, onClose]);

    const handleCopy = React.useCallback(async () => {
        await Clipboard.setStringAsync(m.previewText);
        hapticsLight();
        showCopiedToast();
        onClose();
    }, [m.previewText, onClose]);

    const startEdit = React.useCallback(async () => {
        setDraft(getPendingPreviewText(m.previewText, ''));
        setEditing(true);
        if (!isPaused) {
            autoPausedRef.current = true;
            await onPause(m.id);
        } else {
            autoPausedRef.current = false;
        }
    }, [m.id, m.previewText, isPaused, onPause]);

    const cancelEdit = React.useCallback(async () => {
        setEditing(false);
        if (autoPausedRef.current) {
            autoPausedRef.current = false;
            await onPause(m.id); // toggle back to active — net no change
        }
    }, [m.id, onPause]);

    const saveEdit = React.useCallback(async () => {
        const text = draft.trim();
        if (text.length > 0) {
            await onSaveEdit(m.id, text); // stays paused (draft) per design
        }
        autoPausedRef.current = false;
        setEditing(false);
        showToast(t('pendingQueue.saved'));
    }, [draft, m.id, onSaveEdit]);

    const fullText = getPendingPreviewText(m.previewText, t('pendingQueue.empty'));

    if (editing) {
        const editorMax = Math.max(120, Math.min(320, available - HEADER_H - BANNER_H - EDIT_FOOTER_H - SLACK));
        return (
            <View style={[styles.wrapper, { width: sheetWidth, paddingBottom: safeArea.bottom + 8 }]}>
                <View style={[styles.card, { maxHeight: available }]}>
                    <View style={styles.header}>
                        <Text style={styles.title}>{t('pendingQueue.edit')}</Text>
                    </View>
                    <View style={styles.banner}>
                        <Ionicons name="pause" size={14} color={theme.colors.textSecondary} />
                        <Text style={styles.bannerText}>{t('pendingQueue.editingPausedNotice')}</Text>
                    </View>
                    <TextInput
                        style={[styles.editor, { maxHeight: editorMax }]}
                        value={draft}
                        onChangeText={setDraft}
                        multiline
                        autoFocus
                        placeholder={t('pendingQueue.empty')}
                        placeholderTextColor={theme.colors.textSecondary}
                    />
                    <View style={styles.editFooter}>
                        <Pressable
                            style={({ pressed }) => [styles.footerButton, styles.footerButtonLeft, pressed && styles.pressed]}
                            onPress={() => void cancelEdit()}
                        >
                            <Text style={styles.footerCancel}>{t('common.cancel')}</Text>
                        </Pressable>
                        <Pressable
                            style={({ pressed }) => [styles.footerButton, pressed && styles.pressed]}
                            onPress={() => void saveEdit()}
                        >
                            <Text style={styles.footerSave}>{t('pendingQueue.save')}</Text>
                        </Pressable>
                    </View>
                </View>
            </View>
        );
    }

    // Budget so that card + cancel button always fit the viewport. The text area
    // is capped but always leaves room for a few action rows; the rest of the
    // menu scrolls — so a short (landscape) screen never clips the actions.
    const cardBudget = available - CANCEL_H - 8;
    const RESERVE_ACTIONS = 3 * ROW_H; // keep ~3 rows visible before scrolling
    const textMax = Math.max(80, Math.min(300, cardBudget - HEADER_H - RESERVE_ACTIONS));
    // Start collapsed and grow to the real content height (reported by the WebView)
    // once measured — the text area expands up to fit instead of starting tall and
    // snapping down, which would flash a big empty gap for short messages. Capped at
    // textMax (then the WebView scrolls internally), floored so the box never jumps.
    const TEXT_FLOOR = 48;
    const textHeight = measuredText !== null ? Math.max(TEXT_FLOOR, Math.min(measuredText, textMax)) : TEXT_FLOOR;
    const actionsMaxHeight = Math.max(2 * ROW_H, cardBudget - HEADER_H - textHeight);

    return (
        <View style={[styles.wrapper, { width: sheetWidth, paddingBottom: safeArea.bottom + 8 }]}>
            <View style={[styles.card, { maxHeight: cardBudget }]}>
                <View style={styles.header}>
                    <Text style={styles.title}>{t('pendingQueue.detailTitle')}</Text>
                    <View style={styles.headerBadges}>
                        {schedule && (
                            <Text style={styles.scheduledTime}>{schedule.due ? t('pendingQueue.scheduledDue') : schedule.time}</Text>
                        )}
                        {isPaused && (
                            <Ionicons name="pause" size={15} color={theme.colors.textSecondary} />
                        )}
                        {m.imageCount > 0 && (
                            <View style={styles.imageBadge}>
                                <Octicons name="image" size={13} color={theme.colors.textSecondary} />
                                {m.imageCount > 1 && (
                                    <Text style={styles.imageBadgeCount}>x{m.imageCount}</Text>
                                )}
                            </View>
                        )}
                        {m.fileCount > 0 && (
                            <View style={styles.imageBadge}>
                                <Octicons name="file" size={13} color={theme.colors.textSecondary} />
                                {m.fileCount > 1 && (
                                    <Text style={styles.imageBadgeCount}>x{m.fileCount}</Text>
                                )}
                            </View>
                        )}
                    </View>
                </View>

                <View style={{ height: textHeight }}>
                    <SelectableTextView
                        key={fullText}
                        text={fullText}
                        onMeasure={setMeasuredText}
                    />
                </View>

                <ScrollView
                    style={{ maxHeight: actionsMaxHeight }}
                    bounces={false}
                    keyboardShouldPersistTaps="handled"
                >
                    <Action icon="copy" label={t('pendingQueue.copyText')} onPress={() => void handleCopy()} />
                    {canManage && (
                        <>
                            <Action icon="pencil" label={t('pendingQueue.edit')} onPress={() => void startEdit()} />
                            {m.deliverAt !== null && onReschedule && (
                                <Action
                                    icon="calendar"
                                    label={t('pendingQueue.reschedule')}
                                    onPress={() => { onReschedule(m.id); onClose(); }}
                                />
                            )}
                            {isPaused ? (
                                <Action ion="play" label={t('pendingQueue.resume')} onPress={() => void onPause(m.id)} />
                            ) : (
                                <Action ion="pause" label={t('pendingQueue.pause')} onPress={() => void onPause(m.id)} />
                            )}
                            <Action
                                icon="paper-airplane"
                                label={t('pendingQueue.sendNow')}
                                onPress={() => { void onSendNow(m.id); onClose(); }}
                            />
                            {!isPaused && (
                                <Action
                                    icon="move-to-top"
                                    label={t('pendingQueue.pin')}
                                    onPress={() => void onPin(m.id)}
                                />
                            )}
                            <Action
                                icon="trash"
                                label={t('pendingQueue.delete')}
                                destructive
                                onPress={() => void onDelete(m.id)}
                            />
                        </>
                    )}
                </ScrollView>
            </View>

            <Pressable
                style={({ pressed }) => [styles.cancelButton, pressed && styles.pressed]}
                onPress={onClose}
            >
                <Text style={styles.cancelText}>{t('common.cancel')}</Text>
            </Pressable>
        </View>
    );
}

function Action({ icon, ion, label, onPress, destructive }: {
    icon?: React.ComponentProps<typeof Octicons>['name'];
    ion?: React.ComponentProps<typeof Ionicons>['name'];
    label: string;
    onPress: () => void;
    destructive?: boolean;
}) {
    const { theme } = useUnistyles();
    const color = destructive ? theme.colors.textDestructive : theme.colors.textLink;
    return (
        <Pressable
            style={({ pressed }) => [styles.actionRow, pressed && styles.pressed]}
            onPress={onPress}
        >
            {ion
                ? <Ionicons name={ion} size={18} color={color} />
                : <Octicons name={icon!} size={18} color={color} />}
            <Text style={[styles.actionLabel, destructive && styles.actionLabelDestructive]}>{label}</Text>
        </Pressable>
    );
}

const styles = StyleSheet.create((theme) => ({
    wrapper: {
        width: '100%',
        maxWidth: 420,
        paddingHorizontal: 8,
    },
    card: {
        backgroundColor: theme.colors.surface,
        borderRadius: 14,
        overflow: 'hidden',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 12,
        paddingHorizontal: 16,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: theme.colors.divider,
    },
    title: {
        fontSize: 13,
        fontWeight: '600',
        color: theme.colors.textSecondary,
    },
    headerBadges: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
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
    scheduledTime: {
        color: theme.colors.textLink,
        fontSize: 11,
        fontWeight: '600',
    },
    banner: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingVertical: 9,
        paddingHorizontal: 16,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: theme.colors.divider,
        backgroundColor: theme.colors.surfaceHigh,
    },
    bannerText: {
        flex: 1,
        fontSize: 12.5,
        color: theme.colors.textSecondary,
    },
    editor: {
        color: theme.colors.text,
        fontSize: 15,
        lineHeight: 22,
        paddingVertical: 14,
        paddingHorizontal: 16,
        minHeight: 120,
        backgroundColor: theme.colors.surfaceHigh,
        textAlignVertical: 'top',
    },
    editFooter: {
        flexDirection: 'row',
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: theme.colors.divider,
    },
    footerButton: {
        flex: 1,
        alignItems: 'center',
        paddingVertical: 15,
    },
    footerButtonLeft: {
        borderRightWidth: StyleSheet.hairlineWidth,
        borderRightColor: theme.colors.divider,
    },
    footerCancel: {
        fontSize: 16,
        color: theme.colors.textSecondary,
    },
    footerSave: {
        fontSize: 16,
        fontWeight: '700',
        color: theme.colors.textLink,
    },
    actionRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingVertical: 14,
        paddingHorizontal: 16,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: theme.colors.divider,
    },
    actionLabel: {
        fontSize: 16,
        color: theme.colors.textLink,
    },
    actionLabelDestructive: {
        color: theme.colors.textDestructive,
    },
    pressed: {
        backgroundColor: theme.colors.surfacePressed,
    },
    cancelButton: {
        marginTop: 8,
        backgroundColor: theme.colors.surface,
        borderRadius: 14,
        paddingVertical: 16,
        alignItems: 'center',
    },
    cancelText: {
        fontSize: 17,
        fontWeight: '600',
        color: theme.colors.textLink,
    },
}));
