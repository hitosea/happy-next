import * as React from 'react';
import { View, TextInput, Pressable, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';
import Animated, { useSharedValue, useAnimatedStyle, withTiming } from 'react-native-reanimated';

interface RepoSearchBarProps {
    value: string;
    onChange: (text: string) => void;
    placeholder?: string;
    /** When true, the search input is rendered inline below the title, taking full width. */
    expanded: boolean;
    onExpand: () => void;
    onCollapse: () => void;
    cancelLabel?: string;
}

export const RepoSearchBar = React.memo<RepoSearchBarProps>(({ value, onChange, placeholder, expanded, onExpand, onCollapse, cancelLabel = 'Cancel' }) => {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const inputRef = React.useRef<TextInput>(null);
    const opacity = useSharedValue(expanded ? 1 : 0);

    React.useEffect(() => {
        opacity.value = withTiming(expanded ? 1 : 0, { duration: 200 });
        if (expanded) {
            const t = setTimeout(() => inputRef.current?.focus(), 80);
            return () => clearTimeout(t);
        }
    }, [expanded, opacity]);

    const animatedStyle = useAnimatedStyle(() => ({
        opacity: opacity.value,
    }));

    if (!expanded) {
        return (
            <Pressable onPress={onExpand} hitSlop={8} style={styles.searchIconWrap}>
                <Ionicons name="search" size={20} color={theme.colors.header.tint} />
            </Pressable>
        );
    }

    return (
        <Animated.View style={[styles.container, animatedStyle]}>
            <View style={styles.inputWrap}>
                <Ionicons name="search" size={15} color={theme.colors.textSecondary} />
                <TextInput
                    ref={inputRef}
                    style={styles.input}
                    placeholder={placeholder}
                    placeholderTextColor={theme.colors.input.placeholder}
                    value={value}
                    onChangeText={onChange}
                    autoCorrect={false}
                    autoCapitalize="none"
                    returnKeyType="search"
                />
                {value.length > 0 ? (
                    <Pressable onPress={() => onChange('')} hitSlop={8}>
                        <Ionicons name="close-circle" size={16} color={theme.colors.textSecondary} />
                    </Pressable>
                ) : null}
            </View>
            <Pressable
                onPress={() => {
                    onChange('');
                    onCollapse();
                }}
                hitSlop={8}
                style={styles.cancelBtn}
            >
                <Animated.Text style={styles.cancelText}>{cancelLabel}</Animated.Text>
            </Pressable>
        </Animated.View>
    );
});
RepoSearchBar.displayName = 'RepoSearchBar';

const stylesheet = StyleSheet.create((theme) => ({
    searchIconWrap: {
        paddingHorizontal: 8,
    },
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 12,
        paddingVertical: 8,
        backgroundColor: theme.colors.header.background,
    },
    inputWrap: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 10,
        paddingVertical: Platform.select({ ios: 7, default: 4 }),
        borderRadius: 10,
        backgroundColor: theme.colors.surfaceHighest,
    },
    input: {
        flex: 1,
        fontSize: 15,
        color: theme.colors.text,
        padding: 0,
        ...Typography.default('regular'),
    },
    cancelBtn: {
        paddingHorizontal: 4,
    },
    cancelText: {
        fontSize: 15,
        color: theme.colors.textLink,
        ...Typography.default('regular'),
    },
}));
