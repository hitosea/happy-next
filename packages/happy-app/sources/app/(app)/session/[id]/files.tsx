import * as React from 'react';
import { View, ActivityIndicator, Platform, TextInput, Pressable } from 'react-native';
import { t } from '@/text';
import { useRoute } from '@react-navigation/native';
import { useRouter, Stack } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons, Octicons } from '@expo/vector-icons';
import { Text } from '@/components/StyledText';
import { Item } from '@/components/Item';
import { ItemList } from '@/components/ItemList';
import { Typography } from '@/constants/Typography';
import { getGitStatusFiles, GitFileStatus, GitStatusFiles } from '@/sync/gitStatusFiles';
import { useSession, getSession } from '@/sync/storage';
import { sessionBash } from '@/sync/ops';
import { Modal } from '@/modal';
import { useUnistyles, StyleSheet } from 'react-native-unistyles';
import { layout } from '@/components/layout';
import { softHeaderOptions, useSoftHeaderInset } from '@/components/navigation/softHeader';
import { FileIcon } from '@/components/FileIcon';
import { ActionMenuModal } from '@/components/ActionMenuModal';
import { ActionMenuItem } from '@/components/ActionMenu';
import { shellEscape } from '@/utils/shellEscape';
import { getWorkspaceRepos } from '@/utils/workspaceRepos';
import { RepoSelector } from '@/components/RepoSelector';

