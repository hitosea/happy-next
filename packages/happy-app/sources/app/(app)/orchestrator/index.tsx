import * as React from 'react';
import { View, FlatList, Pressable, ActivityIndicator, RefreshControl, Platform } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Text } from '@/components/StyledText';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { layout } from '@/components/layout';
import { useAuth } from '@/auth/AuthContext';
import { getOrchestratorRunCounts, listOrchestratorRuns, type ListOrchestratorRunsQuery, type OrchestratorRunCounts, type OrchestratorRunDetail, type OrchestratorRunKindFilter } from '@/sync/apiOrchestrator';
import type { BottomSheetModal } from '@gorhom/bottom-sheet';
import { OrchestratorRunFilterSheet, ORCHESTRATOR_RUN_KIND_ICONS, ORCHESTRATOR_RUN_STATUS_FILTERS, orchestratorRunKindLabel, useOrchestratorFilterMachines, type OrchestratorRunStatusFilter } from '@/components/orchestrator/OrchestratorRunFilterSheet';
import { sync } from '@/sync/sync';
import { OrchestratorStatusBadge } from '@/components/orchestrator/OrchestratorStatusBadge';
import { OrchestratorProgressBar } from '@/components/orchestrator/OrchestratorProgressBar';
import { OrchestratorTimelineDot, OrchestratorTimelineHeaderLines, OrchestratorTimelineLine } from '@/components/orchestrator/OrchestratorTimeline';
import { Ionicons } from '@expo/vector-icons';
import { resolveOrchestratorSummaryLineData, resolveMachineName, resolveOrchestratorRunKind } from '@/components/orchestrator/display';
import { useMachineNameMap } from '@/hooks/useMachineNameMap';
import { formatDate } from '@/utils/formatDate';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { isRunningOnMac } from '@/utils/platform';
import { softHeaderOptions } from '@/components/navigation/softHeader';
import { SearchField, searchFieldMetrics } from '@/components/SearchField';
import { useSession } from '@/sync/storage';
import { getSessionName } from '@/utils/sessionUtils';
import { hasWebTextSelection } from '@/components/webTextSelection';
import { useOrchestratorSessionFacets } from '@/hooks/useOrchestratorSessionFacets';

// Mouse users copy what they select here (the desktop app is web too); a drag-select must not count as a tap on the row it is in
const IS_WEB = Platform.OS === 'web';

type RunListItem = Pick<OrchestratorRunDetail, 'runId' | 'title' | 'status' | 'createdAt' | 'updatedAt' | 'summary' | 'machines' | 'providers'>;
const stylesheet = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        backgroundColor: theme.colors.groupped.background,
    },
    filterBar: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        maxWidth: layout.maxWidth,
        alignSelf: 'center',
        width: '100%',
        paddingHorizontal: 16,
        paddingTop: 12,
        paddingBottom: 16,
    },
    // The search box and the filter chip are DooTask's: white on the grouped background, no border
    searchField: {
        flex: 1,
    },
    filterChip: {
        flexDirection: 'row',
        alignItems: 'center',
        maxWidth: '45%',
        // As tall and as round as the search field beside it
        height: searchFieldMetrics.height,
        paddingHorizontal: 12,
        borderRadius: searchFieldMetrics.borderRadius,
        gap: 4,
        backgroundColor: theme.colors.surface,
    },
    filterChipActive: {
        backgroundColor: theme.colors.button.primary.background,
    },
    filterChipText: {
        flexShrink: 1,
        ...Typography.default(),
        fontSize: 13,
        color: theme.colors.text,
    },
    filterChipTextActive: {
        color: theme.colors.button.primary.tint,
    },
    listContent: {
        paddingBottom: 24,
    },
    // Timeline rows on the grouped background: a status dot on a rail at the left, no horizontal rules
    row: {
        flexDirection: 'row',
        paddingHorizontal: 16,
    },
    rowBody: {
        flex: 1,
    },
    // The header holds the dot and the title on one flex line, so the dot centers on that line itself
    cardHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 14,
    },
    cardHeaderLine: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
    },
    rowRest: {
        flexDirection: 'row',
        gap: 10,
    },
    rowRestContent: {
        flex: 1,
        paddingBottom: 14,
    },
    title: {
        flex: 1,
        fontSize: 16,
        fontWeight: '600',
        color: theme.colors.text,
    },
    meta: {
        marginTop: 8,
        fontSize: 12,
        color: theme.colors.textSecondary,
    },
    progressRow: {
        marginTop: 10,
    },
    summary: {
        marginTop: 8,
        fontSize: 12,
        color: theme.colors.textSecondary,
    },
    loadingMore: {
        paddingVertical: 16,
        alignItems: 'center',
    },
    emptyContainer: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 24,
    },
    emptyTitle: {
        fontSize: 18,
        fontWeight: '600',
        color: theme.colors.text,
    },
    emptySubtitle: {
        marginTop: 8,
        fontSize: 14,
        color: theme.colors.textSecondary,
        textAlign: 'center',
    },
    errorText: {
        marginTop: 8,
        fontSize: 14,
        color: theme.colors.textDestructive,
        textAlign: 'center',
    },
}));

