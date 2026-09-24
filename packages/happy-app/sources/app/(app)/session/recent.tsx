import React from 'react';
import { View, FlatList, Pressable, ActivityIndicator, TextInput } from 'react-native';
import { Image } from 'expo-image';
import { Text } from '@/components/StyledText';
import { useAllSessions, useAllMachines, storage } from '@/sync/storage';
import { Session } from '@/sync/storageTypes';
import { Avatar, flavorIcons } from '@/components/Avatar';
import { generateCopyTitle, getSessionName, getSessionSubtitle, getSessionAvatarId, useSessionStatus, copySessionMetadata, copySessionModeSettings, forkQoderSessionForCopy } from '@/utils/sessionUtils';
import { StatusDot } from '@/components/StatusDot';
import { ActionMenuModal } from '@/components/ActionMenuModal';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';
import { layout } from '@/components/layout';
import { useNavigateToSession } from '@/hooks/useNavigateToSession';
import { Ionicons } from '@expo/vector-icons';
import { Modal } from '@/modal';
import { machineForkClaudeSession, machineForkGeminiSession, machineForkCodexSession, machineSpawnNewSession } from '@/sync/ops';
import { sync } from '@/sync/sync';
import { t } from '@/text';
import { MMKV } from 'react-native-mmkv';
import { hasForkableNativeId } from '@/utils/sessionLifecycle';
import { agentDisplayName, type AgentFlavor } from 'happy-wire';

const mmkv = new MMKV();
const SELECTED_MACHINE_KEY = 'session-history-selected-machine';
const SELECTED_AGENT_KEY = 'session-history-selected-agent';
const OLDER_SESSIONS_PAGE_SIZE = 150;

type AgentFilter = 'all' | 'claude' | 'gemini' | 'codex' | 'qoder';

const AGENT_FILTERS: { key: AgentFilter; label: () => string }[] = [
    { key: 'all', label: () => t('sessionHistory.allAgents') },
    { key: 'claude', label: () => t('agentHistory.tabClaude') },
    { key: 'gemini', label: () => t('agentHistory.tabGemini') },
    { key: 'codex', label: () => t('agentHistory.tabCodex') },
    { key: 'qoder', label: () => t('agentHistory.tabQoder') },
];

