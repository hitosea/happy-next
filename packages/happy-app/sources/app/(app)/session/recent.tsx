import React from 'react';
import { View, FlatList, Pressable, ActivityIndicator, TextInput } from 'react-native';
import { Image } from 'expo-image';
import { Text } from '@/components/StyledText';
import { useAllSessions, useAllMachines, storage } from '@/sync/storage';
import { Session } from '@/sync/storageTypes';
import { getSessionName, getSessionSubtitle } from '@/utils/sessionUtils';
import { SessionProjectLabelsContext, useSessionProjectLabels } from '@/hooks/useSessionProjectLabel';
import { ActionMenuModal } from '@/components/ActionMenuModal';
import type { ActionMenuItem } from '@/components/ActionMenu';
import { NativeMenu } from '@/components/NativeMenu';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';
import { layout } from '@/components/layout';
import { useNavigateToSession } from '@/hooks/useNavigateToSession';
import { Ionicons } from '@expo/vector-icons';
import { sync } from '@/sync/sync';
import { t } from '@/text';
import { MMKV } from 'react-native-mmkv';
import { useLocalSearchParams } from 'expo-router';
import { SessionHistoryCard } from '@/components/SessionHistoryCard';
import { useSessionFork } from '@/hooks/useSessionFork';

const mmkv = new MMKV();
const SELECTED_MACHINE_KEY = 'session-history-selected-machine';
const SELECTED_AGENT_KEY = 'session-history-selected-agent';
const OLDER_SESSIONS_PAGE_SIZE = 150;

type AgentFilter = 'all' | 'claude' | 'codex' | 'gemini' | 'qoder';

const AGENT_FILTERS: { key: AgentFilter; label: () => string }[] = [
    { key: 'all', label: () => t('sessionHistory.allAgents') },
    { key: 'claude', label: () => t('agentHistory.tabClaude') },
    { key: 'codex', label: () => t('agentHistory.tabCodex') },
    { key: 'gemini', label: () => t('agentHistory.tabGemini') },
    { key: 'qoder', label: () => t('agentHistory.tabQoder') },
];

const agentIcons: Record<string, any> = {
    claude: require('@/assets/images/icon-claude.png'),
    gemini: require('@/assets/images/icon-gemini.png'),
    codex: require('@/assets/images/icon-gpt.png'),
    qoder: require('@/assets/images/icon-qoder.png'),
};

interface SessionHistoryItem {
    type: 'session' | 'date-header';
    session?: Session;
    date?: string;
}

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'stretch',
        backgroundColor: theme.colors.groupped.background,
    },
    contentContainer: {
        flex: 1,
        maxWidth: layout.maxWidth,
    },
    dateHeader: {
        backgroundColor: theme.colors.groupped.background,
        paddingTop: 20,
        paddingBottom: 8,
        paddingHorizontal: 24,
    },
    dateHeaderText: {
        ...Typography.default('semiBold'),
        color: theme.colors.groupped.sectionTitle,
        fontSize: 14,
        fontWeight: '600',
        letterSpacing: 0.1,
    },
    emptyContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 32,
    },
    emptyText: {
        fontSize: 16,
        color: theme.colors.textSecondary,
        textAlign: 'center',
        ...Typography.default(),
    },
    footerContainer: {
        paddingVertical: 18,
        alignItems: 'center',
        justifyContent: 'center',
    },
    searchContainer: {
        paddingHorizontal: 16,
        paddingTop: 8,
        paddingBottom: 4,
    },
    searchInputWrapper: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: theme.colors.surface,
        borderRadius: 10,
        paddingHorizontal: 10,
    },
    searchInput: {
        flex: 1,
        fontSize: 15,
        lineHeight: 20,
        height: 36,
        color: theme.colors.text,
        ...Typography.default(),
    },
    clearButton: {
        padding: 4,
    },
    filterRow: {
        flexDirection: 'row',
        paddingHorizontal: 16,
        paddingTop: 6,
        paddingBottom: 4,
        gap: 8,
    },
    filterSlot: {
        flex: 1,
        height: 36,
    },
    filterTrigger: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: theme.colors.surface,
        borderRadius: 10,
        paddingHorizontal: 10,
        height: 36,
    },
    filterTriggerText: {
        flex: 1,
        fontSize: 14,
        color: theme.colors.text,
        ...Typography.default('semiBold'),
    },
}));

