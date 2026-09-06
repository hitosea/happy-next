import * as React from 'react';
import { View, ScrollView } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Text } from '@/components/StyledText';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';
import { layout } from '@/components/layout';
import { HtmlContent } from '@/components/dootask/HtmlContent';
import { Item } from '@/components/Item';
import { ItemGroup } from '@/components/ItemGroup';
import { Avatar } from '@/components/Avatar';
import {
    useGithubRepo,
} from '@/hooks/useGithubData';
import { formatTimeAgo, formatNumber, getLanguageColor } from '@/data/repoUtils';
import { storage } from '@/sync/storage';
import { useShallow } from 'zustand/react/shallow';
import type { Session } from '@/sync/storageTypes';
import type { RegisteredRepo } from '@/utils/workspaceRepos';
import { matchesGithubRepo } from '@/utils/workspaceRepos';
import { Typography } from '@/constants/Typography';
import {
    SectionIcon,
    RepoDetailSkeleton,
    RepoEmptyState,
    LanguageDot,
} from '@/components/repos';
import { t } from '@/text';


export default function RepoDashboardScreen() {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const router = useRouter();
    const { owner, repo: repoName } = useLocalSearchParams<{ owner: string; repo: string }>();

    const { data: repoInfo, loading: repoLoading } = useGithubRepo(owner!, repoName!);

    const sessionsMap = storage(useShallow((state) => state.sessions)) as Record<string, Session>;
    const allRegisteredRepos = storage(useShallow((state) => state.registeredRepos)) as Record<string, RegisteredRepo[]>;
    const repoPrefix = `${owner}/${repoName}`;
    const repoSessions = React.useMemo(() => {
        if (!owner || !repoName) return [];
        const repoPaths = new Set(
            Object.values(allRegisteredRepos)
                .flat()
                .filter((r) => matchesGithubRepo(r, owner, repoName))
                .map((r) => r.path)
                .filter(Boolean)
        );
        return Object.values(sessionsMap).filter((s) => {
            const matchByGithubRepo = s.metadata?.githubRepo === repoPrefix;
            const matchByPath = s.metadata?.path && repoPaths.has(s.metadata.path);
            const rid = s.metadata?.externalContext?.resourceId;
            const matchByContext = rid && (rid === repoPrefix || rid.startsWith(repoPrefix + '#'));
            return matchByGithubRepo || matchByPath || matchByContext;
        });
    }, [sessionsMap, allRegisteredRepos, owner, repoName, repoPrefix]);

    const openIssuesCount = repoInfo?.openIssuesCount ?? 0;
    const openPRsCount = repoInfo?.openPRsCount ?? 0;

    if (repoLoading) {
        return (
            <View style={styles.container}>
                <Stack.Screen options={{ headerTitle: repoName }} />
                <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
                    <RepoDetailSkeleton />
                </ScrollView>
            </View>
        );
    }

    if (!repoInfo) {
        return (
            <View style={styles.container}>
                <Stack.Screen options={{ headerTitle: t('lab.repoNotFound') }} />
                <RepoEmptyState
                    icon="help-circle-outline"
                    title={t('lab.repoNotFound')}
                />
            </View>
        );
    }

    const ownerLogin = repoInfo.owner;
    const ownerAvatarUrl = `https://github.com/${ownerLogin}.png?size=160`;
    const languageColor = getLanguageColor(theme, repoInfo.language);

    return (
        <View style={styles.container}>
            <Stack.Screen options={{ headerTitle: repoInfo.name }} />

            <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
                {/* Hero */}
                <View style={[styles.heroWrapper, { alignSelf: 'center', width: '100%', maxWidth: layout.maxWidth }]}>
                    <View style={styles.heroCard}>
                        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 14 }}>
                            <Avatar id={ownerLogin} imageUrl={ownerAvatarUrl} size={52} />
                            <View style={{ flex: 1, minWidth: 0 }}>
                                <Text style={styles.ownerLabel} numberOfLines={1}>{ownerLogin}</Text>
                                <Text style={styles.repoTitle} numberOfLines={1}>
                                    {repoInfo.name}
                                </Text>
                            </View>
                            <View style={repoInfo.isPrivate ? styles.badgePrivate : styles.badgePublic}>
                                <Ionicons
                                    name={repoInfo.isPrivate ? 'lock-closed-outline' : 'globe-outline'}
                                    size={10}
                                    color={repoInfo.isPrivate ? theme.colors.textDestructive : theme.colors.repo.stateOpen}
                                />
                                <Text style={repoInfo.isPrivate ? styles.badgePrivateText : styles.badgePublicText}>
                                    {repoInfo.isPrivate ? t('repository.private') : t('repository.public')}
                                </Text>
                            </View>
                        </View>

                        {!!repoInfo.description && (
                            <Text style={styles.description}>
                                {repoInfo.description}
                            </Text>
                        )}

                        <View style={styles.chipRow}>
                            {!!repoInfo.language && (
                                <View style={styles.chip}>
                                    <View style={[styles.langDot, { backgroundColor: languageColor }]} />
                                    <Text style={styles.chipText}>{repoInfo.language}</Text>
                                </View>
                            )}
                            <View style={styles.chip}>
                                <Ionicons
                                    name={repoInfo.viewerHasStarred ? 'star' : 'star-outline'}
                                    size={12}
                                    color={repoInfo.viewerHasStarred ? theme.colors.repo.starFilled : theme.colors.textSecondary}
                                />
                                <Text style={styles.chipText}>{formatNumber(repoInfo.stars)}</Text>
                            </View>
                            <View style={styles.chip}>
                                <Ionicons name="git-network-outline" size={12} color={theme.colors.textSecondary} />
                                <Text style={styles.chipText}>{formatNumber(repoInfo.forks)}</Text>
                            </View>
                            <Text style={styles.updated} numberOfLines={1}>
                                {t('repository.updatedAgo', { time: formatTimeAgo(repoInfo.pushedAt) })}
                            </Text>
                        </View>
                    </View>
                </View>

                {/* Activity group */}
                <ItemGroup title={t('repository.sectionActivity')}>
                    <Item
                        title={t('repository.issues')}
                        icon={<SectionIcon section="issues" />}
                        detail={openIssuesCount > 0 ? String(openIssuesCount) : undefined}
                        onPress={() => router.push(`/repos/${owner}/${repoName}/issues`)}
                    />
                    <Item
                        title={t('repository.pulls')}
                        icon={<SectionIcon section="pulls" />}
                        detail={openPRsCount > 0 ? String(openPRsCount) : undefined}
                        onPress={() => router.push(`/repos/${owner}/${repoName}/pulls`)}
                    />
                </ItemGroup>

                {/* README */}
                {repoInfo.readme && (
                    <View style={[styles.readmeWrapper, { alignSelf: 'center', width: '100%', maxWidth: layout.maxWidth }]}>
                        <Text style={styles.readmeTitle}>README</Text>
                        <View style={styles.readmeCard}>
                            <HtmlContent html={repoInfo.readme} theme={theme} />
                        </View>
                    </View>
                )}
            </ScrollView>

        </View>
    );
}

