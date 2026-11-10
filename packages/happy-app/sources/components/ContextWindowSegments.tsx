import * as React from 'react';
import { Pressable, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { StyleSheet } from 'react-native-unistyles';
import { Text } from '@/components/StyledText';
import { Typography } from '@/constants/Typography';
import { hapticsLight } from './haptics';

type ContextWindowSegmentsProps = {
    /** The context windows to pick from, smallest first. */
    options: readonly { value: number; label: string }[];
    value: number;
    onChange: (value: number) => void;
    accessibilityLabel: string;
};

// Same slide as the tabs of the composer's settings overlay.
const INDICATOR_TIMING = { duration: 220, easing: Easing.out(Easing.cubic) };
const BAR_PADDING = 2;
// Every segment is as wide as the widest label ("400K") needs, so the selection slides by whole steps.
const SEGMENT_WIDTH = 56;

/**
 * A few context windows side by side, picked with one tap; drawn like the settings overlay's tabs,
 * the selection's background sliding to the picked one.
 */
export function ContextWindowSegments({ options, value, onChange, accessibilityLabel }: ContextWindowSegmentsProps) {
    const selectedIndex = Math.max(options.findIndex((option) => option.value === value), 0);
    // Shown at once on a tap; the picked value comes back through `value` a moment later.
    const [pendingIndex, setPendingIndex] = React.useState<number | null>(null);
    const shownIndex = pendingIndex ?? selectedIndex;
    React.useEffect(() => setPendingIndex(null), [selectedIndex]);

    const indicatorX = useSharedValue(shownIndex * SEGMENT_WIDTH);
    React.useEffect(() => {
        indicatorX.value = withTiming(shownIndex * SEGMENT_WIDTH, INDICATOR_TIMING);
    }, [shownIndex, indicatorX]);
    const indicatorStyle = useAnimatedStyle(() => ({
        transform: [{ translateX: indicatorX.value }],
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
                        accessibilityState={{ selected }}
                        onPress={() => {
                            if (selected) return;
                            hapticsLight();
                            setPendingIndex(index);
                            onChange(option.value);
                        }}
                        style={styles.segment}
                    >
                        <Text style={[styles.label, selected ? styles.labelSelected : styles.labelUnselected]}>{option.label}</Text>
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
        left: BAR_PADDING,
        width: SEGMENT_WIDTH,
        borderRadius: 6,
        backgroundColor: theme.colors.floatingOverlay.segmentedSelected,
    },
    segment: {
        width: SEGMENT_WIDTH,
        paddingVertical: 4,
        alignItems: 'center',
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
