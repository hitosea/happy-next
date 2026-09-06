import * as React from 'react';
import { View, ScrollView, Pressable, Platform } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Text } from '@/components/StyledText';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
    useSharedValue,
    useAnimatedStyle,
    withTiming,
} from 'react-native-reanimated';
import { layout } from '@/components/layout';
import { Typography } from '@/constants/Typography';
import { Avatar } from '@/components/Avatar';
import { MarkdownView } from '@/components/markdown/MarkdownView';
import { ActionMenuModal } from '@/components/ActionMenuModal';
import type { ActionMenuItem } from '@/components/ActionMenu';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import * as WebBrowser from 'expo-web-browser';
import { useGithubPull, useGithubIssueComments } from '@/hooks/useGithubData';
import { updateGithubPull, fetchGithubToken } from '@/sync/apiGithubData';
import { useAuth } from '@/auth/AuthContext';
import { storeTempData, type NewSessionData } from '@/utils/tempDataStore';
import type { RepoPR, RepoIssueComment } from '@/data/mockRepos';
import { ShimmerView } from '@/components/ShimmerView';
import { Modal } from '@/modal';
import { hapticsLight, hapticsSuccess } from '@/components/haptics';
import {
    StatePill,
    RepoEmptyState,
    SkeletonBlock,
} from '@/components/repos';
import { formatTimeAgo, formatAbsoluteTime, formatSessionAge } from '@/data/repoUtils';
import { t } from '@/text';
import { useLinkedSessions } from '@/hooks/useLinkedSessions';
import { useNavigateToSession } from '@/hooks/useNavigateToSession';
import { getSessionName } from '@/utils/sessionUtils';

function buildPRDiscussionPrompt(
    owner: string,
    repo: string,
    prNumber: number,
    pr: RepoPR,
    comments: RepoIssueComment[],
): string {
    const url = `https://github.com/${owner}/${repo}/pull/${prNumber}`;
    const body = pr.body?.trim() || '(no description)';
    const lines: string[] = [
        `GitHub Pull Request #${prNumber}: ${pr.title}`,
        `Repo: ${owner}/${repo}`,
        `URL: ${url}`,
        `Status: ${pr.status}`,
        `Author: @${pr.author} (${pr.createdAt})`,
    ];
    if (pr.headRefName) {
        lines.push(`Branch: ${pr.headRefName}`);
    }
    lines.push('', '--- Description ---', body);
    if (comments.length > 0) {
        lines.push('', `--- Comments (${comments.length}) ---`);
        for (const c of comments) {
            lines.push('', `[@${c.author} · ${c.createdAt}]`, c.body?.trim() || '(empty)');
        }
    }
    lines.push('', "Let's discuss this pull request. What's your understanding and how would you approach reviewing it?");
    return lines.join('\n');
}

