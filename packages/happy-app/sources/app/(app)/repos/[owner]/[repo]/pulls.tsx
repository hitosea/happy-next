import * as React from 'react';
import { View, Pressable, FlatList, ActivityIndicator } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';
import { type RepoPR } from '@/data/mockRepos';
import { useGithubPulls } from '@/hooks/useGithubData';
import {
    PR_FILTERS,
    filterPRs,
    type PRFilter,
} from '@/data/repoUtils';
import {
    PullCard,
    FilterChipRow,
    RepoSearchBar,
    IssueListSkeleton,
    RepoEmptyState,
} from '@/components/repos';
import { t } from '@/text';

export default function RepoPullsScreen() {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const router = useRouter();
    const navigation = useNavigation();
    const { owner, repo: repoName } = useLocalSearchParams<{ owner: string; repo: string }>();

    const { data: pulls, loading: pullsLoading, loadingMore, hasMore, loadMore, refresh: refreshPulls } = useGithubPulls(owner!, repoName!, 'all');
    const lastRefreshRef = React.useRef(0);
    useFocusEffect(React.useCallback(() => {
        const now = Date.now();
        if (now - lastRefreshRef.current > 60_000) {
            lastRefreshRef.current = now;
            refreshPulls();
        }
    }, [refreshPulls]));

    const [prFilter, setPrFilter] = React.useState<PRFilter>('all');
    const [searchVisible, setSearchVisible] = React.useState(false);
    const [searchQuery, setSearchQuery] = React.useState('');

    React.useEffect(() => {
        navigation.setOptions({
            headerTitle: searchVisible ? '' : t('repository.pulls'),
            headerRight: searchVisible ? undefined : () => (
                <View style={styles.headerRight}>
                    <Pressable onPress={() => setSearchVisible(true)} hitSlop={8} style={styles.headerBtn}>
                        <Ionicons name="search" size={21} color={theme.colors.header.tint} />
                    </Pressable>
                    <Pressable onPress={() => router.push(`/repos/${owner}/${repoName}/pulls/new`)} hitSlop={8} style={styles.headerBtn}>
                        <Ionicons name="add" size={24} color={theme.colors.header.tint} />
                    </Pressable>
                </View>
            ),
        });
    }, [navigation, theme, searchVisible, owner, repoName, router, styles]);

    const filteredPulls = React.useMemo(() => {
        let result = filterPRs(pulls, prFilter);
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            result = result.filter((p) =>
                p.title.toLowerCase().includes(q) ||
                String(p.number).includes(q) ||
                p.author.toLowerCase().includes(q)
            );
        }
        return result;
    }, [pulls, prFilter, searchQuery]);

    const filtersWithCount = React.useMemo(() =>
        PR_FILTERS.map((f) => ({
            key: f.key,
            label: f.label,
            count: f.key === 'all' ? pulls.length
                : f.key === 'open' ? pulls.filter((p) => p.status === 'open').length
                : f.key === 'merged' ? pulls.filter((p) => p.status === 'merged').length
                : pulls.filter((p) => p.status === 'closed').length,
        })),
    [pulls]);

    const renderPullItem = React.useCallback(({ item, index }: { item: RepoPR; index: number }) => (
        <PullCard
            data={item}
            onPress={() => router.push(`/repos/${owner}/${repoName}/pulls/${item.number}`)}
            showDivider={index < filteredPulls.length - 1}
        />
    ), [router, owner, repoName, filteredPulls.length]);

    return (
        <View style={styles.container}>
            <Stack.Screen options={{ headerBackTitle: t('common.back') }} />

            {searchVisible ? (
                <RepoSearchBar
                    value={searchQuery}
                    onChange={setSearchQuery}
                    placeholder={t('repository.searchPullsPlaceholder')}
                    expanded
                    onExpand={() => setSearchVisible(true)}
                    onCollapse={() => { setSearchVisible(false); setSearchQuery(''); }}
                    cancelLabel={t('common.cancel')}
                />
            ) : null}

            <FilterChipRow filters={filtersWithCount} value={prFilter} onChange={setPrFilter} />

            {pullsLoading && pulls.length === 0 ? (
                <IssueListSkeleton count={5} />
            ) : filteredPulls.length === 0 ? (
                <RepoEmptyState
                    icon="git-pull-request-outline"
                    title={t('repository.emptyPullsTitle')}
                    subtitle={t('repository.emptyPullsSubtitle')}
                />
            ) : (
                <View style={styles.listWrap}>
                    <FlatList
                        data={filteredPulls}
                        keyExtractor={(item) => String(item.number)}
                        renderItem={renderPullItem}
                        contentContainerStyle={{ paddingBottom: 24 }}
                        onEndReached={hasMore ? loadMore : undefined}
                        onEndReachedThreshold={0.5}
                        ListFooterComponent={loadingMore ? (
                            <ActivityIndicator style={{ paddingVertical: 16 }} color={theme.colors.textSecondary} />
                        ) : null}
                    />
                </View>
            )}
        </View>
    );
}

const stylesheet = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        backgroundColor: theme.colors.groupped.background,
    },
    listWrap: {
        flex: 1,
        marginHorizontal: 16,
        marginTop: 4,
        marginBottom: 16,
        borderRadius: 14,
        overflow: 'hidden',
        backgroundColor: theme.colors.surface,
        borderWidth: 1,
        borderColor: theme.colors.divider,
    },
    headerRight: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 12,
    },
    headerBtn: {
        padding: 4,
    },
}));