export default function FilesScreen() {
    const route = useRoute();
    const router = useRouter();
    const sessionId = (route.params! as any).id as string;

    const [gitStatusFiles, setGitStatusFiles] = React.useState<GitStatusFiles | null>(null);
    const [isLoading, setIsLoading] = React.useState(true);
    const [searchQuery, setSearchQuery] = React.useState('');
    const { theme } = useUnistyles();
    const softHeaderInset = useSoftHeaderInset();
    const isWeb = Platform.OS === 'web';

    const session = useSession(sessionId);
    const isOnline = session?.presence === "online";
    const commandCwd = session?.metadata?.path || '';

    // Multi-repo workspace support
    const workspaceRepos = getWorkspaceRepos(session?.metadata);
    const [selectedRepoIndex, setSelectedRepoIndex] = React.useState(0);
    const selectedRepo = workspaceRepos[selectedRepoIndex];
    const repoBaseCwd = selectedRepo?.path || commandCwd;

    const [isOperating, setIsOperating] = React.useState(false);
    const [operatingAction, setOperatingAction] = React.useState<'stageAll' | 'unstageAll' | null>(null);
    const [menuVisible, setMenuVisible] = React.useState(false);
    const [menuItems, setMenuItems] = React.useState<ActionMenuItem[]>([]);

    const hasGitStatusFiles = React.useRef(false);

    // Load git status files
    const loadGitStatusFiles = React.useCallback(async (silent: boolean = false) => {
        try {
            // Check if the session is offline
            const currentSession = getSession(sessionId);
            if (currentSession?.presence !== 'online') {
                Modal.alert(
                    t('files.sessionOffline'),
                    t('files.sessionOfflineDescription'),
                    [{ text: t('common.ok'), onPress: () => router.back() }]
                );
                setIsLoading(false);
                return;
            }

            if (!silent) {
                setIsLoading(true);
            }
            const result = await getGitStatusFiles(sessionId, selectedRepo?.path);
            hasGitStatusFiles.current = result !== null;
            setGitStatusFiles(result);
        } catch (error) {
            console.error('Failed to load git status files:', error);
            if (!silent) {
                hasGitStatusFiles.current = false;
                setGitStatusFiles(null);
            }
        } finally {
            setIsLoading(false);
        }
    }, [sessionId, selectedRepo?.path, router]);

    // Stage a file
    const handleStageFile = React.useCallback(async (file: GitFileStatus) => {
        setIsOperating(true);
        setOperatingAction(null);
        try {
            const escapedPath = shellEscape(file.fullPath);
            await sessionBash(sessionId, {
                command: `git add -- ${escapedPath}`,
                cwd: repoBaseCwd,
                timeout: 10000,
            });
            await loadGitStatusFiles(true);
        } catch {
            Modal.alert(t('common.error'), t('status.operationFailed'));
        } finally {
            setIsOperating(false);
        }
    }, [sessionId, repoBaseCwd, loadGitStatusFiles]);

    // Unstage a file
    const handleUnstageFile = React.useCallback(async (file: GitFileStatus) => {
        setIsOperating(true);
        setOperatingAction(null);
        try {
            const escapedPath = shellEscape(file.fullPath);
            await sessionBash(sessionId, {
                command: `git reset HEAD -- ${escapedPath}`,
                cwd: repoBaseCwd,
                timeout: 10000,
            });
            await loadGitStatusFiles(true);
        } catch {
            Modal.alert(t('common.error'), t('status.operationFailed'));
        } finally {
            setIsOperating(false);
        }
    }, [sessionId, repoBaseCwd, loadGitStatusFiles]);

    // Stage all files
    const handleStageAll = React.useCallback(async () => {
        setIsOperating(true);
        setOperatingAction('stageAll');
        try {
            await sessionBash(sessionId, {
                command: 'git add -A',
                cwd: repoBaseCwd,
                timeout: 10000,
            });
            await loadGitStatusFiles(true);
        } catch {
            Modal.alert(t('common.error'), t('status.operationFailed'));
        } finally {
            setIsOperating(false);
            setOperatingAction(null);
        }
    }, [sessionId, repoBaseCwd, loadGitStatusFiles]);

    // Unstage all files
    const handleUnstageAll = React.useCallback(async () => {
        setIsOperating(true);
        setOperatingAction('unstageAll');
        try {
            await sessionBash(sessionId, {
                command: 'git reset HEAD',
                cwd: repoBaseCwd,
                timeout: 10000,
            });
            await loadGitStatusFiles(true);
        } catch {
            Modal.alert(t('common.error'), t('status.operationFailed'));
        } finally {
            setIsOperating(false);
            setOperatingAction(null);
        }
    }, [sessionId, repoBaseCwd, loadGitStatusFiles]);

    // Discard changes for a file
    const handleDiscardFile = React.useCallback(async (file: GitFileStatus) => {
        const confirmed = await Modal.confirm(
            t('status.discardTitle'),
            t('status.discardMessage', { fileName: file.fileName }),
            { destructive: true },
        );
        if (!confirmed) return;

        setIsOperating(true);
        setOperatingAction(null);
        try {
            const escapedPath = shellEscape(file.fullPath);
            if (file.status === 'untracked') {
                await sessionBash(sessionId, {
                    command: `git clean -f -- ${escapedPath}`,
                    cwd: repoBaseCwd,
                    timeout: 10000,
                });
            } else if (file.isStaged) {
                await sessionBash(sessionId, {
                    command: `git reset HEAD -- ${escapedPath} && git checkout -- ${escapedPath}`,
                    cwd: repoBaseCwd,
                    timeout: 10000,
                });
            } else {
                await sessionBash(sessionId, {
                    command: `git checkout -- ${escapedPath}`,
                    cwd: repoBaseCwd,
                    timeout: 10000,
                });
            }
            await loadGitStatusFiles(true);
        } catch {
            Modal.alert(t('common.error'), t('status.operationFailed'));
        } finally {
            setIsOperating(false);
        }
    }, [sessionId, repoBaseCwd, loadGitStatusFiles]);

    // Switch between repos in multi-repo workspace
    const handleRepoSelect = React.useCallback((index: number) => {
        if (index === selectedRepoIndex) return;
        setSelectedRepoIndex(index);
        setGitStatusFiles(null);
        setSearchQuery('');
        hasGitStatusFiles.current = false;
        setIsLoading(true);
    }, [selectedRepoIndex]);

    // Long press menu
    const handleLongPress = React.useCallback((file: GitFileStatus, staged: boolean) => {
        const items: ActionMenuItem[] = [];
        if (staged) {
            items.push({
                label: t('status.unstage'),
                onPress: () => handleUnstageFile(file),
            });
        } else {
            items.push({
                label: t('status.stage'),
                onPress: () => handleStageFile(file),
            });
        }
        items.push({
            label: t('status.discard'),
            onPress: () => handleDiscardFile(file),
            destructive: true,
        });
        setMenuItems(items);
        setMenuVisible(true);
    }, [handleStageFile, handleUnstageFile, handleDiscardFile]);

    // Load on mount and when repo selection changes
    React.useEffect(() => {
        hasGitStatusFiles.current = false;
        loadGitStatusFiles(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sessionId, selectedRepoIndex]);

    // Refresh silently when screen is focused (after returning from file view)
    useFocusEffect(
        React.useCallback(() => {
            // Silent refresh - don't show loading indicator if we already have data
            if (hasGitStatusFiles.current) {
                loadGitStatusFiles(true);
            }
        }, [loadGitStatusFiles])
    );

    const normalizedSearchQuery = searchQuery.trim().toLocaleLowerCase();
    const matchesSearch = React.useCallback((file: GitFileStatus) => {
        if (!normalizedSearchQuery) return true;
        return `${file.fileName} ${file.filePath} ${file.fullPath}`
            .toLocaleLowerCase()
            .includes(normalizedSearchQuery);
    }, [normalizedSearchQuery]);
    const stagedFiles = gitStatusFiles?.stagedFiles.filter(matchesSearch) ?? [];
    const unstagedFiles = gitStatusFiles?.unstagedFiles.filter(matchesSearch) ?? [];
    const isClean = gitStatusFiles?.totalStaged === 0 && gitStatusFiles?.totalUnstaged === 0;
    const hasSearchResults = stagedFiles.length > 0 || unstagedFiles.length > 0;

    const handleFilePress = React.useCallback((file: GitFileStatus, staged?: boolean) => {
        // Navigate to file viewer with the file path (base64 encoded for special characters)
        // encodeURIComponent ensures base64 chars (+, /, =) are URL-safe on web
        // For multi-repo: git status returns paths relative to the repo, but file viewer needs
        // absolute paths for sessionReadFile. Prepend repo path to make it absolute.
        const absolutePath = selectedRepo && !file.fullPath.startsWith('/')
            ? `${repoBaseCwd}/${file.fullPath}`
            : file.fullPath;
        const encodedPath = btoa(new TextEncoder().encode(absolutePath).reduce((s, b) => s + String.fromCharCode(b), ''));
        // The staged section already knows the version, so the header subtitle starts out filled
        // instead of waiting for the preview RPC to report it.
        const stagedParam = staged ? `&staged=1&note=${encodeURIComponent(t('files.preview.index'))}` : '';
        router.push(`/session/${sessionId}/file?path=${encodeURIComponent(encodedPath)}${stagedParam}&view=diff`);
    }, [router, sessionId, selectedRepo, repoBaseCwd]);

    const renderFileIcon = (file: GitFileStatus) => {
        return <FileIcon fileName={file.fileName} size={32} />;
    };

    const renderStatusIcon = (file: GitFileStatus) => {
        let statusColor: string;
        let statusIcon: string;

        switch (file.status) {
            case 'modified':
                statusColor = "#FF9500";
                statusIcon = "diff-modified";
                break;
            case 'added':
                statusColor = "#34C759";
                statusIcon = "diff-added";
                break;
            case 'deleted':
                statusColor = "#FF3B30";
                statusIcon = "diff-removed";
                break;
            case 'renamed':
                statusColor = "#007AFF";
                statusIcon = "arrow-right";
                break;
            case 'untracked':
                statusColor = theme.dark ? "#b0b0b0" : "#8E8E93";
                statusIcon = "file";
                break;
            default:
                return null;
        }

        return <Octicons name={statusIcon as any} size={16} color={statusColor} />;
    };

    const renderRightElement = (file: GitFileStatus, staged: boolean) => {
        const hasAdded = file.linesAdded > 0;
        const hasRemoved = file.linesRemoved > 0;
        const hasChanges = hasAdded || hasRemoved;

        const lineChangesEl = hasChanges ? (
            <Text style={{ fontSize: 13, color: theme.colors.textSecondary, ...Typography.default() }}>
                {hasAdded && <Text style={{ color: '#34C759' }}>+{file.linesAdded}</Text>}
                {hasAdded && hasRemoved && ' '}
                {hasRemoved && <Text style={{ color: '#FF3B30' }}>-{file.linesRemoved}</Text>}
            </Text>
        ) : null;

        if (!isWeb) {
            return (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    {lineChangesEl}
                    {renderStatusIcon(file)}
                </View>
            );
        }
        return (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                {lineChangesEl}
                {renderStatusIcon(file)}
                <Pressable
                    onPress={() => handleLongPress(file, staged)}
                    hitSlop={8}
                    style={{ padding: 4 }}
                >
                    <Ionicons name="ellipsis-horizontal" size={18} color={theme.colors.textSecondary} />
                </Pressable>
            </View>
        );
    };

    const renderFileSubtitle = (file: GitFileStatus) => {
        return file.filePath || t('files.projectRoot');
    };

    if (!isOnline) {
        return (
            <View style={[styles.container, { backgroundColor: theme.colors.surface, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 20 }]}>
                <Ionicons name="cloud-offline-outline" size={48} color={theme.colors.textSecondary} />
                <Text style={{
                    fontSize: 16,
                    color: theme.colors.textSecondary,
                    textAlign: 'center',
                    marginTop: 16,
                    ...Typography.default()
                }}>
                    {t('files.sessionOffline')}
                </Text>
                <Text style={{
                    fontSize: 14,
                    color: theme.colors.textSecondary,
                    textAlign: 'center',
                    marginTop: 8,
                    marginBottom: 56,
                    ...Typography.default()
                }}>
                    {t('files.sessionOfflineDescription')}
                </Text>
            </View>
        );
    }

    return (
        <View style={[styles.container, { backgroundColor: theme.colors.surface, paddingTop: softHeaderInset }]}>
            <Stack.Screen
                options={{
                    ...softHeaderOptions,
                    headerRight: () => (
                        <Pressable
                            onPress={() => router.push(`/session/${sessionId}/commits`)}
                            style={{ width: 38, height: 38, alignItems: 'center', justifyContent: 'center' }}
                        >
                            <Octicons name="git-commit" size={20} color={theme.colors.header.tint} />
                        </Pressable>
                    ),
                }}
            />

            {/* Repo Selector for multi-repo workspaces */}
            {workspaceRepos.length > 1 && (
                <View style={{
                    borderBottomWidth: Platform.select({ ios: StyleSheet.hairlineWidth, default: 1 }),
                    borderBottomColor: theme.colors.divider,
                }}>
                    <RepoSelector
                        repos={workspaceRepos}
                        selectedIndex={selectedRepoIndex}
                        onSelect={handleRepoSelect}
                    />
                </View>
            )}

            {/* Search Input */}
            {!isLoading && gitStatusFiles && !isClean && (
                <View style={{
                    padding: 16,
                    borderBottomWidth: Platform.select({ ios: StyleSheet.hairlineWidth, default: 1 }),
                    borderBottomColor: theme.colors.divider
                }}>
                    <View style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        backgroundColor: theme.colors.input.background,
                        borderRadius: 10,
                        paddingHorizontal: 12,
                        paddingVertical: 8
                    }}>
                        <Octicons name="search" size={16} color={theme.colors.textSecondary} style={{ marginRight: 8 }} />
                        <TextInput
                            value={searchQuery}
                            onChangeText={setSearchQuery}
                            placeholder={t('files.searchChangesPlaceholder')}
                            style={{
                                flex: 1,
                                fontSize: 16,
                                height: 24,
                                color: theme.colors.text,
                                ...Typography.default()
                            }}
                            placeholderTextColor={theme.colors.input.placeholder}
                            autoCapitalize="none"
                            autoCorrect={false}
                        />
                    </View>
                </View>
            )}

            {/* Header with branch info */}
            {!isLoading && gitStatusFiles && (
                <View style={{
                    padding: 16,
                    borderBottomWidth: Platform.select({ ios: StyleSheet.hairlineWidth, default: 1 }),
                    borderBottomColor: theme.colors.divider
                }}>
                    <View style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        marginBottom: 8
                    }}>
                        <Octicons name="git-branch" size={16} color={theme.colors.textSecondary} style={{ marginRight: 6 }} />
                        <Text style={{
                            fontSize: 16,
                            fontWeight: '600',
                            color: theme.colors.text,
                            ...Typography.default()
                        }}>
                            {gitStatusFiles.branch || t('files.detachedHead')}
                        </Text>
                    </View>
                    <Text style={{
                        fontSize: 12,
                        color: theme.colors.textSecondary,
                        ...Typography.default()
                    }}>
                        {t('files.summary', { staged: gitStatusFiles.totalStaged, unstaged: gitStatusFiles.totalUnstaged })}
                    </Text>
                </View>
            )}

            {/* Git Status List */}
            <ItemList style={{ flex: 1 }}>
                {isLoading ? (
                    <View style={{
                        flex: 1,
                        justifyContent: 'center',
                        alignItems: 'center',
                        paddingTop: 40
                    }}>
                        <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                    </View>
                ) : !gitStatusFiles ? (
                    <View style={{
                        flex: 1,
                        justifyContent: 'center',
                        alignItems: 'center',
                        paddingTop: 40,
                        paddingHorizontal: 20
                    }}>
                        <Octicons name="git-branch" size={48} color={theme.colors.textSecondary} />
                        <Text style={{
                            fontSize: 16,
                            color: theme.colors.textSecondary,
                            textAlign: 'center',
                            marginTop: 16,
                            ...Typography.default()
                        }}>
                            {t('files.notRepo')}
                        </Text>
                        <Text style={{
                            fontSize: 14,
                            color: theme.colors.textSecondary,
                            textAlign: 'center',
                            marginTop: 8,
                            ...Typography.default()
                        }}>
                            {t('files.notUnderGit')}
                        </Text>
                    </View>
                ) : isClean ? (
                    <View style={{
                        flex: 1,
                        justifyContent: 'center',
                        alignItems: 'center',
                        paddingTop: 40,
                        paddingHorizontal: 20
                    }}>
                        <Octicons name="check-circle" size={48} color={theme.colors.success} />
                        <Text style={{
                            fontSize: 16,
                            color: theme.colors.text,
                            textAlign: 'center',
                            marginTop: 16,
                            ...Typography.default()
                        }}>
                            {t('status.noChanges')}
                        </Text>
                        <Text style={{
                            fontSize: 14,
                            color: theme.colors.textSecondary,
                            textAlign: 'center',
                            marginTop: 8,
                            ...Typography.default()
                        }}>
                            {t('files.noPendingChanges')}
                        </Text>
                    </View>
                ) : normalizedSearchQuery && !hasSearchResults ? (
                    <View style={{
                        flex: 1,
                        justifyContent: 'center',
                        alignItems: 'center',
                        paddingTop: 40,
                        paddingHorizontal: 20
                    }}>
                        <Octicons name="search" size={48} color={theme.colors.textSecondary} />
                        <Text style={{
                            fontSize: 16,
                            color: theme.colors.textSecondary,
                            textAlign: 'center',
                            marginTop: 16,
                            ...Typography.default()
                        }}>
                            {t('files.noFilesFound')}
                        </Text>
                        <Text style={{
                            fontSize: 14,
                            color: theme.colors.textSecondary,
                            textAlign: 'center',
                            marginTop: 8,
                            ...Typography.default()
                        }}>
                            {t('files.tryDifferentTerm')}
                        </Text>
                    </View>
                ) : (
                    <>
                        {/* Staged Changes Section */}
                        {stagedFiles.length > 0 && (
                            <>
                                <Pressable
                                    onPress={handleUnstageAll}
                                    disabled={isOperating}
                                    style={{
                                        backgroundColor: theme.colors.surfaceHigh,
                                        paddingHorizontal: 16,
                                        paddingVertical: 12,
                                        borderBottomWidth: Platform.select({ ios: StyleSheet.hairlineWidth, default: 1 }),
                                        borderBottomColor: theme.colors.divider,
                                        flexDirection: 'row',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                    }}
                                >
                                    <Text style={{
                                        fontSize: 14,
                                        fontWeight: '600',
                                        color: theme.colors.success,
                                        ...Typography.default()
                                    }}>
                                        {t('files.stagedChanges', { count: stagedFiles.length })}
                                    </Text>
                                    {operatingAction === 'unstageAll' ? (
                                        <ActivityIndicator size="small" color={theme.colors.header.tint} />
                                    ) : (
                                        <Text style={{
                                            fontSize: 13,
                                            color: theme.colors.header.tint,
                                            ...Typography.default(),
                                        }}>
                                            {t('status.unstageAll')}
                                        </Text>
                                    )}
                                </Pressable>
                                {stagedFiles.map((file, index) => (
                                    <Item
                                        key={`staged-${file.fullPath}-${index}`}
                                        title={file.fileName}
                                        subtitle={renderFileSubtitle(file)}
                                        icon={renderFileIcon(file)}
                                        rightElement={renderRightElement(file, true)}
                                        onPress={() => handleFilePress(file, true)}
                                        onLongPress={() => handleLongPress(file, true)}
                                        showChevron={true}
                                        showDivider={index < stagedFiles.length - 1 || unstagedFiles.length > 0}
                                    />
                                ))}
                            </>
                        )}

                        {/* Unstaged Changes Section */}
                        {unstagedFiles.length > 0 && (
                            <>
                                <Pressable
                                    onPress={handleStageAll}
                                    disabled={isOperating}
                                    style={{
                                        backgroundColor: theme.colors.surfaceHigh,
                                        paddingHorizontal: 16,
                                        paddingVertical: 12,
                                        borderBottomWidth: Platform.select({ ios: StyleSheet.hairlineWidth, default: 1 }),
                                        borderBottomColor: theme.colors.divider,
                                        flexDirection: 'row',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                    }}
                                >
                                    <Text style={{
                                        fontSize: 14,
                                        fontWeight: '600',
                                        color: theme.colors.warning,
                                        ...Typography.default()
                                    }}>
                                        {t('files.unstagedChanges', { count: unstagedFiles.length })}
                                    </Text>
                                    {operatingAction === 'stageAll' ? (
                                        <ActivityIndicator size="small" color={theme.colors.header.tint} />
                                    ) : (
                                        <Text style={{
                                            fontSize: 13,
                                            color: theme.colors.header.tint,
                                            ...Typography.default(),
                                        }}>
                                            {t('status.stageAll')}
                                        </Text>
                                    )}
                                </Pressable>
                                {unstagedFiles.map((file, index) => (
                                    <Item
                                        key={`unstaged-${file.fullPath}-${index}`}
                                        title={file.fileName}
                                        subtitle={renderFileSubtitle(file)}
                                        icon={renderFileIcon(file)}
                                        rightElement={renderRightElement(file, false)}
                                        onPress={() => handleFilePress(file)}
                                        onLongPress={() => handleLongPress(file, false)}
                                        showChevron={true}
                                        showDivider={index < unstagedFiles.length - 1}
                                    />
                                ))}
                            </>
                        )}
                    </>
                )}
            </ItemList>
            <ActionMenuModal visible={menuVisible} items={menuItems} onClose={() => setMenuVisible(false)} />
        </View>
    );
}

const styles = StyleSheet.create((_theme) => ({
    container: {
        flex: 1,
        maxWidth: layout.maxWidth,
        alignSelf: 'center',
        width: '100%',
    }
}));
