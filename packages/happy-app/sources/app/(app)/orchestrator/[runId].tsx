import * as React from 'react';
import { View, ScrollView, ActivityIndicator, Pressable, RefreshControl, Platform } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Text } from '@/components/StyledText';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';
import { layout } from '@/components/layout';
import { useAuth } from '@/auth/AuthContext';
import { ActionMenuModal } from '@/components/ActionMenuModal';
import type { ActionMenuItem } from '@/components/ActionMenu';
import { cancelOrchestratorRun, getOrchestratorRun, pendOrchestratorRun, type OrchestratorRunDetail } from '@/sync/apiOrchestrator';
import { sync } from '@/sync/sync';
import { OrchestratorStatusBadge } from '@/components/orchestrator/OrchestratorStatusBadge';
import { OrchestratorProgressBar } from '@/components/orchestrator/OrchestratorProgressBar';
import { OrchestratorDuration } from '@/components/orchestrator/OrchestratorDuration';
import { OrchestratorTimelineDot, OrchestratorTimelineHeaderLines, OrchestratorTimelineLine } from '@/components/orchestrator/OrchestratorTimeline';
import {
    formatOrchestratorProviderLabel,
    resolveOrchestratorTaskName,
    resolveTaskMachineId,
    resolveMachineName,
    resolveOrchestratorAttemptDisplay,
    resolveOrchestratorSummaryLineDataFromTasks,
    resolveRunDurationMs,
    resolveTaskDurationMs,
    sanitizeOrchestratorOutputSummary,
} from '@/components/orchestrator/display';
import { useMachineNameMap } from '@/hooks/useMachineNameMap';
import { isRunActive } from '@/components/orchestrator/status';
import { Modal } from '@/modal';
import { delay } from '@/utils/time';
import { formatDate } from '@/utils/formatDate';
import { t } from '@/text';

import { softHeaderOptions } from '@/components/navigation/softHeader';
import { headerMenuOptions } from '@/components/navigation/headerMenu';
import { hasWebTextSelection } from '@/components/webTextSelection';

// Mouse users copy what they select here (the desktop app is web too); a drag-select must not count as a tap on the row it is in
const IS_WEB = Platform.OS === 'web';

const stylesheet = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        backgroundColor: theme.colors.groupped.background,
    },
    contentContainer: {
        paddingBottom: 24,
    },
    // Flat blocks on the grouped background; an inset hairline between tasks, as in an iOS list
    summarySection: {
        padding: 16,
    },
    // Timeline rows on the grouped background: a status dot on a rail at the left, no horizontal rules
    taskRow: {
        flexDirection: 'row',
        paddingHorizontal: 16,
    },
    taskBody: {
        flex: 1,
    },
    // The header holds the dot and the task's first line, so the dot centers on that line itself
    timelineHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 14,
    },
    timelineHeaderLine: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
    },
    taskRest: {
        flexDirection: 'row',
        gap: 10,
    },
    taskRestContent: {
        flex: 1,
        paddingBottom: 14,
    },
    sectionTitle: {
        fontSize: 16,
        fontWeight: '700',
        color: theme.colors.text,
        marginBottom: 8,
    },
    metaText: {
        fontSize: 13,
        color: theme.colors.textSecondary,
    },
    title: {
        flex: 1,
        fontSize: 20,
        fontWeight: '700',
        color: theme.colors.text,
    },
    summaryLine: {
        marginTop: 8,
        fontSize: 13,
        color: theme.colors.textSecondary,
    },
    progressBar: {
        marginTop: 10,
    },
    sectionLabel: {
        fontSize: 16,
        fontWeight: '700',
        color: theme.colors.text,
        paddingHorizontal: 16,
        paddingTop: 16,
        paddingBottom: 4,
    },
    taskHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
    },
    taskTitle: {
        flex: 1,
        fontSize: 15,
        fontWeight: '600',
        color: theme.colors.text,
    },
    taskMeta: {
        marginTop: 6,
        fontSize: 12,
        color: theme.colors.textSecondary,
    },
    depWrap: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 6,
        marginTop: 8,
    },
    depPill: {
        borderWidth: 1,
        borderColor: theme.colors.divider,
        borderRadius: 999,
        paddingHorizontal: 8,
        paddingVertical: 4,
        backgroundColor: theme.colors.surfaceHighest,
    },
    depText: {
        fontSize: 11,
        color: theme.colors.textSecondary,
    },
    outputSummary: {
        marginTop: 8,
        fontSize: 13,
        color: theme.colors.text,
    },
    center: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 24,
    },
    error: {
        marginTop: 12,
        color: theme.colors.textDestructive,
        textAlign: 'center',
    },
    menuButton: {
        paddingHorizontal: 8,
        paddingVertical: 4,
    },
}));

