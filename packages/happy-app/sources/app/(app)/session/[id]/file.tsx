import * as React from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, Share, View } from 'react-native';
import { useRoute } from '@react-navigation/native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { Text } from '@/components/StyledText';
import { SimpleSyntaxHighlighter } from '@/components/SimpleSyntaxHighlighter';
import { CodeEditor } from '@/components/CodeEditor';
import { Typography } from '@/constants/Typography';
import { Ionicons } from '@expo/vector-icons';
import { sessionReadFile, sessionBash, sessionWriteFile, sessionListDirectory } from '@/sync/ops';
import { ActionMenuModal } from '@/components/ActionMenuModal';
import { getSession, useSession, useSetting } from '@/sync/storage';
import { Modal } from '@/modal';
import { useUnistyles, StyleSheet } from 'react-native-unistyles';
import { layout } from '@/components/layout';
import { t } from '@/text';
import { FileIcon } from '@/components/FileIcon';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { storeTempText } from '@/sync/persistence';
import * as Clipboard from 'expo-clipboard';
import { hapticsLight } from '@/components/haptics';
import { showCopiedToast } from '@/components/Toast';
import { formatPathRelativeToHome } from '@/utils/sessionUtils';
import { shellEscape } from '@/utils/shellEscape';
import { getWorkspaceRepos } from '@/utils/workspaceRepos';
import { getExtensionFromMimeType, getImageMimeType, isPreviewableImage } from '@/utils/fileViewer';
import { Image } from 'expo-image';
import { selectFileViewerSharePayload } from '@/utils/fileViewerShare';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { ImageViewer } from '@/components/ImageViewer';
import type { ImageViewerImage } from '@/components/ImageViewer';
import { getFilePreviewType } from 'happy-wire';
import { FilePreviewScreen } from '@/components/FilePreview/FilePreviewScreen';
import { FileViewTabs, type FileViewTab } from '@/components/FilePreview/FileViewTabs';
import { fileRouteNotice } from '@/components/FilePreview/fileNotice';
import { useFileDownload } from '@/components/FilePreview/useFileDownload';
import { FileDownloadProgress } from '@/components/FilePreview/FileDownloadProgress';
import { buildFileMenuItems, canMutateFile, canShareFileText } from '@/utils/fileMenu';

function getRepoRelativePath(filePath: string, repoPath: string): string {
    if (repoPath && filePath.startsWith(`${repoPath}/`)) {
        return filePath.substring(repoPath.length + 1);
    }
    return filePath;
}

interface FileContent {
    content: string;
    encoding: 'utf8' | 'base64';
    isBinary: boolean;
}

