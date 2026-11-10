/**
 * PendingMessageDetailSheet
 *
 * The bottom sheet a pending (queued) message opens in when its row is tapped. Two modes:
 *  - view: the full text in the shared SelectableTextView (the text-selection screen's selectable,
 *    syntax-highlighted rendering) and the actions (copy, edit, reschedule, pause/resume, send now,
 *    pin, delete).
 *  - edit: in-place editing. Entering edit pauses the message so it cannot be dispatched mid-edit;
 *    saving keeps it as a draft (the user resumes or sends it explicitly).
 *
 * It follows the live pending message by id, so pause and pin show at once, and it closes itself
 * when the message is dispatched or deleted. Mounted to show: it presents itself, and `onClosed`
 * runs once it has gone, so the owner can unmount it.
 */

import * as Clipboard from 'expo-clipboard';
import { Octicons, Ionicons } from '@expo/vector-icons';
import { BottomSheetModal, BottomSheetScrollView, BottomSheetTextInput } from '@gorhom/bottom-sheet';
import * as React from 'react';
import { Platform, Pressable, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppBottomSheet } from '@/components/AppBottomSheet';
import { showCopiedToast, showToast } from '@/components/Toast';
import { hapticsLight } from '@/components/haptics';
import { SelectableTextView } from '@/components/SelectableTextView';
import { useSessionPendingMessages } from '@/sync/storage';
import type { PendingMessage } from '@/sync/storageTypes';
import { t } from '@/text';
import { sheetFill, sheetSafeAreaBottom } from './glassSheet';
import { getPendingPreviewText, getPendingScheduleInfo } from './pendingQueuePanelUtils';

// The text box starts this tall and grows to the text once the web view has measured it.
const TEXT_FLOOR = 48;
// The text box takes at most this share of the window (and 320pt), scrolling inside beyond it.
const TEXT_MAX_SHARE = 0.4;
// The bottom sheet's text input handles the keyboard natively; on the web it is a plain one.
const SheetTextInput = Platform.OS === 'web' ? TextInput : BottomSheetTextInput;

interface PendingMessageDetailSheetProps {
    sessionId: string;
    message: PendingMessage;
    canManage: boolean;
    onSendNow: (pendingId: string) => Promise<void> | void;
    onPin: (pendingId: string) => Promise<void> | void;
    onDelete: (pendingId: string) => Promise<void> | void;
    onPause: (pendingId: string) => Promise<void> | void;
    onSaveEdit: (pendingId: string, newText: string) => Promise<void> | void;
    onReschedule?: (pendingId: string) => void;
    /** Open straight into editing, as the queue row's Edit action does. */
    startEditing?: boolean;
    /** The sheet has gone. */
    onClosed: () => void;
}