function PullRequestDetailScreen() {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const router = useRouter();
    const { owner, repo, number: numberStr } = useLocalSearchParams<{ owner: string; repo: string; number: string }>();

    const { credentials } = useAuth();
    const prNumber = parseInt(numberStr, 10);
    const { data: pr, loading: prLoading, mutate: mutatePull } = useGithubPull(owner!, repo!, prNumber);
    const { data: comments } = useGithubIssueComments(owner!, repo!, prNumber);
    const linkedSessions = useLinkedSessions('github', `${owner}/${repo}#${prNumber}`, 'pull_request');
    const navigateToSession = useNavigateToSession();

    const handleStartAiSession = React.useCallback(async () => {
        if (!pr || !credentials) return;
        let githubToken: string | undefined;
        try {
            githubToken = await fetchGithubToken(credentials);
        } catch {
            // Proceed without GitHub MCP if token fetch fails
        }
        const prompt = buildPRDiscussionPrompt(owner!, repo!, prNumber, pr, []);
        const dataId = storeTempData({
            prompt,
            sessionTitle: `PR #${prNumber}: ${pr.title}`,
            sessionIcon: 'github',
            githubRepo: `${owner}/${repo}`,
            externalContext: {
                source: 'github',
                resourceType: 'pull_request',
                resourceId: `${owner}/${repo}#${prNumber}`,
                title: pr.title,
                deepLink: `/repos/${owner}/${repo}/pulls/${prNumber}`,
            },
            ...(githubToken ? { environmentVariables: { GITHUB_PERSONAL_ACCESS_TOKEN: githubToken } } : {}),
        } satisfies NewSessionData);
        router.push(`/new?dataId=${dataId}`);
    }, [pr, credentials, owner, repo, prNumber, router]);

    const insets = useSafeAreaInsets();
    const [menuVisible, setMenuVisible] = React.useState(false);
    const [showAbsoluteTime, setShowAbsoluteTime] = React.useState(false);
    const scrollY = React.useRef(0);
    const [showHeaderSubtitle, setShowHeaderSubtitle] = React.useState(false);
    const subtitleOpacity = useSharedValue(0);
    const [displayedSubtitle, setDisplayedSubtitle] = React.useState('');

    const targetSubtitle = showHeaderSubtitle && pr
        ? pr.title
        : `${owner}/${repo}`;

    React.useEffect(() => {
        subtitleOpacity.value = withTiming(0, { duration: 100 });
        const timer = setTimeout(() => {
            setDisplayedSubtitle(targetSubtitle);
            subtitleOpacity.value = withTiming(1, { duration: 160 });
        }, 120);
        return () => clearTimeout(timer);
    }, [targetSubtitle]);

    const subtitleAnimStyle = useAnimatedStyle(() => ({ opacity: subtitleOpacity.value }));

    const handleScroll = React.useCallback((e: any) => {
        const y = e.nativeEvent.contentOffset.y;
        scrollY.current = y;
        setShowHeaderSubtitle(y > 60);
    }, []);

    const menuItems: ActionMenuItem[] = React.useMemo(() => {
        const isOpen = pr?.status === 'open';
        const isMerged = pr?.status === 'merged';
        const items: ActionMenuItem[] = [
            {
                label: t('repository.copyPrUrl'),
                onPress: () => {
                    Clipboard.setStringAsync(`https://github.com/${owner}/${repo}/pull/${prNumber}`);
                    hapticsLight();
                },
            },
            {
                label: t('repository.openInGithub'),
                onPress: () => {
                    WebBrowser.openBrowserAsync(`https://github.com/${owner}/${repo}/pull/${prNumber}`);
                },
            },
            {
                label: t('repository.copyPrNumber'),
                onPress: () => {
                    Clipboard.setStringAsync(`#${prNumber}`);
                    hapticsLight();
                },
            },
        ];
        if (pr && credentials && !isMerged) {
            items.push({
                label: isOpen ? t('repository.closePr') : t('repository.reopenPr'),
                destructive: isOpen,
                onPress: async () => {
                    const newState = isOpen ? 'closed' as const : 'open' as const;
                    mutatePull((prev) => prev ? { ...prev, status: newState } : prev);
                    hapticsSuccess();
                    try {
                        await updateGithubPull(credentials, owner!, repo!, prNumber, { state: newState });
                    } catch {
                        mutatePull((prev) => prev ? { ...prev, status: isOpen ? 'open' as const : 'closed' as const } : prev);
                        Modal.alert(t('issueComments.errorTitle'), t('repository.updateStateFailed'));
                    }
                },
            });
        }
        return items;
    }, [owner, repo, prNumber, pr, credentials, mutatePull]);

    const headerTitle = React.useCallback(() => (
        <Pressable style={{ alignItems: 'center', justifyContent: 'center', maxWidth: 220 }}>
            <Text numberOfLines={1} style={[styles.headerTitle, { color: theme.colors.header.tint }]}>
                #{pr?.number ?? numberStr}
            </Text>
            <Animated.Text
                numberOfLines={1}
                style={[styles.headerSubtitle, { color: theme.colors.textSecondary }, subtitleAnimStyle]}
            >
                {displayedSubtitle}
            </Animated.Text>
        </Pressable>
    ), [pr?.number, numberStr, theme.colors.header.tint, theme.colors.textSecondary, displayedSubtitle, subtitleAnimStyle]);

    const headerRight = React.useCallback(() => (
        <Pressable
            onPress={() => setMenuVisible(true)}
            style={{ paddingHorizontal: 8, paddingVertical: 4 }}
        >
            <Ionicons name="ellipsis-horizontal" size={22} color={theme.colors.header.tint} />
        </Pressable>
    ), [theme.colors.header.tint]);

    if (prLoading) {
        return (
            <View style={styles.container}>
                <Stack.Screen
                    options={{
                        headerTitle: () => (
                            <View style={{ alignItems: 'center', maxWidth: 220 }}>
                                <Text style={styles.headerTitle}>#{numberStr}</Text>
                                <Text style={[styles.headerSubtitle, { opacity: 1 }]} numberOfLines={1}>
                                    {owner}/{repo}
                                </Text>
                            </View>
                        ),
                        headerRight: () => (
                            <Pressable
                                onPress={() => setMenuVisible(true)}
                                style={{ paddingHorizontal: 8, paddingVertical: 4 }}
                            >
                                <Ionicons name="ellipsis-horizontal" size={22} color={theme.colors.header.tint} />
                            </Pressable>
                        ),
                    }}
                />
                <ScrollView contentContainerStyle={[styles.content, { maxWidth: layout.maxWidth, alignSelf: 'center', width: '100%' }]} style={{ backgroundColor: theme.colors.surface }}>
                    <ShimmerView>
                        <SkeletonBlock w={'85%'} h={22} radius={4} />
                        <SkeletonBlock w={'60%'} h={22} radius={4} mt={6} />
                        <View style={{ gap: 14, marginTop: 20 }}>
                            <View style={styles.field}>
                                <SkeletonBlock w={60} h={14} radius={3} />
                                <SkeletonBlock w={68} h={24} radius={999} />
                            </View>
                            <View style={styles.field}>
                                <SkeletonBlock w={60} h={14} radius={3} />
                                <View style={styles.fieldValueRow}>
                                    <SkeletonBlock w={20} h={20} radius={10} />
                                    <SkeletonBlock w={80} h={14} radius={3} />
                                </View>
                            </View>
                            <View style={styles.field}>
                                <SkeletonBlock w={60} h={14} radius={3} />
                                <SkeletonBlock w={80} h={14} radius={3} />
                            </View>
                        </View>
                        <View style={[styles.sectionDivider, { marginTop: 16 }]} />
                        <View style={{ gap: 6, marginTop: 16 }}>
                            <SkeletonBlock w={90} h={14} radius={3} />
                            <SkeletonBlock w={'95%'} h={14} radius={3} />
                            <SkeletonBlock w={'88%'} h={14} radius={3} />
                            <SkeletonBlock w={'70%'} h={14} radius={3} />
                        </View>
                    </ShimmerView>
                </ScrollView>
            </View>
        );
    }

    if (!pr) {
        return (
            <View style={styles.container}>
                <Stack.Screen options={{ headerTitle: `PR #${numberStr}` }} />
                <RepoEmptyState
                    icon="git-pull-request-outline"
                    title={t('lab.pullRequestNotFound')}
                />
            </View>
        );
    }

    const prState = pr.status;

    return (
        <View style={styles.container}>
            <Stack.Screen
                options={{
                    headerTitle,
                    headerRight,
                }}
            />

            <ScrollView contentContainerStyle={[styles.content, { maxWidth: layout.maxWidth, alignSelf: 'center', width: '100%' }]} style={{ backgroundColor: theme.colors.surface }} onScroll={handleScroll} scrollEventThrottle={16}>
                {/* Title */}
                <Text style={styles.prTitle}>{pr.title}</Text>

                {/* Fields */}
                <View style={styles.fieldGroup}>
                    <View style={styles.field}>
                        <Text style={styles.fieldLabel}>{t('repository.issueStatus')}</Text>
                        <StatePill state={prState} size="md" />
                    </View>
                    <View style={styles.field}>
                        <Text style={styles.fieldLabel}>{t('repository.issueAuthor')}</Text>
                        <View style={styles.fieldValueRow}>
                            <Avatar id={pr.author} size={20} imageUrl={pr.authorAvatarUrl} />
                            <Text style={styles.fieldValue}>{pr.author}</Text>
                        </View>
                    </View>
                    {pr.headRefName && (
                        <View style={styles.field}>
                            <Text style={styles.fieldLabel}>{t('repository.prBranch')}</Text>
                            <View style={styles.branchPill}>
                                <Ionicons name="git-branch" size={11} color={theme.colors.textSecondary} />
                                <Text style={styles.branchPillText}>{pr.headRefName}</Text>
                            </View>
                        </View>
                    )}
                    <Pressable style={styles.field} onPress={() => setShowAbsoluteTime((v) => !v)}>
                        <Text style={styles.fieldLabel}>{t('repository.issueCreated')}</Text>
                        <Text style={styles.fieldValueSecondary}>
                            {showAbsoluteTime ? formatAbsoluteTime(pr.createdAt) : formatTimeAgo(pr.createdAt)}
                        </Text>
                    </Pressable>
                    {prState === 'merged' && pr.mergedAt && (
                        <Pressable style={styles.field} onPress={() => setShowAbsoluteTime((v) => !v)}>
                            <Text style={styles.fieldLabel}>{t('repository.prMerged')}</Text>
                            <Text style={styles.fieldValueSecondary}>
                                {showAbsoluteTime ? formatAbsoluteTime(pr.mergedAt) : formatTimeAgo(pr.mergedAt)}
                            </Text>
                        </Pressable>
                    )}
                </View>

                <View style={styles.sectionDivider} />

                {/* Description */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>{t('repository.issueDescription')}</Text>
                    {pr.body ? (
                        <MarkdownView markdown={pr.body} hideOptions />
                    ) : (
                        <Text style={styles.bodyEmpty}>{t('repository.noDescription')}</Text>
                    )}
                </View>

                {linkedSessions.length > 0 && (
                    <>
                        <View style={styles.sectionDivider} />
                        <View style={styles.section}>
                            <Text style={styles.sectionTitle}>
                                {t('github.relatedSessions')} ({linkedSessions.length})
                            </Text>
                            {linkedSessions.map((session) => (
                                <Pressable
                                    key={session.id}
                                    style={[styles.sessionCard, { backgroundColor: theme.colors.surface }]}
                                    onPress={() => navigateToSession(session.id)}
                                >
                                    <Text style={[styles.sessionTitle, { color: theme.colors.text }]} numberOfLines={1}>
                                        {getSessionName(session)}
                                    </Text>
                                    <Text style={[styles.sessionMeta, { color: theme.colors.textSecondary }]}>
                                        {[
                                            session.metadata?.flavor || 'claude',
                                            session.metadata?.host,
                                            formatSessionAge(session.createdAt),
                                        ].filter(Boolean).join(' · ')}
                                    </Text>
                                </Pressable>
                            ))}
                        </View>
                    </>
                )}

            </ScrollView>
            <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
                <Pressable
                    style={[styles.btnChat, { borderColor: theme.colors.divider }]}
                    onPress={() => router.push(`/repos/${owner}/${repo}/pulls/${prNumber}/comments?issueTitle=${encodeURIComponent(pr.title)}&issueAuthor=${encodeURIComponent(pr.author)}`)}
                >
                    <View style={styles.bottomButtonInner}>
                        <Ionicons name="chatbubbles-outline" size={17} color={theme.colors.text} />
                        <Text style={[styles.bottomButtonText, { color: theme.colors.text }]} numberOfLines={1}>
                            {comments.length > 0 ? `${t('issueComments.title')} (${comments.length})` : t('issueComments.title')}
                        </Text>
                    </View>
                </Pressable>
                <Pressable
                    style={[styles.btnPilot, { backgroundColor: theme.colors.button.primary.background }]}
                    onPress={handleStartAiSession}
                >
                    <View style={styles.bottomButtonInner}>
                        <Ionicons name="sparkles" size={17} color={theme.colors.button.primary.tint} />
                        <Text style={[styles.bottomButtonText, { color: theme.colors.button.primary.tint }]} numberOfLines={1}>
                            {t('issueDetail.aiSession')}
                        </Text>
                    </View>
                </Pressable>
            </View>
            <ActionMenuModal
                visible={menuVisible}
                items={menuItems}
                onClose={() => setMenuVisible(false)}
                deferItemPress
            />
        </View>
    );
}

export default React.memo(PullRequestDetailScreen);

const stylesheet = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        backgroundColor: theme.colors.groupped.background,
    },
    content: {
        padding: 20,
        paddingBottom: 40,
        gap: 16,
    },
    prTitle: {
        ...Typography.default('semiBold'),
        fontSize: 20,
        color: theme.colors.text,
        lineHeight: 26,
    },
    fieldGroup: {
        gap: 12,
    },
    field: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    fieldLabel: {
        ...Typography.default(),
        fontSize: 14,
        color: theme.colors.textSecondary,
        flexShrink: 0,
        marginRight: 12,
    },
    fieldValue: {
        ...Typography.default('semiBold'),
        fontSize: 14,
        color: theme.colors.text,
    },
    fieldValueSecondary: {
        ...Typography.default(),
        fontSize: 14,
        color: theme.colors.textSecondary,
    },
    fieldValueRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    branchPill: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 6,
        backgroundColor: theme.colors.repo.codeBg,
        borderWidth: 1,
        borderColor: theme.colors.repo.codeBorder,
    },
    branchPillText: {
        fontSize: 12,
        color: theme.colors.textSecondary,
        fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
    },
    sectionDivider: {
        height: 1,
        backgroundColor: theme.colors.divider,
    },
    section: {
        gap: 6,
    },
    sectionTitle: {
        ...Typography.default('semiBold'),
        fontSize: 14,
        color: theme.colors.textSecondary,
    },
    bodyEmpty: {
        fontSize: 15,
        fontStyle: 'italic',
        color: theme.colors.textSecondary,
        lineHeight: 22,
        ...Typography.default('regular'),
    },
    bottomBar: {
        flexDirection: 'row',
        gap: 10,
        paddingHorizontal: 16,
        paddingTop: 12,
        borderTopWidth: 1,
        borderTopColor: theme.colors.divider,
        backgroundColor: theme.colors.surface,
    },
    btnChat: {
        flex: 1,
        height: 44,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
    },
    btnPilot: {
        flex: 1,
        height: 44,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
    },
    bottomButtonInner: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    bottomButtonText: {
        ...Typography.default('semiBold'),
        fontSize: 15,
        flexShrink: 1,
    },
    sessionCard: {
        paddingVertical: 10,
        gap: 2,
    },
    sessionTitle: {
        ...Typography.default('semiBold'),
        fontSize: 14,
    },
    sessionMeta: {
        ...Typography.default(),
        fontSize: 12,
    },
    headerTitle: {
        ...Typography.default('semiBold'),
        fontSize: 17,
        color: theme.colors.text,
    },
    headerSubtitle: {
        ...Typography.default(),
        fontSize: 12,
        lineHeight: 16,
        marginTop: -2,
        color: theme.colors.textSecondary,
    },
}));
