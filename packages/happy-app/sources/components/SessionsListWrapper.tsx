import * as React from 'react';
import { View, ActivityIndicator } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { SessionsList } from './SessionsList';
import { EmptyMainScreen } from './EmptyMainScreen';
import { useSessionListScope } from '@/hooks/useSessionListScope';

const stylesheet = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
    },
    loadingContainerWrapper: {
        flex: 1,
        flexBasis: 0,
        flexGrow: 1,
        backgroundColor: theme.colors.groupped.background,
    },
    loadingContainer: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingBottom: 32,
    },
    emptyStateContainer: {
        flex: 1,
        flexBasis: 0,
        flexGrow: 1,
        flexDirection: 'column',
        backgroundColor: theme.colors.groupped.background,
    },
    emptyStateContentContainer: {
        flex: 1,
        flexBasis: 0,
        flexGrow: 1,
    },
}));

export const SessionsListWrapper = React.memo(() => {
    const { theme } = useUnistyles();
    const { data: sessionListViewData, disconnectedSessions, switchable } = useSessionListScope();
    const styles = stylesheet;

    if (sessionListViewData === null) {
        return (
            <View style={styles.container}>
                <View style={styles.loadingContainerWrapper}>
                    <View style={styles.loadingContainer}>
                        <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                    </View>
                </View>
            </View>
        );
    }

    // With machines to switch between the list stays, so the machine switcher's views remain reachable.
    // The list holds live sessions only: disconnected ones, listed below them, keep it too.
    if (sessionListViewData.length === 0 && disconnectedSessions.length === 0 && !switchable) {
        return (
            <View style={styles.container}>
                <View style={styles.emptyStateContainer}>
                    <View style={styles.emptyStateContentContainer}>
                        <EmptyMainScreen />
                    </View>
                </View>
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <SessionsList />
        </View>
    );
});