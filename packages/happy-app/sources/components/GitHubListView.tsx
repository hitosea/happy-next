import * as React from 'react';
import { View, FlatList, Pressable, RefreshControl, TextInput, Platform, Linking, AppState, Modal, ActivityIndicator } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { Text } from '@/components/StyledText';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { BottomSheetModal, BottomSheetFlatList, BottomSheetTextInput, BottomSheetBackdrop } from '@gorhom/bottom-sheet';
import { t } from '@/text';
import { Typography } from '@/constants/Typography';
import { useGithubRepos, useGithubIssues, useGithubPulls, clearGithubCache } from '@/hooks/useGithubData';
import { formatTimeAgo, getLanguageColor, labelColors, ISSUE_FILTERS, PR_FILTERS } from '@/data/repoUtils';
import type { IssueFilter, PRFilter } from '@/data/repoUtils';
import type { RepoInfo, RepoIssue, RepoPR } from '@/data/mockRepos';
import { layout } from '@/components/layout';
import { IssueListSkeleton } from '@/components/repos';
import { useAuth } from '@/auth/AuthContext';
import { useHappyAction } from '@/hooks/useHappyAction';
import { getGitHubOAuthParams } from '@/sync/apiGithub';
import { Image } from 'expo-image';
import { useMainTabBottomPadding } from '@/hooks/useMainTabBottomPadding';

const SheetTextInput = Platform.OS === 'web' ? TextInput : BottomSheetTextInput;

type ActiveTab = 'issues' | 'pulls';

function getIssueApiState(filter: IssueFilter): 'open' | 'closed' | 'all' {
    if (filter === 'all') return 'all';
    return filter;
}

function getPRApiState(filter: PRFilter): 'open' | 'closed' | 'all' {
    if (filter === 'all') return 'all';
    if (filter === 'merged') return 'closed';
    return filter;
}

function getStateColor(state: string, theme: ReturnType<typeof useUnistyles>['theme']): string {
    switch (state) {
        case 'open': return theme.colors.repo.stateOpen;
        case 'closed': return theme.colors.repo.stateClosed;
        case 'merged': return theme.colors.repo.stateMerged;
        default: return theme.colors.textSecondary;
    }
}

const IssueRow = React.memo(({ item, onPress, theme }: { item: RepoIssue; onPress: () => void; theme: any }) => (
    <Pressable style={issueStyles.row} onPress={onPress}>
        <View style={[issueStyles.dot, { backgroundColor: getStateColor(item.state, theme) }]} />
        <View style={issueStyles.content}>
            <Text style={[issueStyles.title, item.state === 'closed' && { color: theme.colors.textSecondary }]}>
                {item.title}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 }}>
                <Text style={[issueStyles.meta, { color: theme.colors.textSecondary, marginTop: 0 }]}>
                    #{item.number} · {formatTimeAgo(item.createdAt)} · @{item.author}
                </Text>
            </View>
            {item.labels.length > 0 && (
                <View style={issueStyles.labelsRow}>
                    {item.labels.map((label) => {
                        const lc = labelColors(label.color);
                        return (
                            <View key={label.name} style={[issueStyles.labelPill, { backgroundColor: lc.bg }]}>
                                <Text style={[issueStyles.labelText, { color: lc.text }]}>{label.name}</Text>
                            </View>
                        );
                    })}
                </View>
            )}
        </View>
    </Pressable>
));

const PRRow = React.memo(({ item, onPress, theme }: { item: RepoPR; onPress: () => void; theme: any }) => (
    <Pressable style={issueStyles.row} onPress={onPress}>
        <View style={[issueStyles.dot, { backgroundColor: getStateColor(item.status, theme) }]} />
        <View style={issueStyles.content}>
            <Text style={[issueStyles.title, item.status !== 'open' && { color: theme.colors.textSecondary }]}>
                {item.title}
            </Text>
            <Text style={[issueStyles.meta, { color: theme.colors.textSecondary }]}>
                #{item.number} · {formatTimeAgo(item.createdAt)} · @{item.author}
                {item.headRefName ? ` → ${item.headRefName}` : ''}
            </Text>
        </View>
    </Pressable>
));

