import * as React from 'react';
import { View, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/StyledText';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';
import { LanguageDot } from './LanguageDot';
import { PressableCard } from './PressableCard';
import { IssueIcon } from './IssueIcon';
import { ReanimatedProgress } from './ReanimatedProgress';
import { formatNumber, formatTimeAgo } from '@/data/repoUtils';

export interface RepoCardData {
    fullName: string;
    description?: string;
    language?: string;
    stars?: number;
    forks?: number;
    openIssuesCount?: number;
    isPrivate?: boolean;
    updatedAt?: string;
    viewerHasStarred?: boolean;
}

interface RepoCardProps {
    data: RepoCardData;
    onPress?: () => void;
    showDivider?: boolean;
    /** Creating state */
    creating?: boolean;
    creatingProgress?: number;
    creatingStepLabel?: string;
}

export const RepoCard = React.memo<RepoCardProps>(({
    data, onPress, showDivider = true, creating, creatingProgress = 0, creatingStepLabel,
}) => {
    const styles = stylesheet;
    const { theme } = useUnistyles();

    const content = (
        <View style={styles.inner}>
            <View style={styles.nameRow}>
                <Text style={styles.repoName} numberOfLines={1}>{data.fullName}</Text>
                {creating ? (
                    <View style={styles.statePill}>
                        <View style={[styles.stateDot, { backgroundColor: theme.colors.repo.pilotRunning }]} />
                        <Text style={styles.statePillText}>Creating</Text>
                    </View>
                ) : (
                    <View style={styles.visibilityBadge}>
                        <Text style={styles.visibilityText}>
                            {data.isPrivate ? 'Private' : 'Public'}
                        </Text>
                    </View>
                )}
            </View>

            <Text style={styles.description} numberOfLines={1}>
                {data.description || ' '}
            </Text>

            {creating ? (
                <View style={styles.progressWrap}>
                    <ReanimatedProgress progress={creatingProgress / 100} height={4} />
                    {creatingStepLabel ? (
                        <Text style={styles.creatingStep}>{creatingStepLabel}</Text>
                    ) : null}
                </View>
            ) : (
                <View style={styles.metaRow}>
                    {data.language ? <LanguageDot language={data.language} showLabel /> : null}
                    {typeof data.stars === 'number' ? (
                        <View style={styles.metaItem}>
                            <Ionicons
                                name={data.viewerHasStarred ? 'star' : 'star-outline'}
                                size={13}
                                color={data.viewerHasStarred ? theme.colors.repo.starFilled : theme.colors.textSecondary}
                            />
                            <Text style={styles.metaText}>{formatNumber(data.stars)}</Text>
                        </View>
                    ) : null}
                    {typeof data.forks === 'number' ? (
                        <View style={styles.metaItem}>
                            <Ionicons name="git-network-outline" size={13} color={theme.colors.textSecondary} />
                            <Text style={styles.metaText}>{formatNumber(data.forks)}</Text>
                        </View>
                    ) : null}
                    <View style={styles.metaItem}>
                        <IssueIcon size={13} color={theme.colors.textSecondary} />
                        <Text style={styles.metaText}>{formatNumber(data.openIssuesCount ?? 0)}</Text>
                    </View>
                    {data.updatedAt ? (
                        <Text style={[styles.metaText, styles.timeText]}>
                            {formatTimeAgo(data.updatedAt)}
                        </Text>
                    ) : null}
                </View>
            )}
        </View>
    );

    const inner = (
        <>
            {content}
            {showDivider ? <View style={styles.divider} /> : null}
        </>
    );

    if (creating || !onPress) {
        return <View style={styles.card}>{inner}</View>;
    }
    return (
        <PressableCard onPress={onPress} style={styles.card}>
            {inner}
        </PressableCard>
    );
});
RepoCard.displayName = 'RepoCard';

const stylesheet = StyleSheet.create((theme) => ({
    card: {
        backgroundColor: theme.colors.surface,
        borderLeftWidth: 1,
        borderRightWidth: 1,
        borderColor: theme.colors.divider,
    },
    inner: {
        paddingHorizontal: 16,
        paddingVertical: 12,
    },
    nameRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    repoName: {
        flex: 1,
        fontSize: 15,
        color: theme.colors.textLink,
        ...Typography.default('semiBold'),
    },
    visibilityBadge: {
        paddingHorizontal: 7,
        paddingVertical: 2,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: theme.colors.divider,
    },
    visibilityText: {
        fontSize: 10,
        color: theme.colors.textSecondary,
        fontWeight: '600',
    },
    statePill: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 999,
        backgroundColor: theme.colors.repo.pilotRunning + '1F',
    },
    stateDot: {
        width: 6,
        height: 6,
        borderRadius: 3,
    },
    statePillText: {
        fontSize: 11,
        color: theme.colors.repo.pilotRunning,
        fontWeight: '600',
    },
    description: {
        marginTop: 4,
        fontSize: 13,
        color: theme.colors.textSecondary,
        lineHeight: 18,
    },
    progressWrap: {
        marginTop: 8,
    },
    metaRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 6,
        gap: 14,
    },
    metaItem: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 3,
    },
    metaText: {
        fontSize: 12,
        color: theme.colors.textSecondary,
    },
    timeText: {
        marginLeft: 'auto',
    },
    creatingStep: {
        marginTop: 6,
        fontSize: 11,
        color: theme.colors.textSecondary,
    },
    divider: {
        height: Platform.select({ ios: 0.33, default: 1 }),
        backgroundColor: theme.colors.divider,
    },
}));
