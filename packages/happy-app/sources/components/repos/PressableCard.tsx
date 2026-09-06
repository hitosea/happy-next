import * as React from 'react';
import { Platform, Pressable, StyleProp, ViewStyle } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withSpring, withTiming } from 'react-native-reanimated';
import { hapticsLight } from '@/components/haptics';

interface PressableCardProps {
    onPress?: () => void;
    onLongPress?: () => void;
    disabled?: boolean;
    style?: StyleProp<ViewStyle>;
    children: React.ReactNode;
    haptic?: boolean;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export const PressableCard = React.memo<PressableCardProps>(({ onPress, onLongPress, disabled, style, children, haptic = true }) => {
    const scale = useSharedValue(1);
    const opacity = useSharedValue(1);

    const animatedStyle = useAnimatedStyle(() => ({
        transform: [{ scale: scale.value }],
        opacity: opacity.value,
    }));

    const handlePressIn = React.useCallback(() => {
        if (disabled) return;
        if (Platform.OS !== 'web') {
            scale.value = withSpring(0.975, { damping: 18, stiffness: 260, mass: 0.45 });
        }
        opacity.value = withTiming(0.9, { duration: 120 });
        if (haptic && Platform.OS !== 'web') hapticsLight();
    }, [disabled, haptic, scale, opacity]);

    const handlePressOut = React.useCallback(() => {
        if (Platform.OS !== 'web') {
            scale.value = withSpring(1, { damping: 18, stiffness: 260, mass: 0.45 });
        }
        opacity.value = withTiming(1, { duration: 160 });
    }, [scale, opacity]);

    return (
        <AnimatedPressable
            onPress={onPress}
            onLongPress={onLongPress}
            disabled={disabled}
            onPressIn={handlePressIn}
            onPressOut={handlePressOut}
            style={[style, animatedStyle]}
        >
            {children}
        </AnimatedPressable>
    );
});
PressableCard.displayName = 'PressableCard';
