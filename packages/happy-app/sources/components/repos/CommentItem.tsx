import * as React from 'react';
import { View, Pressable, Platform } from 'react-native';
import { Image } from 'expo-image';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Text } from '@/components/StyledText';
import { Avatar } from '@/components/Avatar';
import { MarkdownView } from '@/components/markdown/MarkdownView';
import { formatTimeAgo, formatAbsoluteTime } from '@/data/repoUtils';
import type { RepoIssueComment } from '@/data/mockRepos';

const ASSOCIATION_LABELS: Record<string, string> = {
    OWNER: 'Owner',
    MEMBER: 'Member',
    COLLABORATOR: 'Collaborator',
    CONTRIBUTOR: 'Contributor',
};

interface CommentItemProps {
    comment: RepoIssueComment;
    issueAuthor?: string;
    onLongPress?: () => void;
}

export function CommentItem({ comment, issueAuthor, onLongPress }: CommentItemProps) {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const [showAbsolute, setShowAbsolute] = React.useState(false);
    const roleBadge = ASSOCIATION_LABELS[comment.authorAssociation];
    const isAuthor = issueAuthor && comment.author === issueAuthor;

    const inner = (
        <>
            <View style={styles.commentHeader}>
                {comment.authorAvatarUrl ? (
                    <Image
                        source={{ uri: comment.authorAvatarUrl }}
                        style={{ width: 32, height: 32, borderRadius: 16 }}
                        contentFit="cover"
                    />
                ) : (
                    <Avatar id={comment.author} size={32} />
                )}
                <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <Text style={styles.commentAuthor}>{comment.author}</Text>
                        {isAuthor && (
                            <View style={[styles.badge, { borderColor: theme.colors.divider }]}>
                                <Text style={[styles.badgeText, { color: theme.colors.textSecondary }]}>Author</Text>
                            </View>
                        )}
                        {roleBadge && (
                            <View style={[styles.badge, { borderColor: theme.colors.divider }]}>
                                <Text style={[styles.badgeText, { color: theme.colors.textSecondary }]}>{roleBadge}</Text>
                            </View>
                        )}
                    </View>
                    <Pressable onPress={() => setShowAbsolute((v) => !v)} hitSlop={6}>
                        <Text style={styles.commentTimestamp}>
                            {showAbsolute ? formatAbsoluteTime(comment.createdAt) : formatTimeAgo(comment.createdAt)}
                        </Text>
                    </Pressable>
                </View>
            </View>
            <View style={styles.commentBody}>
                {comment.body ? (
                    <MarkdownView markdown={comment.body} hideOptions />
                ) : (
                    <Text style={styles.commentBodyEmpty}>—</Text>
                )}
            </View>
        </>
    );

    if (onLongPress) {
        return (
            <Pressable onLongPress={onLongPress} style={styles.commentItem}>
                {inner}
            </Pressable>
        );
    }
    return <View style={styles.commentItem}>{inner}</View>;
}

const stylesheet = StyleSheet.create((theme) => ({
    commentItem: {
        paddingVertical: 14,
        borderBottomWidth: Platform.select({ ios: 0.33, default: 1 }) as number,
        borderBottomColor: theme.colors.divider,
        gap: 10,
    },
    commentHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    commentAuthor: {
        fontSize: 14,
        fontWeight: '600',
        color: theme.colors.text,
    },
    commentTimestamp: {
        fontSize: 12,
        color: theme.colors.textSecondary,
        marginTop: 1,
    },
    commentBody: {
        paddingLeft: 42,
    },
    commentBodyEmpty: {
        fontSize: 13,
        fontStyle: 'italic',
        color: theme.colors.textSecondary,
    },
    badge: {
        borderWidth: 1,
        borderRadius: 999,
        paddingHorizontal: 6,
        paddingVertical: 1,
    },
    badgeText: {
        fontSize: 10,
        fontWeight: '600',
    },
}));