export function PendingMessageDetailSheet({
    sessionId,
    message,
    canManage,
    onSendNow,
    onPin,
    onDelete,
    onPause,
    onSaveEdit,
    onReschedule,
    startEditing = false,
    onClosed,
}: PendingMessageDetailSheetProps) {
    const { theme } = useUnistyles();
    const safeArea = useSafeAreaInsets();
    const { height: windowHeight } = useWindowDimensions();
    const sheetRef = React.useRef<BottomSheetModal>(null);

    React.useEffect(() => {
        sheetRef.current?.present();
    }, []);
    const close = React.useCallback(() => sheetRef.current?.dismiss(), []);

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
    const seenLiveRef = React.useRef(false);
    React.useEffect(() => {
        if (live !== null) {
            seenLiveRef.current = true;
        } else if (seenLiveRef.current) {
            close();
        }
    }, [live, close]);

    const handleCopy = React.useCallback(async () => {
        await Clipboard.setStringAsync(m.previewText);
        hapticsLight();
        showCopiedToast();
        close();
    }, [m.previewText, close]);

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

    // Mounted from the queue row's Edit action: enter editing once, as the Edit row here would.
    const startedEditingRef = React.useRef(false);
    React.useEffect(() => {
        if (startEditing && !startedEditingRef.current && canManage) {
            startedEditingRef.current = true;
            void startEdit();
        }
    }, [startEditing, canManage, startEdit]);

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

    // Swiped away mid-edit: the edit is dropped as Cancel would, un-pausing what editing paused.
    const handleDismiss = React.useCallback(() => {
        if (autoPausedRef.current) {
            autoPausedRef.current = false;
            void onPause(m.id);
        }
        onClosed();
    }, [m.id, onPause, onClosed]);

    const fullText = getPendingPreviewText(m.previewText, t('pendingQueue.empty'));
    const textMax = Math.min(320, windowHeight * TEXT_MAX_SHARE);
    // Starts short and grows to the measured text, instead of starting tall and snapping down.
    const textHeight = measuredText !== null ? Math.max(TEXT_FLOOR, Math.min(measuredText, textMax)) : TEXT_FLOOR;
    // The input's and Cancel's fill: white on the light sheet; on the dark one the surface is
    // nearly the sheet's own grey, so a lighter grey stands out instead.
    const boxFill = sheetFill(theme.dark ? theme.colors.surfacePressed : theme.colors.surface);

    const header = (
        <View style={styles.header}>
            <Text style={styles.title}>{editing ? t('pendingQueue.edit') : t('pendingQueue.detailTitle')}</Text>
            {!editing && (
                <View style={styles.headerBadges}>
                    {schedule && (
                        <Text style={styles.scheduledTime}>{schedule.due ? t('pendingQueue.scheduledDue') : schedule.time}</Text>
                    )}
                    {isPaused && <Ionicons name="pause" size={15} color={theme.colors.textSecondary} />}
                    {m.imageCount > 0 && (
                        <View style={styles.badge}>
                            <Octicons name="image" size={13} color={theme.colors.textSecondary} />
                            {m.imageCount > 1 && <Text style={styles.badgeCount}>x{m.imageCount}</Text>}
                        </View>
                    )}
                    {m.fileCount > 0 && (
                        <View style={styles.badge}>
                            <Octicons name="file" size={13} color={theme.colors.textSecondary} />
                            {m.fileCount > 1 && <Text style={styles.badgeCount}>x{m.fileCount}</Text>}
                        </View>
                    )}
                </View>
            )}
        </View>
    );

    return (
        <AppBottomSheet ref={sheetRef} enableDynamicSizing onDismiss={handleDismiss}>
            {/* Everything sits in the scroll view: only its content is measured for the sheet's height. */}
            <BottomSheetScrollView
                keyboardShouldPersistTaps="handled"
                // Plain object: the sheet's scroll view drops a stylesheet entry in an array on the web.
                contentContainerStyle={{ paddingBottom: sheetSafeAreaBottom(safeArea.bottom) + 16 }}
            >
                {header}
                {editing ? (
                    <>
                        <View style={styles.banner}>
                            <Ionicons name="pause" size={14} color={theme.colors.textSecondary} />
                            <Text style={styles.bannerText}>{t('pendingQueue.editingPausedNotice')}</Text>
                        </View>
                        {/* The input is the one card on the sheet, so it reads as the place to type. */}
                        <SheetTextInput
                            style={[styles.editor, { maxHeight: textMax, backgroundColor: boxFill }]}
                            value={draft}
                            onChangeText={setDraft}
                            multiline
                            autoFocus
                            placeholder={t('pendingQueue.empty')}
                            placeholderTextColor={theme.colors.textSecondary}
                        />
                        <View style={styles.editButtons}>
                            <Pressable
                                style={({ pressed }) => [styles.editButton, { backgroundColor: boxFill }, pressed && styles.pressed]}
                                onPress={() => void cancelEdit()}
                            >
                                <Text style={styles.editCancel}>{t('common.cancel')}</Text>
                            </Pressable>
                            <Pressable
                                style={({ pressed }) => [styles.editButton, styles.editSave, pressed && styles.pressed]}
                                onPress={() => void saveEdit()}
                            >
                                <Text style={styles.editSaveText}>{t('pendingQueue.save')}</Text>
                            </Pressable>
                        </View>
                    </>
                ) : (
                    // Straight on the sheet, which is the card: the text, then the actions under it.
                    <View style={styles.box}>
                        <View style={{ height: textHeight }}>
                            <SelectableTextView key={fullText} text={fullText} backgroundColor="transparent" onMeasure={setMeasuredText} />
                        </View>
                        <Action icon="copy-outline" label={t('pendingQueue.copyText')} onPress={() => void handleCopy()} />
                        {canManage && (
                            <>
                                <Action icon="create-outline" label={t('pendingQueue.edit')} onPress={() => void startEdit()} />
                                {m.deliverAt !== null && onReschedule && (
                                    <Action
                                        icon="calendar-outline"
                                        label={t('pendingQueue.reschedule')}
                                        onPress={() => { onReschedule(m.id); close(); }}
                                    />
                                )}
                                <Action
                                    icon={isPaused ? 'play-outline' : 'pause-outline'}
                                    label={isPaused ? t('pendingQueue.resume') : t('pendingQueue.pause')}
                                    onPress={() => void onPause(m.id)}
                                />
                                <Action
                                    icon="paper-plane-outline"
                                    label={t('pendingQueue.sendNow')}
                                    onPress={() => { void onSendNow(m.id); close(); }}
                                />
                                {!isPaused && (
                                    <Action icon="arrow-up-circle-outline" label={t('pendingQueue.pin')} onPress={() => void onPin(m.id)} />
                                )}
                                <Action icon="trash-outline" label={t('pendingQueue.delete')} destructive onPress={() => void onDelete(m.id)} />
                            </>
                        )}
                    </View>
                )}
            </BottomSheetScrollView>
        </AppBottomSheet>
    );
}