function parsePositiveInt(value: string | string[] | undefined): number | undefined {
    if (typeof value !== 'string') return undefined;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

// Diff display component
const DiffDisplay: React.FC<{ diffContent: string; selectable?: boolean }> = ({ diffContent, selectable }) => {
    const { theme } = useUnistyles();
    const lines = diffContent.split('\n');

    return (
        <View>
            {lines.map((line, index) => {
                const baseStyle = { ...Typography.mono(), fontSize: 14, lineHeight: 20 };
                let lineStyle: any = baseStyle;
                let backgroundColor = 'transparent';

                if (line.startsWith('+') && !line.startsWith('+++')) {
                    lineStyle = { ...baseStyle, color: theme.colors.diff.addedText };
                    backgroundColor = theme.colors.diff.addedBg;
                } else if (line.startsWith('-') && !line.startsWith('---')) {
                    lineStyle = { ...baseStyle, color: theme.colors.diff.removedText };
                    backgroundColor = theme.colors.diff.removedBg;
                } else if (line.startsWith('@@')) {
                    lineStyle = { ...baseStyle, color: theme.colors.diff.hunkHeaderText, fontWeight: '600' };
                    backgroundColor = theme.colors.diff.hunkHeaderBg;
                } else if (line.startsWith('+++') || line.startsWith('---')) {
                    lineStyle = { ...baseStyle, color: theme.colors.text, fontWeight: '600' };
                } else {
                    lineStyle = { ...baseStyle, color: theme.colors.diff.contextText };
                }

                return (
                    <View
                        key={index}
                        style={{
                            backgroundColor,
                            paddingHorizontal: 8,
                            paddingVertical: 1,
                            borderLeftWidth: line.startsWith('+') && !line.startsWith('+++') ? 3 :
                                           line.startsWith('-') && !line.startsWith('---') ? 3 : 0,
                            borderLeftColor: line.startsWith('+') && !line.startsWith('+++') ? theme.colors.diff.addedBorder : theme.colors.diff.removedBorder
                        }}
                    >
                        <Text style={lineStyle} selectable={selectable}>
                            {line || ' '}
                        </Text>
                    </View>
                );
            })}
        </View>
    );
};

export default function FileScreen() {
    const { path } = useLocalSearchParams<{ path?: string }>();
    let decoded = '';
    try { decoded = new TextDecoder().decode(Uint8Array.from(atob(path || ''), char => char.charCodeAt(0))); } catch { /* Preserve legacy path error handling. */ }
    if (getFilePreviewType(decoded)) return <FilePreviewScreen key={decoded} filePath={decoded} />;
    return <LegacyFileScreen key={decoded} />;
}

function LegacyFileScreen() {
    const route = useRoute();
    const router = useRouter();
    const { theme } = useUnistyles();
    const { id: sessionId } = useLocalSearchParams<{ id: string }>();
    const searchParams = useLocalSearchParams();
    const encodedPath = searchParams.path as string;
    const ref = searchParams.ref as string | undefined;
    const preferredView = searchParams.view as 'file' | 'diff' | undefined;
    const isStaged = searchParams.staged === '1';
    const requestedLine = parsePositiveInt(searchParams.line);
    const requestedColumn = parsePositiveInt(searchParams.column);
    let filePath = '';

    // Decode base64 path with error handling (UTF-8 safe)
    try {
        if (encodedPath) {
            const binaryString = atob(encodedPath);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            filePath = new TextDecoder('utf-8').decode(bytes);
        }
    } catch (error) {
        console.error('Failed to decode file path:', error);
        filePath = encodedPath || ''; // Fallback to original path if decoding fails
    }

    const session = useSession(sessionId!);
    const displayPath = formatPathRelativeToHome(filePath, session?.metadata?.homeDir);

    const sessionPath = session?.metadata?.path || '';

    // Multi-repo: detect which repo this file belongs to for correct git cwd
    const workspaceRepos = getWorkspaceRepos(session?.metadata);
    const fileRepo = workspaceRepos.find(r => filePath.startsWith(r.path + '/'));
    const gitCwd = fileRepo?.path || sessionPath;

    const [fileContent, setFileContent] = React.useState<FileContent | null>(null);
    const [diffContent, setDiffContent] = React.useState<string | null>(null);
    const [displayMode, setDisplayMode] = React.useState<'file' | 'diff'>('diff');
    const [imageBase64, setImageBase64] = React.useState<string | null>(null);
    const [imageMimeType, setImageMimeType] = React.useState('image/png');
    const [imageViewerVisible, setImageViewerVisible] = React.useState(false);
    const [isLoading, setIsLoading] = React.useState(true);
    const [error, setError] = React.useState<string | null>(null);
    const [menuVisible, setMenuVisible] = React.useState(false);
    const [worktreeExists, setWorktreeExists] = React.useState(false);
    const wordWrap = useSetting('wrapLinesInDiffs');

    const fileName = filePath.split('/').pop() || filePath;
    const isPreviewImageFile = isPreviewableImage(filePath);
    const imagePreviewUri = imageBase64 ? `data:${imageMimeType};base64,${imageBase64}` : null;
    const imageViewerItems: ImageViewerImage[] = imagePreviewUri ? [{ uri: imagePreviewUri }] : [];

    // Relative path for display/copy (relative to repo, not workspace root)
    const relativePath = React.useMemo(() => {
        if (gitCwd && filePath.startsWith(gitCwd + '/')) {
            return filePath.substring(gitCwd.length + 1);
        }
        if (sessionPath && filePath.startsWith(sessionPath + '/')) {
            return filePath.substring(sessionPath.length + 1);
        }
        return filePath;
    }, [filePath, gitCwd, sessionPath]);
    const download = useFileDownload(sessionId!, {
        path: filePath,
        repoPath: gitCwd || sessionPath,
        version: ref ? 'commit' : isStaged ? 'index' : 'worktree',
        revision: ref,
        compare: preferredView === 'diff' || !!ref || isStaged,
    });

    const shareImage = React.useCallback(async (base64: string, mimeType: string) => {
        const ext = getExtensionFromMimeType(mimeType);
        const outputFileName = fileName.includes('.') ? fileName : `${fileName}.${ext}`;
        const tempFile = new File(Paths.cache, `shared-${Date.now()}-${outputFileName}`);
        tempFile.create({ overwrite: true, intermediates: true });
        tempFile.write(base64, { encoding: 'base64' });

        try {
            if (await Sharing.isAvailableAsync()) {
                await Sharing.shareAsync(tempFile.uri, {
                    mimeType,
                    dialogTitle: fileName,
                });
                return;
            }
            await Share.share({ title: fileName, message: fileName });
        } finally {
            try {
                tempFile.delete();
            } catch {
                // ignore cleanup errors
            }
        }
    }, [fileName]);

    const handleShare = React.useCallback(async () => {
        const payload = selectFileViewerSharePayload({
            platform: Platform.OS,
            imageBase64,
            imageMimeType,
            fileContent,
            diffContent,
        });

        if (payload.kind === 'none') {
            return;
        }

        try {
            if (payload.kind === 'image') {
                await shareImage(payload.base64, payload.mimeType);
                return;
            }
            await Share.share({ title: fileName, message: payload.text });
        } catch (shareError) {
            if (shareError instanceof Error && shareError.name === 'AbortError') return;
            console.error('Failed to share content:', shareError);
            Modal.alert(t('common.error'), 'Failed to share file');
        }
    }, [imageBase64, imageMimeType, fileContent, diffContent, fileName, shareImage]);

    const canModify = canMutateFile(session, ref ? 'commit' : isStaged ? 'index' : 'worktree',
        worktreeExists && !isLoading && !error);
    const sharePayload = selectFileViewerSharePayload({ platform: Platform.OS, imageBase64, imageMimeType, fileContent, diffContent });
    const canShare = !isLoading && sharePayload.kind === 'text' && canShareFileText(sharePayload.text, Platform.OS,
        typeof navigator !== 'undefined' && typeof navigator.share === 'function');
    const menuItems = buildFileMenuItems({
        copyRelativePath: {
            label: t('files.copyRelativePath'),
            onPress: async () => {
                await Clipboard.setStringAsync(relativePath);
                hapticsLight(); showCopiedToast();
            },
        },
        copyFileName: {
            label: t('files.copyFileName'),
            onPress: async () => {
                await Clipboard.setStringAsync(fileName);
                hapticsLight(); showCopiedToast();
            },
        },
        history: !ref && (gitCwd || sessionPath) ? {
            label: t('files.fileHistory'),
            onPress: () => {
                router.push(`/session/${sessionId}/commits?file=${encodeURIComponent(relativePath)}`);
            },
        } : undefined,
        edit: canModify && fileContent && !fileContent.isBinary && !isPreviewImageFile ? {
            label: t('files.editFile'),
            onPress: () => {
                const encodedPath = btoa(
                    new TextEncoder().encode(filePath).reduce((s, b) => s + String.fromCharCode(b), '')
                );
                router.push(`/session/${sessionId}/edit?path=${encodeURIComponent(encodedPath)}`);
            },
        } : undefined,
        share: canShare ? {
            label: t('files.preview.shareContent'),
            onPress: handleShare,
        } : undefined,
        download: {
            label: t('files.preview.download'),
            onPress: download.start,
            disabled: download.downloading,
        },
        delete: canModify ? {
            label: t('files.deleteFile'),
            destructive: true,
            onPress: async () => {
                const confirmed = await Modal.confirm(
                    t('files.deleteFile'),
                    t('files.deleteFileConfirm', { fileName }),
                    { destructive: true },
                );
                if (!confirmed) return;
                const escapedPath = shellEscape(filePath);
                const result = await sessionBash(sessionId!, {
                    command: `rm -- ${escapedPath}`,
                    cwd: gitCwd || sessionPath,
                    timeout: 5000,
                });
                if (result.success) {
                    Modal.alert(t('common.success'), t('files.deleteFileSuccess'));
                    router.back();
                } else {
                    Modal.alert(t('common.error'), t('files.deleteFileFailed'));
                }
            },
        } : undefined,
    });

    // Determine file language from extension
    const getFileLanguage = React.useCallback((path: string): string | null => {
        const ext = path.split('.').pop()?.toLowerCase();
        switch (ext) {
            case 'js':
            case 'jsx':
                return 'javascript';
            case 'ts':
            case 'tsx':
                return 'typescript';
            case 'py':
                return 'python';
            case 'html':
            case 'htm':
                return 'html';
            case 'css':
                return 'css';
            case 'json':
                return 'json';
            case 'md':
                return 'markdown';
            case 'xml':
                return 'xml';
            case 'yaml':
            case 'yml':
                return 'yaml';
            case 'sh':
            case 'bash':
                return 'bash';
            case 'sql':
                return 'sql';
            case 'go':
                return 'go';
            case 'rust':
            case 'rs':
                return 'rust';
            case 'java':
                return 'java';
            case 'c':
                return 'c';
            case 'cpp':
            case 'cc':
            case 'cxx':
                return 'cpp';
            case 'php':
                return 'php';
            case 'rb':
                return 'ruby';
            case 'swift':
                return 'swift';
            case 'kt':
                return 'kotlin';
            default:
                return null;
        }
    }, []);

    // Check if file is likely binary based on extension
    const isBinaryFile = React.useCallback((path: string): boolean => {
        const ext = path.split('.').pop()?.toLowerCase();
        const binaryExtensions = [
            'png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'ico',
            'mp4', 'avi', 'mov', 'wmv', 'flv', 'webm',
            'mp3', 'wav', 'flac', 'aac', 'ogg',
            'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
            'zip', 'tar', 'gz', 'rar', '7z',
            'exe', 'dmg', 'deb', 'rpm',
            'woff', 'woff2', 'ttf', 'otf',
            'db', 'sqlite', 'sqlite3'
        ];
        return ext ? binaryExtensions.includes(ext) : false;
    }, []);

    // Load file content
    React.useEffect(() => {
        let isCancelled = false;

        const loadFile = async () => {
            try {
                setIsLoading(true);
                setError(null);
                setWorktreeExists(false);
                setFileContent(null);
                setDiffContent(null);
                setImageBase64(null);
                setImageViewerVisible(false);

                // Get session metadata for git commands
                const session = getSession(sessionId!);
                const sessionPath = session?.metadata?.path;

                if (isPreviewImageFile && !ref) {
                    const response = await sessionReadFile(sessionId!, filePath);
                    if (!isCancelled) {
                        if (response && response.success && response.content) {
                            setWorktreeExists(true);
                            const mimeType = getImageMimeType(filePath) || 'image/png';
                            setFileContent({
                                content: '',
                                encoding: 'base64',
                                isBinary: false,
                            });
                            setImageBase64(response.content);
                            setImageMimeType(mimeType);
                        } else {
                            setError(response?.error || 'Failed to read file');
                        }
                    }
                    return;
                }

                // Check if file is likely binary before trying to read
                if (isBinaryFile(filePath)) {
                    // Binary previews skip reads; check the directory entry before offering deletion.
                    if (!ref && !isStaged) {
                        const fullPath = filePath.startsWith('/') ? filePath : `${gitCwd}/${filePath}`;
                        const parent = fullPath.slice(0, fullPath.lastIndexOf('/')) || '/';
                        const listing = await sessionListDirectory(sessionId!, parent);
                        if (!isCancelled)
                            setWorktreeExists(!!listing.success && !!listing.entries?.some(entry => entry.name === fileName && entry.type === 'file'));
                    }
                    if (!isCancelled) {
                        setFileContent({
                            content: '',
                            encoding: 'base64',
                            isBinary: true
                        });
                        setIsLoading(false);
                    }
                    return;
                }

                // Fetch git diff for the file
                // Use repo-specific cwd for multi-repo workspaces
                const effectiveCwd = gitCwd || sessionPath;
                if (effectiveCwd && sessionId) {
                    try {
                        const repoRelativePath = getRepoRelativePath(filePath, effectiveCwd);
                        const escapedPath = shellEscape(repoRelativePath);
                        const diffCommand = ref
                            ? `git diff --no-ext-diff ${shellEscape(`${ref}~1`)} ${shellEscape(ref)} -- ${escapedPath}`
                            : isStaged
                                ? `git diff --cached --no-ext-diff -- ${escapedPath}`
                                : `git diff --no-ext-diff -- ${escapedPath}`;
                        const diffResponse = await sessionBash(sessionId, {
                            command: diffCommand,
                            cwd: effectiveCwd,
                            timeout: 5000
                        });

                        if (!isCancelled && diffResponse.success && diffResponse.stdout.trim()) {
                            setDiffContent(diffResponse.stdout);
                        }
                    } catch (diffError) {
                        console.log('Could not fetch git diff:', diffError);
                    }
                }

                if (ref && effectiveCwd && sessionId) {
                    // For a specific commit ref, use git show to get file content at that revision
                    const relativePath = getRepoRelativePath(filePath, effectiveCwd);
                    const escapedShowTarget = shellEscape(`${ref}:${relativePath}`);
                    const showResponse = await sessionBash(sessionId, {
                        command: `git show ${escapedShowTarget}`,
                        cwd: effectiveCwd,
                        timeout: 10000,
                    });

                    if (!isCancelled) {
                        if (showResponse.success) {
                            setFileContent({
                                content: showResponse.stdout || '',
                                encoding: 'utf8',
                                isBinary: false,
                            });
                        } else {
                            // File may have been deleted in this commit; show diff only
                            setFileContent({ content: '', encoding: 'utf8', isBinary: false });
                        }
                    }
                } else {
                    const response = await sessionReadFile(sessionId, filePath);

                    if (!isCancelled) {
                        if (response && response.success && response.content !== undefined) {
                            setWorktreeExists(true);
                            // Decode base64 content to UTF-8 string
                            let decodedContent: string;
                            try {
                                const binaryString = atob(response.content);
                                const bytes = new Uint8Array(binaryString.length);
                                for (let i = 0; i < binaryString.length; i++) {
                                    bytes[i] = binaryString.charCodeAt(i);
                                }
                                decodedContent = new TextDecoder('utf-8').decode(bytes);
                            } catch (decodeError) {
                                // If base64 decode fails, treat as binary
                                setFileContent({
                                    content: '',
                                    encoding: 'base64',
                                    isBinary: true
                                });
                                return;
                            }

                            // Check if content contains binary data (null bytes or too many non-printable chars)
                            const hasNullBytes = decodedContent.includes('\0');
                            const nonPrintableCount = decodedContent.split('').filter(char => {
                                const code = char.charCodeAt(0);
                                return code < 32 && code !== 9 && code !== 10 && code !== 13; // Allow tab, LF, CR
                            }).length;
                            const isBinary = hasNullBytes || (nonPrintableCount / decodedContent.length > 0.1);

                            setFileContent({
                                content: isBinary ? '' : decodedContent,
                                encoding: 'utf8',
                                isBinary
                            });
                        } else {
                            setError(response?.error || 'Failed to read file');
                        }
                    }
                }
            } catch (error) {
                console.error('Failed to load file:', error);
                if (!isCancelled) {
                    setError('Failed to load file');
                }
            } finally {
                if (!isCancelled) {
                    setIsLoading(false);
                }
            }
        };

        loadFile();

        return () => {
            isCancelled = true;
        };
    }, [sessionId, filePath, ref, isStaged, isBinaryFile, gitCwd, isPreviewImageFile, fileName]);

    // Show error modal if there's an error
    React.useEffect(() => {
        if (error) {
            Modal.alert(t('common.error'), error);
        }
    }, [error]);

    // Set default display mode based on diff availability
    React.useEffect(() => {
        if (preferredView === 'file' && fileContent && !fileContent.isBinary) {
            setDisplayMode('file');
        } else if (preferredView === 'diff' && diffContent) {
            setDisplayMode('diff');
        } else if (diffContent) {
            setDisplayMode('diff');
        } else if (fileContent) {
            setDisplayMode('file');
        }
    }, [diffContent, fileContent, preferredView]);

    const language = getFileLanguage(filePath);
    const editorLanguage = language || 'plaintext';
    const viewTabs: FileViewTab<'file' | 'diff'>[] = [
        { value: 'file', label: t('files.file') },
        { value: 'diff', label: t('files.diff') },
    ];
    // Which version this file was opened from is known from the params alone, so the header
    // subtitle is filled in from the first frame rather than after the read settles.
    const notice = fileRouteNotice({
        note: searchParams.note as string | undefined,
        ref,
        staged: isStaged,
    });
    const useReadOnlyCodeEditor = displayMode === 'file' && !!fileContent?.content;
    const handleReadOnlyEditorChange = React.useCallback(() => {
        // Viewer mode only: ignore edits.
    }, []);

    // Handle long press to open text selection screen
    const handleLongPress = React.useCallback((content: string) => {
        if (Platform.OS === 'web') return;
        try {
            const textId = storeTempText(content);
            router.push(`/text-selection?textId=${textId}`);
        } catch (error) {
            console.error('Error storing text for selection:', error);
            Modal.alert(t('common.error'), 'Failed to open text selection');
        }
    }, [router]);

    // Get current display content for long press
    const currentContent = React.useMemo(() => {
        if (displayMode === 'diff' && diffContent) {
            return diffContent;
        } else if (displayMode === 'file' && fileContent?.content) {
            return fileContent.content;
        }
        return '';
    }, [displayMode, diffContent, fileContent]);

    // Long press gesture for text selection
    const longPressGesture = React.useMemo(() =>
        Gesture.LongPress()
            .minDuration(500)
            .onStart(() => {
                if (currentContent) {
                    handleLongPress(currentContent);
                }
            })
            .runOnJS(true),
        [currentContent, handleLongPress]
    );

    const fileActions = <>
        <Stack.Screen options={{
            headerTitle: t('common.fileViewer'),
            headerSubtitle: notice ?? undefined,
            headerRight: () => (
                <Pressable onPress={() => setMenuVisible(true)} accessibilityRole="button" accessibilityLabel={t('files.file')}
                    style={{ paddingHorizontal: 8, paddingVertical: 4 }}>
                    <Ionicons name="ellipsis-horizontal" size={22} color={theme.colors.header.tint} />
                </Pressable>
            ),
        }} />
        <ActionMenuModal visible={menuVisible} items={menuItems} onClose={() => setMenuVisible(false)} />
        <FileDownloadProgress progress={download.progress} onCancel={download.cancel} />
    </>;

    if (isLoading) {
        return (
            <View style={{
                flex: 1,
                backgroundColor: theme.colors.surface,
                justifyContent: 'center',
                alignItems: 'center'
            }}>
                {fileActions}
                <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                <Text style={{
                    marginTop: 16,
                    fontSize: 16,
                    color: theme.colors.textSecondary,
                    ...Typography.default()
                }}>
                    {t('files.loadingFile', { fileName })}
                </Text>
            </View>
        );
    }

    if (error) {
        return (
            <View style={{
                flex: 1,
                backgroundColor: theme.colors.surface,
                justifyContent: 'center',
                alignItems: 'center',
                padding: 20
            }}>
                {fileActions}
                <Text style={{
                    fontSize: 18,
                    fontWeight: 'bold',
                    color: theme.colors.textDestructive,
                    marginBottom: 8,
                    ...Typography.default('semiBold')
                }}>
                    {t('common.error')}
                </Text>
                <Text style={{
                    fontSize: 16,
                    color: theme.colors.textSecondary,
                    textAlign: 'center',
                    ...Typography.default()
                }}>
                    {error}
                </Text>
            </View>
        );
    }

    if (fileContent?.isBinary) {
        return (
            <View style={{
                flex: 1,
                backgroundColor: theme.colors.surface,
                justifyContent: 'center',
                alignItems: 'center',
                padding: 20
            }}>
                {fileActions}
                <Text style={{
                    fontSize: 18,
                    fontWeight: 'bold',
                    color: theme.colors.textSecondary,
                    marginBottom: 8,
                    ...Typography.default('semiBold')
                }}>
                    {t('files.binaryFile')}
                </Text>
                <Text style={{
                    fontSize: 16,
                    color: theme.colors.textSecondary,
                    textAlign: 'center',
                    ...Typography.default()
                }}>
                    {t('files.cannotDisplayBinary')}
                </Text>
                <Text style={{
                    fontSize: 14,
                    color: '#999',
                    textAlign: 'center',
                    marginTop: 8,
                    ...Typography.default()
                }}>
                    {fileName}
                </Text>
            </View>
        );
    }

    return (
        <View style={[styles.container, { backgroundColor: theme.colors.surface }]}>
            {fileActions}

            {/* File path header - single line, scrollable, long press to copy */}
            <View style={{
                borderBottomWidth: Platform.select({ ios: StyleSheet.hairlineWidth, default: 1 }),
                borderBottomColor: theme.colors.divider,
                backgroundColor: theme.colors.surfaceHigh,
                flexDirection: 'row',
                alignItems: 'center',
                paddingVertical: 12,
            }}>
                <View style={{ paddingLeft: 16 }}>
                    <FileIcon fileName={fileName} size={20} />
                </View>
                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={{ paddingHorizontal: 8, paddingRight: 16, alignItems: 'center' }}
                    style={{ flex: 1 }}
                >
                    <Pressable
                        onLongPress={async () => {
                            try {
                                await Clipboard.setStringAsync(filePath);
                                hapticsLight(); showCopiedToast();
                            } catch { /* ignore */ }
                        }}
                    >
                        <Text style={{
                            fontSize: 14,
                            color: theme.colors.textSecondary,
                            ...Typography.mono(),
                        }} numberOfLines={1} selectable={Platform.OS === 'web'}>
                            {displayPath}
                        </Text>
                    </Pressable>
                </ScrollView>
            </View>

            {imagePreviewUri ? (
                <>
                    <View style={{ flex: 1, padding: 16 }}>
                        <Pressable onPress={() => setImageViewerVisible(true)} style={{ flex: 1 }}>
                            <Image
                                source={{ uri: imagePreviewUri }}
                                style={{ width: '100%', height: '100%', borderRadius: 10 }}
                                contentFit="contain"
                            />
                        </Pressable>
                    </View>
                    <ImageViewer
                        images={imageViewerItems}
                        initialIndex={0}
                        visible={imageViewerVisible}
                        onClose={() => setImageViewerVisible(false)}
                    />
                </>
            ) : (
                <>
                    {/* File/Diff view switch */}
                    {diffContent && (
                        <FileViewTabs
                            tabs={viewTabs}
                            value={displayMode}
                            onChange={setDisplayMode}
                        />
                    )}

                    {/* Content display */}
                    {useReadOnlyCodeEditor ? (
                        <View style={{ flex: 1 }}>
                            <CodeEditor
                                value={fileContent?.content || ''}
                                onChangeText={handleReadOnlyEditorChange}
                                language={editorLanguage}
                                bottomPadding={12}
                                readOnly
                                revealLine={requestedLine}
                                revealColumn={requestedColumn}
                            />
                        </View>
                    ) : (
                        <ScrollView
                            style={{ flex: 1 }}
                            contentContainerStyle={wordWrap ? { padding: 16 } : { paddingVertical: 16 }}
                            showsVerticalScrollIndicator={true}
                        >
                            <ScrollView
                                horizontal={!wordWrap}
                                scrollEnabled={!wordWrap}
                                showsHorizontalScrollIndicator={!wordWrap}
                                contentContainerStyle={wordWrap ? undefined : { paddingHorizontal: 16 }}
                            >
                                {Platform.OS !== 'web' && currentContent ? (
                                    <GestureDetector gesture={longPressGesture}>
                                        <View>
                                            {displayMode === 'diff' && diffContent ? (
                                                <DiffDisplay diffContent={diffContent} selectable={false} />
                                            ) : displayMode === 'file' && fileContent?.content ? (
                                                <SimpleSyntaxHighlighter
                                                    code={fileContent.content}
                                                    language={language}
                                                    selectable={false}
                                                />
                                            ) : displayMode === 'file' && fileContent && !fileContent.content ? (
                                                <Text style={{
                                                    fontSize: 16,
                                                    color: theme.colors.textSecondary,
                                                    fontStyle: 'italic',
                                                    ...Typography.default()
                                                }}>
                                                    {t('files.fileEmpty')}
                                                </Text>
                                            ) : null}
                                        </View>
                                    </GestureDetector>
                                ) : (
                                    <>
                                        {displayMode === 'diff' && diffContent ? (
                                            <DiffDisplay diffContent={diffContent} selectable={true} />
                                        ) : displayMode === 'file' && fileContent?.content ? (
                                            <SimpleSyntaxHighlighter
                                                code={fileContent.content}
                                                language={language}
                                                selectable={true}
                                            />
                                        ) : displayMode === 'file' && fileContent && !fileContent.content ? (
                                            <Text style={{
                                                fontSize: 16,
                                                color: theme.colors.textSecondary,
                                                fontStyle: 'italic',
                                                ...Typography.default()
                                            }}>
                                                {t('files.fileEmpty')}
                                            </Text>
                                        ) : !diffContent && !fileContent?.content ? (
                                            <Text style={{
                                                fontSize: 16,
                                                color: theme.colors.textSecondary,
                                                fontStyle: 'italic',
                                                ...Typography.default()
                                            }}>
                                                {t('files.noChanges')}
                                            </Text>
                                        ) : null}
                                    </>
                                )}
                            </ScrollView>
                        </ScrollView>
                    )}
                </>
            )}
        </View>
    );
}

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        maxWidth: layout.maxWidth,
        alignSelf: 'center',
        width: '100%',
    }
}));
