import * as React from 'react';
import { Pressable, View } from 'react-native';
import { AntDesign } from '@expo/vector-icons';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Text } from '@/components/StyledText';
import { Typography } from '@/constants/Typography';
import { hapticsLight } from './haptics';

export type ContextWindowSegment = {
    value: string;
    label: string;
    /** Picks no value itself but asks for one (a custom size), so it is pressed again while selected to change it. */
    opensEditor?: boolean;
    /** An editor segment that holds a value: drawn with the edit icon after it, as session details draw rename. */
    edited?: boolean;
    /** Read out instead of `label`, e.g. what an edited segment's value is. */
    accessibilityLabel?: string;
};

type ContextWindowSegmentsProps = {
    /** The context windows to pick from, smallest first. */
    options: readonly ContextWindowSegment[];
    value: string;
    onChange: (value: string) => void;
    accessibilityLabel: string;
};

// Same slide as the tabs of the composer's settings overlay.
const INDICATOR_TIMING = { duration: 220, easing: Easing.out(Easing.cubic) };
const BAR_PADDING = 2;
// Sizes ("200K", "1M") all take this width, so they read as even steps; a longer label ("Custom") widens its own.
const SEGMENT_MIN_WIDTH = 56;

/**
 * A few context windows side by side, picked with one tap; drawn like the settings overlay's tabs,
 * the selection's background sliding to the picked one.
 */
export function ContextWindowSegments({ options, value, onChange, accessibilityLabel }: ContextWindowSegmentsProps) {
    const { theme } = useUnistyles();
    const selectedIndex = Math.max(options.findIndex((option) => option.value === value), 0);
    // Shown at once on a tap; the picked value comes back through `value` a moment later.
    const [pendingIndex, setPendingIndex] = React.useState<number | null>(null);
    const shownIndex = pendingIndex ?? selectedIndex;
    React.useEffect(() => setPendingIndex(null), [selectedIndex]);

    // Each segment's x and width within the bar, once laid out.
    const [layouts, setLayouts] = React.useState<Record<number, { x: number; width: number }>>({});
    const shownLayout = layouts[shownIndex];
    const indicatorX = useSharedValue(0);
    const indicatorWidth = useSharedValue(0);
    const placed = React.useRef(false);
    React.useEffect(() => {
        if (!shownLayout) return;
        // The first placement jumps there; later ones slide.
        indicatorX.value = placed.current ? withTiming(shownLayout.x, INDICATOR_TIMING) : shownLayout.x;
        indicatorWidth.value = placed.current ? withTiming(shownLayout.width, INDICATOR_TIMING) : shownLayout.width;
        placed.current = true;
    }, [shownLayout?.x, shownLayout?.width, indicatorX, indicatorWidth]);
    const indicatorStyle = useAnimatedStyle(() => ({
        transform: [{ translateX: indicatorX.value }],
        width: indicatorWidth.value,
    }));

    return (
        <View style={styles.bar} accessibilityRole="radiogroup" accessibilityLabel={accessibilityLabel}>
            <Animated.View style={[styles.indicator, indicatorStyle]} />
            {options.map((option, index) => {
                const selected = index === shownIndex;
                return (
                    <Pressable
                        key={option.value}
                        accessibilityRole="radio"
                        accessibilityLabel={option.accessibilityLabel ?? option.label}
                        accessibilityState={{ selected }}
                        onLayout={(e) => {
                            const { x, width } = e.nativeEvent.layout;
                            setLayouts((previous) => previous[index]?.x === x && previous[index]?.width === width
                                ? previous
                                : { ...previous, [index]: { x, width } });
                        }}
                        onPress={() => {
                            if (selected && !option.opensEditor) return;
                            hapticsLight();
                            if (!option.opensEditor) setPendingIndex(index);
                            onChange(option.value);
                        }}
                        style={styles.segment}
                    >
                        <Text style={[styles.label, selected ? styles.labelSelected : styles.labelUnselected]} numberOfLines={1}>{option.label}</Text>
                        {option.edited && (
                            <AntDesign name="edit" size={13} color={selected ? theme.colors.text : theme.colors.textSecondary} />
                        )}
                    </Pressable>
                );
            })}
        </View>
    );
}

const styles = StyleSheet.create((theme) => ({
    bar: {
        flexDirection: 'row',
        padding: BAR_PADDING,
        borderRadius: 8,
        backgroundColor: theme.colors.floatingOverlay.segmentedBackground,
    },
    indicator: {
        position: 'absolute',
        top: BAR_PADDING,
        bottom: BAR_PADDING,
        left: 0,
        borderRadius: 6,
        backgroundColor: theme.colors.floatingOverlay.segmentedSelected,
    },
    segment: {
        minWidth: SEGMENT_MIN_WIDTH,
        paddingHorizontal: 10,
        paddingVertical: 4,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 3,
    },
    label: {
        fontSize: 13,
        fontVariant: ['tabular-nums'],
    },
    labelSelected: {
        color: theme.colors.text,
        ...Typography.default('semiBold'),
    },
    labelUnselected: {
        color: theme.colors.textSecondary,
        ...Typography.default(),
    },
}));