const TokenExpiredCard = React.memo(({ onReconnect, loading }: { onReconnect: () => void; loading: boolean }) => {
    const { theme } = useUnistyles();
    return (
        <View style={[styles.tokenExpiredCard, { backgroundColor: theme.colors.surface }]}>
            <Ionicons name="alert-circle-outline" size={40} color={theme.colors.warning ?? '#e6a700'} />
            <Text style={[styles.tokenExpiredTitle, { color: theme.colors.text }]}>
                {t('github.tokenExpired')}
            </Text>
            <Text style={[styles.tokenExpiredDesc, { color: theme.colors.textSecondary }]}>
                {t('github.tokenExpiredDesc')}
            </Text>
            <Pressable
                style={[styles.reconnectButton, { backgroundColor: theme.colors.button.primary.background }, loading && { opacity: 0.6 }]}
                onPress={onReconnect}
                disabled={loading}
            >
                <Text style={[styles.reconnectButtonText, { color: theme.colors.button.primary.tint }]}>
                    {loading ? t('openclaw.connecting') : t('github.reconnect')}
                </Text>
            </Pressable>
        </View>
    );
});

const RepoPickerRow = React.memo(({ item, isSelected, onPress, theme }: {
    item: RepoInfo; isSelected: boolean; onPress: () => void; theme: any;
}) => {
    const langColor = getLanguageColor(theme, item.language);
    return (
        <Pressable
            style={[styles.repoItem, isSelected && { backgroundColor: theme.colors.surfaceHigh }]}
            onPress={onPress}
        >
            {item.ownerAvatarUrl ? (
                <Image
                    source={{ uri: item.ownerAvatarUrl }}
                    style={{ width: 32, height: 32, borderRadius: 8 }}
                />
            ) : (
                <View style={[styles.repoAvatar, { backgroundColor: theme.colors.surfaceHigh }]}>
                    <Text style={[styles.repoAvatarText, { color: theme.colors.text }]}>
                        {(item.name || item.fullName)[0].toUpperCase()}
                    </Text>
                </View>
            )}
            <View style={styles.repoItemContent}>
                <View style={styles.repoItemNameRow}>
                    <Text style={[styles.repoItemOwner, { color: theme.colors.textSecondary }]} numberOfLines={1}>
                        {item.owner}/
                    </Text>
                    <Text style={[styles.repoItemName, { color: theme.colors.text }]} numberOfLines={1}>
                        {item.name}
                    </Text>
                    {item.isPrivate && (
                        <Ionicons name="lock-closed" size={11} color={theme.colors.textSecondary} style={{ marginLeft: 4 }} />
                    )}
                </View>
                <View style={styles.repoItemMeta}>
                    {item.language ? (
                        <View style={styles.repoItemLang}>
                            <View style={[styles.langDot, { backgroundColor: langColor }]} />
                            <Text style={[styles.repoItemMetaText, { color: theme.colors.textSecondary }]}>{item.language}</Text>
                        </View>
                    ) : null}
                    <Text style={[styles.repoItemMetaText, { color: theme.colors.textSecondary }]}>
                        {item.openIssuesCount} issues
                    </Text>
                    <Text style={[styles.repoItemMetaText, { color: theme.colors.textSecondary }]}>·</Text>
                    <Text style={[styles.repoItemMetaText, { color: theme.colors.textSecondary }]}>
                        {item.openPRsCount} PRs
                    </Text>
                </View>
            </View>
            {isSelected && (
                <Ionicons name="checkmark" size={18} color={theme.colors.repo.stateOpen} />
            )}
        </Pressable>
    );
});

interface GitHubListViewProps {
    onRepoChange?: (repo: string | null) => void;
    onLoadingChange?: (loading: boolean) => void;
    repoPickerTriggerRef?: React.MutableRefObject<(() => void) | null>;
}

