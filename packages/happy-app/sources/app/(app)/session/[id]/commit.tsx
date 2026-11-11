import * as React from 'react';
import { View, ActivityIndicator, Pressable, Platform, ScrollView } from 'react-native';
import { useRoute } from '@react-navigation/native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/StyledText';
import { Typography } from '@/constants/Typography';
import { sessionBash } from '@/sync/ops';
import { getSession } from '@/sync/storage';
import { useUnistyles, StyleSheet } from 'react-native-unistyles';
import { layout } from '@/components/layout';
import { FileIcon } from '@/components/FileIcon';
import { ActionMenuModal } from '@/components/ActionMenuModal';
import type { ActionMenuItem } from '@/components/ActionMenu';
import * as Clipboard from 'expo-clipboard';
import { t } from '@/text';
import { hapticsLight } from '@/components/haptics';
import { showCopiedToast } from '@/components/Toast';
import { headerMenuOptions } from '@/components/navigation/headerMenu';
import { useCopySelectable } from '@/components/LongPressCopy';

interface CommitDetail {
    hash: string;
    shortHash: string;
    author: string;
    email: string;
    date: Date;
    title: string;
    body: string;
}

interface CommitFile {
    fileName: string;
    filePath: string;
    additions: number;
    deletions: number;
}

function formatRelativeTime(date: Date): string {
    const now = Date.now();
    const diffSeconds = Math.floor((now - date.getTime()) / 1000);
    if (diffSeconds < 60) return 'just now';
    const diffMinutes = Math.floor(diffSeconds / 60);
    if (diffMinutes < 60) return `${diffMinutes}m ago`;
    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 30) return `${diffDays}d ago`;
    const diffMonths = Math.floor(diffDays / 30);
    if (diffMonths < 12) return `${diffMonths}mo ago`;
    const diffYears = Math.floor(diffDays / 365);
    return `${diffYears}y ago`;
}

function parseCommitDetail(stdout: string): CommitDetail | null {
    const lines = stdout.trim().split('\n');
    if (lines.length < 6) return null;
    return {
        hash: lines[0] || '',
        shortHash: lines[1] || '',
        author: lines[2] || '',
        email: lines[3] || '',
        date: new Date(parseInt(lines[4] || '0') * 1000),
        title: lines[5] || '',
        body: lines.slice(6).join('\n').trim(),
    };
}

function parseDiffTree(stdout: string): CommitFile[] {
    return stdout.trim().split('\n').filter(Boolean).map(line => {
        const [add, del, ...pathParts] = line.split('\t');
        const filePath = pathParts.join('\t'); // handle filenames with tabs (unlikely but safe)
        return {
            fileName: filePath.split('/').pop() || filePath,
            filePath,
            additions: add === '-' ? 0 : parseInt(add || '0'),
            deletions: del === '-' ? 0 : parseInt(del || '0'),
        };
    });
}

