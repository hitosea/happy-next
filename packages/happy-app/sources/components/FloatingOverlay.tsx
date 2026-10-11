import * as React from 'react';
import { Platform, NativeSyntheticEvent, NativeScrollEvent, LayoutChangeEvent, ScrollView } from 'react-native';
import Animated from 'react-native-reanimated';
import { StyleSheet } from 'react-native-unistyles';
import { computeScrollIntoView } from './scrollIntoView';

const stylesheet = StyleSheet.create((theme, runtime) => ({
    container: {
        borderRadius: 12,
        overflow: 'hidden',
        backgroundColor: theme.colors.surface,
        borderWidth: Platform.OS === 'web' ? 0 : 0.5,
        borderColor: theme.colors.modal.border,
        shadowColor: theme.colors.shadow.color,
        shadowOffset: { width: 0, height: 2 },
        shadowRadius: 3.84,
        shadowOpacity: theme.colors.shadow.opacity,
        elevation: 5,
    },
}));

interface FloatingOverlayProps {
    children: React.ReactNode;
    maxHeight?: number;
    showScrollIndicator?: boolean;
    /**
     * Defaults to true. When false the overlay is only the clamped, rounded surface and does not scroll:
     * the children manage their own scrolling, so fixed rows (tabs, footers) stay in place.
     */
    scrollable?: boolean;
    keyboardShouldPersistTaps?: boolean | 'always' | 'never' | 'handled';
    /**
     * When provided (together with `itemHeight`), the overlay keeps the item at
     * `selectedIndex` scrolled into view as it changes — used for keyboard
     * navigation of lists that overflow `maxHeight`.
     */
    selectedIndex?: number;
    /** Fixed height of each row, required for `selectedIndex` scroll-into-view. */
    itemHeight?: number;
}

export const FloatingOverlay = React.memo((props: FloatingOverlayProps) => {
    const styles = stylesheet;
    const {
        children,
        maxHeight = 240,
        showScrollIndicator = false,
        scrollable = true,
        keyboardShouldPersistTaps = 'handled',
        selectedIndex,
        itemHeight,
    } = props;

    const scrollRef = React.useRef<ScrollView>(null);
    const scrollYRef = React.useRef(0);
    const viewportHeightRef = React.useRef(maxHeight);

    React.useEffect(() => {
        if (selectedIndex === undefined || itemHeight === undefined) {
            return;
        }
        const nextY = computeScrollIntoView({
            selectedIndex,
            itemHeight,
            currentScrollY: scrollYRef.current,
            viewportHeight: viewportHeightRef.current || maxHeight,
        });
        if (nextY !== null) {
            scrollRef.current?.scrollTo({ y: nextY, animated: true });
        }
    }, [selectedIndex, itemHeight, maxHeight]);

    if (!scrollable) {
        return (
            <Animated.View style={[styles.container, { maxHeight }]}>
                {children}
            </Animated.View>
        );
    }

    return (
        <Animated.View style={[styles.container, { maxHeight }]}>
            <Animated.ScrollView
                ref={scrollRef}
                style={{ maxHeight }}
                keyboardShouldPersistTaps={keyboardShouldPersistTaps}
                showsVerticalScrollIndicator={showScrollIndicator}
                scrollEventThrottle={16}
                onScroll={(e: NativeSyntheticEvent<NativeScrollEvent>) => {
                    scrollYRef.current = e.nativeEvent.contentOffset.y;
                }}
                onLayout={(e: LayoutChangeEvent) => {
                    viewportHeightRef.current = e.nativeEvent.layout.height;
                }}
            >
                {children}
            </Animated.ScrollView>
        </Animated.View>
    );
});