function formatDateHeader(date: Date): string {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
    const sessionDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    
    if (sessionDate.getTime() === today.getTime()) {
        return t('sessionHistory.today');
    } else if (sessionDate.getTime() === yesterday.getTime()) {
        return t('sessionHistory.yesterday');
    } else {
        const diffTime = today.getTime() - sessionDate.getTime();
        const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
        return t('sessionHistory.daysAgo', { count: diffDays });
    }
}

function groupSessionsByDate(sessions: Session[]): SessionHistoryItem[] {
    const activeSessions = sessions.filter(s => s.active);
    const inactiveSessions = sessions.filter(s => !s.active);

    const items: SessionHistoryItem[] = [];

    // Active sessions pinned at top, sorted by createdAt desc
    if (activeSessions.length > 0) {
        const sorted = activeSessions.slice().sort((a, b) => b.createdAt - a.createdAt);
        items.push({ type: 'date-header', date: t('sessionHistory.active') });
        sorted.forEach(sess => {
            items.push({ type: 'session', session: sess });
        });
    }

    // Inactive sessions sorted and grouped by updatedAt desc
    const sortedInactive = inactiveSessions
        .slice()
        .sort((a, b) => b.updatedAt - a.updatedAt);

    let currentDateString: string | null = null;
    let currentDateGroup: Session[] = [];

    for (const session of sortedInactive) {
        const dateString = new Date(session.updatedAt).toDateString();

        if (currentDateString !== dateString) {
            if (currentDateGroup.length > 0) {
                items.push({
                    type: 'date-header',
                    date: formatDateHeader(new Date(currentDateString!)),
                });
                currentDateGroup.forEach(sess => {
                    items.push({ type: 'session', session: sess });
                });
            }
            currentDateString = dateString;
            currentDateGroup = [session];
        } else {
            currentDateGroup.push(session);
        }
    }

    if (currentDateGroup.length > 0) {
        items.push({
            type: 'date-header',
            date: formatDateHeader(new Date(currentDateString!)),
        });
        currentDateGroup.forEach(sess => {
            items.push({ type: 'session', session: sess });
        });
    }

    return items;
}

