import * as React from 'react';
import { type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withSequence, withTiming } from 'react-native-reanimated';
import { StyleSheet } from 'react-native-unistyles';

// A session row the list jumped to (see sessionListJump) flashes the press tint once, so the eye
// finds where it landed: in quickly, held, then faded out.
type SessionRowFlashListener = (sessionId: string) => void;

const listeners = new Set<SessionRowFlashListener>();

export function flashSessionRow(sessionId: string) {
    for (const listener of listeners) {
        listener(sessionId);
    }
}

/**
 * The flash of one session row, laid over its background like PressHighlight: put it first among
 * the pressable's children, with `style` taking the pressable's corner radii.
 */
export const SessionRowFlash = React.memo(({ sessionId, style }: { sessionId: string; style?: StyleProp<ViewStyle> }) => {
    const opacity = useSharedValue(0);

    React.useEffect(() => {
        const listener: SessionRowFlashListener = (id) => {
            if (id !== sessionId) return;
            opacity.value = withSequence(
                withTiming(1, { duration: 120 }),
                withDelay(300, withTiming(0, { duration: 700 })),
            );
        };
        listeners.add(listener);
        return () => {
            listeners.delete(listener);
        };
    }, [sessionId, opacity]);

    const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

    return <Animated.View pointerEvents="none" style={[styles.flash, style, animatedStyle]} />;
});
SessionRowFlash.displayName = 'SessionRowFlash';

const styles = StyleSheet.create((theme) => ({
    flash: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: theme.colors.surfaceRipple,
    },
}));
