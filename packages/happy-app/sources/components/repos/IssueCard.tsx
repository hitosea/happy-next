import * as React from 'react';
import { View, Platform } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/StyledText';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';
import { PressableCard } from './PressableCard';
import { IssueIcon } from './IssueIcon';
import { formatTimeAgo } from '@/data/repoUtils';

export interface IssueCardData {
    number: number;
    title: string;
    state: 'open' | 'closed';
    author: string;
    authorAvatarUrl?: string;
    createdAt: string;
    labels?: { name: string; color: string }[];
    linkedPR?: number;
}

interface IssueCardProps {
    data: IssueCardData;
    onPress?: () => void;
    /** rendered inline right of AI badge */
    rightAction?: React.ReactNode;
    showDivider?: boolean;
}

export const IssueCard = React.memo<IssueCardProps>(({ data, onPress, rightAction, showDivider }) => {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const iconColor = data.state === 'open' ? theme.colors.repo.stateOpen : theme.colors.repo.stateClosed;
    return (
        <PressableCard onPress={onPress} style={styles.pressable}>
            <View style={styles.row}>
                <View style={styles.iconCol}>
                    {data.state === 'open'
                        ? <IssueIcon size={16} color={iconColor} />
                        : <Ionicons name="checkmark-circle-outline" size={18} color={iconColor} allowFontScaling={false} />
                    }
                </View>
                <View style={styles.body}>
                    <View style={styles.titleRow}>
                        <Text style={styles.title} numberOfLines={2}>{data.title}</Text>
                    </View>
                    {data.labels && data.labels.length > 0 ? (
                        <View style={styles.labels}>
                            {data.labels.slice(0, 4).map((l) => (
                                <View
                                    key={l.name}
                                    style={[styles.label, {
                                        backgroundColor: l.color + '22',
                                        borderColor: l.color + '66',
                                    }]}
                                >
                                    <Text style={[styles.labelText, { color: l.color }]}>{l.name}</Text>
                                </View>
                            ))}
                        </View>
                    ) : null}
                    <View style={styles.metaRow}>
                        {data.authorAvatarUrl ? (
                            <Image
                                source={{ uri: data.authorAvatarUrl }}
                                style={{ width: 14, height: 14, borderRadius: 7 }}
                                contentFit="cover"
                            />
                        ) : null}
                        <Text style={styles.meta} numberOfLines={1}>
                            #{data.number} · @{data.author} · {formatTimeAgo(data.createdAt)}
                        </Text>
                        {data.linkedPR ? (
                            <View style={styles.prLink}>
                                <Ionicons name="git-pull-request-outline" size={11} color={theme.colors.repo.stateMerged} allowFontScaling={false} />
                                <Text style={[styles.meta, { color: theme.colors.repo.stateMerged }]}>#{data.linkedPR}</Text>
                            </View>
                        ) : null}
                    </View>
                </View>
                <View style={styles.actionCol}>
                    {rightAction}
                </View>
            </View>
            {showDivider ? <View style={styles.divider} /> : null}
        </PressableCard>
    );
});
IssueCard.displayName = 'IssueCard';

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
        width: 18,
        paddingTop: 2,
        alignItems: 'center',
    },
    body: {
        flex: 1,
        gap: 6,
    },
    titleRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    title: {
        flex: 1,
        fontSize: 15,
        color: theme.colors.text,
        ...Typography.default('semiBold'),
        lineHeight: 20,
    },
    labels: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 6,
        marginTop: 4,
    },
    label: {
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 999,
        borderWidth: 1,
    },
    labelText: {
        fontSize: 11,
        fontWeight: '600',
    },
    metaRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginTop: 2,
    },
    meta: {
        fontSize: 12,
        color: theme.colors.textSecondary,
    },
    prLink: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 3,
    },
    actionCol: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        marginLeft: 4,
    },
    divider: {
        height: Platform.select({ ios: 0.33, default: 1 }),
        backgroundColor: theme.colors.divider,
        marginLeft: 44,
    },
}));