type ForkMode = 'resume' | 'copy';

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
    sessionCard: {
        backgroundColor: theme.colors.surface,
        marginHorizontal: 16,
        marginBottom: 1,
        paddingVertical: 16,
        paddingHorizontal: 16,
        flexDirection: 'row',
        alignItems: 'center',
    },
    sessionCardFirst: {
        borderTopLeftRadius: 12,
        borderTopRightRadius: 12,
    },
    sessionCardLast: {
        borderBottomLeftRadius: 12,
        borderBottomRightRadius: 12,
        marginBottom: 12,
    },
    sessionCardSingle: {
        borderRadius: 12,
        marginBottom: 12,
    },
    sessionContent: {
        flex: 1,
        marginLeft: 16,
    },
    sessionTitle: {
        fontSize: 15,
        fontWeight: '500',
        color: theme.colors.text,
        marginBottom: 2,
        ...Typography.default('semiBold'),
    },
    sessionSubtitle: {
        fontSize: 13,
        color: theme.colors.textSecondary,
        ...Typography.default(),
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
    rightSection: {
        flexDirection: 'row',
        alignItems: 'center',
        marginLeft: 8,
    },
    playButton: {
        width: 29,
        height: 29,
        alignItems: 'center',
        justifyContent: 'center',
    },
    statusRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 4,
    },
    statusDotContainer: {
        alignItems: 'center',
        justifyContent: 'center',
        height: 16,
        marginRight: 4,
    },
    statusText: {
        fontSize: 12,
        fontWeight: '500',
        lineHeight: 16,
        ...Typography.default(),
    },
    unreadDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: '#007AFF',
        marginRight: 6,
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
        paddingHorizontal: 8,
    },
    searchIcon: {
        marginRight: 6,
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
    const [resumingSessionId, setResumingSessionId] = React.useState<string | null>(null);
    const [searchQuery, setSearchQuery] = React.useState('');
    const [selectedMachineId, setSelectedMachineId] = React.useState<string | null>(() => {
        return mmkv.getString(SELECTED_MACHINE_KEY) || null;
    });
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

    const handleForkSession = React.useCallback(async (session: Session, mode: 'resume' | 'copy') => {
        if (resumingSessionId) return;
        const flavor = session.metadata?.flavor;
        const claudeSessionId = session.metadata?.claudeSessionId;
        const codexSessionId = session.metadata?.codexSessionId;
        const qoderSessionId = session.metadata?.qoderSessionId;
        const machineId = session.metadata?.machineId;
        const directory = session.metadata?.path;

        // Guard: must have a forkable session identifier
        if (!hasForkableNativeId(session)) return;
        if (!directory) {
            Modal.alert(t('common.error'), t('claudeHistory.pathUnavailable'));
            return;
        }
        if (!machineId) {
            Modal.alert(t('common.error'), t('claudeHistory.noMachines'));
            return;
        }

        const provider = agentDisplayName(flavor);
        const confirmTitle = mode === 'copy' ? t('sessionHistory.copyConfirmTitle') : t('sessionHistory.resumeConfirmTitle');
        const confirmMessage = mode === 'copy' ? t('sessionHistory.copyConfirmMessage', { provider }) : t('sessionHistory.resumeConfirmMessage', { provider });
        const confirmed = await Modal.confirm(
            confirmTitle,
            confirmMessage,
            { confirmText: t('common.continue'), cancelText: t('common.cancel') }
        );
        if (!confirmed) return;

        setResumingSessionId(session.id);
        try {
            const originalTitle = session.metadata?.summary?.text || getSessionName(session);
            let sessionTitle = originalTitle;
            if (mode === 'copy') {
                sessionTitle = generateCopyTitle(originalTitle);
            }

            let resumeSessionId: string | undefined;
            let agent: 'claude' | 'gemini' | 'codex' | 'qoder' = 'claude';

            if (flavor === 'gemini') {
                const forkResult = await machineForkGeminiSession(machineId, session.id);
                if (!forkResult.success || !forkResult.newSessionId) {
                    Modal.alert(t('common.error'), forkResult.errorMessage || t('claudeHistory.resumeFailed'));
                    return;
                }
                resumeSessionId = forkResult.newSessionId;
                agent = 'gemini';
            } else if (flavor === 'codex' && codexSessionId) {
                const forkResult = await machineForkCodexSession(machineId, codexSessionId, { restoreArchived: mode !== 'copy' });
                if (!forkResult.success || !forkResult.newFilePath) {
                    Modal.alert(t('common.error'), forkResult.errorMessage || t('claudeHistory.resumeFailed'));
                    return;
                }
                resumeSessionId = forkResult.newFilePath;
                agent = 'codex';
            } else if (claudeSessionId) {
                const forkResult = await machineForkClaudeSession(machineId, claudeSessionId);
                if (!forkResult.success || !forkResult.newSessionId) {
                    Modal.alert(t('common.error'), forkResult.errorMessage || t('claudeHistory.resumeFailed'));
                    return;
                }
                resumeSessionId = forkResult.newSessionId;
                agent = 'claude';
            } else if (flavor === 'qoder') {
                const qoderFork = await forkQoderSessionForCopy(machineId, qoderSessionId, directory);
                if ('error' in qoderFork) {
                    Modal.alert(t('common.error'), qoderFork.error ?? t('claudeHistory.resumeFailed'));
                    return;
                }
                resumeSessionId = qoderFork.newSessionId;
                agent = 'qoder';
            } else {
                return;
            }

            const result = await machineSpawnNewSession({
                machineId,
                directory,
                approvedNewDirectoryCreation: false,
                agent,
                resumeSessionId,
                sessionTitle,
                skipForkSession: true,
            });
            if (result.type === 'requestToApproveDirectoryCreation') {
                Modal.alert(t('common.error'), t('claudeHistory.directoryNotFound'));
                return;
            }
            if (result.type === 'error') {
                Modal.alert(t('common.error'), result.errorMessage || t('claudeHistory.resumeFailed'));
                return;
            }
            if (result.type === 'success') {
                await sync.refreshSessions();
                await copySessionMetadata(session, result.sessionId).catch(e => console.warn('copySessionMetadata failed:', e));
                copySessionModeSettings(session, result.sessionId);
                navigateToSession(result.sessionId);
            }
        } catch (error) {
            console.error('Failed to fork session', error);
            Modal.alert(t('common.error'), t('claudeHistory.resumeFailed'));
        } finally {
            setResumingSessionId(null);
        }
    }, [navigateToSession, resumingSessionId]);

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
                <SessionHistoryItemCard
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
    
    const searchHeader = React.useMemo(() => (
        <View>
            <View style={styles.searchContainer}>
                <View style={styles.searchInputWrapper}>
                    <Ionicons name="search" size={16} color={theme.colors.textSecondary} style={styles.searchIcon} />
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
                <Pressable
                    style={styles.filterTrigger}
                    onPress={() => setMachineMenuVisible(true)}
                >
                    <Ionicons name="desktop-outline" size={16} color={theme.colors.textSecondary} style={{ marginRight: 6 }} />
                    <Text style={styles.filterTriggerText} numberOfLines={1}>
                        {selectedMachine
                            ? (selectedMachine.metadata?.displayName || selectedMachine.metadata?.host || 'Unknown')
                            : t('sessionHistory.allDevices')}
                    </Text>
                    <Ionicons name="chevron-down" size={14} color={theme.colors.textSecondary} />
                </Pressable>

                <Pressable
                    style={styles.filterTrigger}
                    onPress={() => setAgentMenuVisible(true)}
                >
                    {selectedAgent !== 'all' ? (
                        <Image
                            source={flavorIcons[selectedAgent as AgentFlavor]}
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
                </Pressable>
            </View>
        </View>
    ), [searchQuery, theme, selectedMachine, selectedAgent]);

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
                {listContent}
            </View>
            <ActionMenuModal
                visible={machineMenuVisible}
                title={t('sessionHistory.allDevices')}
                items={[
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
                ]}
                onClose={() => setMachineMenuVisible(false)}
            />
            <ActionMenuModal
                visible={agentMenuVisible}
                title={t('sessionHistory.allAgents')}
                items={AGENT_FILTERS.map((filter) => ({
                    label: filter.label(),
                    selected: selectedAgent === filter.key,
                    onPress: () => setSelectedAgent(filter.key),
                }))}
                onClose={() => setAgentMenuVisible(false)}
            />
        </View>
    );
}

export default React.memo(SessionHistory);

const SessionHistoryItemCard = React.memo(({ session, isFirst, isLast, isSingle, isResuming, onPress, onFork }: {
    session: Session;
    isFirst?: boolean;
    isLast?: boolean;
    isSingle?: boolean;
    isResuming: boolean;
    onPress: () => void;
    onFork: (session: Session, mode: ForkMode) => void;
}) => {
    const { theme } = useUnistyles();
    const sessionStatus = useSessionStatus(session);
    const sessionName = getSessionName(session);
    const sessionSubtitle = getSessionSubtitle(session);
    const avatarId = getSessionAvatarId(session);
    const canFork = hasForkableNativeId(session);
    const isOnline = session.active;

    return (
        <Pressable
            style={[
                styles.sessionCard,
                isSingle ? styles.sessionCardSingle :
                isFirst ? styles.sessionCardFirst :
                isLast ? styles.sessionCardLast : {}
            ]}
            onPress={onPress}
        >
            <Avatar id={avatarId} size={48} monochrome={!sessionStatus.isConnected} flavor={session.metadata?.flavor} sessionIcon={session.metadata?.sessionIcon} />
            <View style={styles.sessionContent}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    {sessionStatus.hasUnreadCompletion && (
                        <View style={styles.unreadDot} />
                    )}
                    <Text style={[styles.sessionTitle, { flex: 1 }]} numberOfLines={1}>
                        {sessionName}
                    </Text>
                </View>
                <Text style={styles.sessionSubtitle} numberOfLines={1}>
                    {sessionSubtitle}
                </Text>
                <View style={styles.statusRow}>
                    <View style={styles.statusDotContainer}>
                        <StatusDot color={sessionStatus.statusDotColor} isPulsing={sessionStatus.isPulsing} />
                    </View>
                    <Text style={[styles.statusText, { color: sessionStatus.statusColor }]}>
                        {sessionStatus.statusText}
                    </Text>
                </View>
            </View>
            <View style={styles.rightSection}>
                {canFork && !isResuming && (
                    <Pressable
                        style={styles.playButton}
                        onPress={(event) => {
                            event.stopPropagation?.();
                            onFork(session, isOnline ? 'copy' : 'resume');
                        }}
                    >
                        <Ionicons
                            name={isOnline ? "copy-outline" : "play-circle-outline"}
                            size={isOnline ? 22 : 29}
                            color={theme.colors.groupped.chevron}
                        />
                    </Pressable>
                )}
                {isResuming && (
                    <View style={styles.playButton}>
                        <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                    </View>
                )}
            </View>
        </Pressable>
    );
});
