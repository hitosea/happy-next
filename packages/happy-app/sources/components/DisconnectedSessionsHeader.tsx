import * as React from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Text } from '@/components/StyledText';
import { Typography } from '@/constants/Typography';
import { Modal } from '@/modal';
import { useHappyAction } from '@/hooks/useHappyAction';
import { HappyError } from '@/utils/errors';
import { sessionArchive } from '@/sync/ops';
import { sync } from '@/sync/sync';
import type { Session } from '@/sync/storageTypes';
import { t } from '@/text';

/**
 * Heads the sessions that went offline without being ended (see isSessionDisconnected). They stay
 * listed until resumed or archived, so this is where they are archived together.
 */
export const DisconnectedSessionsHeader = React.memo(({ sessions }: { sessions: Session[] }) => {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const sessionsRef = React.useRef(sessions);
    sessionsRef.current = sessions;

    const [archiving, archiveAll] = useHappyAction(async () => {
        const ids = sessionsRef.current.map(session => session.id);
        const results = await Promise.allSettled(ids.map(async id => {
            const result = await sessionArchive(id);
            if (!result.success && !/RPC method not available/i.test(result.message ?? '')) throw new Error(result.message);
            await sync.clearSessionMessageCache(id);
        }));
        const failed = results.filter(result => result.status === 'rejected').length;
        if (failed > 0) throw new HappyError(t('sessionScope.archiveAllDisconnectedFailed', { count: failed }), false);
    }, { timeoutMs: 180_000 });

    const handlePress = React.useCallback(async () => {
        const confirmed = await Modal.confirm(
            t('sessionScope.archiveAllDisconnectedTitle'),
            t('sessionScope.archiveAllDisconnectedMessage', { count: sessionsRef.current.length }),
            { confirmText: t('sessionScope.archiveAllDisconnected'), destructive: true },
        );
        if (confirmed) archiveAll();
    }, [archiveAll]);

    return (
        <View style={styles.container}>
            <Text style={styles.title} selectable={false}>{t('sessionScope.disconnectedSessions')}</Text>
            <Text style={styles.count} selectable={false}>{sessions.length}</Text>
            <View style={styles.spacer} />
            {archiving ? (
                <ActivityIndicator size="small" color={theme.colors.textSecondary} />
            ) : (
                <Pressable onPress={handlePress} hitSlop={8} accessibilityRole="button">
                    <Text style={styles.action} selectable={false}>{t('sessionScope.archiveAllDisconnected')}</Text>
                </Pressable>
            )}
        </View>
    );
});

const stylesheet = StyleSheet.create((theme) => ({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingTop: 12,
        paddingBottom: 4,
    },
    title: {
        fontSize: 12,
        color: theme.colors.textSecondary,
        ...Typography.default('medium'),
    },
    count: {
        marginLeft: 6,
        fontSize: 12,
        color: theme.colors.textSecondary,
        ...Typography.default(),
    },
    spacer: {
        flex: 1,
    },
    action: {
        fontSize: 12,
        color: theme.colors.textLink,
        ...Typography.default('medium'),
    },
}));
