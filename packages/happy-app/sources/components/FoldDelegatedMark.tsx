import * as React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { TextShimmer } from './TextShimmer';

/**
 * What a folded line says at its far end when a delegated task it hides is still running: the icon
 * the chat header wears once a conversation has delegations, and what the task was asked to do, the
 * title carrying the same band of light the line's snapshot has, or a spinner in its place when the
 * call carried no title. Only ever drawn where there is no snapshot.
 *
 * The icon is what keeps this from reading as the turn still going. The line's duration has stopped
 * with the turn and the task runs on without it, so the far end has to say it is a different thing.
 */
export const FoldDelegatedMark = React.memo((props: { label: string | null }) => {
    const { theme } = useUnistyles();
    return (
        <View style={styles.row}>
            <Ionicons name="layers-outline" size={12} color={theme.colors.textSecondary} style={styles.icon} />
            {props.label ? (
                <TextShimmer
                    style={styles.label}
                    baseColor={theme.colors.textSecondary}
                    highlightColor={theme.colors.text}
                >
                    {props.label}
                </TextShimmer>
            ) : (
                <ActivityIndicator size="small" color={theme.colors.textSecondary} style={styles.spinner} />
            )}
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    // The same slot as a snapshot: the far end, giving way before the line's own label does.
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        flexShrink: 1,
        minWidth: 0,
        marginLeft: 'auto',
        paddingLeft: 12,
    },
    icon: {
        flexShrink: 0,
        opacity: 0.7,
    },
    label: {
        flexShrink: 1,
        minWidth: 0,
        fontSize: 12,
        color: theme.colors.textSecondary,
    },
    // Small enough not to change the height of the line.
    spinner: {
        transform: [{ scale: 0.6 }],
        height: 14,
    },
}));
