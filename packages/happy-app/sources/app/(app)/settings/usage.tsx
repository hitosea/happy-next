import React from 'react';
import { View, ScrollView, Platform } from 'react-native';
import { Stack } from 'expo-router';
import { UsagePanel } from '@/components/usage/UsagePanel';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { layout } from '@/components/layout';
import { t } from '@/text';
import { softHeaderOptions } from '@/components/navigation/softHeader';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const stylesheet = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        backgroundColor: theme.colors.groupped.background,
    },
    scrollContent: {
        alignItems: 'center',
    },
    contentWrapper: {
        width: '100%',
        maxWidth: layout.maxWidth,
    },
}));

export default function UsageSettingsScreen() {
    const styles = stylesheet;
    const safeArea = useSafeAreaInsets();

    return (
        <View style={styles.container}>
            <Stack.Screen
                options={{
                    ...softHeaderOptions,
                    headerTitle: t('settings.usage'),
                }}
            />
            <ScrollView
                style={{ flex: 1 }}
                contentInsetAdjustmentBehavior={Platform.OS === 'ios' ? 'automatic' : undefined}
                contentContainerStyle={[
                    styles.scrollContent,
                    { paddingBottom: safeArea.bottom + 20 }
                ]}
            >
                <View style={styles.contentWrapper}>
                    <UsagePanel />
                </View>
            </ScrollView>
        </View>
    );
}