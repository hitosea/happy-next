import * as React from 'react';
import { View, Pressable, ActivityIndicator, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Text } from '@/components/StyledText';
import { Avatar } from '@/components/Avatar';
import { ProjectLabelText } from '@/components/ProjectLabelText';
import { StatusDot } from '@/components/StatusDot';
import { Typography } from '@/constants/Typography';
import type { Session } from '@/sync/storageTypes';
import { useSessionProjectLabel } from '@/hooks/useSessionProjectLabel';
import type { SessionForkMode } from '@/hooks/useSessionFork';
import { getSessionAvatarId, getSessionName, useSessionStatus } from '@/utils/sessionUtils';

/**
 * A past session's row in the session history (and a machine's recent sessions): avatar, name,
 * project and status, with resume (ended) or copy (running) beside it while that is possible.
 * `isFirst` / `isLast` / `isSingle` round the corners of a run of rows standing on their own.
 */
export const SessionHistoryCard = React.memo(({ session, isFirst, isLast, isSingle, isResuming, onPress, onFork, style }: {
    session: Session;
    isFirst?: boolean;
    isLast?: boolean;
    isSingle?: boolean;
    isResuming: boolean;
    onPress: () => void;
    onFork: (session: Session, mode: SessionForkMode) => void;
    style?: StyleProp<ViewStyle>;
}) => {
    const { theme } = useUnistyles();
    const sessionStatus = useSessionStatus(session);
    const sessionName = getSessionName(session);
    const sessionSubtitle = useSessionProjectLabel(session);
    const avatarId = getSessionAvatarId(session);
    const canFork = Boolean(session.metadata?.claudeSessionId || session.metadata?.flavor === 'gemini' || session.metadata?.codexSessionId || session.metadata?.qoderSessionId);
    const isOnline = session.active;

    return (
        <Pressable
            style={[
                styles.sessionCard,
                isSingle ? styles.sessionCardSingle :
                isFirst ? styles.sessionCardFirst :
                isLast ? styles.sessionCardLast : {},
                style,
            ]}
            onPress={onPress}
        >
            <Avatar id={avatarId} size={48} monochrome={!sessionStatus.isConnected} flavor={session.metadata?.flavor} sessionIcon={session.metadata?.sessionIcon} />
            <View style={styles.sessionContent}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    {sessionStatus.hasUnreadCompletion && (
                        <View style={styles.unreadDot} />
                    )}
                    <Text style={[styles.sessionTitle, { flex: 1 }]} numberOfLines={1}>
                        {sessionName}
                    </Text>
                </View>
                <ProjectLabelText label={sessionSubtitle} style={styles.sessionSubtitle} />
                <View style={styles.statusRow}>
                    <View style={styles.statusDotContainer}>
                        <StatusDot color={sessionStatus.statusDotColor} isPulsing={sessionStatus.isPulsing} />
                    </View>
                    <Text style={[styles.statusText, { color: sessionStatus.statusColor }]}>
                        {sessionStatus.statusText}
                    </Text>
                </View>
            </View>
            <View style={styles.rightSection}>
                {canFork && !isResuming && (
                    <Pressable
                        style={styles.playButton}
                        onPress={(event) => {
                            event.stopPropagation?.();
                            onFork(session, isOnline ? 'copy' : 'resume');
                        }}
                    >
                        <Ionicons
                            name={isOnline ? "copy-outline" : "play-circle-outline"}
                            size={isOnline ? 22 : 29}
                            color={theme.colors.groupped.chevron}
                        />
                    </Pressable>
                )}
                {isResuming && (
                    <View style={styles.playButton}>
                        <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                    </View>
                )}
            </View>
        </Pressable>
    );
});

const styles = StyleSheet.create((theme) => ({
    sessionCard: {
        backgroundColor: theme.colors.surface,
        marginHorizontal: 16,
        marginBottom: 1,
        paddingVertical: 16,
        paddingHorizontal: 16,
        flexDirection: 'row',
        alignItems: 'center',
    },
    sessionCardFirst: {
        borderTopLeftRadius: 12,
        borderTopRightRadius: 12,
    },
    sessionCardLast: {
        borderBottomLeftRadius: 12,
        borderBottomRightRadius: 12,
        marginBottom: 12,
    },
    sessionCardSingle: {
        borderRadius: 12,
        marginBottom: 12,
    },
    sessionContent: {
        flex: 1,
        marginLeft: 16,
    },
    sessionTitle: {
        fontSize: 15,
        fontWeight: '500',
        color: theme.colors.text,
        marginBottom: 2,
        ...Typography.default('semiBold'),
    },
    sessionSubtitle: {
        fontSize: 13,
        color: theme.colors.textSecondary,
        ...Typography.default(),
    },
    rightSection: {
        flexDirection: 'row',
        alignItems: 'center',
        marginLeft: 8,
    },
    playButton: {
        width: 29,
        height: 29,
        alignItems: 'center',
        justifyContent: 'center',
    },
    statusRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 4,
    },
    statusDotContainer: {
        alignItems: 'center',
        justifyContent: 'center',
        height: 16,
        marginRight: 4,
    },
    statusText: {
        fontSize: 12,
        fontWeight: '500',
        lineHeight: 16,
        ...Typography.default(),
    },
    unreadDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: '#007AFF',
        marginRight: 6,
    },
}));
