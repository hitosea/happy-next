import * as React from 'react';
import { View } from 'react-native';
import { KeyboardStickyView, useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface AgentContentViewProps {
    input?: React.ReactNode | null;
    content?: React.ReactNode | null;
    placeholder?: React.ReactNode | null;
    betweenContentAndInput?: React.ReactNode | null;
}

export const AgentContentView: React.FC<AgentContentViewProps> = React.memo(({ input, content, placeholder, betweenContentAndInput }) => {
    const safeArea = useSafeAreaInsets();
    const { height } = useReanimatedKeyboardAnimation();
    const placeholderVisibleAreaStyle = useAnimatedStyle(() => ({
        // Keyboard controller reports iOS keyboard height as a negative offset here.
        // Use the inverse so the placeholder is centered in the visible area above the keyboard.
        bottom: Math.max(0, -height.value),
    }), []);
    return (
        <View style={{ flexBasis:0, flexGrow:1 }}>
            <View style={{ flexBasis:0, flexGrow:1 }}>
                {/* The content keeps its frame while the keyboard is up — the message list lifts its
                    own content natively instead (see ChatList's KeyboardChatScrollView). Translating
                    this wrapper would drag the top edge of the scroll view off screen, and with it
                    the iOS 26 scroll-edge effect that the transparent header draws there. */}
                {content && (
                    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
                        {content}
                    </View>
                )}
                {placeholder && (
                    <Animated.ScrollView
                        style={[
                            { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
                            placeholderVisibleAreaStyle,
                        ]}
                        contentContainerStyle={{ alignItems: 'center', justifyContent: 'center', flexGrow: 1 }}
                        keyboardShouldPersistTaps="handled"
                        alwaysBounceVertical={false}
                    >
                        {placeholder}
                    </Animated.ScrollView>
                )}
            </View>
            <KeyboardStickyView offset={{ opened: safeArea.bottom }}>
                {betweenContentAndInput}
                {input}
            </KeyboardStickyView>
        </View>
    );
});

// const FallbackKeyboardAvoidingView: React.FC<AgentContentViewProps> = React.memo(({
//     children,
// }) => {
    
// });