function getFilterStatus(statusFilter: OrchestratorRunStatusFilter): ListOrchestratorRunsQuery['status'] | undefined {
    if (statusFilter === 'all') {
        return undefined;
    }
    return statusFilter;
}

export default function OrchestratorRunsScreen() {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const router = useRouter();
    const machineNameMap = useMachineNameMap();
    const searchParams = useLocalSearchParams<{ controllerSessionId?: string | string[]; }>();
    const auth = useAuth();
    const credentials = auth.credentials;
    const controllerSessionId = React.useMemo(() => (
        Array.isArray(searchParams.controllerSessionId)
            ? searchParams.controllerSessionId[0]
            : searchParams.controllerSessionId
    ), [searchParams.controllerSessionId]);
    const isConversationScoped = !!controllerSessionId;
    const controllerSession = useSession(controllerSessionId ?? '');
    // The conversation's name once its session is loaded, the generic subtitle until then
    const sessionSubtitle = controllerSession ? getSessionName(controllerSession) : t('settings.orchestratorSessionRuns');
    const navigation = useNavigation();
    const useNativeSoftHeader = Platform.OS === 'ios' && !isRunningOnMac();

    React.useEffect(() => {
        if (isConversationScoped) {
            navigation.setOptions({
                ...softHeaderOptions,
                headerTitle: useNativeSoftHeader ? t('settings.orchestratorRuns') : () => (
                    <View style={{ alignItems: 'center', justifyContent: 'center' }}>
                        <Text style={[Typography.default('semiBold'), { fontSize: 17, lineHeight: 24, color: theme.colors.header.tint, includeFontPadding: false }]}>
                            {t('settings.orchestratorRuns')}
                        </Text>
                        <Text numberOfLines={1} style={[Typography.default(), { fontSize: 12, color: theme.colors.header.tint, opacity: 0.7, marginTop: -2, includeFontPadding: false }]}>
                            {sessionSubtitle}
                        </Text>
                    </View>
                ),
                headerSubtitle: useNativeSoftHeader ? sessionSubtitle : undefined,
            });
        } else {
            navigation.setOptions({
                ...softHeaderOptions,
                headerTitle: t('settings.orchestratorRuns'),
                headerSubtitle: undefined,
            });
        }
    }, [isConversationScoped, navigation, theme, useNativeSoftHeader, sessionSubtitle]);

    const [statusFilter, setStatusFilter] = React.useState<OrchestratorRunStatusFilter>('all');
    const [searchText, setSearchText] = React.useState('');
    const [kindFilter, setKindFilter] = React.useState<OrchestratorRunKindFilter | undefined>(undefined);
    const [machineFilter, setMachineFilter] = React.useState<string | undefined>(undefined);
    const filterSheetRef = React.useRef<BottomSheetModal>(null);
    const filterMachines = useOrchestratorFilterMachines();
    // From a conversation the drawer offers only the machines and kinds its runs used
    const { facets: sessionFacets, merge: mergeSessionFacets } = useOrchestratorSessionFacets(credentials, controllerSessionId);
    const [runs, setRuns] = React.useState<RunListItem[]>([]);
    const [nextCursor, setNextCursor] = React.useState<string | undefined>(undefined);
    const [loading, setLoading] = React.useState(true);
    const [refreshing, setRefreshing] = React.useState(false);
    const [loadingMore, setLoadingMore] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const [counts, setCounts] = React.useState<OrchestratorRunCounts>({});

    const fetchCounts = React.useCallback(async () => {
        if (!credentials) return;
        try {
            const result = await getOrchestratorRunCounts(credentials, { controllerSessionId, kind: kindFilter, machineId: machineFilter });
            setCounts(result);
        } catch {
            // non-critical — counts are cosmetic
        }
    }, [credentials, controllerSessionId, kindFilter, machineFilter]);

    const fetchRuns = React.useCallback(async (opts?: { cursor?: string; append?: boolean; silent?: boolean; }) => {
        if (!credentials) {
            return;
        }
        const append = opts?.append === true;
        if (append) {
            setLoadingMore(true);
        } else if (!opts?.silent) {
            setLoading(true);
        }

        try {
            setError(null);
            const [result] = await Promise.all([
                listOrchestratorRuns(credentials, sync.encryption, {
                    status: getFilterStatus(statusFilter),
                    limit: 50,
                    cursor: opts?.cursor,
                    controllerSessionId,
                    kind: kindFilter,
                    machineId: machineFilter,
                }),
                // Refresh counts alongside the first page fetch (not for load-more)
                ...(!append ? [fetchCounts()] : []),
            ]);
            setRuns((previous) => append ? [...previous, ...result.items] : result.items);
            mergeSessionFacets(result.items);
            setNextCursor(result.nextCursor);
        } catch (err) {
            setError(err instanceof Error ? err.message : t('settings.orchestratorLoadError'));
        } finally {
            if (append) {
                setLoadingMore(false);
            } else {
                setLoading(false);
            }
            setRefreshing(false);
        }
    }, [credentials, controllerSessionId, statusFilter, kindFilter, machineFilter, fetchCounts, mergeSessionFacets]);

    const handleRefresh = React.useCallback(() => {
        setRefreshing(true);
        void fetchRuns({ silent: true });
    }, [fetchRuns]);

    const handleLoadMore = React.useCallback(() => {
        if (!nextCursor || loadingMore || loading) {
            return;
        }
        void fetchRuns({ cursor: nextCursor, append: true, silent: true });
    }, [fetchRuns, nextCursor, loadingMore, loading]);

    useFocusEffect(React.useCallback(() => {
        let active = true;
        void fetchRuns();

        const interval = setInterval(() => {
            if (!active) {
                return;
            }
            void fetchRuns({ silent: true });
        }, 5000);

        return () => {
            active = false;
            clearInterval(interval);
        };
    }, [fetchRuns]));

    // Titles are sealed end to end, so the server can't search them: the search narrows the runs loaded so far
    const searchQuery = searchText.trim().toLowerCase();
    const visibleRuns = React.useMemo(() => (
        searchQuery ? runs.filter((run) => run.title.toLowerCase().includes(searchQuery)) : runs
    ), [runs, searchQuery]);

    const renderRunItem = React.useCallback(({ item, index }: { item: RunListItem; index: number; }) => {
        const summaryLine = resolveOrchestratorSummaryLineData(item.summary);
        const kind = resolveOrchestratorRunKind(item.providers);
        return (
            <Pressable
                style={styles.row}
                onPress={() => !hasWebTextSelection() && router.push({
                    pathname: '/orchestrator/[runId]',
                    params: {
                        runId: item.runId,
                        initialTitle: item.title,
                    },
                })}
            >
                <View style={styles.rowBody}>
                    <View style={styles.cardHeader}>
                        <OrchestratorTimelineHeaderLines
                            above={index > 0}
                            below={index < visibleRuns.length - 1}
                        />
                        <OrchestratorTimelineDot status={item.status} />
                        <View style={styles.cardHeaderLine}>
                            {kind ? <Ionicons name={ORCHESTRATOR_RUN_KIND_ICONS[kind]} size={16} color={theme.colors.textSecondary} /> : null}
                            <Text selectable={IS_WEB} style={styles.title} numberOfLines={1}>{item.title}</Text>
                            <OrchestratorStatusBadge status={item.status} />
                        </View>
                    </View>
                    <View style={styles.rowRest}>
                        <OrchestratorTimelineLine visible={index < visibleRuns.length - 1} />
                        <View style={styles.rowRestContent}>
                            <Text selectable={IS_WEB} style={styles.meta}>
                                {t('settings.orchestratorUpdatedTime', { time: formatDate(item.updatedAt) })}
                            </Text>
                            <View style={styles.progressRow}>
                                <OrchestratorProgressBar summary={item.summary} />
                                <Text selectable={IS_WEB} style={styles.summary}>
                                    {t('settings.orchestratorSummaryLine', {
                                        total: summaryLine.total,
                                        running: summaryLine.running,
                                        completed: summaryLine.completed,
                                        failed: summaryLine.failed,
                                        cancelled: summaryLine.cancelled,
                                    })}
                                </Text>
                            </View>
                            {item.machines && item.machines.length > 0 ? (
                                <Text selectable={IS_WEB} style={styles.meta}>
                                    {t('settings.orchestratorRunMachines')}: {item.machines.map((id) => resolveMachineName(id, machineNameMap)).join(', ')}
                                </Text>
                            ) : null}
                        </View>
                    </View>
                </View>
            </Pressable>
        );
    }, [router, styles, theme, machineNameMap, visibleRuns.length]);

    const listEmpty = React.useMemo(() => {
        if (loading) {
            return (
                <View style={styles.emptyContainer}>
                    <ActivityIndicator size="large" />
                    <Text selectable={IS_WEB} style={styles.emptySubtitle}>{t('settings.orchestratorLoading')}</Text>
                </View>
            );
        }
        const filtered = statusFilter !== 'all' || !!kindFilter || !!machineFilter || searchText.trim().length > 0;
        return (
            <View style={styles.emptyContainer}>
                <Text selectable={IS_WEB} style={styles.emptyTitle}>{t('settings.orchestratorNoRuns')}</Text>
                <Text selectable={IS_WEB} style={styles.emptySubtitle}>
                    {isConversationScoped && !filtered
                        ? t('settings.orchestratorSessionRunsEmpty')
                        : t('settings.orchestratorNoRunsMatch')}
                </Text>
                {!!error && <Text selectable={IS_WEB} style={styles.errorText}>{error}</Text>}
            </View>
        );
    }, [loading, styles, error, isConversationScoped, statusFilter, kindFilter, machineFilter, searchText]);

    // The drawer's filters, as the button that opens it names them once any is set
    const filterMachine = machineFilter ? filterMachines.find((item) => item.id === machineFilter) : undefined;
    const sheetFilterLabel = [
        statusFilter !== 'all' ? ORCHESTRATOR_RUN_STATUS_FILTERS.find((filter) => filter.key === statusFilter)?.label : null,
        kindFilter ? orchestratorRunKindLabel(kindFilter) : null,
        machineFilter ? filterMachine?.metadata?.displayName || filterMachine?.metadata?.host || resolveMachineName(machineFilter, machineNameMap) : null,
    ].filter(Boolean).join(' · ');
    const hasSheetFilters = sheetFilterLabel.length > 0;
    const filterTint = hasSheetFilters ? theme.colors.button.primary.tint : theme.colors.textSecondary;

    const filterBar = (
        <View style={styles.filterBar}>
            <SearchField
                value={searchText}
                onChangeText={setSearchText}
                placeholder={t('settings.orchestratorSearchPlaceholder')}
                style={styles.searchField}
            />
            <Pressable
                style={[styles.filterChip, hasSheetFilters && styles.filterChipActive]}
                onPress={() => filterSheetRef.current?.present()}
            >
                <Text style={[styles.filterChipText, hasSheetFilters && styles.filterChipTextActive]} numberOfLines={1}>
                    {hasSheetFilters ? sheetFilterLabel : t('settings.orchestratorFilter')}
                </Text>
                <Ionicons name="chevron-down" size={12} color={filterTint} />
            </Pressable>
            <OrchestratorRunFilterSheet
                ref={filterSheetRef}
                status={statusFilter}
                counts={counts}
                onChangeStatus={setStatusFilter}
                kind={kindFilter}
                machineId={machineFilter}
                onChangeKind={setKindFilter}
                onChangeMachine={setMachineFilter}
                facets={sessionFacets}
            />
        </View>
    );

    const list = (
            <FlatList
                contentInsetAdjustmentBehavior="automatic"
                data={visibleRuns}
                keyExtractor={(item) => item.runId}
                renderItem={renderRunItem}
                onEndReached={handleLoadMore}
                onEndReachedThreshold={0.4}
                refreshControl={
                    <RefreshControl
                        refreshing={refreshing}
                        onRefresh={handleRefresh}
                        tintColor={theme.colors.textSecondary}
                    />
                }
                contentContainerStyle={[
                    styles.listContent,
                    visibleRuns.length === 0 && { flex: 1 },
                    { maxWidth: layout.maxWidth, alignSelf: 'center', width: '100%' },
                ]}
                ListFooterComponent={loadingMore ? (
                    <View style={styles.loadingMore}>
                        <ActivityIndicator />
                    </View>
                ) : null}
                ListEmptyComponent={listEmpty}
                // Under the see-through iOS header the filters scroll with the list: pinned, they
                // would sit on the runs with no backdrop right under the header's soft edge.
                ListHeaderComponent={useNativeSoftHeader ? filterBar : undefined}
            />
    );

    return (
        <View style={styles.container}>
            {useNativeSoftHeader ? list : (
                <>
                    {filterBar}
                    {list}
                </>
            )}
        </View>
    );
}
