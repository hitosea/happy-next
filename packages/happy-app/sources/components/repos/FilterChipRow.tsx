import * as React from 'react';
import { View, ScrollView, Pressable } from 'react-native';
import { Text } from '@/components/StyledText';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { hapticsLight } from '@/components/haptics';

interface FilterChipRowProps<T extends string> {
    filters: ReadonlyArray<{ key: T; label: string; count?: number }>;
    value: T;
    onChange: (key: T) => void;
    style?: any;
}

export function FilterChipRow<T extends string>({ filters, value, onChange, style }: FilterChipRowProps<T>) {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    return (
        <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.row}
            style={[styles.scroll, style]}
        >
            {filters.map(({ key, label, count }) => {
                const active = key === value;
                return (
                    <Pressable
                        key={key}
                        onPress={() => {
                            if (!active) {
                                hapticsLight();
                                onChange(key);
                            }
                        }}
                        style={[styles.chip, active && styles.chipActive, { alignSelf: 'center' }]}
                        hitSlop={6}
                    >
                        <Text style={[styles.chipText, active && styles.chipTextActive]}>
                            {label}
                            {typeof count === 'number' && count > 0 ? (
                                <Text style={[styles.chipCount, active && styles.chipTextActive]}>  {count}</Text>
                            ) : null}
                        </Text>
                    </Pressable>
                );
            })}
        </ScrollView>
    );
}

const stylesheet = StyleSheet.create((theme) => ({
    scroll: {
        flexGrow: 0,
        flexShrink: 0,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 16,
        paddingVertical: 10,
    },
    chip: {
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        backgroundColor: theme.colors.surface,
    },
    chipActive: {
        backgroundColor: theme.colors.button.primary.background,
        borderColor: theme.colors.button.primary.background,
    },
    chipText: {
        fontSize: 13,
        color: theme.colors.textSecondary,
        fontWeight: '500',
    },
    chipCount: {
        fontSize: 12,
        opacity: 0.7,
        fontWeight: '500',
    },
    chipTextActive: {
        color: theme.colors.button.primary.tint,
        fontWeight: '600',
    },
}));