export default function CommitScreen() {
    const route = useRoute();
    const router = useRouter();
    const sessionId = (route.params! as any).id as string;
    const searchParams = useLocalSearchParams();
    const hash = searchParams.hash as string;
    const { theme } = useUnistyles();
    const selectable = useCopySelectable();

    const session = getSession(sessionId);
    const sessionPath = session?.metadata?.path || '';
    const cwdParam = searchParams.cwd as string | undefined;
    const repoCwd = cwdParam || sessionPath;

    const [commitDetail, setCommitDetail] = React.useState<CommitDetail | null>(null);
    const [files, setFiles] = React.useState<CommitFile[]>([]);
    const [isLoading, setIsLoading] = React.useState(true);
    const [error, setError] = React.useState<string | null>(null);

    React.useEffect(() => {
        let cancelled = false;

        const load = async () => {
            setIsLoading(true);
            setError(null);
            try {
                // Fetch commit info and changed files in parallel
                const [infoRes, filesRes] = await Promise.all([
                    sessionBash(sessionId, {
                        command: `git show --format="%H%n%h%n%an%n%ae%n%at%n%s%n%b" --no-patch ${hash}`,
                        cwd: repoCwd,
                        timeout: 10000,
                    }),
                    sessionBash(sessionId, {
                        command: `git diff-tree --no-commit-id -r --numstat ${hash}`,
                        cwd: repoCwd,
                        timeout: 10000,
                    }),
                ]);

                if (cancelled) return;

                if (infoRes.success && infoRes.stdout) {
                    setCommitDetail(parseCommitDetail(infoRes.stdout));
                } else {
                    setError(infoRes.error || 'Failed to load commit');
                }

                if (filesRes.success && filesRes.stdout) {
                    setFiles(parseDiffTree(filesRes.stdout));
                }
            } catch {
                if (!cancelled) setError('Failed to load commit');
            } finally {
                if (!cancelled) setIsLoading(false);
            }
        };

        load();
        return () => { cancelled = true; };
    }, [sessionId, repoCwd, hash]);

    const handleFilePress = React.useCallback((file: CommitFile) => {
        const fullPath = `${repoCwd}/${file.filePath}`;
        const encodedPath = btoa(
            new TextEncoder().encode(fullPath).reduce((s, b) => s + String.fromCharCode(b), '')
        );
        router.push(`/session/${sessionId}/file?path=${encodeURIComponent(encodedPath)}&ref=${hash}`);
    }, [router, sessionId, repoCwd, hash]);

    // Action menu
    const [menuVisible, setMenuVisible] = React.useState(false);
    // Copying the hash needs only the route's, so the menu is there while the commit loads; copying
    // its message joins once it has.
    const menuItems: ActionMenuItem[] = React.useMemo(() => {
        const copyHash: ActionMenuItem = {
            label: t('commits.copyHash'),
            onPress: async () => {
                await Clipboard.setStringAsync(commitDetail?.hash || hash);
                hapticsLight(); showCopiedToast();
            },
        };
        if (!commitDetail) return [copyHash];
        return [
            copyHash,
            {
                label: t('commits.copyMessage'),
                onPress: async () => {
                    const message = commitDetail.body
                        ? `${commitDetail.title}\n\n${commitDetail.body}`
                        : commitDetail.title;
                    await Clipboard.setStringAsync(message);
                    hapticsLight(); showCopiedToast();
                },
            },
        ];
    }, [commitDetail, hash]);

    // Calculate totals
    const totalAdditions = files.reduce((sum, f) => sum + f.additions, 0);
    const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0);

    const headerActions = (
        <>
            <Stack.Screen
                options={{
                    headerRight: () => (
                        <Pressable
                            onPress={() => setMenuVisible(true)}
                            style={{ paddingHorizontal: 8, paddingVertical: 4 }}
                        >
                            <Ionicons name="ellipsis-horizontal" size={22} color={theme.colors.header.tint} />
                        </Pressable>
                    ),
                    ...headerMenuOptions(menuItems),
                }}
            />
            <ActionMenuModal
                visible={menuVisible}
                items={menuItems}
                onClose={() => setMenuVisible(false)}
            />
        </>
    );

    if (isLoading) {
        return (
            <View style={[styles.container, { backgroundColor: theme.colors.surface, justifyContent: 'center', alignItems: 'center' }]}>
                {headerActions}
                <ActivityIndicator size="small" color={theme.colors.textSecondary} />
            </View>
        );
    }

    if (error || !commitDetail) {
        return (
            <View style={[styles.container, { backgroundColor: theme.colors.surface, justifyContent: 'center', alignItems: 'center', padding: 20 }]}>
                {headerActions}
                <Ionicons name="alert-circle-outline" size={48} color={theme.colors.textSecondary} />
                <Text style={{ fontSize: 16, color: theme.colors.textSecondary, textAlign: 'center', marginTop: 16, ...Typography.default() }}>
                    {error || 'Failed to load commit'}
                </Text>
            </View>
        );
    }

    return (
        <View style={[styles.container, { backgroundColor: theme.colors.surface }]}>
            {headerActions}
            <ScrollView
                contentInsetAdjustmentBehavior="automatic"
                contentContainerStyle={[
                    styles.content,
                    { maxWidth: layout.maxWidth, alignSelf: 'center', width: '100%' },
                ]}
            >
                <View style={styles.summary}>
                    <Text selectable={selectable} style={styles.title}>{commitDetail.title}</Text>
                    {commitDetail.body ? (
                        <Text selectable={selectable} style={styles.body}>{commitDetail.body}</Text>
                    ) : null}
                    <View style={styles.metaRow}>
                        <Text selectable={selectable} style={styles.hash}>{commitDetail.shortHash}</Text>
                        <Text style={styles.metaSeparator}>·</Text>
                        <Text selectable={selectable} style={styles.meta} numberOfLines={1}>
                            {commitDetail.author} · {formatRelativeTime(commitDetail.date)}
                        </Text>
                    </View>
                </View>

                <View style={styles.divider} />

                <View style={styles.filesHeader}>
                    <Text style={styles.filesTitle}>{t('commits.filesChanged', { count: files.length })}</Text>
                    <View style={styles.totals}>
                        {totalAdditions > 0 && <Text style={styles.additions}>+{totalAdditions}</Text>}
                        {totalDeletions > 0 && <Text style={styles.deletions}>-{totalDeletions}</Text>}
                    </View>
                </View>

                {files.map((file, index) => (
                    <Pressable
                        key={file.filePath}
                        onPress={() => handleFilePress(file)}
                        style={[styles.fileRow, index < files.length - 1 && styles.fileRowDivider]}
                    >
                        <FileIcon fileName={file.fileName} size={29} />
                        <View style={styles.fileContent}>
                            <Text style={styles.fileName} numberOfLines={1}>{file.fileName}</Text>
                            <Text style={styles.filePath} numberOfLines={1} ellipsizeMode="middle">{file.filePath}</Text>
                        </View>
                        <View style={styles.fileCounts}>
                            {file.additions > 0 && <Text style={styles.additions}>+{file.additions}</Text>}
                            {file.deletions > 0 && <Text style={styles.deletions}>-{file.deletions}</Text>}
                        </View>
                        <Ionicons name="chevron-forward" size={16} color={theme.colors.textSecondary} />
                    </Pressable>
                ))}
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        maxWidth: layout.maxWidth,
        alignSelf: 'center' as const,
        width: '100%',
    },
    content: {
        paddingBottom: 32,
    },
    summary: {
        paddingHorizontal: 16,
        paddingTop: 16,
        paddingBottom: 16,
        gap: 8,
    },
    title: {
        ...Typography.default('semiBold'),
        fontSize: 20,
        lineHeight: 26,
        color: theme.colors.text,
    },
    body: {
        ...Typography.default(),
        fontSize: 15,
        lineHeight: 22,
        color: theme.colors.textSecondary,
    },
    metaRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 2,
    },
    hash: {
        ...Typography.mono(),
        fontSize: 13,
        color: theme.colors.textSecondary,
    },
    metaSeparator: {
        ...Typography.default(),
        fontSize: 13,
        color: theme.colors.textSecondary,
        marginHorizontal: 6,
    },
    meta: {
        ...Typography.default(),
        fontSize: 13,
        color: theme.colors.textSecondary,
        flexShrink: 1,
    },
    divider: {
        height: Platform.select({ ios: StyleSheet.hairlineWidth, default: 1 }),
        backgroundColor: theme.colors.divider,
    },
    filesHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        paddingHorizontal: 16,
        paddingTop: 14,
        paddingBottom: 6,
    },
    filesTitle: {
        ...Typography.default('semiBold'),
        fontSize: 14,
        color: theme.colors.textSecondary,
    },
    totals: {
        flexDirection: 'row',
        gap: 6,
    },
    additions: {
        ...Typography.mono(),
        fontSize: 13,
        color: '#34C759',
    },
    deletions: {
        ...Typography.mono(),
        fontSize: 13,
        color: '#FF3B30',
    },
    fileRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 12,
    },
    fileRowDivider: {
        borderBottomWidth: Platform.select({ ios: StyleSheet.hairlineWidth, default: 1 }),
        borderBottomColor: theme.colors.divider,
    },
    fileContent: {
        flex: 1,
        gap: 2,
    },
    fileName: {
        ...Typography.default('medium'),
        fontSize: 15,
        color: theme.colors.text,
    },
    filePath: {
        ...Typography.default(),
        fontSize: 12,
        color: theme.colors.textSecondary,
    },
    fileCounts: {
        flexDirection: 'row',
        gap: 6,
        flexShrink: 0,
    },
}));
