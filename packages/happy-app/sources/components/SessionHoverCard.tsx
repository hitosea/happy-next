import * as React from 'react';
import { Platform, Pressable, TextInput, View, type ViewStyle, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { formatModelDisplay, resolveLocalModelDisplay } from 'happy-wire';
import { Text } from '@/components/StyledText';
import { Modal } from '@/modal';
import { sessionUpdateSummary } from '@/sync/ops';
import { Typography } from '@/constants/Typography';
import { useLocalSetting, useMachine, useOrchestratorRunningTaskCount, useSession, useSessionHasDraft } from '@/sync/storage';
import type { Session } from '@/sync/storageTypes';
import { t } from '@/text';
import { formatLastSeen, formatPathRelativeToHome, getSessionName, useSessionStatus } from '@/utils/sessionUtils';
import { StatusDot } from './StatusDot';
import { getMachineDisplayName } from './sessionListScope';
import type { ScrollTarget } from './sessionContextMenuScroll';
import { SessionContextMenuPortal } from './SessionContextMenuPortal';
import { sessionHoverCard, type HoverAnchorRect } from './sessionHoverCardController';
import { canLocateSessionProject, locateSessionProject } from './sessionProjectLocate';

const CARD_WIDTH = 280;
const GAP = 8;
const BELOW_GAP = 4;
const EDGE = 8;
// How fast the card follows the pointer from one row to the next.
const MOVE_TRANSITION = Platform.OS === 'web'
    ? { transitionProperty: 'top, left', transitionDuration: '140ms', transitionTimingFunction: 'ease-out' } as any
    : null;

type PointerLike = { nativeEvent?: { pointerType?: string } };
const isMouse = (event: PointerLike) => !event.nativeEvent?.pointerType || event.nativeEvent.pointerType === 'mouse';

/**
 * Hooks a session row up to the shared hover card (web, mouse only) — see `sessionHoverCard`.
 * `dismiss` is for the row's own menu, which takes the card's place.
 */
export function useSessionHoverCard(sessionId: string, anchorRef: React.RefObject<ScrollTarget>) {
    const owner = React.useRef({}).current;
    const sessionIdRef = React.useRef(sessionId);
    sessionIdRef.current = sessionId;

    React.useEffect(() => () => {
        sessionHoverCard.rowLeave(owner);
        sessionHoverCard.dismiss(owner);
    }, [owner]);

    const rowProps = React.useMemo(() => Platform.OS === 'web' ? {
        onPointerEnter: (event: PointerLike) => {
            if (!isMouse(event)) return;
            sessionHoverCard.rowEnter({ owner, sessionId: sessionIdRef.current, getElement: () => anchorRef.current });
        },
        onPointerMove: (event: PointerLike) => {
            if (isMouse(event)) sessionHoverCard.rowMove(owner);
        },
        onPointerLeave: () => sessionHoverCard.rowLeave(owner),
    } : {}, [owner, anchorRef]);

    const dismiss = React.useCallback(() => sessionHoverCard.dismiss(owner), [owner]);

    return { rowProps, dismiss };
}

/**
 * The one hover card, mounted once for the whole app. Moving between rows keeps this card and
 * only changes what it shows and where, so it never blinks out between rows or shows twice.
 */
export function SessionHoverCardHost() {
    const state = React.useSyncExternalStore(sessionHoverCard.subscribe, sessionHoverCard.getSnapshot, sessionHoverCard.getSnapshot);
    if (state === null) return null;
    return (
        <SessionContextMenuPortal>
            <HoverCardSession sessionId={state.sessionId} anchor={state.anchor} />
        </SessionContextMenuPortal>
    );
}

function HoverCardSession({ sessionId, anchor }: { sessionId: string; anchor: HoverAnchorRect }) {
    const session = useSession(sessionId);
    if (!session) return null;
    return <SessionHoverCard session={session} anchor={anchor} />;
}

function providerName(flavor: string | null | undefined): string {
    if (!flavor || flavor === 'claude') return 'Claude';
    if (flavor === 'codex' || flavor === 'gpt' || flavor === 'openai') return 'Codex';
    if (flavor === 'gemini') return 'Gemini';
    return flavor;
}

/**
 * The card's title, renamed in place: a click turns it into an input over the same box, so
 * nothing moves. Enter saves — only a changed title, and pins it so the AI stops retitling the
 * session; Escape or a click elsewhere drops the edit.
 */
function EditableTitle({ session, onEditingChange }: { session: Session; onEditingChange: (editing: boolean) => void }) {
    const { theme } = useUnistyles();
    const name = getSessionName(session);
    const editable = !session.accessLevel && !!session.metadata;
    const [draft, setDraft] = React.useState<string | null>(null);
    // The title just saved, shown until the session catches up with it.
    const [saved, setSaved] = React.useState<string | null>(null);
    const editing = draft !== null;
    const shown = saved ?? name;

    React.useEffect(() => { setSaved(null); }, [name]);
    React.useEffect(() => { onEditingChange(editing); }, [editing, onEditingChange]);

    const submit = () => {
        const text = (draft ?? '').replace(/\s+/g, ' ').trim();
        setDraft(null);
        if (!text || text === shown || !session.metadata) return;
        setSaved(text);
        sessionUpdateSummary(session.id, session.metadata, text, session.metadataVersion, true).catch((error) => {
            setSaved(null);
            Modal.alert(
                t('common.error'),
                error instanceof Error ? error.message : t('sessionInfo.failedToRenameSession'),
            );
        });
    };

    const handleKeyPress = (event: { nativeEvent: unknown; preventDefault: () => void; stopPropagation?: () => void }) => {
        const key = event.nativeEvent as { key?: string; shiftKey?: boolean; isComposing?: boolean; keyCode?: number };
        if (key.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation?.();
            setDraft(null);
        } else if (key.key === 'Enter' && !key.isComposing && key.keyCode !== 229) {
            // A title is one line: Shift+Enter saves too rather than breaking it.
            event.preventDefault();
            event.stopPropagation?.();
            submit();
        }
    };

    return (
        <View>
            {editing && <View pointerEvents="none" style={styles.titleField} />}
            <Text
                style={[styles.title, editable && styles.titleEditable, editing && styles.titleHidden]}
                numberOfLines={2}
                onPress={editable ? () => setDraft(shown) : undefined}
            >
                {shown}
            </Text>
            {editing && (
                <TextInput
                    autoFocus
                    multiline
                    selectTextOnFocus
                    value={draft}
                    onChangeText={setDraft}
                    onBlur={() => setDraft(null)}
                    onKeyPress={handleKeyPress}
                    style={[styles.title, styles.titleInput, { color: theme.colors.text }, webInputReset]}
                />
            )}
        </View>
    );
}

const webInputReset = Platform.OS === 'web'
    ? { outlineStyle: 'none', outline: 'none', outlineWidth: 0, resize: 'none' } as any
    : null;

/**
 * The card a session row shows while the pointer rests on it (web): where the session runs, what
 * runs it, and when — the basics, without opening it. Beside the row, on whichever side has room,
 * else under it. Drawn invisible until measured, so it never shows clamped against a guessed height.
 */
function SessionHoverCard({ session, anchor }: { session: Session; anchor: HoverAnchorRect }) {
    const { theme } = useUnistyles();
    const { width, height } = useWindowDimensions();
    const [cardHeight, setCardHeight] = React.useState<number | null>(null);
    // Slides only once it has been seen in place: the first placement just appears.
    const [settled, setSettled] = React.useState(false);
    React.useEffect(() => {
        if (cardHeight === null || settled) return;
        const frame = requestAnimationFrame(() => setSettled(true));
        return () => cancelAnimationFrame(frame);
    }, [cardHeight, settled]);
    const status = useSessionStatus(session);
    const hasDraft = useSessionHasDraft(session.id);
    const runningTaskCount = useOrchestratorRunningTaskCount(session.id);
    const machineId = session.metadata?.machineId;
    // A pinned session is out of the list below; this finds where it would sit there.
    const locatable = canLocateSessionProject(session.id);
    const [locateHovered, setLocateHovered] = React.useState(false);
    const machine = useMachine(machineId ?? '');
    const nameCache = useLocalSetting('machineNameCache');

    const metadata = session.metadata;
    const path = metadata?.path ? formatPathRelativeToHome(metadata.path, metadata.homeDir) : null;
    const machineName = machineId ? getMachineDisplayName(machine ?? undefined, machineId, nameCache) : null;
    const local = resolveLocalModelDisplay(session.modelMode);
    const model = formatModelDisplay(metadata?.model, metadata?.reasoningEffort)
        || formatModelDisplay(local.model, local.reasoningEffort);
    const agent = [providerName(metadata?.flavor), model].filter(Boolean).join(' · ');

    // The gap to the row is transparent padding on the card's own box, which starts a pixel inside
    // the row: the pointer never leaves both on its way across, so the card can hide the moment it
    // leaves either.
    let side: 'right' | 'left' | 'below' = 'right';
    if (anchor.right + GAP + CARD_WIDTH > width - EDGE) side = 'left';
    if (side === 'left' && anchor.left - GAP - CARD_WIDTH < EDGE) side = 'below';
    let left: number;
    let top = anchor.top;
    let bridge: ViewStyle;
    if (side === 'right') {
        left = anchor.right - 1;
        bridge = { paddingLeft: GAP + 1 };
    } else if (side === 'left') {
        left = anchor.left - GAP - CARD_WIDTH;
        bridge = { paddingRight: GAP + 1 };
    } else {
        left = Math.max(EDGE, Math.min(anchor.left + 16, width - CARD_WIDTH - EDGE));
        top = anchor.bottom - 1;
        bridge = { paddingTop: BELOW_GAP + 1 };
    }
    if (cardHeight !== null) {
        top = Math.max(EDGE, Math.min(top, height - cardHeight - EDGE));
    }

    const rows: { icon: React.ComponentProps<typeof Ionicons>['name']; text: string }[] = [];
    if (path) rows.push({ icon: 'folder-outline', text: path });
    if (machineName) rows.push({ icon: 'desktop-outline', text: machineName });
    rows.push({ icon: 'sparkles-outline', text: agent });
    rows.push({
        icon: 'time-outline',
        text: `${t('sessionHoverCard.created', { time: formatLastSeen(session.createdAt) })} · ${t('sessionHoverCard.updated', { time: formatLastSeen(session.updatedAt) })}`,
    });

    const badges: string[] = [];
    if (status.hasUnreadCompletion) badges.push(t('sessionHoverCard.unread'));
    if (hasDraft) badges.push(t('sessionHoverCard.draft'));
    if (runningTaskCount > 0) badges.push(t('sessionHoverCard.runningTasks', { count: runningTaskCount }));

    return (
        <View
            ref={(node) => sessionHoverCard.setCardElement(node as unknown as HTMLElement | null)}
            pointerEvents="auto"
            {...({ onPointerEnter: sessionHoverCard.cardEnter, onPointerLeave: sessionHoverCard.cardLeave } as any)}
            onLayout={(event) => setCardHeight(event.nativeEvent.layout.height)}
            style={[styles.frame, bridge, settled && MOVE_TRANSITION, { left, top, opacity: cardHeight === null ? 0 : 1 }]}
        >
            <View style={styles.card}>
                <EditableTitle key={session.id} session={session} onEditingChange={sessionHoverCard.setEditing} />
                <View style={styles.statusRow}>
                    <StatusDot color={status.statusDotColor} isPulsing={status.isPulsing} />
                    <Text style={[styles.statusText, { color: status.statusColor }]} numberOfLines={1}>{status.statusText}</Text>
                </View>
                <View style={styles.rows}>
                    {rows.map(row => (
                        <View key={row.icon} style={styles.row}>
                            <View style={styles.rowIcon}>
                                <Ionicons name={row.icon} size={14} color={theme.colors.textSecondary} />
                            </View>
                            <Text style={styles.rowText} numberOfLines={2}>{row.text}</Text>
                        </View>
                    ))}
                </View>
                {badges.length > 0 && (
                    <View style={styles.badges}>
                        {badges.map(badge => (
                            <View key={badge} style={styles.badge}>
                                <Text style={styles.badgeText}>{badge}</Text>
                            </View>
                        ))}
                    </View>
                )}
                {locatable && (
                    <Pressable
                        style={styles.locate}
                        onPress={() => locateSessionProject(session.id)}
                        onHoverIn={() => setLocateHovered(true)}
                        onHoverOut={() => setLocateHovered(false)}
                        accessibilityRole="button"
                    >
                        <View style={styles.rowIcon}>
                            <Ionicons name="locate-outline" size={14} color={theme.colors.textLink} />
                        </View>
                        <Text style={[styles.locateText, locateHovered && styles.locateTextHovered]}>
                            {t('sessionHoverCard.locateInList')}
                        </Text>
                    </Pressable>
                )}
            </View>
        </View>
    );
}

const styles = StyleSheet.create((theme) => ({
    frame: {
        position: 'absolute',
    },
    card: {
        width: CARD_WIDTH,
        paddingHorizontal: 14,
        paddingVertical: 12,
        borderRadius: 12,
        backgroundColor: theme.colors.surface,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider,
        shadowColor: theme.colors.shadow.color,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.16,
        shadowRadius: 16,
    },
    title: {
        fontSize: 15,
        lineHeight: 20,
        color: theme.colors.text,
        ...Typography.default('semiBold'),
    },
    titleEditable: {
        cursor: 'text',
    } as any,
    // Drawn around the title rather than padding it, so the edit box takes no room of its own.
    titleField: {
        position: 'absolute',
        top: -4,
        left: -6,
        right: -6,
        bottom: -4,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: theme.colors.textLink,
        backgroundColor: theme.colors.input.background,
    },
    titleHidden: {
        opacity: 0,
    },
    titleInput: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        // A textarea keeps its own intrinsic size under top/bottom alone.
        width: '100%',
        height: '100%',
        margin: 0,
        padding: 0,
        paddingTop: 0,
        borderWidth: 0,
        backgroundColor: 'transparent',
    },
    statusRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        marginTop: 4,
    },
    statusText: {
        fontSize: 12,
        ...Typography.default(),
    },
    rows: {
        marginTop: 10,
        gap: 6,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 8,
    },
    rowIcon: {
        width: 14,
        marginTop: 1,
    },
    rowText: {
        flex: 1,
        fontSize: 12,
        lineHeight: 16,
        color: theme.colors.textSecondary,
        ...Typography.default(),
    },
    locate: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        alignSelf: 'flex-start',
        gap: 8,
        marginTop: 10,
    },
    locateText: {
        fontSize: 12,
        lineHeight: 16,
        color: theme.colors.textLink,
        ...Typography.default(),
    },
    locateTextHovered: {
        textDecorationLine: 'underline',
    },
    badges: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 6,
        marginTop: 10,
    },
    badge: {
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 4,
        backgroundColor: theme.colors.surfaceHighest,
    },
    badgeText: {
        fontSize: 11,
        color: theme.colors.textSecondary,
        ...Typography.default(),
    },
}));
