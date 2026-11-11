import * as React from 'react';
import { Animated, Easing, Platform, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { t } from '@/text';
import { TextShimmer } from './TextShimmer';
import { FoldDelegatedMark } from './FoldDelegatedMark';
import { ToolCall } from '@/sync/typesMessage';
import { toolIcon } from './tools/toolIcon';

/** How long the chevron takes to swing between open and folded. Matches the turn's own line. */
const CHEVRON_TURN_MS = 180;

/**
 * The line a run of steps folds to: the icon of its first step and how many steps it ran, tap to open
 * or close. The chevron after the label says so while the pointer is on the line, and stays while the
 * run is open, as the way back.
 *
 * It is the turn line's smaller sibling and looks like it, minus the clock and the hairline — the
 * turn's line is what the turn cost and what divides it from the answer, while this one sits between
 * the agent's own words and has nothing to divide. A run that is still going says what it is doing at
 * the far end of the line, the same way the turn's line does.
 */
export const SegmentFoldLine = React.memo((props: {
    folded: boolean;
    /** Steps the run holds — tool calls and thinking alike. */
    steps: number;
    /** The oldest tool call among them, whose icon the line opens with; none when the run only thought. */
    tool?: ToolCall;
    /** What the run is doing right now. Only a run still going has one, and only while folded. */
    snapshot?: string;
    /**
     * A delegated task the folded run hides is still running: what it was asked to do, or null when
     * there is nothing to say of it. Undefined when none is. Shown only when there is no snapshot.
     */
    delegated?: string | null;
    running: boolean;
    onToggle: () => void;
}) => {
    const { theme } = useUnistyles();
    const { folded, steps, tool, snapshot, delegated, running, onToggle } = props;

    const [hovered, setHovered] = React.useState(false);

    // One glyph that turns, rather than two icons swapped, and with the native driver for the same
    // reason the turn's line does it: see TurnHeader.
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
    // Hidden by opacity, not taken out: the chevron keeps its room, so showing it moves nothing. A
    // touch screen has no pointer to reveal it with, so there it always says the line opens.
    const chevronShown = Platform.OS !== 'web' || hovered || !folded;
    // Under the pointer the label and both glyphs light up, as the turn's line does.
    const glyphColor = hovered ? theme.colors.text : theme.colors.textSecondary;

    // Said the same folded or open: what the line reports is the run, not the state of the line.
    const label = running ? t('message.segmentRunning', { steps }) : t('message.segmentSteps', { steps });

    return (
        <Pressable
            style={styles.row}
            onPress={onToggle}
            onHoverIn={() => setHovered(true)}
            onHoverOut={() => setHovered(false)}
            accessibilityRole="button"
            accessibilityState={{ expanded: !folded }}
            accessibilityLabel={`${label}. ${folded ? t('message.expandProcess') : t('message.foldProcess')}`}
        >
            <View style={styles.icon}>
                {tool
                    ? toolIcon(tool, 12, glyphColor)
                    : <Ionicons name="construct-outline" size={12} color={glyphColor} />}
            </View>
            <Text style={[styles.text, hovered && styles.textLit]} numberOfLines={1}>{label}</Text>
            <Animated.View style={[styles.chevron, { opacity: chevronShown ? 1 : 0, transform: [{ rotate: rotation }] }]}>
                <Ionicons name="chevron-down" size={12} color={glyphColor} />
            </Animated.View>
            {snapshot ? (
                running ? (
                    <TextShimmer
                        style={styles.snapshotLive}
                        baseColor={theme.colors.textSecondary}
                        highlightColor={theme.colors.text}
                        ellipsizeMode="middle"
                    >
                        {snapshot}
                    </TextShimmer>
                ) : (
                    <Text style={styles.snapshot} numberOfLines={1} ellipsizeMode="middle">{snapshot}</Text>
                )
            ) : delegated !== undefined ? (
                <FoldDelegatedMark label={delegated} />
            ) : null}
        </Pressable>
    );
});

const styles = StyleSheet.create((theme) => ({
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        paddingVertical: 4,
    },
    // The icon leans left a little: at this size a bare glyph floats in from the margin, and the
    // label is what the line is for.
    icon: {
        width: 12,
        alignItems: 'center',
        justifyContent: 'center',
    },
    chevron: {
        width: 12,
        alignItems: 'center',
        justifyContent: 'center',
    },
    text: {
        fontSize: 13,
        color: theme.colors.textSecondary,
        flexShrink: 0,
    },
    textLit: {
        color: theme.colors.text,
    },
    snapshot: {
        flexShrink: 1,
        minWidth: 0,
        marginLeft: 'auto',
        paddingLeft: 12,
        fontSize: 12,
        color: theme.colors.textSecondary,
        opacity: 0.7,
    },
    snapshotLive: {
        flexShrink: 1,
        minWidth: 0,
        marginLeft: 'auto',
        paddingLeft: 12,
        fontSize: 12,
        color: theme.colors.textSecondary,
    },
}));