/** An action row in the card, under a hairline. */
function Action({ icon, label, onPress, destructive }: {
    icon: React.ComponentProps<typeof Ionicons>['name'];
    label: string;
    onPress: () => void;
    destructive?: boolean;
}) {
    const { theme } = useUnistyles();
    const color = destructive ? theme.colors.textDestructive : theme.colors.text;
    return (
        <Pressable style={({ pressed }) => [styles.actionRow, pressed && styles.actionRowPressed]} onPress={onPress}>
            <Ionicons name={icon} size={20} color={destructive ? theme.colors.textDestructive : theme.colors.textLink} />
            <Text style={[styles.actionLabel, { color }]}>{label}</Text>
        </Pressable>
    );
}

const styles = StyleSheet.create((theme) => ({
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingTop: 4,
        paddingBottom: 12,
        paddingHorizontal: 16,
    },
    title: {
        fontSize: 17,
        fontWeight: '600',
        color: theme.colors.text,
    },
    headerBadges: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    badge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 2,
    },
    badgeCount: {
        color: theme.colors.textSecondary,
        fontSize: 11,
        fontWeight: '600',
    },
    scheduledTime: {
        color: theme.colors.textLink,
        fontSize: 11,
        fontWeight: '600',
    },
    box: {
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: theme.colors.divider,
    },
    actionRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 13,
        paddingHorizontal: 16,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: theme.colors.divider,
    },
    actionRowPressed: {
        backgroundColor: theme.colors.surfacePressed,
    },
    actionLabel: {
        fontSize: 16,
    },
    banner: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingBottom: 10,
        paddingHorizontal: 16,
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
        paddingVertical: 12,
        paddingHorizontal: 14,
        marginHorizontal: 16,
        marginVertical: 2,
        borderRadius: 12,
        minHeight: 120,
        textAlignVertical: 'top',
    },
    editButtons: {
        flexDirection: 'row',
        gap: 10,
        marginTop: 12,
        marginHorizontal: 16,
    },
    editButton: {
        flex: 1,
        alignItems: 'center',
        paddingVertical: 13,
        borderRadius: 12,
    },
    editSave: {
        backgroundColor: theme.colors.button.primary.background,
    },
    editCancel: {
        fontSize: 16,
        color: theme.colors.text,
    },
    editSaveText: {
        fontSize: 16,
        fontWeight: '600',
        color: theme.colors.button.primary.tint,
    },
    pressed: {
        opacity: 0.7,
    },
}));
