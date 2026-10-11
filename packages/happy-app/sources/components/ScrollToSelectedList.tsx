import * as React from 'react';
import { ScrollView, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent, type StyleProp, type ViewStyle } from 'react-native';

export type ItemLayoutHandler = (value: string, y: number, height: number) => void;

interface ScrollToSelectedListProps {
    selectedValue: string | null;
    /** Renders the rows; each row reports its layout through `onItemLayout`. */
    renderItems: (onItemLayout: ItemLayoutHandler) => React.ReactNode;
    style?: StyleProp<ViewStyle>;
    contentContainerStyle?: StyleProp<ViewStyle>;
}

const EDGE = 8;

/**
 * A scroll list that keeps its selected row in view: on mount, when the selection changes, and when
 * the viewport changes size (a footer row appearing or going away). A list that is re-created or
 * resized by a neighbouring section would otherwise lose or shift its position and hide the choice.
 */
export const ScrollToSelectedList = React.memo((props: ScrollToSelectedListProps) => {
    const { selectedValue, renderItems, style, contentContainerStyle } = props;
    const scrollRef = React.useRef<ScrollView>(null);
    const scrollYRef = React.useRef(0);
    const viewportRef = React.useRef(0);
    const layoutsRef = React.useRef(new Map<string, { y: number; height: number }>());
    // Set until the selected row has been revealed once; row layouts can arrive after the mount.
    const pendingRevealRef = React.useRef(true);

    const ensureVisible = React.useCallback(() => {
        const item = selectedValue === null ? undefined : layoutsRef.current.get(selectedValue);
        const viewport = viewportRef.current;
        if (!item || viewport === 0) return;
        const top = scrollYRef.current;
        let next: number | null = null;
        if (item.y < top + EDGE) {
            next = Math.max(0, item.y - EDGE);
        } else if (item.y + item.height > top + viewport - EDGE) {
            next = item.y + item.height - viewport + EDGE;
        }
        pendingRevealRef.current = false;
        if (next !== null) {
            scrollYRef.current = next;
            scrollRef.current?.scrollTo({ y: next, animated: false });
        }
    }, [selectedValue]);

    React.useEffect(() => {
        pendingRevealRef.current = true;
        ensureVisible();
    }, [ensureVisible]);

    const handleItemLayout = React.useCallback<ItemLayoutHandler>((value, y, height) => {
        layoutsRef.current.set(value, { y, height });
        if (pendingRevealRef.current && value === selectedValue) ensureVisible();
    }, [selectedValue, ensureVisible]);

    return (
        <ScrollView
            ref={scrollRef}
            style={style}
            contentContainerStyle={contentContainerStyle}
            keyboardShouldPersistTaps="always"
            scrollEventThrottle={16}
            onScroll={(e: NativeSyntheticEvent<NativeScrollEvent>) => {
                scrollYRef.current = e.nativeEvent.contentOffset.y;
            }}
            onLayout={(e: LayoutChangeEvent) => {
                viewportRef.current = e.nativeEvent.layout.height;
                ensureVisible();
            }}
        >
            {renderItems(handleItemLayout)}
        </ScrollView>
    );
});
ScrollToSelectedList.displayName = 'ScrollToSelectedList';