let lastSelectedRepo: string | null = null;

export const GitHubListView = React.memo(({ onRepoChange, onLoadingChange, repoPickerTriggerRef }: GitHubListViewProps) => {
    const { theme } = useUnistyles();
    const router = useRouter();
    const auth = useAuth();
    const tabBottomPadding = useMainTabBottomPadding();

    const [repoSearch, setRepoSearch] = React.useState('');
    const [debouncedRepoSearch, setDebouncedRepoSearch] = React.useState('');

    React.useEffect(() => {
        const timer = setTimeout(() => setDebouncedRepoSearch(repoSearch), 300);
        return () => clearTimeout(timer);
    }, [repoSearch]);

    const { data: repos, loading: reposLoading, loadingMore: reposLoadingMore, hasMore: reposHasMore, totalCount: reposTotalCount, loadMore: loadMoreRepos, refresh: refreshRepos, tokenExpired } = useGithubRepos({
        search: debouncedRepoSearch || undefined,
    });

    const [activeTab, setActiveTab] = React.useState<ActiveTab>('issues');
    const [issueFilter, setIssueFilter] = React.useState<IssueFilter>('open');
    const [prFilter, setPRFilter] = React.useState<PRFilter>('open');
    const [searchQuery, setSearchQuery] = React.useState('');
    const [filterPopoverVisible, setFilterPopoverVisible] = React.useState(false);
    const [selectedRepo, setSelectedRepo] = React.useState<string | null>(() =>
        lastSelectedRepo || (repos.length > 0 ? repos[0].fullName : null)
    );

    const repoPickerRef = React.useRef<BottomSheetModal>(null);

    React.useEffect(() => {
        if (repoPickerTriggerRef) {
            repoPickerTriggerRef.current = () => repoPickerRef.current?.present();
            return () => { repoPickerTriggerRef.current = null; };
        }
    }, [repoPickerTriggerRef]);

    React.useEffect(() => {
        if (selectedRepo) {
            lastSelectedRepo = selectedRepo;
        }
        onRepoChange?.(selectedRepo);
    }, [selectedRepo, onRepoChange]);

    React.useEffect(() => {
        if (repos.length > 0 && !selectedRepo) {
            setSelectedRepo(repos[0].fullName);
        }
    }, [repos, selectedRepo]);

    const [owner, repoName] = React.useMemo(() => {
        if (!selectedRepo) return ['', ''];
        const parts = selectedRepo.split('/');
        return [parts[0] || '', parts[1] || ''];
    }, [selectedRepo]);

    const { data: issues, loading: issuesLoading, loadingMore: issuesLoadingMore, hasMore: issuesHasMore, loadMore: loadMoreIssues, refresh: refreshIssues } = useGithubIssues(
        owner, repoName, getIssueApiState(issueFilter), activeTab === 'issues'
    );

    const { data: pulls, loading: pullsLoading, loadingMore: pullsLoadingMore, hasMore: pullsHasMore, loadMore: loadMorePulls, refresh: refreshPulls } = useGithubPulls(
        owner, repoName, getPRApiState(prFilter), activeTab === 'pulls'
    );

    const filteredPulls = React.useMemo(() => {
        if (prFilter !== 'merged') return pulls;
        return pulls.filter((p) => p.status === 'merged');
    }, [pulls, prFilter]);

    const filteredIssues = React.useMemo(() => {
        if (!searchQuery) return issues;
        const q = searchQuery.toLowerCase();
        return issues.filter((i) => i.title.toLowerCase().includes(q) || `#${i.number}`.includes(q));
    }, [issues, searchQuery]);

    const filteredPRs = React.useMemo(() => {
        if (!searchQuery) return filteredPulls;
        const q = searchQuery.toLowerCase();
        return filteredPulls.filter((p) => p.title.toLowerCase().includes(q) || `#${p.number}`.includes(q));
    }, [filteredPulls, searchQuery]);

    const isLoading = reposLoading || (activeTab === 'issues' ? issuesLoading : pullsLoading);
    const prevIsLoading = React.useRef(isLoading);
    React.useEffect(() => {
        if (prevIsLoading.current !== isLoading) {
            prevIsLoading.current = isLoading;
            onLoadingChange?.(isLoading);
        }
    }, [isLoading, onLoadingChange]);

    const handleRefresh = React.useCallback(() => {
        if (activeTab === 'issues') {
            refreshIssues();
        } else {
            refreshPulls();
        }
    }, [activeTab, refreshIssues, refreshPulls]);

    const handleIssuePress = React.useCallback((item: RepoIssue) => {
        router.push(`/repos/${owner}/${repoName}/issue/${item.number}`);
    }, [router, owner, repoName]);

    const handlePRPress = React.useCallback((item: RepoPR) => {
        router.push(`/repos/${owner}/${repoName}/pulls/${item.number}`);
    }, [router, owner, repoName]);

    const [reconnecting, handleReconnect] = useHappyAction(async () => {
        if (!auth.credentials) return;
        if (Platform.OS === 'web') {
            const params = await getGitHubOAuthParams(auth.credentials);
            await Linking.openURL(params.url);
            await new Promise<void>((resolve) => {
                const onFocus = () => {
                    window.removeEventListener('focus', onFocus);
                    setTimeout(resolve, 1500);
                };
                window.addEventListener('focus', onFocus);
            });
        } else {
            const callbackUrl = 'happy://github-callback';
            const params = await getGitHubOAuthParams(auth.credentials, callbackUrl);
            if (Platform.OS === 'android') {
                const subs: Array<{ remove(): void }> = [];
                try {
                    const done = new Promise<void>((resolve) => {
                        let settled = false;
                        subs.push(Linking.addEventListener('url', (event: { url: string }) => {
                            if (!settled && event.url.startsWith(callbackUrl)) {
                                settled = true;
                                resolve();
                            }
                        }));
                        subs.push(AppState.addEventListener('change', (state) => {
                            if (state === 'active' && !settled) {
                                setTimeout(() => { if (!settled) { settled = true; resolve(); } }, 2000);
                            }
                        }));
                    });
                    await WebBrowser.openBrowserAsync(params.url);
                    await done;
                } finally {
                    subs.forEach((s) => s.remove());
                }
            } else {
                const result = await WebBrowser.openAuthSessionAsync(params.url, callbackUrl);
                if (result.type === WebBrowser.WebBrowserResultType.CANCEL || result.type === WebBrowser.WebBrowserResultType.DISMISS) {
                    return;
                }
            }
        }
        clearGithubCache();
        refreshRepos();
    }, { timeoutMs: 35_000 });

    const handleSelectRepo = React.useCallback((repo: RepoInfo) => {
        setSelectedRepo(repo.fullName);
        setSearchQuery('');
        repoPickerRef.current?.dismiss();
    }, []);

    const renderIssueItem = React.useCallback(({ item }: { item: RepoIssue }) => (
        <IssueRow item={item} onPress={() => handleIssuePress(item)} theme={theme} />
    ), [handleIssuePress, theme]);

    const renderPRItem = React.useCallback(({ item }: { item: RepoPR }) => (
        <PRRow item={item} onPress={() => handlePRPress(item)} theme={theme} />
    ), [handlePRPress, theme]);

    const filters = activeTab === 'issues' ? ISSUE_FILTERS : PR_FILTERS;
    const currentFilter = activeTab === 'issues' ? issueFilter : prFilter;
    const setFilter = activeTab === 'issues'
        ? (f: string) => setIssueFilter(f as IssueFilter)
        : (f: string) => setPRFilter(f as PRFilter);

    const filterLabels: Record<string, string> = {
        all: t('github.all'),
        open: t('github.open'),
        closed: t('github.closed'),
        merged: t('github.merged'),
    };

    const renderBackdrop = React.useCallback(
        (props: any) => <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} />,
        []
    );

    const emptyText = activeTab === 'issues' ? t('github.noIssues') : t('github.noPullRequests');

    const otherTab = activeTab === 'issues' ? 'pulls' : 'issues';
    const otherTabLabel = activeTab === 'issues' ? t('github.prs') : t('github.issues');
    // The inactive tab's list is lazy-loaded (useGithubPulls/useGithubIssues are
    // gated by activeTab), so its array length stays 0 until you open it. Take the
    // header counts from the selected repo's aggregate open counts (already fetched
    // via GraphQL in the repo list) so both previews are correct, falling back to
    // the loaded list length when the repo isn't in the currently loaded list.
    const selectedRepoInfo = repos.find((r) => r.fullName === selectedRepo);
    const issuesCount = selectedRepoInfo?.openIssuesCount ?? issues.length;
    const pullsCount = selectedRepoInfo?.openPRsCount ?? filteredPulls.length;
    const otherTabCount = activeTab === 'issues' ? pullsCount : issuesCount;
    const currentTabLabel = activeTab === 'issues' ? t('github.issues') : t('github.pullRequests');
    const currentCount = activeTab === 'issues' ? issuesCount : pullsCount;

    return (
        <View style={[styles.container, { backgroundColor: theme.colors.groupped.background }]}>
            <View style={styles.headlineRow}>
                <Text style={[styles.headlineTitle, { color: theme.colors.text }]}>
                    {currentTabLabel}
                </Text>
                <Text style={[styles.headlineCount, { color: theme.colors.textSecondary }]}>
                    {currentCount}
                </Text>
                <View style={{ flex: 1 }} />
                <Pressable
                    style={[styles.swapPill, { backgroundColor: theme.colors.surfaceHigh }]}
                    onPress={() => setActiveTab(otherTab)}
                >
                    <Text style={[styles.swapPillText, { color: theme.colors.textSecondary }]}>
                        {otherTabLabel}
                    </Text>
                    <View style={[styles.swapPillBadge, { backgroundColor: theme.colors.divider }]}>
                        <Text style={[styles.swapPillBadgeText, { color: theme.colors.textSecondary }]}>
                            {otherTabCount}
                        </Text>
                    </View>
                    <Text style={[styles.swapPillArrow, { color: theme.colors.textSecondary }]}>→</Text>
                </Pressable>
            </View>

            <View style={styles.searchContainer}>
                <View style={[styles.searchBox, { backgroundColor: theme.colors.surface, borderColor: theme.colors.divider }]}>
                    <Ionicons name="search" size={15} color={theme.colors.textSecondary} />
                    <TextInput
                        value={searchQuery}
                        onChangeText={setSearchQuery}
                        placeholder={activeTab === 'issues' ? t('github.searchIssues') : t('github.searchPullRequests')}
                        placeholderTextColor={theme.colors.textSecondary}
                        style={[styles.searchTextInput, { color: theme.colors.text }, Platform.OS === 'web' && { outlineStyle: 'none', outline: 'none', outlineWidth: 0, outlineColor: 'transparent' } as any]}
                        returnKeyType="search"
                        autoCorrect={false}
                        underlineColorAndroid="transparent"
                    />
                    {searchQuery.length > 0 && (
                        <Pressable onPress={() => setSearchQuery('')} hitSlop={8}>
                            <Ionicons name="close-circle" size={16} color={theme.colors.textSecondary} />
                        </Pressable>
                    )}
                    <Pressable
                        style={[
                            styles.filterButton,
                            currentFilter === 'all'
                                ? { backgroundColor: theme.colors.surfaceHigh }
                                : { backgroundColor: theme.colors.text },
                        ]}
                        onPress={() => setFilterPopoverVisible(true)}
                    >
                        <Ionicons
                            name="filter"
                            size={13}
                            color={currentFilter === 'all' ? theme.colors.text : theme.colors.groupped.background}
                        />
                        <Text style={[
                            styles.filterButtonText,
                            currentFilter === 'all'
                                ? { color: theme.colors.text }
                                : { color: theme.colors.groupped.background },
                        ]}>
                            {filterLabels[currentFilter]}
                        </Text>
                    </Pressable>
                </View>
            </View>

            <Modal
                visible={filterPopoverVisible}
                transparent
                animationType="fade"
                onRequestClose={() => setFilterPopoverVisible(false)}
            >
                <Pressable style={styles.popoverOverlay} onPress={() => setFilterPopoverVisible(false)}>
                    <View
                        style={[styles.filterPopover, { backgroundColor: theme.colors.surface }]}
                        onStartShouldSetResponder={() => true}
                    >
                        {filters.map((f) => (
                            <Pressable
                                key={f.key}
                                style={[
                                    styles.filterPopoverItem,
                                    f.key === currentFilter && { backgroundColor: theme.colors.surfaceHigh },
                                ]}
                                onPress={() => {
                                    setFilter(f.key);
                                    setFilterPopoverVisible(false);
                                }}
                            >
                                <Text style={[styles.filterPopoverText, { color: theme.colors.text }]}>
                                    {filterLabels[f.key]}
                                </Text>
                            </Pressable>
                        ))}
                    </View>
                </Pressable>
            </Modal>

            {tokenExpired ? (
                <TokenExpiredCard onReconnect={handleReconnect} loading={reconnecting} />
            ) : activeTab === 'issues' ? (
                <FlatList
                    data={filteredIssues}
                    keyExtractor={(item) => String(item.number)}
                    renderItem={renderIssueItem}
                    refreshControl={<RefreshControl refreshing={isLoading && filteredIssues.length > 0} onRefresh={handleRefresh} tintColor={theme.colors.textSecondary} />}
                    contentContainerStyle={[styles.listContent, { maxWidth: layout.maxWidth, alignSelf: 'center', width: '100%', paddingBottom: tabBottomPadding }]}
                    onEndReached={issuesHasMore ? loadMoreIssues : undefined}
                    onEndReachedThreshold={0.5}
                    ListFooterComponent={issuesLoadingMore ? (
                        <ActivityIndicator style={{ paddingVertical: 16 }} color={theme.colors.textSecondary} />
                    ) : null}
                    ListEmptyComponent={isLoading ? (
                        <IssueListSkeleton variant="plain" />
                    ) : (
                        <View style={styles.emptyContainer}>
                            <Ionicons name="alert-circle-outline" size={40} color={theme.colors.textSecondary} />
                            <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>{emptyText}</Text>
                        </View>
                    )}
                />
            ) : (
                <FlatList
                    data={filteredPRs}
                    keyExtractor={(item) => String(item.number)}
                    renderItem={renderPRItem}
                    refreshControl={<RefreshControl refreshing={isLoading && filteredPRs.length > 0} onRefresh={handleRefresh} tintColor={theme.colors.textSecondary} />}
                    contentContainerStyle={[styles.listContent, { maxWidth: layout.maxWidth, alignSelf: 'center', width: '100%', paddingBottom: tabBottomPadding }]}
                    onEndReached={pullsHasMore ? loadMorePulls : undefined}
                    onEndReachedThreshold={0.5}
                    ListFooterComponent={pullsLoadingMore ? (
                        <ActivityIndicator style={{ paddingVertical: 16 }} color={theme.colors.textSecondary} />
                    ) : null}
                    ListEmptyComponent={isLoading ? (
                        <IssueListSkeleton variant="plain" />
                    ) : (
                        <View style={styles.emptyContainer}>
                            <Ionicons name="git-pull-request-outline" size={40} color={theme.colors.textSecondary} />
                            <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>{emptyText}</Text>
                        </View>
                    )}
                />
            )}

            <BottomSheetModal
                ref={repoPickerRef}
                snapPoints={['50%', '80%']}
                enableDynamicSizing={false}
                backdropComponent={renderBackdrop}
                backgroundStyle={{ backgroundColor: theme.colors.groupped.background }}
                handleIndicatorStyle={{ backgroundColor: theme.colors.textSecondary }}
            >
                <View style={styles.sheetHeader}>
                    <Text style={[styles.sheetTitle, { color: theme.colors.text }]}>{t('github.switchRepo')}</Text>
                    <View style={{ flex: 1 }} />
                    <Pressable
                        style={[styles.sheetCloseButton, { backgroundColor: theme.colors.surfaceHigh }]}
                        onPress={() => repoPickerRef.current?.dismiss()}
                    >
                        <Ionicons name="close" size={14} color={theme.colors.text} />
                    </Pressable>
                </View>
                <View style={styles.sheetSearchContainer}>
                    <View style={[styles.sheetSearchBox, { backgroundColor: theme.colors.surface, borderColor: theme.colors.divider }]}>
                        <Ionicons name="search" size={14} color={theme.colors.textSecondary} />
                        <SheetTextInput
                            value={repoSearch}
                            onChangeText={setRepoSearch}
                            placeholder={t('github.findRepo')}
                            placeholderTextColor={theme.colors.textSecondary}
                            style={[styles.searchTextInput, { color: theme.colors.text }]}
                        />
                    </View>
                </View>
                {repos.length > 0 && (
                    <View style={styles.sheetCountRow}>
                        <Text style={[styles.sheetCountText, { color: theme.colors.textSecondary }]}>
                            {reposTotalCount ? `${repos.length} / ${reposTotalCount}` : repos.length} repositories
                        </Text>
                    </View>
                )}
                <BottomSheetFlatList<RepoInfo>
                    data={repos}
                    keyExtractor={(item: RepoInfo) => item.fullName}
                    renderItem={({ item }: { item: RepoInfo }) => (
                        <RepoPickerRow
                            item={item}
                            isSelected={selectedRepo === item.fullName}
                            onPress={() => handleSelectRepo(item)}
                            theme={theme}
                        />
                    )}
                    onEndReached={reposHasMore ? loadMoreRepos : undefined}
                    onEndReachedThreshold={0.5}
                    ListFooterComponent={reposLoadingMore ? (
                        <ActivityIndicator style={{ paddingVertical: 16 }} color={theme.colors.textSecondary} />
                    ) : null}
                    ListEmptyComponent={
                        <View style={styles.emptyContainer}>
                            <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>{t('github.noRepos')}</Text>
                        </View>
                    }
                />
            </BottomSheetModal>
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
    },

    // Editorial headline
    headlineRow: {
        flexDirection: 'row',
        alignItems: 'baseline',
        paddingHorizontal: 20,
        paddingTop: 14,
        paddingBottom: 14,
        gap: 10,
    },
    headlineTitle: {
        ...Typography.default('semiBold'),
        fontSize: 28,
        letterSpacing: -0.5,
        lineHeight: 32,
    },
    headlineCount: {
        ...Typography.default('semiBold'),
        fontSize: 14,
    },
    swapPill: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 11,
        paddingVertical: 6,
        borderRadius: 99,
    },
    swapPillText: {
        ...Typography.default('semiBold'),
        fontSize: 12,
    },
    swapPillBadge: {
        paddingHorizontal: 6,
        paddingVertical: 1,
        borderRadius: 99,
    },
    swapPillBadgeText: {
        ...Typography.default(),
        fontSize: 10.5,
    },
    swapPillArrow: {
        fontSize: 14,
        marginLeft: 2,
    },

    // Search bar with integrated filter
    searchContainer: {
        paddingHorizontal: 16,
        paddingBottom: 10,
    },
    searchBox: {
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: 14,
        paddingLeft: 14,
        paddingRight: 6,
        height: 44,
        gap: 8,
        borderWidth: 1,
    },
    searchTextInput: {
        flex: 1,
        ...Typography.default(),
        fontSize: 14,
        lineHeight: 18,
        height: 44,
        textAlignVertical: 'center',
        includeFontPadding: false,
        paddingHorizontal: 0,
        paddingVertical: 0,
        margin: 0,
    },
    filterButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        paddingHorizontal: 10,
        paddingVertical: 7,
        borderRadius: 10,
    },
    filterButtonText: {
        ...Typography.default('semiBold'),
        fontSize: 12,
    },

    // Filter popover
    popoverOverlay: {
        flex: 1,
        justifyContent: 'flex-start',
        paddingTop: 180,
        paddingRight: 16,
        alignItems: 'flex-end',
    },
    filterPopover: {
        borderRadius: 12,
        padding: 6,
        minWidth: 130,
        ...Platform.select({
            ios: {
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 12 },
                shadowOpacity: 0.12,
                shadowRadius: 30,
            },
            android: {
                elevation: 8,
            },
            web: {
                boxShadow: '0 12px 30px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.06)',
            },
        }) as any,
    },
    filterPopoverItem: {
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 8,
    },
    filterPopoverText: {
        ...Typography.default(),
        fontSize: 13,
    },

    // List
    listContent: {
        paddingHorizontal: 16,
    },
    emptyContainer: {
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 60,
        gap: 12,
    },
    emptyText: {
        ...Typography.default(),
        fontSize: 14,
    },

    // Token expired
    tokenExpiredCard: {
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 60,
        paddingHorizontal: 32,
        gap: 12,
    },
    tokenExpiredTitle: {
        ...Typography.default('semiBold'),
        fontSize: 16,
        textAlign: 'center',
    },
    tokenExpiredDesc: {
        ...Typography.default(),
        fontSize: 14,
        textAlign: 'center',
    },
    reconnectButton: {
        marginTop: 8,
        paddingHorizontal: 20,
        paddingVertical: 10,
        borderRadius: 20,
    },
    reconnectButtonText: {
        ...Typography.default('semiBold'),
        fontSize: 14,
    },

    // Repo picker sheet
    sheetHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 20,
        paddingVertical: 8,
    },
    sheetTitle: {
        ...Typography.default('semiBold'),
        fontSize: 17,
    },
    sheetCloseButton: {
        width: 30,
        height: 30,
        borderRadius: 99,
        alignItems: 'center',
        justifyContent: 'center',
    },
    sheetCountRow: {
        paddingHorizontal: 20,
        paddingBottom: 8,
    },
    sheetCountText: {
        fontSize: 13,
    },
    sheetSearchContainer: {
        paddingHorizontal: 16,
        paddingBottom: 10,
    },
    sheetSearchBox: {
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: 12,
        paddingHorizontal: 14,
        height: 40,
        gap: 8,
        borderWidth: 1,
    },
    repoItem: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 20,
        paddingVertical: 12,
    },
    repoAvatar: {
        width: 32,
        height: 32,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
    },
    repoAvatarText: {
        ...Typography.default('semiBold'),
        fontSize: 13,
    },
    repoItemContent: {
        flex: 1,
        gap: 2,
    },
    repoItemNameRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    repoItemOwner: {
        ...Typography.default(),
        fontSize: 14,
    },
    repoItemName: {
        ...Typography.default('semiBold'),
        fontSize: 14,
        flexShrink: 1,
    },
    repoItemMeta: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    repoItemLang: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    langDot: {
        width: 7,
        height: 7,
        borderRadius: 99,
    },
    repoItemMetaText: {
        ...Typography.default(),
        fontSize: 12,
    },
}));

const issueStyles = StyleSheet.create((theme) => ({
    row: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 10,
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.divider,
    },
    dot: {
        width: 10,
        height: 10,
        borderRadius: 5,
        marginTop: 5,
    },
    content: {
        flex: 1,
    },
    title: {
        ...Typography.default('semiBold'),
        fontSize: 14,
        color: theme.colors.text,
    },
    meta: {
        ...Typography.default(),
        fontSize: 12,
        marginTop: 4,
    },
    labelsRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 4,
        marginTop: 6,
    },
    labelPill: {
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 12,
    },
    labelText: {
        fontSize: 11,
        ...Typography.default('semiBold'),
    },
}));
