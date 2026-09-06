import * as React from 'react';
import { View, StyleProp, ViewStyle } from 'react-native';
import Animated, {
    useSharedValue,
    useAnimatedStyle,
    withTiming,
    Easing,
    useReducedMotion,
} from 'react-native-reanimated';
import { useUnistyles } from 'react-native-unistyles';

interface ReanimatedProgressProps {
    /** 0–1 */
    progress: number;
    /** Animation duration (ms) for progress change */
    duration?: number;
    height?: number;
    color?: string;
    trackColor?: string;
    style?: StyleProp<ViewStyle>;
    borderRadius?: number;
}

export const ReanimatedProgress = React.memo<ReanimatedProgressProps>(({
    progress,
    duration = 600,
    height = 4,
    color,
    trackColor,
    style,
    borderRadius = 2,
}) => {
    const { theme } = useUnistyles();
    const reducedMotion = useReducedMotion();
    const width = useSharedValue(Math.max(0, Math.min(1, progress)));

    React.useEffect(() => {
        const target = Math.max(0, Math.min(1, progress));
        width.value = reducedMotion
            ? target
            : withTiming(target, { duration, easing: Easing.out(Easing.cubic) });
    }, [progress, duration, reducedMotion, width]);

    const fillStyle = useAnimatedStyle(() => ({
        width: `${width.value * 100}%`,
    }));

    return (
        <View style={[{
            height,
            backgroundColor: trackColor ?? theme.colors.divider,
            borderRadius,
            overflow: 'hidden',
        }, style]}>
            <Animated.View
                style={[{
                    height: '100%',
                    backgroundColor: color ?? theme.colors.repo.pilotRunning,
                    borderRadius,
                }, fillStyle]}
            />
        </View>
    );
});
ReanimatedProgress.displayName = 'ReanimatedProgress';
