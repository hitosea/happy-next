import * as React from 'react';
import { View, FlatList, Pressable, RefreshControl, Platform, ActivityIndicator } from 'react-native';
import { Text } from '@/components/StyledText';
import { useRouter } from 'expo-router';
import { useNavigation } from '@react-navigation/native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';
import { layout } from '@/components/layout';
import type { RepoInfo } from '@/data/mockRepos';
import { t } from '@/text';
import { useGithubRepos } from '@/hooks/useGithubData';
import {
    RepoCard,
    RepoListSkeleton,
    RepoEmptyState,
    RepoSearchBar,
} from '@/components/repos';

export default function ReposListScreen() {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const router = useRouter();
    const navigation = useNavigation();
    const [search, setSearch] = React.useState('');
    const [debouncedSearch, setDebouncedSearch] = React.useState('');
    const [searchVisible, setSearchVisible] = React.useState(false);

    React.useEffect(() => {
        const timer = setTimeout(() => setDebouncedSearch(search), 300);
        return () => clearTimeout(timer);
    }, [search]);

    const { data: githubRepos, loading: githubLoading, loadingMore, hasMore, totalCount, loadMore, refresh: refreshGithubRepos } = useGithubRepos({
        search: debouncedSearch || undefined,
    });

    React.useEffect(() => {
        navigation.setOptions({
            headerRight: () =>
                searchVisible ? null : (
                    <View style={styles.headerRight}>
                        <Pressable onPress={() => setSearchVisible(true)} hitSlop={8} style={styles.headerBtn}>
                            <Ionicons name="search" size={21} color={theme.colors.header.tint} />
                        </Pressable>
                    </View>
                ),
        });
    }, [navigation, router, theme, searchVisible, styles]);

    const handleRefresh = React.useCallback(() => {
        refreshGithubRepos();
    }, [refreshGithubRepos]);

    const renderItem = React.useCallback(({ item, index }: { item: RepoInfo; index: number }) => {
        const isLast = index === githubRepos.length - 1;
        return (
            <RepoCard
                data={item}
                onPress={() => router.push(`/repos/${item.owner}/${item.name}`)}
                showDivider={!isLast}
            />
        );
    }, [router, githubRepos.length]);

    const listEmpty = React.useMemo(() => {
        if (githubLoading) return <RepoListSkeleton count={4} />;
        return (
            <RepoEmptyState
                icon="folder-open-outline"
                title={t('lab.emptyTitle')}
                subtitle={t('lab.emptySubtitle')}
            />
        );
    }, [githubLoading]);

    return (
        <View style={styles.container}>
            {searchVisible ? (
                <RepoSearchBar
                    value={search}
                    onChange={setSearch}
                    placeholder={t('lab.searchPlaceholder')}
                    expanded
                    onExpand={() => setSearchVisible(true)}
                    onCollapse={() => {
                        setSearchVisible(false);
                        setSearch('');
                    }}
                    cancelLabel={t('common.cancel')}
                />
            ) : null}

            <FlatList
                data={githubRepos}
                keyExtractor={(item) => item.fullName}
                renderItem={renderItem}
                refreshControl={
                    <RefreshControl
                        refreshing={githubLoading}
                        onRefresh={handleRefresh}
                        tintColor={theme.colors.textSecondary}
                    />
                }
                contentContainerStyle={[
                    styles.listContent,
                    githubRepos.length === 0 && { flex: 1 },
                    { maxWidth: layout.maxWidth, alignSelf: 'center', width: '100%' },
                ]}
                ListEmptyComponent={listEmpty}
                ListHeaderComponent={githubRepos.length > 0 ? (
                    <View style={styles.listCardTop}>
                        <Text style={styles.listCountText}>{totalCount ? `${githubRepos.length} / ${totalCount}` : githubRepos.length} repositories</Text>
                    </View>
                ) : null}
                onEndReached={hasMore ? loadMore : undefined}
                onEndReachedThreshold={0.5}
                ListFooterComponent={
                    loadingMore ? (
                        <ActivityIndicator style={{ paddingVertical: 16 }} color={theme.colors.textSecondary} />
                    ) : githubRepos.length > 0 ? (
                        <View style={styles.listCardBottom} />
                    ) : null
                }
            />
        </View>
    );
}

const stylesheet = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        backgroundColor: theme.colors.groupped.background,
    },
    listContent: {
        paddingHorizontal: 16,
        paddingTop: 12,
        paddingBottom: 24,
    },
    listCardTop: {
        backgroundColor: theme.colors.surface,
        borderTopLeftRadius: 14,
        borderTopRightRadius: 14,
        borderTopWidth: 1,
        borderLeftWidth: 1,
        borderRightWidth: 1,
        borderColor: theme.colors.divider,
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderBottomWidth: Platform.select({ ios: 0.33, default: 1 }),
        borderBottomColor: theme.colors.divider,
    },
    listCountText: {
        fontSize: 13,
        fontWeight: '600',
        color: theme.colors.text,
    },
    listCardBottom: {
        backgroundColor: theme.colors.surface,
        borderBottomLeftRadius: 14,
        borderBottomRightRadius: 14,
        borderBottomWidth: 1,
        borderLeftWidth: 1,
        borderRightWidth: 1,
        borderColor: theme.colors.divider,
        height: 2,
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
