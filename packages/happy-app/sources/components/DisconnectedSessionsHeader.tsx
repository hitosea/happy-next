import * as React from 'react';
import { Platform, Pressable, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { Text } from '@/components/StyledText';
import { Typography } from '@/constants/Typography';
import { Modal } from '@/modal';
import { archiveSessionFromApp } from '@/sync/archiveSessionFromApp';
import type { Session } from '@/sync/storageTypes';
import { t } from '@/text';

/**
 * Heads the sessions that went offline without being ended (see isSessionDisconnected). They stay
 * listed until resumed or archived, so this is where they are archived together.
 */
export const DisconnectedSessionsHeader = React.memo(({ sessions }: { sessions: Session[] }) => {
    const styles = stylesheet;
    const handlePress = React.useCallback(async () => {
        const confirmed = await Modal.confirm(
            t('sessionScope.archiveAllDisconnectedTitle'),
            t('sessionScope.archiveAllDisconnectedMessage', { count: sessions.length }),
            { confirmText: t('sessionScope.archiveAllDisconnected'), destructive: true },
        );
        if (confirmed) void archiveAll(sessions);
    }, [sessions]);

    return (
        <View style={styles.container}>
            <Text style={styles.title} selectable={false}>{t('sessionScope.disconnectedSessions')}</Text>
            <Text style={[styles.title, styles.count]} selectable={false}>{sessions.length}</Text>
            <View style={styles.spacer} />
            <Pressable
                onPress={handlePress}
                hitSlop={10}
                accessibilityRole="button"
                style={({ hovered, pressed }: any) => (hovered || pressed) && styles.actionPressed}
            >
                <Text style={styles.title} selectable={false}>{t('sessionScope.archiveAllDisconnected')}</Text>
            </Pressable>
        </View>
    );
});

// Not tied to the header: the sessions leave the block as their archive starts, which unmounts it.
// Native (Codex) history may stay put while the machine is away; the sessions still archive.
async function archiveAll(sessions: Session[]) {
    const results = await Promise.allSettled(sessions.map(session => archiveSessionFromApp(session)));
    const failed = results.filter(result => result.status === 'rejected').length;
    if (failed > 0) {
        Modal.alert(t('common.error'), t('sessionScope.archiveAllDisconnectedFailed', { count: failed }), [{ text: t('common.ok'), style: 'cancel' }]);
    }
}

// Set like the list's section titles, the action too, as ItemGroup's headerAction is.
const stylesheet = StyleSheet.create((theme) => ({
    container: {
        height: 44,
        paddingHorizontal: 16,
        marginBottom: 2,
        flexDirection: 'row',
        alignItems: 'center',
    },
    title: {
        ...Typography.default('regular'),
        color: theme.colors.groupped.sectionTitle,
        fontSize: Platform.select({ ios: 13, default: 14 }),
        lineHeight: Platform.select({ ios: 18, default: 20 }),
        letterSpacing: Platform.select({ ios: -0.08, default: 0.1 }),
        fontWeight: Platform.select({ ios: 'normal', default: '500' }),
    },
    count: {
        marginLeft: 6,
    },
    spacer: {
        flex: 1,
    },
    actionPressed: {
        opacity: 0.6,
    },
}));
