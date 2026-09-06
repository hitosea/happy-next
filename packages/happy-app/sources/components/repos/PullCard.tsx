import * as React from 'react';
import { View, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/StyledText';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';
import { PressableCard } from './PressableCard';
import { formatTimeAgo } from '@/data/repoUtils';
import { Avatar } from '@/components/Avatar';
import type { RepoState } from './StatePill';

export interface PullCardData {
    number: number;
    title: string;
    author: string;
    authorAvatarUrl: string;
    createdAt: string;
    mergedAt?: string;
    status: 'open' | 'closed' | 'merged';
    headRefName?: string;
    isDraft?: boolean;
}

interface PullCardProps {
    data: PullCardData;
    onPress?: () => void;
    showDivider?: boolean;
}

export const PullCard = React.memo<PullCardProps>(({ data, onPress, showDivider }) => {
    const styles = stylesheet;
    const { theme } = useUnistyles();

    const state: RepoState = data.isDraft ? 'draft' : data.status;
    const iconName: React.ComponentProps<typeof Ionicons>['name'] =
        state === 'merged' ? 'git-merge'
        : state === 'closed' ? 'close-circle'
        : state === 'draft' ? 'git-pull-request-outline'
        : 'git-pull-request';
    const iconColor =
        state === 'merged' ? theme.colors.repo.stateMerged
        : state === 'closed' ? theme.colors.repo.stateClosed
        : state === 'draft' ? theme.colors.repo.stateDraft
        : theme.colors.repo.stateOpen;

    return (
        <PressableCard onPress={onPress} style={styles.pressable}>
            <View style={styles.row}>
                <View style={styles.iconCol}>
                    <Ionicons name={iconName} size={16} color={iconColor} allowFontScaling={false} />
                </View>
                <View style={styles.body}>
                    <Text style={styles.title} numberOfLines={2}>{data.title}</Text>
                    <View style={styles.metaRow}>
                        <Avatar id={data.author} size={14} imageUrl={data.authorAvatarUrl} />
                        <Text style={styles.meta} numberOfLines={1}>
                            #{data.number} · @{data.author} · {formatTimeAgo(data.mergedAt ?? data.createdAt)}
                        </Text>
                        {data.headRefName ? (
                            <View style={styles.branchPill}>
                                <Ionicons name="git-branch" size={10} color={theme.colors.textSecondary} allowFontScaling={false} />
                                <Text style={styles.branchText} numberOfLines={1}>{data.headRefName}</Text>
                            </View>
                        ) : null}
                    </View>
                </View>
            </View>
            {showDivider ? <View style={styles.divider} /> : null}
        </PressableCard>
    );
});
PullCard.displayName = 'PullCard';

const stylesheet = StyleSheet.create((theme) => ({
    pressable: {
        backgroundColor: theme.colors.surface,
    },
    row: {
        flexDirection: 'row',
        paddingHorizontal: 14,
        paddingVertical: 12,
        gap: 10,
    },
    iconCol: {
        width: 16,
        paddingTop: 3,
        alignItems: 'center',
    },
    body: {
        flex: 1,
        gap: 6,
    },
    title: {
        fontSize: 15,
        color: theme.colors.text,
        ...Typography.default('semiBold'),
        lineHeight: 20,
    },
    metaRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        flexWrap: 'wrap',
    },
    meta: {
        fontSize: 12,
        color: theme.colors.textSecondary,
    },
    branchPill: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 6,
        backgroundColor: theme.colors.repo.codeBg,
        borderWidth: 1,
        borderColor: theme.colors.repo.codeBorder,
        maxWidth: 140,
    },
    branchText: {
        fontSize: 11,
        color: theme.colors.textSecondary,
        fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
    },
    divider: {
        height: Platform.select({ ios: 0.33, default: 1 }),
        backgroundColor: theme.colors.divider,
        marginLeft: 44,
    },
}));