const stylesheet = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        backgroundColor: theme.colors.groupped.background,
    },
    heroWrapper: {
        paddingHorizontal: 16,
        paddingTop: 16,
    },
    heroCard: {
        backgroundColor: theme.colors.surface,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        padding: 16,
    },
    ownerLabel: {
        fontSize: 12,
        color: theme.colors.textSecondary,
        ...Typography.default('regular'),
    },
    repoTitle: {
        fontSize: 22,
        color: theme.colors.text,
        marginTop: 1,
        ...Typography.default('semiBold'),
    },
    description: {
        marginTop: 14,
        fontSize: 14,
        color: theme.colors.textSecondary,
        lineHeight: 20,
    },
    chipRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 8,
        marginTop: 14,
    },
    chip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 6,
        backgroundColor: theme.colors.surfaceHighest,
    },
    chipText: {
        fontSize: 12,
        color: theme.colors.text,
        fontWeight: '500',
    },
    langDot: {
        width: 9,
        height: 9,
        borderRadius: 4.5,
    },
    updated: {
        fontSize: 12,
        color: theme.colors.textSecondary,
        marginLeft: 'auto',
    },
    badgePrivate: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 3,
        backgroundColor: theme.colors.textDestructive + '1A',
        paddingHorizontal: 7,
        paddingVertical: 3,
        borderRadius: 6,
    },
    badgePrivateText: {
        fontSize: 10,
        fontWeight: '700',
        color: theme.colors.textDestructive,
    },
    badgePublic: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 3,
        backgroundColor: theme.colors.repo.stateOpen + '1A',
        paddingHorizontal: 7,
        paddingVertical: 3,
        borderRadius: 6,
    },
    badgePublicText: {
        fontSize: 10,
        fontWeight: '700',
        color: theme.colors.repo.stateOpen,
    },
    readmeWrapper: {
        paddingHorizontal: 16,
        marginTop: 24,
    },
    readmeTitle: {
        fontSize: 13,
        fontWeight: '600',
        color: theme.colors.groupped.sectionTitle,
        marginBottom: 8,
        marginLeft: 4,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    readmeCard: {
        backgroundColor: theme.colors.surface,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        padding: 16,
        overflow: 'hidden',
    },
}));