function SessionHistory() {
    const { theme } = useUnistyles();
    const safeArea = useSafeAreaInsets();
    const allSessions = useAllSessions();
    const machines = useAllMachines();
    const navigateToSession = useNavigateToSession();
    const { resumingSessionId, forkSession: handleForkSession } = useSessionFork();
    const [searchQuery, setSearchQuery] = React.useState('');
    // Opened from a machine's page: start filtered to that machine.
    const { machineId: machineIdParam } = useLocalSearchParams<{ machineId?: string }>();
    const [selectedMachineId, setSelectedMachineId] = React.useState<string | null>(() => {
        return machineIdParam || mmkv.getString(SELECTED_MACHINE_KEY) || null;
    });
    React.useEffect(() => {
        if (machineIdParam) setSelectedMachineId(machineIdParam);
    }, [machineIdParam]);
    const [selectedAgent, setSelectedAgent] = React.useState<AgentFilter>(() => {
        const saved = mmkv.getString(SELECTED_AGENT_KEY);
        if (saved === 'claude' || saved === 'gemini' || saved === 'codex' || saved === 'qoder') return saved;
        return 'all';
    });
    const [machineMenuVisible, setMachineMenuVisible] = React.useState(false);
    const [agentMenuVisible, setAgentMenuVisible] = React.useState(false);
    const [paginationCursor, setPaginationCursor] = React.useState<{ updatedAt: number; id: string } | null>(null);
    const [loadingMore, setLoadingMore] = React.useState(false);
    const [hasMoreOlderSessions, setHasMoreOlderSessions] = React.useState(true);
    const [localOlderSessions, setLocalOlderSessions] = React.useState<Session[]>([]);
    const loadMoreInFlightRef = React.useRef(false);
    const autoLoadPageCountRef = React.useRef(0);
    const loadMoreCooldownUntilRef = React.useRef(0);

    const selectedMachine = React.useMemo(
        () => machines.find((m) => m.id === selectedMachineId) || null,
        [machines, selectedMachineId]
    );

    // Clear stale machineId if it no longer exists in the machines list
    React.useEffect(() => {
        if (selectedMachineId && machines.length > 0 && !machines.some(m => m.id === selectedMachineId)) {
            setSelectedMachineId(null);
        }
    }, [machines, selectedMachineId]);

    React.useEffect(() => {
        if (selectedMachineId) {
            mmkv.set(SELECTED_MACHINE_KEY, selectedMachineId);
        } else {
            mmkv.delete(SELECTED_MACHINE_KEY);
        }
    }, [selectedMachineId]);

    React.useEffect(() => {
        mmkv.set(SELECTED_AGENT_KEY, selectedAgent);
    }, [selectedAgent]);

    const mergedSessions = React.useMemo(() => {
        if (localOlderSessions.length === 0) return allSessions;
        const globalIds = new Set(allSessions.map(s => s.id));
        const localOnly = localOlderSessions.filter(s => !globalIds.has(s.id));
        if (localOnly.length === 0) return allSessions;
        return [...allSessions, ...localOnly].sort((a, b) => b.updatedAt - a.updatedAt);
    }, [allSessions, localOlderSessions]);

    const initialPaginationCursor = React.useMemo(() => {
        const oldestSession = mergedSessions[mergedSessions.length - 1];
        if (!oldestSession) return null;
        return { updatedAt: oldestSession.updatedAt, id: oldestSession.id };
    }, [mergedSessions]);

    const effectivePaginationCursor = paginationCursor ?? initialPaginationCursor;

    React.useEffect(() => {
        autoLoadPageCountRef.current = 0;
    }, [selectedMachineId, selectedAgent, searchQuery]);

    const filteredSessions = React.useMemo(() => {
        let result = mergedSessions;

        if (selectedMachineId) {
            result = result.filter(s => s.metadata?.machineId === selectedMachineId);
        }

        if (selectedAgent !== 'all') {
            result = result.filter(s => s.metadata?.flavor === selectedAgent);
        }

        const query = searchQuery.trim().toLowerCase();
        if (query) {
            result = result.filter(session => {
                const name = getSessionName(session).toLowerCase();
                const subtitle = getSessionSubtitle(session).toLowerCase();
                return name.includes(query) || subtitle.includes(query);
            });
        }

        return result;
    }, [mergedSessions, selectedMachineId, selectedAgent, searchQuery]);

    const groupedItems = React.useMemo(() => {
        return groupSessionsByDate(filteredSessions);
    }, [filteredSessions]);
    const projectLabel = useSessionProjectLabels(filteredSessions);
    
    const handleLoadMore = React.useCallback(async () => {
        if (!effectivePaginationCursor || loadingMore || !hasMoreOlderSessions || loadMoreInFlightRef.current) return;
        if (Date.now() < loadMoreCooldownUntilRef.current) return;
        if (autoLoadPageCountRef.current >= 5) return;

        loadMoreInFlightRef.current = true;
        autoLoadPageCountRef.current += 1;
        setLoadingMore(true);
        try {
            const page = await sync.fetchOlderSessionsPage({
                beforeUpdatedAt: effectivePaginationCursor.updatedAt,
                beforeId: effectivePaginationCursor.id,
                limit: OLDER_SESSIONS_PAGE_SIZE,
                persistToStore: false,
            });

            if (page.length > 0) {
                setLocalOlderSessions(prev => {
                    const existing = new Set(prev.map(s => s.id));
                    const additions = page.filter(s => !existing.has(s.id));
                    return additions.length === 0 ? prev : [...prev, ...additions];
                });
            }

            const last = page[page.length - 1];
            if (last) {
                setPaginationCursor({ updatedAt: last.updatedAt, id: last.id });
            }
            if (page.length < OLDER_SESSIONS_PAGE_SIZE) {
                setHasMoreOlderSessions(false);
            }
        } catch (error) {
            console.error('Failed to load older sessions', error);
            loadMoreCooldownUntilRef.current = Date.now() + 5000;
        } finally {
            setLoadingMore(false);
            loadMoreInFlightRef.current = false;
        }
    }, [effectivePaginationCursor, loadingMore, hasMoreOlderSessions]);


    const listFooter = React.useMemo(() => {
        if (!loadingMore) return null;
        return (
            <View style={styles.footerContainer}>
                <ActivityIndicator size="small" color={theme.colors.textSecondary} />
            </View>
        );
    }, [loadingMore, theme.colors.textSecondary]);

    const handleNavigateToSession = React.useCallback((session: Session) => {
        const state = storage.getState();
        if (!state.sessions[session.id] && !state.sharedSessions[session.id]) {
            state.applySessions([session]);
        }
        navigateToSession(session.id);
    }, [navigateToSession]);

    const renderItem = React.useCallback(({ item, index }: { item: SessionHistoryItem, index: number }) => {
        if (item.type === 'date-header') {
            return (
                <View style={styles.dateHeader}>
                    <Text style={styles.dateHeaderText}>
                        {item.date}
                    </Text>
                </View>
            );
        }

        if (item.type === 'session' && item.session) {
            // Determine card styling based on position within date group
            const prevItem = index > 0 ? groupedItems[index - 1] : null;
            const nextItem = index < groupedItems.length - 1 ? groupedItems[index + 1] : null;

            const isFirst = prevItem?.type === 'date-header';
            const isLast = nextItem?.type === 'date-header' || nextItem == null;
            const isSingle = isFirst && isLast;

            return (
                <SessionHistoryCard
                    session={item.session}
                    isFirst={isFirst}
                    isLast={isLast}
                    isSingle={isSingle}
                    isResuming={resumingSessionId === item.session.id}
                    onPress={() => handleNavigateToSession(item.session!)}
                    onFork={handleForkSession}
                />
            );
        }

        return null;
    }, [groupedItems, handleNavigateToSession, handleForkSession, resumingSessionId]);
    
    const keyExtractor = React.useCallback((item: SessionHistoryItem, index: number) => {
        if (item.type === 'date-header') {
            return `date-${item.date}-${index}`;
        }
        if (item.type === 'session' && item.session) {
            return `session-${item.session.id}`;
        }
        return `item-${index}`;
    }, []);
    
    const machineMenuItems = React.useMemo<ActionMenuItem[]>(() => [
        {
            label: t('sessionHistory.allDevices'),
            selected: selectedMachineId === null,
            onPress: () => setSelectedMachineId(null),
        },
        ...machines.map((machine) => ({
            label: machine.metadata?.displayName || machine.metadata?.host || 'Unknown',
            selected: machine.id === selectedMachineId,
            onPress: () => setSelectedMachineId(machine.id),
        })),
    ], [machines, selectedMachineId]);

    const agentMenuItems = React.useMemo<ActionMenuItem[]>(() => AGENT_FILTERS.map((filter) => ({
        label: filter.label(),
        selected: selectedAgent === filter.key,
        onPress: () => setSelectedAgent(filter.key),
    })), [selectedAgent]);

    const searchHeader = React.useMemo(() => (
        <View>
            <View style={styles.searchContainer}>
                <View style={styles.searchInputWrapper}>
                    <Ionicons name="search" size={16} color={theme.colors.textSecondary} style={{ marginRight: 6 }} />
                    <TextInput
                        style={styles.searchInput}
                        placeholder={t('sessionHistory.searchPlaceholder')}
                        placeholderTextColor={theme.colors.textSecondary}
                        value={searchQuery}
                        onChangeText={setSearchQuery}
                        autoCorrect={false}
                        autoCapitalize="none"
                    />
                    {searchQuery.length > 0 && (
                        <Pressable style={styles.clearButton} onPress={() => setSearchQuery('')}>
                            <Ionicons name="close-circle" size={18} color={theme.colors.textSecondary} />
                        </Pressable>
                    )}
                </View>
            </View>
            <View style={styles.filterRow}>
                <NativeMenu
                    items={machineMenuItems}
                    style={styles.filterSlot}
                    onFallbackOpen={() => setMachineMenuVisible(true)}
                >
                    <View style={styles.filterTrigger}>
                        <Ionicons name="desktop-outline" size={16} color={theme.colors.textSecondary} style={{ marginRight: 6 }} />
                        <Text style={styles.filterTriggerText} numberOfLines={1}>
                            {selectedMachine
                                ? (selectedMachine.metadata?.displayName || selectedMachine.metadata?.host || 'Unknown')
                                : t('sessionHistory.allDevices')}
                        </Text>
                        <Ionicons name="chevron-down" size={14} color={theme.colors.textSecondary} />
                    </View>
                </NativeMenu>

                <NativeMenu
                    items={agentMenuItems}
                    style={styles.filterSlot}
                    onFallbackOpen={() => setAgentMenuVisible(true)}
                >
                    <View style={styles.filterTrigger}>
                        {selectedAgent !== 'all' ? (
                            <Image
                                source={agentIcons[selectedAgent]}
                                style={{ width: 16, height: 16, marginRight: 6 }}
                                contentFit="contain"
                                tintColor={selectedAgent === 'codex' || selectedAgent === 'qoder' ? theme.colors.text : undefined}
                            />
                        ) : (
                            <Ionicons name="grid-outline" size={16} color={theme.colors.textSecondary} style={{ marginRight: 6 }} />
                        )}
                        <Text style={styles.filterTriggerText} numberOfLines={1}>
                            {AGENT_FILTERS.find(f => f.key === selectedAgent)?.label() || selectedAgent}
                        </Text>
                        <Ionicons name="chevron-down" size={14} color={theme.colors.textSecondary} />
                    </View>
                </NativeMenu>
            </View>
        </View>
    ), [searchQuery, theme, selectedMachine, selectedAgent, machineMenuItems, agentMenuItems]);

    if (!allSessions) {
        return (
            <View style={styles.container}>
                <View style={styles.contentContainer} />
            </View>
        );
    }

    const listContent = groupedItems.length === 0 ? (
        allSessions.length > 0 ? (
            <FlatList
                data={[]}
                contentInsetAdjustmentBehavior="automatic"
                renderItem={() => null}
                ListHeaderComponent={searchHeader}
                ListEmptyComponent={
                    <View style={styles.emptyContainer}>
                        <Text style={styles.emptyText}>
                            {t('sessionHistory.noResults')}
                        </Text>
                    </View>
                }
                ListFooterComponent={listFooter}
                onEndReached={handleLoadMore}
                onEndReachedThreshold={0.4}
                contentContainerStyle={{
                    paddingBottom: safeArea.bottom + 16,
                    paddingTop: 8,
                    flex: 1,
                }}
            />
        ) : (
            <View style={styles.emptyContainer}>
                <Text style={styles.emptyText}>
                    {t('sessionHistory.empty')}
                </Text>
            </View>
        )
    ) : (
        <FlatList
            data={groupedItems}
            contentInsetAdjustmentBehavior="automatic"
            renderItem={renderItem}
            keyExtractor={keyExtractor}
            ListHeaderComponent={searchHeader}
            ListFooterComponent={listFooter}
            onEndReached={handleLoadMore}
            onEndReachedThreshold={0.4}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{
                paddingBottom: safeArea.bottom + 16,
                paddingTop: 8,
            }}
        />
    );

    return (
        <View style={styles.container}>
            <View style={styles.contentContainer}>
                <SessionProjectLabelsContext.Provider value={projectLabel}>
                    {listContent}
                </SessionProjectLabelsContext.Provider>
            </View>
            <ActionMenuModal
                visible={machineMenuVisible}
                title={t('sessionHistory.allDevices')}
                items={machineMenuItems}
                onClose={() => setMachineMenuVisible(false)}
            />
            <ActionMenuModal
                visible={agentMenuVisible}
                title={t('sessionHistory.allAgents')}
                items={agentMenuItems}
                onClose={() => setAgentMenuVisible(false)}
            />
        </View>
    );
}

export default React.memo(SessionHistory);