export default function OrchestratorRunDetailScreen() {
    const { theme } = useUnistyles();
    const styles = stylesheet;
    const { runId, initialTitle } = useLocalSearchParams<{ runId: string; initialTitle?: string | string[]; }>();
    const router = useRouter();
    const auth = useAuth();
    const credentials = auth.credentials;
    const machineNameMap = useMachineNameMap();
    const routeTitle = Array.isArray(initialTitle) ? initialTitle[0] : initialTitle;
    const defaultHeaderTitle = routeTitle || t('settings.orchestratorRunDetails');

    const [run, setRun] = React.useState<OrchestratorRunDetail | null>(null);
    const [loading, setLoading] = React.useState(true);
    const [refreshing, setRefreshing] = React.useState(false);
    const [canceling, setCanceling] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const [menuVisible, setMenuVisible] = React.useState(false);

    const loadRun = React.useCallback(async (opts?: { silent?: boolean; }) => {
        if (!credentials || !runId) {
            return;
        }
        if (!opts?.silent) {
            setLoading(true);
        }
        try {
            setError(null);
            const data = await getOrchestratorRun(credentials, sync.encryption, runId, {
                includeTasks: true,
                includeExecutions: true,
            });
            setRun(data);
        } catch (err) {
            setError(err instanceof Error ? err.message : t('settings.orchestratorRunLoadError'));
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [credentials, runId]);

    const handleRefresh = React.useCallback(() => {
        setRefreshing(true);
        void loadRun({ silent: true });
    }, [loadRun]);

    const handleCancelRun = React.useCallback(async () => {
        if (!credentials || !runId || !run) {
            return;
        }
        if (!isRunActive(run.status) || run.status === 'canceling') {
            return;
        }

        const confirmed = await Modal.confirm(
            t('settings.orchestratorCancelTitle'),
            t('settings.orchestratorCancelMessage'),
            {
                confirmText: t('settings.orchestratorCancelConfirm'),
                destructive: true,
            },
        );
        if (!confirmed) {
            return;
        }

        try {
            setCanceling(true);
            await cancelOrchestratorRun(credentials, runId, 'Cancelled from app');
            await loadRun({ silent: true });
        } catch (err) {
            Modal.alert(t('settings.orchestratorCancelFailedTitle'), err instanceof Error ? err.message : t('settings.orchestratorCancelFailedMessage'));
        } finally {
            setCanceling(false);
        }
    }, [credentials, runId, run, loadRun]);

    useFocusEffect(React.useCallback(() => {
        if (!credentials || !runId) {
            return () => undefined;
        }

        let cancelled = false;
        let cursor: string | undefined;
        let pendController: AbortController | null = null;

        const loop = async () => {
            await loadRun({ silent: false });
            while (!cancelled) {
                try {
                    pendController = new AbortController();
                    const pend = await pendOrchestratorRun(credentials, sync.encryption, runId, {
                        cursor,
                        waitFor: 'change',
                        timeoutMs: 25_000,
                        include: 'all_tasks',
                    }, {
                        signal: pendController.signal,
                    });
                    pendController = null;
                    if (cancelled) {
                        break;
                    }
                    cursor = pend.cursor;
                    if (pend.changed) {
                        await loadRun({ silent: true });
                        if (cancelled) {
                            break;
                        }
                    }
                    if (pend.terminal) {
                        break;
                    }
                } catch (error) {
                    pendController = null;
                    if (!cancelled) {
                        if (error instanceof Error && error.name === 'AbortError') {
                            break;
                        }
                        await delay(1500);
                    }
                }
            }
        };

        void loop();

        return () => {
            cancelled = true;
            pendController?.abort();
        };
    }, [credentials, runId, loadRun]));

    const canCancel = !!run && isRunActive(run.status) && run.status !== 'canceling';
    const runSummaryLine = run ? resolveOrchestratorSummaryLineDataFromTasks(run.summary, run.tasks) : null;

    const menuItems = React.useMemo<ActionMenuItem[]>(() => {
        if (!canCancel) {
            return [];
        }
        return [{
            label: canceling || run?.status === 'canceling'
                ? t('settings.orchestratorCanceling')
                : t('settings.orchestratorCancel'),
            destructive: true,
            onPress: handleCancelRun,
        }];
    }, [canCancel, canceling, run?.status, handleCancelRun]);

    if (loading && !run) {
        return (
            <View style={styles.center}>
                <Stack.Screen options={{ ...softHeaderOptions, headerTitle: defaultHeaderTitle }} />
                <ActivityIndicator size="large" />
                <Text selectable={IS_WEB} style={styles.metaText}>{t('settings.orchestratorLoadingRun')}</Text>
            </View>
        );
    }

    if (!run) {
        return (
            <View style={styles.center}>
                <Stack.Screen options={{ ...softHeaderOptions, headerTitle: defaultHeaderTitle }} />
                <Text selectable={IS_WEB} style={styles.sectionTitle}>{t('settings.orchestratorRunNotFound')}</Text>
                {!!error && <Text selectable={IS_WEB} style={styles.error}>{error}</Text>}
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <Stack.Screen
                options={{
                    ...softHeaderOptions,
                    headerTitle: run.title || t('settings.orchestratorRunDetails'),
                    headerRight: canCancel ? () => (
                        <Pressable
                            style={styles.menuButton}
                            onPress={() => setMenuVisible(true)}
                        >
                            <Ionicons name="ellipsis-horizontal" size={22} color={theme.colors.header.tint} />
                        </Pressable>
                    ) : undefined,
                    ...headerMenuOptions(canCancel ? menuItems : null),
                }}
            />
            <ActionMenuModal
                visible={menuVisible}
                items={menuItems}
                onClose={() => setMenuVisible(false)}
            />
            <ScrollView
                contentInsetAdjustmentBehavior="automatic"
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={theme.colors.textSecondary} />}
                contentContainerStyle={[
                    styles.contentContainer,
                    { maxWidth: layout.maxWidth, alignSelf: 'center', width: '100%' },
                ]}
            >
                <View style={styles.summarySection}>
                    <View style={styles.taskHeader}>
                        <Text selectable={IS_WEB} style={styles.title}>{run.title}</Text>
                        <OrchestratorStatusBadge status={run.status} />
                    </View>
                    <Text selectable={IS_WEB} style={styles.summaryLine}>{t('settings.orchestratorLabelRunId')}: {run.runId}</Text>
                    <Text selectable={IS_WEB} style={styles.summaryLine}>{t('settings.orchestratorLabelCreated')}: {formatDate(run.createdAt)}</Text>
                    <Text selectable={IS_WEB} style={styles.summaryLine}>{t('settings.orchestratorLabelUpdated')}: {formatDate(run.updatedAt)}</Text>
                    <OrchestratorDuration
                        style={styles.summaryLine}
                        label={t('settings.orchestratorLabelDuration')}
                        live={isRunActive(run.status)}
                        resolve={(now) => resolveRunDurationMs(run, now)}
                    />
                    <View style={styles.progressBar}>
                        <OrchestratorProgressBar summary={run.summary} />
                    </View>
                    <Text selectable={IS_WEB} style={styles.summaryLine}>
                        {t('settings.orchestratorSummaryLine', {
                            total: runSummaryLine?.total ?? run.summary.total,
                            running: runSummaryLine?.running ?? run.summary.running,
                            completed: runSummaryLine?.completed ?? run.summary.completed,
                            failed: runSummaryLine?.failed ?? run.summary.failed,
                            cancelled: runSummaryLine?.cancelled ?? run.summary.cancelled,
                        })}
                    </Text>
                </View>

                <Text selectable={IS_WEB} style={styles.sectionLabel}>{t('settings.orchestratorTasksTitle')}</Text>
                {(run.tasks ?? []).map((task, index, allTasks) => {
                    const attempt = resolveOrchestratorAttemptDisplay(task);
                    const providerLabel = formatOrchestratorProviderLabel(task);
                    const outputSummary = sanitizeOrchestratorOutputSummary(task.outputSummary);
                    return (
                        <Pressable
                            key={task.taskId}
                            style={styles.taskRow}
                            onPress={() => !hasWebTextSelection() && router.push(`/orchestrator/${run.runId}/task/${task.taskId}`)}
                        >
                            <View style={styles.taskBody}>
                                <View style={styles.timelineHeader}>
                                    <OrchestratorTimelineHeaderLines
                                        above={index > 0}
                                        below={index < allTasks.length - 1}
                                    />
                                    <OrchestratorTimelineDot status={task.status} />
                                    <View style={styles.timelineHeaderLine}>
                                        <Text selectable={IS_WEB} style={styles.taskTitle} numberOfLines={1}>
                                            #{task.seq} {resolveOrchestratorTaskName(task) ?? t('settings.orchestratorProviderTask', { provider: task.provider })}
                                        </Text>
                                        <OrchestratorStatusBadge status={task.status} />
                                    </View>
                                </View>
                                <View style={styles.taskRest}>
                                    <OrchestratorTimelineLine visible={index < allTasks.length - 1} />
                                    <View style={styles.taskRestContent}>
                                        <Text selectable={IS_WEB} style={styles.taskMeta}>
                                            {t('settings.orchestratorTaskMeta', { provider: providerLabel, current: attempt.current, max: attempt.max })}
                                        </Text>
                                        {(() => {
                                            const machineId = resolveTaskMachineId(task);
                                            return machineId ? (
                                                <Text selectable={IS_WEB} style={styles.taskMeta}>
                                                    {t('settings.orchestratorLabelMachine')}: {resolveMachineName(machineId, machineNameMap)}
                                                </Text>
                                            ) : null;
                                        })()}
                                        <OrchestratorDuration
                                            style={styles.taskMeta}
                                            label={t('settings.orchestratorLabelDuration')}
                                            live={task.status === 'running'}
                                            resolve={(now) => resolveTaskDurationMs(task, now)}
                                        />
                                        {task.taskKey ? (
                                            <Text selectable={IS_WEB} style={styles.taskMeta}>{t('settings.orchestratorLabelTaskKey')}: {task.taskKey}</Text>
                                        ) : null}
                                        {task.dependsOn.length > 0 ? (
                                            <View style={styles.depWrap}>
                                                {task.dependsOn.map((dependencyKey) => (
                                                    <View key={`${task.taskId}-${dependencyKey}`} style={styles.depPill}>
                                                        <Text selectable={IS_WEB} style={styles.depText}>{t('settings.orchestratorDependsOnKey', { key: dependencyKey })}</Text>
                                                    </View>
                                                ))}
                                            </View>
                                        ) : null}
                                        {outputSummary ? <Text selectable={IS_WEB} style={styles.outputSummary}>{outputSummary}</Text> : null}
                                    </View>
                                </View>
                            </View>
                        </Pressable>
                    );
                })}

                {!!error && <Text selectable={IS_WEB} style={styles.error}>{error}</Text>}
            </ScrollView>
        </View>
    );
}
