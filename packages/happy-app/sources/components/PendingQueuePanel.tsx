import { Octicons, Ionicons } from '@expo/vector-icons';
import type { PendingMessage } from '@/sync/storageTypes';
import { t } from '@/text';
import * as React from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import Animated, { Easing, interpolate, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import type { ActionMenuItem } from './ActionMenu';
import { DropdownMenu } from './DropdownMenu';
import { GlassSurface } from './GlassSurface';
import { hapticsLight } from './haptics';
import { layout } from './layout';
import { PendingMessageDetailSheet } from './PendingMessageDetailSheet';
import { getPendingPreviewText, getPendingScheduleInfo, truncatePendingPreview } from './pendingQueuePanelUtils';

type PendingActionType = 'send-now' | 'steer' | 'pin' | 'delete' | 'pause';

type PendingQueuePanelProps = {
    sessionId: string;
    messages: PendingMessage[];
    canManage: boolean;
    /** A turn is running: queued messages wait for it to end, and sending one now interrupts it. */
    isBusy: boolean;
    /** The composer floats over the chat as Liquid Glass (iOS 26): the queue floats with it, as glass too. */
    glass: boolean;
    onSendNow: (pendingId: string) => Promise<void> | void;
    /** Steers a message into the running turn ("插话"); set only when the session's agent can. */
    onSteer?: (pendingId: string) => Promise<void> | void;
    onPin: (pendingId: string) => Promise<void> | void;
    onDelete: (pendingId: string) => Promise<void> | void;
    onPause: (pendingId: string) => Promise<void> | void;
    onSaveEdit: (pendingId: string, newText: string) => Promise<void> | void;
    onReschedule?: (pendingId: string) => void;
};

const BAR_HEIGHT = 46;
const RADIUS = 16;
// How far each card stacked behind the collapsed bar peeks out above it.
const GHOST_STEP = 4;
const MAX_GHOSTS = 2;
const TOGGLE_MS = 260;
// The web has hover and room for a second button: Delete sits on the row, next to the menu.
const MENU_SHIELD_LINGER_MS = 100;
const DELETE_ON_ROW = Platform.OS === 'web';

/**
 * The queue of messages waiting to be sent, right above the composer and shaped like it: collapsed,
 * a capsule saying how many wait and which goes next, with the cards behind it peeking out above;
 * expanded, a card listing them in order. One surface grows from the capsule into the card (its
 * height animates while the two contents cross-fade); the glass itself never fades, as Liquid Glass
 * under a translucent parent renders wrong. Each row opens the full message on tap and keeps its
 * actions in a menu; its state (pinned, paused, scheduled, attachments) shows as small tags.
 * Messages being steered into the running turn head the list in a section of their own, without
 * actions: they cannot be changed until the agent reads them, and then they leave the queue.
 */
export const PendingQueuePanel: React.FC<PendingQueuePanelProps> = React.memo((props) => {
    const { sessionId, messages, canManage, isBusy, glass, onSendNow, onSteer, onPin, onDelete, onPause, onSaveEdit, onReschedule } = props;
    const { theme } = useUnistyles();
    const { width: screenWidth, height: screenHeight } = useWindowDimensions();
    const [expanded, setExpanded] = React.useState(false);
    const [pendingAction, setPendingAction] = React.useState<{ pendingId: string; action: PendingActionType } | null>(null);
    const scrollRef = React.useRef<ScrollView>(null);
    const prevCountRef = React.useRef(messages.length);

    React.useEffect(() => {
        if (expanded && messages.length > prevCountRef.current) {
            requestAnimationFrame(() => {
                scrollRef.current?.scrollToEnd({ animated: true });
            });
        }
        prevCountRef.current = messages.length;
    }, [expanded, messages.length]);

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

    // While a row's native menu is up, a shield over the queue takes the tap that dismisses it, which
    // iOS would otherwise also hand to the row under it. The menu reports going as that tap lands, so
    // the shield stays a moment longer to be sure it is the one that takes it.
    const [menuShield, setMenuShield] = React.useState(false);
    const shieldTimerRef = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const handleMenuOpenChange = React.useCallback((open: boolean) => {
        clearTimeout(shieldTimerRef.current);
        if (open) {
            setMenuShield(true);
        } else {
            shieldTimerRef.current = setTimeout(() => setMenuShield(false), MENU_SHIELD_LINGER_MS);
        }
    }, []);
    React.useEffect(() => () => clearTimeout(shieldTimerRef.current), []);

    // The message whose detail sheet is up; the sheet unmounts once it has gone.
    const [detail, setDetail] = React.useState<{ message: PendingMessage; startEditing: boolean } | null>(null);
    const openDetail = React.useCallback((message: PendingMessage, startEditing = false) => {
        setDetail({ message, startEditing });
    }, []);
    const closeDetail = React.useCallback(() => setDetail(null), []);

    // 0 = capsule, 1 = card. The card's natural height is measured while hidden, so the surface
    // knows how tall to grow.
    const progress = useSharedValue(0);
    const cardHeight = useSharedValue(BAR_HEIGHT);
    const toggleExpanded = React.useCallback(() => {
        hapticsLight();
        setExpanded((value) => {
            const next = !value;
            progress.value = withTiming(next ? 1 : 0, { duration: TOGGLE_MS, easing: Easing.out(Easing.cubic) });
            return next;
        });
    }, [progress]);

    // Down to one message there is nothing to expand: the card folds back into that message's row.
    const isSingle = messages.length === 1;
    React.useEffect(() => {
        if (isSingle && expanded) {
            setExpanded(false);
            progress.value = withTiming(0, { duration: TOGGLE_MS, easing: Easing.out(Easing.cubic) });
        }
    }, [isSingle, expanded, progress]);

    const shellStyle = useAnimatedStyle(() => ({
        height: interpolate(progress.value, [0, 1], [BAR_HEIGHT, Math.max(BAR_HEIGHT, cardHeight.value)]),
    }));
    const barLayerStyle = useAnimatedStyle(() => ({
        opacity: interpolate(progress.value, [0, 0.4], [1, 0], 'clamp'),
    }));
    const cardLayerStyle = useAnimatedStyle(() => ({
        opacity: interpolate(progress.value, [0.3, 1], [0, 1], 'clamp'),
        transform: [{ translateY: interpolate(progress.value, [0, 1], [8, 0]) }],
    }));

    if (messages.length === 0) {
        return null;
    }

    // What goes out next: the first message not steering, paused nor waiting for its time.
    const now = Date.now();
    const next = messages.find((m) => m.steeringAt === null && m.pausedAt === null && (m.deliverAt === null || m.deliverAt <= now)) ?? null;
    // Steering messages sort first (see pendingQueue.ts)
    const steeringCount = messages.filter((m) => m.steeringAt !== null).length;
    const previewOf = (m: PendingMessage) => truncatePendingPreview(getPendingPreviewText(m.previewText, t('pendingQueue.empty')));
    const surfaceColor = theme.colors.input.background;

    const menuItems = (message: PendingMessage): ActionMenuItem[] => {
        const isPaused = message.pausedAt !== null;
        const items: ActionMenuItem[] = [];
        // Only into a running turn, and only a message that would otherwise go out at the next turn
        if (onSteer && isBusy && !isPaused && message.deliverAt === null) {
            items.push({
                label: t('pendingQueue.steer'),
                onPress: () => void runAction(message.id, 'steer', onSteer),
            });
        }
        if (!isPaused) {
            items.push({
                label: isBusy ? t('pendingQueue.sendNowInterrupt') : t('pendingQueue.sendNow'),
                onPress: () => void runAction(message.id, 'send-now', onSendNow),
            });
            items.push({
                label: t('pendingQueue.pin'),
                onPress: () => void runAction(message.id, 'pin', onPin),
            });
        }
        items.push({
            label: t('pendingQueue.edit'),
            onPress: () => openDetail(message, true),
        });
        items.push({
            label: isPaused ? t('pendingQueue.resume') : t('pendingQueue.pause'),
            onPress: () => void runAction(message.id, 'pause', onPause),
        });
        if (onReschedule) {
            items.push({
                label: t('pendingQueue.reschedule'),
                onPress: () => onReschedule(message.id),
            });
        }
        // The web shows Delete on the row itself.
        if (!DELETE_ON_ROW) {
            items.push({
                label: t('pendingQueue.delete'),
                destructive: true,
                startsSection: true,
                onPress: () => void runAction(message.id, 'delete', onDelete),
            });
        }
        return items;
    };

    const renderTags = (message: PendingMessage) => {
        const schedule = getPendingScheduleInfo(message.deliverAt);
        const tags: React.ReactNode[] = [];
        if (message.steeringAt !== null) {
            tags.push(
                <View key="steering" style={styles.tag}>
                    <Ionicons name="return-down-forward" size={10} color={theme.colors.textLink} />
                    <Text style={[styles.tagText, styles.tagTextAccent]}>{t('pendingQueue.steering')}</Text>
                </View>
            );
        }
        if (message.pinnedAt !== null && message.pausedAt === null) {
            tags.push(
                <View key="pin" style={styles.tag}>
                    <Text style={[styles.tagText, styles.tagTextAccent]}>{t('pendingQueue.pinned')}</Text>
                </View>
            );
        }
        if (message.pausedAt !== null) {
            tags.push(
                <View key="paused" style={styles.tag}>
                    <Ionicons name="pause" size={10} color={theme.colors.textSecondary} />
                    <Text style={styles.tagText}>{t('pendingQueue.paused')}</Text>
                </View>
            );
        }
        if (schedule) {
            tags.push(
                <View key="schedule" style={styles.tag}>
                    <Octicons name="clock" size={10} color={schedule.due ? theme.colors.textSecondary : theme.colors.textLink} />
                    <Text style={[styles.tagText, !schedule.due && styles.tagTextAccent]} numberOfLines={1}>
                        {schedule.due ? t('pendingQueue.scheduledDue') : t('pendingQueue.scheduledAt', { time: schedule.time })}
                    </Text>
                </View>
            );
        }
        if (message.imageCount > 0) {
            tags.push(
                <View key="images" style={styles.tag}>
                    <Octicons name="image" size={10} color={theme.colors.textSecondary} />
                    {message.imageCount > 1 && <Text style={styles.tagText}>×{message.imageCount}</Text>}
                </View>
            );
        }
        if (message.fileCount > 0) {
            tags.push(
                <View key="files" style={styles.tag}>
                    <Octicons name="file" size={10} color={theme.colors.textSecondary} />
                    {message.fileCount > 1 && <Text style={styles.tagText}>×{message.fileCount}</Text>}
                </View>
            );
        }
        return tags.length > 0 ? <View style={styles.tagRow}>{tags}</View> : null;
    };

    // A row's actions. On the web Delete sits after the menu, and both are bare until hovered.
    const renderActions = (message: PendingMessage) => {
        if (!canManage || message.steeringAt !== null) return null;
        if (pendingAction?.pendingId === message.id) {
            return (
                <View style={[styles.moreButton, DELETE_ON_ROW && styles.moreButtonHoverOnly]}>
                    <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                </View>
            );
        }
        const disabled = pendingAction !== null;
        return (
            <View style={styles.rowActions}>
                <DropdownMenu
                    items={menuItems(message)}
                    accessibilityLabel={t('pendingQueue.moreActions')}
                    // Above the trigger and centred on it on native; the web flips on its own when there is no room below.
                    placement={Platform.OS === 'web' ? undefined : 'topCenter'}
                    onOpenChange={handleMenuOpenChange}
                    style={[styles.moreButton, DELETE_ON_ROW && styles.moreButtonHoverOnly, disabled && styles.moreButtonDisabled]}
                    hoveredStyle={DELETE_ON_ROW && !disabled ? styles.moreButtonHovered : undefined}
                >
                    <Ionicons name="ellipsis-horizontal" size={16} color={theme.colors.text} />
                </DropdownMenu>
                {DELETE_ON_ROW && (
                    <Pressable
                        style={({ hovered }: any) => [styles.moreButton, styles.moreButtonHoverOnly, hovered && !disabled && styles.moreButtonHovered, disabled && styles.moreButtonDisabled]}
                        onPress={() => void runAction(message.id, 'delete', onDelete)}
                        disabled={disabled}
                        accessibilityLabel={t('pendingQueue.delete')}
                    >
                        <Ionicons name="trash-outline" size={16} color={theme.colors.textDestructive} />
                    </Pressable>
                )}
            </View>
        );
    };

    const ghosts = Math.min(MAX_GHOSTS, messages.length - 1);
    // A lone message is shown as it is, with its actions, instead of a capsule to expand.
    const single = messages.length === 1 ? messages[0] : null;

    const barContent = single ? (
        <View style={[styles.bar, canManage && styles.singleBar]}>
            <View style={styles.countBadge}>
                <Text style={styles.countBadgeText}>1</Text>
            </View>
            <Pressable style={styles.barText} onPress={() => openDetail(single)} accessibilityLabel={t('pendingQueue.detailTitle')}>
                <Text style={[styles.barTitle, styles.singleTitle, single.pausedAt !== null && styles.rowTextPaused]} numberOfLines={1}>
                    {previewOf(single)}
                </Text>
                {renderTags(single) ?? (
                    <Text style={styles.barSubtitle} numberOfLines={1}>
                        {isBusy ? t('pendingQueue.sendsAfterTurn') : t('pendingQueue.title')}
                    </Text>
                )}
            </Pressable>
            {renderActions(single)}
        </View>
    ) : (
        <Pressable style={styles.bar} onPress={toggleExpanded} accessibilityRole="button" accessibilityLabel={t('pendingQueue.expand')}>
            <View style={styles.countBadge}>
                <Text style={styles.countBadgeText}>{messages.length}</Text>
            </View>
            <View style={styles.barText}>
                <Text style={styles.barTitle} numberOfLines={1}>
                    {t('pendingQueue.collapsedTitle', { count: messages.length })}
                </Text>
                <Text style={styles.barSubtitle} numberOfLines={1}>
                    {steeringCount > 0
                        ? `${t('pendingQueue.steering')} · ${previewOf(messages[0])}`
                        : next ? t('pendingQueue.nextUp', { text: previewOf(next) }) : t('pendingQueue.nothingDue')}
                </Text>
            </View>
            <Ionicons name="chevron-up" size={16} color={theme.colors.textSecondary} />
        </Pressable>
    );

    const cardContent = (
        <>
            <Pressable style={styles.cardHeader} onPress={toggleExpanded} accessibilityRole="button" accessibilityLabel={t('pendingQueue.collapse')}>
                <View style={styles.cardHeaderText}>
                    <Text style={styles.cardTitle}>{t('pendingQueue.title')}</Text>
                    {isBusy && <Text style={styles.cardSubtitle} numberOfLines={1}>{t('pendingQueue.sendsAfterTurn')}</Text>}
                </View>
                <Text style={styles.cardCount}>{messages.length}</Text>
                <Ionicons name="chevron-down" size={16} color={theme.colors.textSecondary} />
            </Pressable>

            <ScrollView
                ref={scrollRef}
                style={{ maxHeight: Math.min(320, screenHeight * 0.4) }}
                contentContainerStyle={styles.listContent}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator
            >
                {messages.map((message, index) => {
                    const isPaused = message.pausedAt !== null;
                    const isSteering = message.steeringAt !== null;
                    // With messages steering, they and the rest of the queue each get a heading
                    const heading = steeringCount === 0 ? null
                        : index === 0 ? { title: t('pendingQueue.steering'), hint: t('pendingQueue.steeringHint') }
                        : index === steeringCount ? { title: t('pendingQueue.queuedSection'), hint: null }
                        : null;
                    return (
                        <React.Fragment key={message.id}>
                        {heading && (
                            <View style={[styles.sectionHeader, index > 0 && styles.rowDivider]}>
                                <Text style={styles.sectionTitle}>{heading.title}</Text>
                                {heading.hint && <Text style={styles.sectionHint} numberOfLines={1}>{heading.hint}</Text>}
                            </View>
                        )}
                        <View style={[styles.row, index > 0 && !heading && styles.rowDivider]}>
                            <View style={styles.rowIndex}>
                                {isSteering
                                    ? <ActivityIndicator size="small" color={theme.colors.textLink} style={styles.rowIndexSpinner} />
                                    : <Text style={styles.rowIndexText}>{index + 1 - steeringCount}</Text>}
                            </View>
                            <Pressable
                                style={styles.rowBody}
                                onPress={() => openDetail(message)}
                                accessibilityLabel={t('pendingQueue.detailTitle')}
                            >
                                <Text style={[styles.rowText, isPaused && styles.rowTextPaused]} numberOfLines={2}>
                                    {previewOf(message)}
                                </Text>
                                {renderTags(message)}
                            </Pressable>
                            {renderActions(message)}
                        </View>
                        </React.Fragment>
                    );
                })}
            </ScrollView>
        </>
    );

    return (
        // Matches AgentInput's container padding, and innerContainer its panelSideMargin inset (applied inside
        // the maxWidth clamp), so the queue lines up with the input card at any width.
        <View style={[styles.container, { paddingHorizontal: screenWidth > 700 ? 16 : 8 }]}>
            {/* Expanded, a tap anywhere outside the card folds it back: an invisible layer over the
                chat and the composer, under the card. */}
            {expanded && (
                <Pressable
                    style={[styles.backdrop, { top: -screenHeight, bottom: -screenHeight, left: -screenWidth, right: -screenWidth }, Platform.OS === 'web' && styles.backdropWeb]}
                    onPress={toggleExpanded}
                    accessibilityLabel={t('pendingQueue.collapse')}
                />
            )}
            {/* Takes the collapsed room only (the capsule and the cards peeking above it): expanded, the card
                floats up over the chat from there, so neither the composer nor the chat moves. */}
            <View style={[styles.innerContainer, { height: ghosts * GHOST_STEP + BAR_HEIGHT }]}>
                {/* Back as soon as the card starts shrinking, so it settles straight into the stack:
                    the card covers them on its way down. */}
                {!expanded && Array.from({ length: ghosts }, (_, i) => {
                    // The farthest card is drawn first, so the nearer ones cover it.
                    const depth = ghosts - i;
                    return (
                        <GlassSurface
                            key={depth}
                            glass={glass}
                            color={surfaceColor}
                            pointerEvents="none"
                            style={[
                                styles.ghost,
                                { top: (ghosts - depth) * GHOST_STEP, left: 8 + depth * 10, right: 8 + depth * 10 },
                                !glass && styles.ghostSolid,
                            ]}
                        />
                    );
                })}
                <Animated.View style={[styles.shell, glass && Platform.OS === 'web' && styles.shellWebShadow, shellStyle]}>
                    <GlassSurface glass={glass} color={surfaceColor} pointerEvents="none" style={styles.shellSurface} />
                    <Animated.View
                        style={[styles.cardLayer, cardLayerStyle]}
                        pointerEvents={expanded ? 'auto' : 'none'}
                        onLayout={(e) => { cardHeight.value = e.nativeEvent.layout.height; }}
                    >
                        {cardContent}
                    </Animated.View>
                    <Animated.View style={[styles.barLayer, barLayerStyle]} pointerEvents={expanded ? 'none' : 'auto'}>
                        {barContent}
                    </Animated.View>
                </Animated.View>
            </View>
            {detail && (
                <PendingMessageDetailSheet
                    key={detail.message.id}
                    sessionId={sessionId}
                    message={detail.message}
                    canManage={canManage}
                    startEditing={detail.startEditing}
                    onSendNow={onSendNow}
                    onPin={onPin}
                    onDelete={onDelete}
                    onPause={onPause}
                    onSaveEdit={onSaveEdit}
                    onReschedule={onReschedule}
                    onClosed={closeDetail}
                />
            )}
            {menuShield && (
                <View
                    style={[styles.menuShield, { top: -screenHeight, bottom: -screenHeight, left: -screenWidth, right: -screenWidth }]}
                    onStartShouldSetResponder={() => true}
                />
            )}
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    menuShield: {
        position: 'absolute',
        zIndex: 30,
    },
    container: {
        paddingTop: 8,
        alignItems: 'center',
    },
    innerContainer: {
        width: '100%',
        maxWidth: layout.maxWidth,
        paddingHorizontal: 8,
    },
    ghost: {
        position: 'absolute',
        height: BAR_HEIGHT,
        borderRadius: RADIUS,
    },
    // Anchored to the bottom of the collapsed room, so growing taller grows it upward over the chat.
    shell: {
        position: 'absolute',
        left: 8,
        right: 8,
        bottom: 0,
        zIndex: 10,
        borderRadius: RADIUS,
        overflow: 'hidden',
    },
    // The frosted surface's own shadow is clipped by the shell, so on the web the shell casts it.
    shellWebShadow: {
        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.12)',
    },
    shellSurface: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        borderRadius: RADIUS,
    },
    barLayer: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: BAR_HEIGHT,
    },
    cardLayer: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        paddingBottom: 6,
    },
    ghostSolid: {
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider,
        opacity: 0.7,
    },
    bar: {
        height: BAR_HEIGHT,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingLeft: 8,
        paddingRight: 14,
    },
    countBadge: {
        minWidth: 30,
        height: 30,
        borderRadius: 15,
        paddingHorizontal: 6,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.surfaceRipple,
    },
    countBadgeText: {
        color: theme.colors.text,
        fontSize: 13,
        fontWeight: '700',
    },
    barText: {
        flex: 1,
        minWidth: 0,
    },
    barTitle: {
        color: theme.colors.text,
        fontSize: 14,
        fontWeight: '600',
    },
    barSubtitle: {
        color: theme.colors.textSecondary,
        fontSize: 12,
        marginTop: 1,
    },
    cardHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingLeft: 16,
        paddingRight: 14,
        paddingTop: 12,
        paddingBottom: 6,
    },
    cardHeaderText: {
        flex: 1,
        minWidth: 0,
    },
    cardTitle: {
        color: theme.colors.text,
        fontSize: 15,
        fontWeight: '700',
    },
    cardSubtitle: {
        color: theme.colors.textSecondary,
        fontSize: 12,
        marginTop: 1,
    },
    cardCount: {
        color: theme.colors.textSecondary,
        fontSize: 13,
        fontWeight: '500',
    },
    listContent: {
        paddingHorizontal: 8,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingVertical: 8,
        paddingHorizontal: 6,
    },
    rowDivider: {
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: theme.colors.divider,
    },
    rowIndex: {
        width: 22,
        height: 22,
        borderRadius: 11,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.surfaceRipple,
    },
    rowIndexSpinner: {
        transform: [{ scale: 0.6 }],
    },
    sectionHeader: {
        flexDirection: 'row',
        alignItems: 'baseline',
        gap: 6,
        paddingTop: 8,
        paddingBottom: 2,
        paddingHorizontal: 6,
    },
    sectionTitle: {
        color: theme.colors.textSecondary,
        fontSize: 12,
        fontWeight: '700',
    },
    sectionHint: {
        flex: 1,
        color: theme.colors.textSecondary,
        fontSize: 11,
    },
    rowIndexText: {
        color: theme.colors.textSecondary,
        fontSize: 11,
        fontWeight: '700',
    },
    rowBody: {
        flex: 1,
        minWidth: 0,
        gap: 4,
    },
    rowText: {
        color: theme.colors.text,
        fontSize: 14,
        lineHeight: 20,
    },
    rowTextPaused: {
        color: theme.colors.textSecondary,
    },
    tagRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 4,
    },
    tag: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 3,
        height: 18,
        borderRadius: 9,
        paddingHorizontal: 6,
        backgroundColor: theme.colors.surfaceRipple,
    },
    tagText: {
        color: theme.colors.textSecondary,
        fontSize: 11,
        fontWeight: '600',
    },
    tagTextAccent: {
        color: theme.colors.textLink,
    },
    moreButton: {
        width: 32,
        height: 32,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.surfaceRipple,
    },
    rowActions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    // On the web the row's buttons are bare until hovered.
    moreButtonHoverOnly: {
        backgroundColor: 'transparent',
    },
    moreButtonHovered: {
        backgroundColor: theme.colors.surfaceRipple,
    },
    backdrop: {
        position: 'absolute',
    },
    // The page's own coordinates: offsets past the panel would stretch the document instead.
    backdropWeb: {
        position: 'fixed' as any,
        top: 0,
        bottom: 0,
        left: 0,
        right: 0,
    },
    // The row's buttons bring their own padding.
    singleBar: {
        paddingRight: 7,
    },
    singleTitle: {
        fontWeight: '400',
    },
    moreButtonDisabled: {
        opacity: 0.4,
    },
}));
