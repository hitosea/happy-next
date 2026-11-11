import * as React from 'react';
import { Animated, Easing, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { t } from '@/text';
import { formatDuration, formatFullMessageTime } from '@/utils/messageTime';
import { showToast } from './Toast';
import { hapticsLight } from './haptics';
import { TextShimmer } from './TextShimmer';
import { FoldDelegatedMark } from './FoldDelegatedMark';

/** How long the chevron takes to swing between open and folded. */
const CHEVRON_TURN_MS = 180;

/**
 * A turn with nothing to fold that took no longer than this — as the line would read it, 5s at most —
 * has no line: a quick reply needs no account of what it cost, and the rule under it would only fence
 * off a sentence.
 */
const BRIEF_TURN_MS = 6000;

/** The folded line's state, for the turns that have one. */
export type TurnFoldProps = {
    folded: boolean;
    /** Tool calls the process is hiding. */
    steps: number;
    /**
     * What the hidden rows are doing right now, shown at the far end of the line. Only a turn still
     * running has one: once it settles the answer is on screen below, and the line goes back to
     * being just the cost of the process.
     */
    snapshot?: string;
    /**
     * A delegated task the folded line hides is still running: what it was asked to do, or null when
     * there is nothing to say of it. Undefined when none is. Shown at the far end, but only when there
     * is no snapshot: what the turn is doing right now outranks it.
     */
    delegated?: string | null;
    onToggle: () => void;
};

/**
 * The line above an assistant turn: how long it has been going, or how long it
 * took. It belongs to the turn rather than to the list footer so it arrives with
 * the reply and stays put when the turn settles — a line that appeared and
 * disappeared on its own would jog everything above it.
 *
 * While the turn runs it counts up. Once it settles it just states the result: no
 * affordance, nothing that changes under the cursor. Tapping it still reveals the
 * exact window for anyone who wants it.
 *
 * A turn whose process is long enough to be worth folding hands one in through
 * `fold`, and then this line is the fold: a chevron and what the process cost,
 * tap to open or close it. That displaces the exact-window tap, which moves to a
 * long press rather than being lost. A settled one that took under a second says
 * only its steps: "0s" is no duration worth reading.
 *
 * A brief turn with nothing to fold has no line at all (`BRIEF_TURN_MS`). One
 * still running is held back until it outlasts that or takes its first step, and
 * once shown the line stays: a line that went again would jog the rows above it.
 */
export const TurnHeader = React.memo((props: {
    startedAt: number;
    /** Null while the turn is still running. */
    completedAt: number | null;
    fold?: TurnFoldProps;
    /**
     * Whether the line closes the row off from what follows it. False on a row with nothing under
     * the line — a folded turn the line is the whole of — where the line would be dividing the row
     * from empty space. Defaults to true.
     */
    divide?: boolean;
}) => {
    const { theme } = useUnistyles();
    const { startedAt, completedAt, fold } = props;
    const divide = props.divide ?? true;
    const folded = fold?.folded ?? false;
    const running = completedAt === null;
    // A fold line under the pointer lights up its label and chevron: text over textSecondary is the
    // stronger of the two in either theme (darker on light, lighter on dark).
    const [hovered, setHovered] = React.useState(false);

    // One glyph that turns, rather than two icons swapped: this row is the thing the reader just
    // tapped, and a swap reads as a jump. `Animated` with the native driver, not Reanimated — see
    // StatusDot for what a Reanimated frame costs in this build. A rotation is a transform, so it
    // never re-runs layout either.
    const turn = React.useRef(new Animated.Value(folded ? 1 : 0)).current;
    React.useEffect(() => {
        Animated.timing(turn, {
            toValue: folded ? 1 : 0,
            duration: CHEVRON_TURN_MS,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
        }).start();
    }, [folded, turn]);
    const rotation = turn.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-90deg'] });
    const elapsedMs = useElapsedMs(running ? startedAt : null);
    const elapsed = running ? elapsedMs : completedAt - startedAt;
    const brief = fold === undefined && elapsed < BRIEF_TURN_MS;
    const shownRef = React.useRef(false);
    if (!brief) shownRef.current = true;

    let label: string;
    if (running && elapsed < 1000) {
        // Under a second there is nothing to report yet, so the line says what is
        // happening instead of how long it has been.
        label = t('message.processing');
    } else if (running) {
        label = t('message.processed', { duration: formatDuration(elapsed) });
    } else if (fold !== undefined && elapsed < 1000) {
        label = t('message.segmentSteps', { steps: fold.steps });
    } else if (fold?.folded) {
        label = t('message.foldedProcess', { duration: formatDuration(elapsed), steps: fold.steps });
    } else {
        label = t('message.took', { duration: formatDuration(elapsed) });
    }

    // The window behind that duration, for anyone who long-presses the line.
    const detail = running
        ? null
        : `${formatFullMessageTime(startedAt)} – ${formatFullMessageTime(completedAt)}`;

    const showDetail = () => {
        if (detail === null) return;
        hapticsLight();
        showToast(detail, { icon: null });
    };

    // A fold is offered whatever the turn is doing. While it runs, the folded line is the only thing
    // showing — which is exactly when the reader is most likely to want it open.
    const foldable = fold !== undefined;
    const onPress = foldable ? fold.onToggle : (running ? undefined : showDetail);
    const onLongPress = foldable ? showDetail : undefined;
    // Inert means there is nothing here to do, not that the turn is busy: react-native-web answers a
    // disabled Pressable with `pointer-events: none`, so a running turn's fold would be untappable.
    const inert = onPress === undefined;
    const lit = foldable && hovered;

    if (brief && !shownRef.current) return null;

    return (
        <Pressable
            style={[styles.row, !divide && styles.rowUndivided]}
            onPress={onPress}
            onLongPress={onLongPress}
            onHoverIn={fold !== undefined ? () => setHovered(true) : undefined}
            onHoverOut={fold !== undefined ? () => setHovered(false) : undefined}
            disabled={inert}
            accessibilityRole={foldable ? 'button' : undefined}
            accessibilityState={foldable ? { expanded: !folded } : undefined}
            accessibilityLabel={foldable
                ? `${label}. ${folded ? t('message.expandProcess') : t('message.foldProcess')}`
                : label}
        >
            {foldable && (
                <Animated.View style={[styles.chevron, { transform: [{ rotate: rotation }] }]}>
                    <Ionicons name="chevron-down" size={12} color={lit ? theme.colors.text : theme.colors.textSecondary} />
                </Animated.View>
            )}
            <Text style={[styles.text, lit && styles.textLit]} numberOfLines={1}>{label}</Text>
            {foldable && fold.snapshot ? (
                running ? (
                    // What the turn is doing right now is the long part of the line, and it is the
                    // part that carries the sign of life: a band of light travels it, so the line
                    // reads as still working without anything about it changing size.
                    <TextShimmer
                        style={styles.snapshotLive}
                        baseColor={theme.colors.textSecondary}
                        highlightColor={theme.colors.text}
                        ellipsizeMode="middle"
                    >
                        {fold.snapshot}
                    </TextShimmer>
                ) : (
                    // The snapshot gives way to the label: the cost of the process is the line's own
                    // subject, and the snapshot is what the reader glances at.
                    <Text style={styles.snapshot} numberOfLines={1} ellipsizeMode="middle">{fold.snapshot}</Text>
                )
            ) : foldable && fold.delegated !== undefined ? (
                <FoldDelegatedMark label={fold.delegated} />
            ) : null}
        </Pressable>
    );
});

// Ticks once a second while a turn is in flight; a settled one reads its duration
// straight off the turn's timestamps.
function useElapsedMs(startedAt: number | null): number {
    const [elapsedMs, setElapsedMs] = React.useState(0);
    React.useEffect(() => {
        if (startedAt === null) return;
        const update = () => setElapsedMs(Math.max(0, Date.now() - startedAt));
        update();
        const timer = setInterval(update, 1000);
        return () => clearInterval(timer);
    }, [startedAt]);
    return startedAt === null ? 0 : elapsedMs;
}

const styles = StyleSheet.create((theme) => ({
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        paddingBottom: 6,
        marginBottom: 8,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: theme.colors.divider,
    },
    // The hairline still takes up its width with nothing under the row to divide: the fold opens
    // and closes in place, and a row that changed height on that would move everything below it.
    rowUndivided: {
        borderBottomColor: 'transparent',
    },
    // The chevron leans left a little: at this size a bare glyph floats in from the
    // margin, and the label is what the line is for.
    chevron: {
        marginLeft: -2,
        width: 12,
        alignItems: 'center',
        justifyContent: 'center',
    },
    text: {
        fontSize: 13,
        color: theme.colors.textSecondary,
        // The cost of the process is short and is the line's own subject, so it never gives way.
        flexShrink: 0,
    },
    textLit: {
        color: theme.colors.text,
    },
    // Everything the line has left goes to the snapshot, which is the part long enough to need
    // cutting. minWidth keeps it from refusing to shrink below its content on web.
    snapshot: {
        flexShrink: 1,
        minWidth: 0,
        marginLeft: 'auto',
        paddingLeft: 12,
        fontSize: 12,
        color: theme.colors.textSecondary,
        opacity: 0.7,
    },
    // The live one paints its own dimming into the gradient, so it takes neither the flat colour nor
    // the 70%: the band has to be free to reach the text's full strength.
    snapshotLive: {
        flexShrink: 1,
        minWidth: 0,
        marginLeft: 'auto',
        paddingLeft: 12,
        fontSize: 12,
        color: theme.colors.textSecondary,
    },
}));
