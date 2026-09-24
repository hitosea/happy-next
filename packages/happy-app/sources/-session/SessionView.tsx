import { AgentContentView } from '@/components/AgentContentView';
import { AgentInput } from '@/components/AgentInput';
import { Avatar } from '@/components/Avatar';
import { MultiTextInputHandle } from '@/components/MultiTextInput';
import { getSuggestions } from '@/components/autocomplete/suggestions';
import { HeaderBackButton } from '@/components/navigation/Header';
import { ChatList, type ForkMessageRequest } from '@/components/ChatList';
import { ConversationMinimap, type ConversationMinimapEdgeTouch, type ConversationMinimapItem } from '@/components/ConversationMinimap';
import type { MinimapMessage } from '@/sync/typesMessage';
import { Deferred } from '@/components/Deferred';
import { DuplicateSheet } from '@/components/DuplicateSheet';
import { ActionMenuModal } from '@/components/ActionMenuModal';
import type { ActionMenuItem } from '@/components/ActionMenu';
import { EmptyMessages } from '@/components/EmptyMessages';
import { PendingQueuePanel } from '@/components/PendingQueuePanel';
import { VoiceAssistantStatusBar } from '@/components/VoiceAssistantStatusBar';
import { useDraft } from '@/hooks/useDraft';
import { useImagePicker } from '@/hooks/useImagePicker';
import { useWebImageDrop } from '@/hooks/useWebImageDrop';
import { Modal } from '@/modal';
import { voiceHooks } from '@/realtime/hooks/voiceHooks';
import { startRealtimeSession, stopRealtimeSession } from '@/realtime/RealtimeSession';
import { sessionAbort, machineGetClaudeSessionUserMessages, machineDuplicateClaudeSession, machineForkClaudeSession, machineSpawnNewSession, machineGetGeminiSessionUserMessages, machineDuplicateGeminiSession, machineForkGeminiSession, machineGetCodexSessionUserMessages, machineDuplicateCodexSession, machineForkCodexSession, machineResolveClaudeForkTarget, machineResolveGeminiForkTarget, machineResolveCodexForkTarget, machineGetClaudeSessionUserMessage, machineGetGeminiSessionUserMessage, machineGetCodexSessionUserMessage, type UserMessageWithUuid, type UserMessagePage, type ResolvedForkTarget } from '@/sync/ops';
import { storage, useIsDataReady, useLocalSetting, useOrchestratorRunningTaskCount, useOrchestratorHasRuns, useRealtimeStatus, useSessionMessages, useSessionMessagesFetching, useSessionPendingMessages, useSessionUsage, useSetting } from '@/sync/storage';
import { useSession } from '@/sync/storage';
import { Session } from '@/sync/storageTypes';
import { sync } from '@/sync/sync';
import { t } from '@/text';
import { tracking, trackMessageSent } from '@/track';
import { handleImagePasteEvent } from '@/utils/imagePaste';
import { isRunningOnMac } from '@/utils/platform';
import { useDeviceType, useIsLandscape, useIsTablet } from '@/utils/responsive';
import { formatPathRelativeToHome, generateCopyTitle, getSessionAvatarId, getSessionName, useSessionStatus, copySessionMetadata, copySessionModeSettings } from '@/utils/sessionUtils';
import { canEditSession, canForkSession } from '@/utils/sessionLifecycle';
import { sendFailureKey } from '@/utils/sendFailure';
import { isVersionSupported, useLatestCliVersion } from '@/utils/versionUtils';
import { log } from '@/log';
import { Ionicons } from '@expo/vector-icons';
import { useHeaderHeight as useNavigationHeaderHeight } from '@react-navigation/elements';
import { useFocusEffect, useIsFocused, useNavigation } from '@react-navigation/native';
import { Stack, useRouter } from 'expo-router';
import * as React from 'react';
import { useMemo } from 'react';
import { ActivityIndicator, Platform, Pressable, Text, View, type GestureResponderEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUnistyles } from 'react-native-unistyles';

const SILENT_REFRESH_INDICATOR_DELAY_MS = 3000;
const SILENT_REFRESH_FAILED_TIMEOUT_MS = 12000;

// Gap between the leading header-right action (orchestrator / new-session) and the avatar.
// Web (custom header) gets a roomier gap; native apps stay at the 4px baseline.
const HEADER_LEADING_ACTION_MARGIN = Platform.OS === 'web' ? 8 : 4;

function shouldHideSessionHeaderForCompactLayout(shouldUseCompactLandscapeSessionLayout: boolean) {
    return shouldUseCompactLandscapeSessionLayout && Platform.OS !== 'web';
}

export const SessionView = React.memo((props: { id: string }) => {
    const sessionId = props.id;
    const router = useRouter();
    const navigation = useNavigation();
    const session = useSession(sessionId);
    const isDataReady = useIsDataReady();
    const { theme } = useUnistyles();
    const safeArea = useSafeAreaInsets();
    const isLandscape = useIsLandscape();
    const deviceType = useDeviceType();
    const isIpad = Platform.OS === 'ios' && Platform.isPad;
    const shouldUseCompactLandscapeSessionLayout = isLandscape && !isIpad && deviceType === 'phone';
    const shouldHideHeader = shouldHideSessionHeaderForCompactLayout(shouldUseCompactLandscapeSessionLayout);
    const headerHeight = useNavigationHeaderHeight();
    const shouldUseTransparentNativeHeader = Platform.OS === 'ios' && !isRunningOnMac() && !shouldHideHeader;
    const realtimeStatus = useRealtimeStatus();
    const isTablet = useIsTablet();
    const runningTaskCount = useOrchestratorRunningTaskCount(sessionId);
    const hasRuns = useOrchestratorHasRuns(sessionId);
    const handleOpenSessionRuns = React.useCallback(() => {
        router.push(`/orchestrator?controllerSessionId=${encodeURIComponent(sessionId)}`);
    }, [router, sessionId]);

    // Start a new session, carrying over the current session's machine and path
    const handleNewSession = React.useCallback(() => {
        const params = new URLSearchParams();
        const machineId = session?.metadata?.machineId;
        const path = session?.metadata?.path;
        if (machineId) params.set('machineId', machineId);
        if (path) params.set('path', path);
        const query = params.toString();
        router.push(query ? `/new?${query}` : '/new');
    }, [router, session?.metadata?.machineId, session?.metadata?.path]);

    const handleBackPress = React.useCallback(() => {
        if (navigation.canGoBack()) {
            router.back();
        } else {
            router.replace('/');
        }
    }, [navigation, router]);

    // Track if we've confirmed the session doesn't exist after data loads
    const [sessionNotFound, setSessionNotFound] = React.useState(false);

    // When session appears, reset the not found state
    React.useEffect(() => {
        if (session) {
            setSessionNotFound(false);
        }
    }, [session]);

    // When session doesn't exist, refresh sessions and check again
    React.useEffect(() => {
        if (!isDataReady || session || sessionNotFound) {
            return;
        }

        let cancelled = false;

        // Refresh sessions and then check if session exists
        sync.refreshSessions()
            .then(() => {
                if (cancelled) return;
                // After refresh, check if session exists in storage (owned or shared)
                if (!storage.getState().sessions[sessionId] && !storage.getState().sharedSessions[sessionId]) {
                    setSessionNotFound(true);
                }
            })
            .catch(() => {
                // On error, mark as not found to avoid infinite loading
                if (!cancelled) {
                    setSessionNotFound(true);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [isDataReady, session, sessionId, sessionNotFound]);

    // Compute header props based on session state
    const headerProps = useMemo(() => {
        if (!isDataReady) {
            // Loading state - show empty header
            return {
                title: '',
                subtitle: undefined,
                avatarId: undefined,
                onAvatarPress: undefined,
                isConnected: false,
                flavor: null
            };
        }

        if (!session) {
            // Show deleted message only if we've confirmed session doesn't exist
            // Otherwise show empty header while waiting for data
            return {
                title: sessionNotFound ? t('errors.sessionDeleted') : '',
                subtitle: undefined,
                avatarId: undefined,
                onAvatarPress: undefined,
                isConnected: false,
                flavor: null
            };
        }

        // Normal state - show session info
        const isConnected = session.presence === 'online';
        return {
            title: getSessionName(session),
            subtitle: session.metadata?.path ? formatPathRelativeToHome(session.metadata.path, session.metadata?.homeDir) : undefined,
            avatarId: getSessionAvatarId(session),
            onAvatarPress: () => router.push(`/session/${sessionId}/info`),
            isConnected: isConnected,
            flavor: session.metadata?.flavor || null,
            sessionIcon: session.metadata?.sessionIcon || null,
            tintColor: isConnected ? '#000' : '#8E8E93'
        };
    }, [session, isDataReady, sessionId, router, sessionNotFound]);

    return (
        <>
            {/* Status bar shadow for landscape mode */}
            {shouldUseCompactLandscapeSessionLayout && (
                <View style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    height: safeArea.top,
                    backgroundColor: theme.colors.surface,
                    zIndex: 1000,
                    shadowColor: theme.colors.shadow.color,
                    shadowOffset: {
                        width: 0,
                        height: 2,
                    },
                    shadowOpacity: theme.colors.shadow.opacity,
                    shadowRadius: 3,
                    elevation: 5,
                }} />
            )}

            {/* Native header config. With the transparent header the message list scrolls beneath it
                and the system scroll-edge effect paints the soft fade there (iOS 26+).
                Title and subtitle have to stay plain strings: UIKit stops drawing the scroll-edge
                effect as soon as a custom title view (`headerTitle` as a component) is set, and it
                ignores `headerSubtitle` in that case too. */}
            <Stack.Screen
                options={{
                    headerShown: !shouldHideHeader,
                    headerTransparent: shouldUseTransparentNativeHeader,
                    headerStyle: shouldUseTransparentNativeHeader ? { backgroundColor: 'transparent' } : undefined,
                    headerShadowVisible: !shouldUseTransparentNativeHeader,
                    scrollEdgeEffects: shouldUseTransparentNativeHeader
                        ? { top: 'soft', bottom: 'hidden' }
                        : undefined,
                    headerTitle: headerProps.title,
                    headerSubtitle: headerProps.subtitle,
                    headerLeft: Platform.OS === 'web' ? () => (
                        <HeaderBackButton
                            tintColor={theme.colors.header.tint}
                            onPress={handleBackPress}
                        />
                    ) : undefined,
                    headerRight: session ? () => (
                        <ChatHeaderRight
                            avatarId={headerProps.avatarId}
                            isConnected={headerProps.isConnected}
                            onAvatarPress={headerProps.onAvatarPress}
                            hasRuns={hasRuns}
                            runningTaskCount={runningTaskCount}
                            onOpenRuns={handleOpenSessionRuns}
                            // The + opens /new pre-filled with this session's machine and path,
                            // which only works on a machine of my own — a session shared with me
                            // points at the owner's.
                            onNewSession={session.accessLevel ? undefined : handleNewSession}
                        />
                    ) : undefined,
                }}
            />

            {/* Content based on state. The padding is only there for the loading states: once the
                session is loaded the chat list scrolls under the transparent header and reserves
                the header's height with its own list header, which is what the scroll-edge effect
                needs to have content to fade. */}
            <View style={{ flex: 1, paddingTop: shouldUseTransparentNativeHeader && (!isDataReady || !session) ? headerHeight : 0 }}>
                {/* Voice status bar below header - not on tablet (shown in sidebar), hidden in landscape phone */}
                {!(shouldUseCompactLandscapeSessionLayout && Platform.OS !== 'web') && !isTablet && realtimeStatus !== 'disconnected' && (
                    <VoiceAssistantStatusBar
                        variant="full"
                        style={{
                            position: 'relative',
                            zIndex: 20,
                            elevation: 20,
                            // The content area no longer reserves the header, so the bar steps
                            // down by the header's height to stay clear of the native one.
                            marginTop: shouldUseTransparentNativeHeader && isDataReady && session ? headerHeight : 0,
                        }}
                    />
                )}
                {!isDataReady ? (
                    // Loading state - initial data not ready
                    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                        <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                    </View>
                ) : !session && !sessionNotFound ? (
                    // Loading state - waiting for session data to arrive
                    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                        <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                    </View>
                ) : !session && sessionNotFound ? (
                    // Deleted state - confirmed session doesn't exist
                    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                        <Ionicons name="trash-outline" size={48} color={theme.colors.textSecondary} />
                        <Text style={{ color: theme.colors.text, fontSize: 20, marginTop: 16, fontWeight: '600' }}>{t('errors.sessionDeleted')}</Text>
                        <Text style={{ color: theme.colors.textSecondary, fontSize: 15, marginTop: 8, textAlign: 'center', paddingHorizontal: 32 }}>{t('errors.sessionDeletedDescription')}</Text>
                    </View>
                ) : session ? (
                    // Normal session view
                    <SessionViewLoaded
                        key={sessionId}
                        sessionId={sessionId}
                        session={session}
                        headerTopInset={shouldUseTransparentNativeHeader ? headerHeight : 0}
                    />
                ) : null}
            </View>
        </>
    );
});


function SessionViewLoaded({ sessionId, session, headerTopInset }: { sessionId: string, session: Session, headerTopInset: number }) {
    const { theme } = useUnistyles();
    const router = useRouter();
    const safeArea = useSafeAreaInsets();
    const isFocused = useIsFocused();
    const isLandscape = useIsLandscape();
    const deviceType = useDeviceType();
    const isIpad = Platform.OS === 'ios' && Platform.isPad;
    const shouldUseCompactLandscapeSessionLayout = isLandscape && !isIpad && deviceType === 'phone';
    const [message, setMessage] = React.useState('');
    const realtimeStatus = useRealtimeStatus();
    const { messages, isLoaded, fetchVersion } = useSessionMessages(sessionId);
    const messagesFetching = useSessionMessagesFetching(sessionId);
    const pendingMessages = useSessionPendingMessages(sessionId);
    const acknowledgedCliVersions = useLocalSetting('acknowledgedCliVersions');

    // Check if CLI version is outdated and not already acknowledged
    const cliVersion = session.metadata?.version;
    const machineId = session.metadata?.machineId;
    const latestCliVersion = useLatestCliVersion();
    const isCliOutdated = cliVersion && latestCliVersion && !isVersionSupported(cliVersion, latestCliVersion);
    const isAcknowledged = machineId && acknowledgedCliVersions[machineId] === cliVersion;
    const isSessionOnline = session.presence === 'online';
    const shouldShowCliWarning = isSessionOnline && isCliOutdated && !isAcknowledged;
    // Get permission mode from session object, default to 'default'
    const permissionMode = session.permissionMode || 'default';
    // Get model mode from session object. "default" means use CLI/profile configured model.
    const modelMode = session.modelMode || 'default';
    const fastMode = session.fastMode ?? false;
    const sessionStatus = useSessionStatus(session);
    const sessionUsage = useSessionUsage(sessionId);
    const alwaysShowContextSize = useSetting('alwaysShowContextSize');
    const [silentRefreshTrackingKey, setSilentRefreshTrackingKey] = React.useState(0);
    const [silentRefreshPhase, setSilentRefreshPhase] = React.useState<'idle' | 'refreshing' | 'failed'>('idle');
    // Opens SILENT_REFRESH_INDICATOR_DELAY_MS after focus/retry. Gates the message-list
    // refreshing indicator so a fast (<3s) reload never flashes "refreshing".
    const [refreshGateOpen, setRefreshGateOpen] = React.useState(false);
    const latestMessageSnapshotRef = React.useRef({ isLoaded, messages, fetchVersion });
    latestMessageSnapshotRef.current = { isLoaded, messages, fetchVersion };
    const silentRefreshBaselineRef = React.useRef<{ isLoaded: boolean; messagesRef: typeof messages; fetchVersion: number } | null>(null);

    const startSilentRefreshTracking = React.useCallback(() => {
        const snapshot = latestMessageSnapshotRef.current;
        if (!snapshot.isLoaded) {
            setSilentRefreshTrackingKey(0);
            setSilentRefreshPhase('idle');
            silentRefreshBaselineRef.current = null;
            return;
        }

        silentRefreshBaselineRef.current = {
            isLoaded: snapshot.isLoaded,
            messagesRef: snapshot.messages,
            fetchVersion: snapshot.fetchVersion,
        };
        setSilentRefreshTrackingKey((k) => k + 1);
        setSilentRefreshPhase('idle');
    }, []);

    const isTracking = silentRefreshTrackingKey > 0;

    React.useEffect(() => {
        if (!isTracking) {
            return;
        }
        const baseline = silentRefreshBaselineRef.current;
        if (!baseline) {
            return;
        }
        if (messages !== baseline.messagesRef || isLoaded !== baseline.isLoaded || fetchVersion !== baseline.fetchVersion) {
            setSilentRefreshTrackingKey(0);
            setSilentRefreshPhase('idle');
            silentRefreshBaselineRef.current = null;
        }
    }, [isTracking, isLoaded, messages, fetchVersion]);

    React.useEffect(() => {
        if (!isTracking) {
            return;
        }
        const refreshingTimer = setTimeout(() => {
            setSilentRefreshPhase((prev) => (prev === 'idle' ? 'refreshing' : prev));
        }, SILENT_REFRESH_INDICATOR_DELAY_MS);
        const failedTimer = setTimeout(() => {
            setSilentRefreshPhase((prev) => {
                if (prev === 'idle' || prev === 'refreshing') {
                    return 'failed';
                }
                return prev;
            });
        }, SILENT_REFRESH_FAILED_TIMEOUT_MS);
        return () => {
            clearTimeout(refreshingTimer);
            clearTimeout(failedTimer);
        };
    }, [isTracking, silentRefreshTrackingKey]);

    const handleRetryStatusRefresh = React.useCallback(() => {
        startSilentRefreshTracking();
        setSilentRefreshPhase('refreshing');
        // Explicit retry: surface feedback immediately and force a fresh message bootstrap
        // (clears the cursor → fetchMessagesV3 bootstrap → sets messagesFetching).
        setRefreshGateOpen(true);
        sync.onSessionVisible(sessionId, true);
        void sync.refreshSessions().catch(() => {
            // Keep current phase and rely on timeout-based feedback.
        });
    }, [startSilentRefreshTracking, sessionId]);

    const isRefreshingStatus = silentRefreshPhase === 'refreshing' || sessionStatus.state === 'syncing';
    // Real "message list is reloading" signal, gated behind the 3s delay. When true it takes
    // priority over both the original clear and the 12s failure: as long as the list is genuinely
    // still fetching, keep showing "refreshing" (an errored fetch clears messagesFetching, so a
    // stuck network falls through to "refresh failed" instead of spinning forever).
    const isListRefreshing = messagesFetching && refreshGateOpen;

    const inputConnectionStatus = React.useMemo(() => {
        if (isListRefreshing) {
            return {
                text: t('status.refreshing'),
                color: theme.colors.status.connecting,
                dotColor: theme.colors.status.connecting,
                isPulsing: true
            };
        }
        if (silentRefreshPhase === 'failed') {
            return {
                text: t('status.refreshFailed'),
                color: theme.colors.status.error,
                dotColor: theme.colors.status.error,
                isPulsing: false,
                onPress: handleRetryStatusRefresh
            };
        }
        if (isRefreshingStatus) {
            return {
                text: t('status.refreshing'),
                color: theme.colors.status.connecting,
                dotColor: theme.colors.status.connecting,
                isPulsing: true
            };
        }
        return {
            text: sessionStatus.statusText,
            color: sessionStatus.statusColor,
            dotColor: sessionStatus.statusDotColor,
            isPulsing: sessionStatus.isPulsing,
            ...(sessionStatus.state === 'permission_required' && { action: 'openPermission' as const }),
        };
    }, [isListRefreshing, silentRefreshPhase, isRefreshingStatus, sessionStatus, theme.colors.status.connecting, theme.colors.status.error, handleRetryStatusRefresh]);

    // Ref for the input component (used for web auto-focus)
    const inputRef = React.useRef<MultiTextInputHandle>(null);

    // Handler for filling the input from option selection
    const handleFillInput = React.useCallback(async (text: string, allOptions?: string[]) => {
        const currentMessage = message.trim();
        if (currentMessage) {
            // Skip confirmation if current input is one of the available options
            const isCurrentInputAnOption = allOptions?.includes(currentMessage);
            if (!isCurrentInputAnOption) {
                const confirmed = await Modal.confirm(
                    t('message.confirmOverwriteInput'),
                    t('message.confirmOverwriteInputMessage'),
                    { confirmText: t('common.yes'), cancelText: t('common.cancel') }
                );
                if (!confirmed) return;
            }
        }
        setMessage(text);
        // Auto-focus input on web platform
        if (Platform.OS === 'web') {
            inputRef.current?.focus();
        }
    }, [message]);

    // Image picker hook for handling image attachments
    const {
        images,
        pickFromGallery,
        pickFromCamera,
        addImagesFromFiles,
        removeImage,
        clearImages,
        initImages,
        canAddMore,
    } = useImagePicker({ maxImages: 4 });

    // Use draft hook for auto-saving message drafts
    const { clearDraft } = useDraft(sessionId, message, setMessage, images, initImages);

    const [isUploadingImages, setIsUploadingImages] = React.useState(false);
    const [isSending, setIsSending] = React.useState(false);

    // Track failed message for retry with same localId
    const failedMessageRef = React.useRef<{ localId: string; content: string } | null>(null);

    // Duplicate sheet state
    const [duplicateSheetVisible, setDuplicateSheetVisible] = React.useState(false);
    const [duplicateMessages, setDuplicateMessages] = React.useState<UserMessageWithUuid[] | null>(null);
    const [duplicateLoading, setDuplicateLoading] = React.useState(false);
    const [duplicateLoadingMore, setDuplicateLoadingMore] = React.useState(false);
    const [duplicateHasMore, setDuplicateHasMore] = React.useState(false);
    const [duplicateBeforeIndex, setDuplicateBeforeIndex] = React.useState<number | null>(null);
    const [duplicateConfirming, setDuplicateConfirming] = React.useState(false);
    // Id of the user message whose per-message fork is in progress (drives the
    // in-icon spinner on its action bar).
    const [forkingMessageId, setForkingMessageId] = React.useState<string | null>(null);

    // Ref for hidden file input (web only)
    const fileInputRef = React.useRef<HTMLInputElement>(null);

    // Image picker sheet state
    const [imagePickerSheetVisible, setImagePickerSheetVisible] = React.useState(false);

    // Check if the current session flavor supports images
    const supportsImages = React.useMemo(() => {
        const flavor = session?.metadata?.flavor;
        return flavor === 'claude' || flavor === 'gemini' || flavor === 'codex';
    }, [session?.metadata?.flavor]);

    // Handle dismissing CLI version warning
    const handleDismissCliWarning = React.useCallback(() => {
        if (machineId && cliVersion) {
            storage.getState().applyLocalSettings({
                acknowledgedCliVersions: {
                    ...acknowledgedCliVersions,
                    [machineId]: cliVersion
                }
            });
        }
    }, [machineId, cliVersion, acknowledgedCliVersions]);

    // Function to update permission mode
    const updatePermissionMode = React.useCallback((mode: 'default' | 'acceptEdits' | 'auto' | 'bypassPermissions' | 'plan' | 'read-only' | 'on-failure' | 'full-auto' | 'auto_edit' | 'yolo') => {
        storage.getState().updateSessionPermissionMode(sessionId, mode);
    }, [sessionId]);

    // Function to update model mode
    const updateModelMode = React.useCallback((mode: string) => {
        storage.getState().updateSessionModelMode(sessionId, mode);
    }, [sessionId]);

    const updateFastMode = React.useCallback((enabled: boolean) => {
        storage.getState().setSessionFastMode(sessionId, enabled);
    }, [sessionId]);

    const loadDuplicateMessagesPage = React.useCallback(async (beforeIndex?: number): Promise<UserMessagePage> => {
        const flavor = session.metadata?.flavor;
        const claudeSessionId = session.metadata?.claudeSessionId;
        const codexSessionId = session.metadata?.codexSessionId;
        if (!machineId) return { messages: [], hasMore: false, nextBeforeIndex: null };

        if (flavor === 'gemini') {
            return machineGetGeminiSessionUserMessages(machineId, session.id, { beforeIndex });
        }
        if (flavor === 'codex' && codexSessionId) {
            return machineGetCodexSessionUserMessages(machineId, codexSessionId, { beforeIndex });
        }
        if (claudeSessionId) {
            const result = await machineGetClaudeSessionUserMessages(machineId, claudeSessionId, { beforeIndex });
            return result;
        }
        return { messages: [], hasMore: false, nextBeforeIndex: null };
    }, [machineId, session.id, session.metadata?.flavor, session.metadata?.claudeSessionId, session.metadata?.codexSessionId]);

    const applyDuplicatePage = React.useCallback((page: UserMessagePage, appendOlder: boolean) => {
        setDuplicateMessages((current) => {
            if (!appendOlder || !current) return page.messages;
            const seen = new Set(current.map((message) => message.uuid));
            return [...page.messages.filter((message) => !seen.has(message.uuid)), ...current];
        });
        setDuplicateHasMore(page.hasMore);
        setDuplicateBeforeIndex(page.nextBeforeIndex);
    }, []);

    // Handle opening the duplicate sheet - loads user messages from the session
    const handleOpenDuplicateSheet = React.useCallback(async () => {
        if (!canForkSession(storage.getState().sessions[session.id])) return;
        const flavor = session.metadata?.flavor;
        const claudeSessionId = session.metadata?.claudeSessionId;
        const codexSessionId = session.metadata?.codexSessionId;
        const canDuplicate = Boolean(claudeSessionId || flavor === 'gemini' || codexSessionId);
        if (!machineId || !canDuplicate) {
            Modal.alert(t('common.error'), t('duplicate.notAvailable'));
            return;
        }

        // Blur input to prevent keyboard from re-appearing when the modal closes
        inputRef.current?.blur();

        setDuplicateSheetVisible(true);
        setDuplicateLoading(true);
        setDuplicateMessages(null);
        setDuplicateHasMore(false);
        setDuplicateBeforeIndex(null);

        try {
            applyDuplicatePage(await loadDuplicateMessagesPage(), false);
        } catch (error) {
            console.error('Failed to load duplicate messages:', error);
            Modal.alert(t('common.error'), t('duplicate.loadFailed'));
            setDuplicateSheetVisible(false);
        } finally {
            setDuplicateLoading(false);
        }
    }, [machineId, session.id, session.metadata?.flavor, session.metadata?.claudeSessionId, session.metadata?.codexSessionId, loadDuplicateMessagesPage, applyDuplicatePage]);

    const handleLoadMoreDuplicateMessages = React.useCallback(async () => {
        if (duplicateLoadingMore || !duplicateHasMore || duplicateBeforeIndex == null) return;
        setDuplicateLoadingMore(true);
        try {
            applyDuplicatePage(await loadDuplicateMessagesPage(duplicateBeforeIndex), true);
        } catch (error) {
            console.error('Failed to load older duplicate messages:', error);
            Modal.alert(t('common.error'), t('duplicate.loadFailed'));
        } finally {
            setDuplicateLoadingMore(false);
        }
    }, [duplicateLoadingMore, duplicateHasMore, duplicateBeforeIndex, loadDuplicateMessagesPage, applyDuplicatePage]);

    // Core fork-and-spawn logic, shared by the duplicate sheet and the
    // per-message fork icon.
    //
    // `uuid` is the CLI message to truncate before (the new session keeps
    // everything older than it). Passing `uuid: null` forks the WHOLE session
    // with no truncation — used when forking from the latest AI reply, which has
    // no following user prompt to truncate at. `skipDraft` suppresses the draft
    // write (AI-message forks continue after the reply, so there's nothing to
    // pre-fill; user-message forks pre-fill the tapped prompt).
    const forkSessionFromUuid = React.useCallback(async (opts: { uuid: string | null; draftText?: string; skipDraft: boolean }) => {
        if (!canForkSession(storage.getState().sessions[session.id])) {
            setDuplicateConfirming(false);
            return;
        }
        const { uuid, draftText, skipDraft } = opts;
        const flavor = session.metadata?.flavor;
        const claudeSessionId = session.metadata?.claudeSessionId;
        const codexSessionId = session.metadata?.codexSessionId;
        const sessionPath = session.metadata?.path;
        if (!machineId || !sessionPath) {
            // Reset so the fork loading overlay / sheet spinner can't get stuck.
            setDuplicateConfirming(false);
            return;
        }

        // Start confirming state - keep sheet open with loading button
        setDuplicateConfirming(true);

        try {
            let resumeSessionId: string | undefined;
            let agent: 'claude' | 'gemini' | 'codex' = 'claude';

            if (flavor === 'gemini') {
                const duplicateResult = uuid
                    ? await machineDuplicateGeminiSession(machineId, session.id, uuid)
                    : await machineForkGeminiSession(machineId, session.id);
                if (!duplicateResult.success || !duplicateResult.newSessionId) {
                    setDuplicateConfirming(false);
                    Modal.alert(t('common.error'), duplicateResult.errorMessage || t('duplicate.failed'));
                    return;
                }
                resumeSessionId = duplicateResult.newSessionId;
                agent = 'gemini';
            } else if (flavor === 'codex' && codexSessionId) {
                const duplicateResult = uuid
                    ? await machineDuplicateCodexSession(machineId, codexSessionId, uuid)
                    : await machineForkCodexSession(machineId, codexSessionId);
                if (!duplicateResult.success || !duplicateResult.newFilePath) {
                    setDuplicateConfirming(false);
                    Modal.alert(t('common.error'), duplicateResult.errorMessage || t('duplicate.failed'));
                    return;
                }
                resumeSessionId = duplicateResult.newFilePath;
                agent = 'codex';
            } else if (claudeSessionId) {
                const duplicateResult = uuid
                    ? await machineDuplicateClaudeSession(machineId, claudeSessionId, uuid)
                    : await machineForkClaudeSession(machineId, claudeSessionId);
                if (!duplicateResult.success || !duplicateResult.newSessionId) {
                    setDuplicateConfirming(false);
                    Modal.alert(t('common.error'), duplicateResult.errorMessage || t('duplicate.failed'));
                    return;
                }
                resumeSessionId = duplicateResult.newSessionId;
                agent = 'claude';
            } else {
                setDuplicateConfirming(false);
                return;
            }

            // Step 2: Spawn a new Happy session that resumes the forked Claude session
            const newSessionTitle = generateCopyTitle(getSessionName(session));

            const spawnResult = await machineSpawnNewSession({
                machineId,
                directory: sessionPath,
                agent,
                resumeSessionId,
                sessionTitle: newSessionTitle,
                skipForkSession: true,
            });

            if (spawnResult.type === 'success' && spawnResult.sessionId) {
                await sync.refreshSessions();
                await copySessionMetadata(session, spawnResult.sessionId).catch(e => console.warn('copySessionMetadata failed:', e));
                copySessionModeSettings(session, spawnResult.sessionId);

                // Save the selected message as a draft in the new session so it appears in the input box.
                // Skipped for AI-message forks (the new session continues after the reply, nothing to pre-fill).
                if (!skipDraft && draftText) {
                    storage.getState().setDraft(spawnResult.sessionId, {
                        text: draftText,
                        images: [],
                    });
                }

                // Close the sheet and navigate to the new Happy session
                setDuplicateSheetVisible(false);
                setDuplicateConfirming(false);
                router.replace(`/session/${spawnResult.sessionId}`);
            } else if (spawnResult.type === 'error') {
                setDuplicateConfirming(false);
                Modal.alert(t('common.error'), spawnResult.errorMessage || t('duplicate.failed'));
            }
        } catch (error) {
            console.error('Failed to duplicate session:', error);
            setDuplicateConfirming(false);
            Modal.alert(t('common.error'), t('duplicate.failed'));
        }
    }, [machineId, session.id, session.metadata?.flavor, session.metadata?.claudeSessionId, session.metadata?.codexSessionId, session.metadata?.path, router]);

    // Handle selecting a message in the duplicate sheet. Picker rows are previews,
    // so fetch the full prompt by UUID before creating the new-session draft.
    const handleDuplicateSelect = React.useCallback(async (uuid: string) => {
        if (!canForkSession(storage.getState().sessions[session.id])) return;
        const flavor = session.metadata?.flavor;
        const claudeSessionId = session.metadata?.claudeSessionId;
        const codexSessionId = session.metadata?.codexSessionId;
        if (!machineId) return;
        setDuplicateConfirming(true);
        try {
            let selected: UserMessageWithUuid | null = null;
            if (flavor === 'gemini') {
                selected = await machineGetGeminiSessionUserMessage(machineId, session.id, uuid);
            } else if (flavor === 'codex' && codexSessionId) {
                selected = await machineGetCodexSessionUserMessage(machineId, codexSessionId, uuid);
            } else if (claudeSessionId) {
                selected = await machineGetClaudeSessionUserMessage(machineId, claudeSessionId, uuid);
            }
            if (!selected) {
                setDuplicateConfirming(false);
                Modal.alert(t('common.error'), t('duplicate.loadFailed'));
                return;
            }
            await forkSessionFromUuid({ uuid, draftText: selected.content, skipDraft: false });
        } catch (error) {
            console.error('Failed to load selected duplicate message:', error);
            // Compatibility fallback for older CLIs that do not expose the
            // full-message lookup RPC yet. Their picker rows contain the best
            // available content (full for Claude, preview for Codex/Gemini).
            const selectedPreview = duplicateMessages?.find((message) => message.uuid === uuid);
            if (selectedPreview) {
                await forkSessionFromUuid({ uuid, draftText: selectedPreview.content, skipDraft: false });
            } else {
                setDuplicateConfirming(false);
                Modal.alert(t('common.error'), t('duplicate.loadFailed'));
            }
        }
    }, [machineId, session.id, session.metadata?.flavor, session.metadata?.claudeSessionId, session.metadata?.codexSessionId, forkSessionFromUuid, duplicateMessages]);

    // Runs after the user confirms a per-message fork: ask the CLI to resolve
    // the tapped message against the complete local JSONL, then fork. The RPC is
    // deferred to here (post-confirm) so tapping the fork icon shows the
    // confirm dialog instantly instead of waiting on an RPC round-trip.
    // Falls back to opening the sheet if the target can't be matched.
    //
    // `request.target` is the user message whose UUID becomes the truncation
    // point. For an AI-message fork it's the user prompt that FOLLOWS the reply
    // (so the reply is kept); when the reply has no following prompt it's null,
    // meaning fork the whole session with no truncation.
    const performForkFromMessage = React.useCallback(async (request: ForkMessageRequest) => {
        if (!canForkSession(storage.getState().sessions[session.id])) return;
        const flavor = session.metadata?.flavor;
        const claudeSessionId = session.metadata?.claudeSessionId;
        const codexSessionId = session.metadata?.codexSessionId;
        if (!machineId) return;

        // Turn the tapped message's fork icon into a spinner for the whole
        // post-confirm window (message load + fork), then clear it.
        setForkingMessageId(request.loadingMessageId);
        try {
            // No truncation target (forking from the latest AI reply): duplicate
            // the whole session, no draft.
            if (!request.target) {
                await forkSessionFromUuid({ uuid: null, skipDraft: true });
                return;
            }

            const target = request.target;
            let resolved: ResolvedForkTarget | null = null;
            try {
                if (flavor === 'gemini') {
                    resolved = await machineResolveGeminiForkTarget(machineId, session.id, target.text, target.createdAt);
                } else if (flavor === 'codex' && codexSessionId) {
                    resolved = await machineResolveCodexForkTarget(machineId, codexSessionId, target.text, target.createdAt);
                } else if (claudeSessionId) {
                    resolved = await machineResolveClaudeForkTarget(machineId, claudeSessionId, target.text, target.createdAt);
                }
            } catch (error) {
                console.warn('Failed to resolve fork target, falling back to picker:', error);
                await handleOpenDuplicateSheet();
                return;
            }

            if (!resolved) {
                // Fallback: open the paginated sheet so the user can pick manually.
                await handleOpenDuplicateSheet();
                return;
            }

            await forkSessionFromUuid({
                uuid: resolved.uuid,
                draftText: request.skipDraft ? undefined : target.text,
                skipDraft: request.skipDraft,
            });
        } finally {
            setForkingMessageId(null);
        }
    }, [machineId, session.id, session.metadata?.flavor, session.metadata?.claudeSessionId, session.metadata?.codexSessionId, forkSessionFromUuid, handleOpenDuplicateSheet]);

    // Handle the per-message fork icon: show the confirm dialog immediately,
    // then do the network work in performForkFromMessage once confirmed.
    const handleForkFromMessage = React.useCallback((request: ForkMessageRequest) => {
        if (!canForkSession(storage.getState().sessions[session.id])) return;
        const flavor = session.metadata?.flavor;
        const claudeSessionId = session.metadata?.claudeSessionId;
        const codexSessionId = session.metadata?.codexSessionId;
        const canDuplicate = Boolean(claudeSessionId || flavor === 'gemini' || codexSessionId);
        if (!machineId || !canDuplicate) {
            Modal.alert(t('common.error'), t('duplicate.notAvailable'));
            return;
        }

        // Blur input to prevent keyboard from re-appearing when the modal closes
        inputRef.current?.blur();

        Modal.alert(
            t('duplicate.confirmTitle'),
            t('duplicate.confirmMessage'),
            [
                { text: t('common.cancel'), style: 'cancel' },
                { text: t('duplicate.confirm'), onPress: () => { performForkFromMessage(request); } },
            ]
        );
    }, [machineId, session.id, session.metadata?.flavor, session.metadata?.claudeSessionId, session.metadata?.codexSessionId, performForkFromMessage]);

    // Handle closing the duplicate sheet (prevent closing while confirming)
    const handleCloseDuplicateSheet = React.useCallback(() => {
        if (!duplicateConfirming) {
            setDuplicateSheetVisible(false);
        }
    }, [duplicateConfirming]);

    // Memoize header-dependent styles to prevent re-renders
    const headerDependentStyles = React.useMemo(() => ({
        contentContainer: {
            flex: 1
        },
        flatListStyle: {
            marginTop: 0 // No marginTop needed since header is handled by parent
        },
    }), []);


    // Handle microphone button press - memoized to prevent button flashing
    const handleMicrophonePress = React.useCallback(async () => {
        if (realtimeStatus === 'connecting') {
            return; // Prevent actions during transitions
        }
        if (realtimeStatus === 'disconnected' || realtimeStatus === 'error') {
            try {
                const initialPrompt = voiceHooks.onVoiceStarted(sessionId);
                await startRealtimeSession(sessionId, initialPrompt);
                tracking?.capture('voice_session_started', { sessionId });
            } catch (error) {
                console.error('Failed to start realtime session:', error);
                Modal.alert(t('common.error'), t('errors.voiceSessionFailed'));
                tracking?.capture('voice_session_error', { error: error instanceof Error ? error.message : 'Unknown error' });
            }
        } else if (realtimeStatus === 'connected') {
            // On web/desktop, stop session from mic button; on mobile, use the status bar
            if (Platform.OS === 'web') {
                await stopRealtimeSession();
                tracking?.capture('voice_session_stopped');
                voiceHooks.onVoiceStopped();
            }
        }
    }, [realtimeStatus, sessionId]);

    // Memoize mic button state to prevent flashing during chat transitions
    const micButtonState = useMemo(() => ({
        onMicPress: handleMicrophonePress,
        isMicActive: realtimeStatus === 'connected' || realtimeStatus === 'connecting'
    }), [handleMicrophonePress, realtimeStatus]);

    // Handle image button press - platform-specific behavior
    const handleImageButtonPress = React.useCallback(() => {
        if (Platform.OS === 'web') {
            // Web: directly open file picker
            fileInputRef.current?.click();
        } else {
            // Native: show action sheet with camera and gallery options
            setImagePickerSheetVisible(true);
        }
    }, []);

    // Image picker sheet menu items
    const imagePickerMenuItems: ActionMenuItem[] = React.useMemo(() => [
        { label: t('session.takePhoto'), onPress: pickFromCamera },
        { label: t('session.chooseFromLibrary'), onPress: pickFromGallery },
    ], [pickFromCamera, pickFromGallery]);

    // Handle file input change (web only)
    const handleFileInputChange = React.useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        const files = event.target.files;
        if (!files || files.length === 0) return;

        void addImagesFromFiles(Array.from(files));

        // Reset input so same file can be selected again
        event.target.value = '';
    }, [addImagesFromFiles]);

    // Handle paste event for images (both web and native through input)
    const handlePaste = React.useCallback(async (event: ClipboardEvent) => {
        await handleImagePasteEvent(event, {
            isScreenFocused: isFocused,
            canAddMore,
            supportsImages,
            onImageFile: async (file) => addImagesFromFiles([file]),
        });
    }, [isFocused, canAddMore, supportsImages, addImagesFromFiles]);

    const handleImageDrop = React.useCallback(async (files: File[]) => {
        if (!supportsImages) return;
        await addImagesFromFiles(files);
    }, [supportsImages, addImagesFromFiles]);
    const { dropZoneRef, isDragging: isDraggingImage } = useWebImageDrop({
        enabled: isFocused && supportsImages,
        onImageDrop: handleImageDrop,
    });

    // Handle loading more older messages when scrolling to top
    const [minimapItems, setMinimapItems] = React.useState<ConversationMinimapItem[]>([]);
    const [minimapActiveMessageId, setMinimapActiveMessageId] = React.useState<string | null>(null);
    const [minimapCachedMessages, setMinimapCachedMessages] = React.useState<MinimapMessage[]>([]);
    const [contentAreaWidth, setContentAreaWidth] = React.useState(0);
    const minimapJumpRef = React.useRef<((message: MinimapMessage) => void | Promise<void>) | null>(null);
    const handleRegisterMinimapJump = React.useCallback((jump: ((message: MinimapMessage) => void | Promise<void>) | null) => {
        minimapJumpRef.current = jump;
    }, []);
    // The answer is handed back rather than dropped: a jump that has to page older messages in takes a
    // while, and the rail holds itself up until it lands.
    const handleMinimapJump = React.useCallback((message: MinimapMessage) => {
        return minimapJumpRef.current?.(message);
    }, []);

    // The minimap's summoning swipe, listened for from here: the rail cannot watch the screen edge itself
    // without putting a touch zone between the list and the thumb, and this View is the nearest ancestor
    // of the list that can hear the edge instead. The touch props below are bubbling events — they read
    // touches the list is already handling, and change nothing about how the list scrolls.
    const minimapEdgeTouchRef = React.useRef<ConversationMinimapEdgeTouch | null>(null);
    const handleRegisterMinimapEdgeTouch = React.useCallback((listener: ConversationMinimapEdgeTouch | null) => {
        minimapEdgeTouchRef.current = listener;
    }, []);
    // One stable handler per phase: this view re-renders constantly, and a new identity would make RN
    // re-register the touch handlers with it every time.
    const edgeTouchHandlers = React.useMemo(() => {
        const report = (phase: 'start' | 'move' | 'end') => (event: GestureResponderEvent) => {
            minimapEdgeTouchRef.current?.(phase, event.nativeEvent.pageX, event.nativeEvent.pageY);
        };
        return {
            onTouchStart: report('start'),
            onTouchMove: report('move'),
            onTouchEnd: report('end'),
            onTouchCancel: report('end'),
        };
    }, []);

    // Tracks which session the cached minimap list currently belongs to, so we only blank it on a
    // real session switch (not on every refocus of the same session, which would flicker the rail).
    const cachedMinimapSessionRef = React.useRef<string | null>(null);
    // Load all minimap landmarks (prompts and AskUserQuestion calls) from the persistent offline
    // cache so the rail can display ones that haven't been paged into the message list yet.
    // Refreshed on focus / session change.
    useFocusEffect(
        React.useCallback(() => {
            let cancelled = false;
            if (cachedMinimapSessionRef.current !== sessionId) {
                cachedMinimapSessionRef.current = sessionId;
                setMinimapCachedMessages([]);
            }
            void sync.getCachedMinimapMessages(sessionId)
                .then((messages) => {
                    if (!cancelled) {
                        setMinimapCachedMessages(messages);
                    }
                })
                .catch(() => {
                    // Minimap simply falls back to loaded messages; never surface an error.
                });
            return () => {
                cancelled = true;
            };
        }, [sessionId])
    );

    const handleLoadMore = React.useCallback(() => {
        return sync.fetchOlderMessages(sessionId);
    }, [sessionId]);

    // Trigger refresh whenever this session screen gets focus.
    useFocusEffect(
        React.useCallback(() => {
            sync.onSessionVisible(sessionId, true);
            startSilentRefreshTracking();
            // Keep the message-list refreshing indicator suppressed for the first 3s, matching
            // the existing silent-refresh behavior, then let it reflect the real fetch state.
            setRefreshGateOpen(false);
            const gateTimer = setTimeout(() => setRefreshGateOpen(true), SILENT_REFRESH_INDICATOR_DELAY_MS);
            void sync.refreshSessions().catch(() => {
                // Silent refresh indicator handles delayed feedback if status stays stale.
            });
            return () => clearTimeout(gateTimer);
        }, [sessionId, startSilentRefreshTracking])
    );

    // Add paste event listener for images (web only)
    React.useEffect(() => {
        if (Platform.OS !== 'web') return;

        const pasteListener = (e: Event) => handlePaste(e as ClipboardEvent);
        document.addEventListener('paste', pasteListener);

        return () => {
            document.removeEventListener('paste', pasteListener);
        };
    }, [handlePaste]);

    let content = (
        <>
            <Deferred>
                {messages.length > 0 && (
                    <ChatList
                        session={session}
                        onFillInput={handleFillInput}
                        onForkMessage={canForkSession(session) ? handleForkFromMessage : undefined}
                        forkingMessageId={forkingMessageId}
                        onLoadMore={handleLoadMore}
                        minimapCachedUserMessages={minimapCachedMessages}
                        onMinimapItemsChange={setMinimapItems}
                        onActiveMessageIdChange={setMinimapActiveMessageId}
                        onRegisterMinimapJump={handleRegisterMinimapJump}
                    />
                )}
            </Deferred>
        </>
    );
    const placeholder = messages.length === 0 ? (
        <>
            {isLoaded ? (
                <EmptyMessages session={session} />
            ) : (
                <ActivityIndicator size="small" color={theme.colors.textSecondary} />
            )}
        </>
    ) : null;

    const canEdit = canEditSession(session);

    const handleSendNowPending = React.useCallback(async (pendingId: string) => {
        try {
            // A paused (draft) message is excluded from dispatch, so resume it first —
            // otherwise pin+abort would skip it and it could never be sent.
            const target = pendingMessages.find((m) => m.id === pendingId);
            if (target?.pausedAt != null) {
                await sync.pausePendingMessage(sessionId, pendingId);
            }
            // Pin the message so it becomes the next to dispatch (pinnedAt desc ordering),
            // then abort the current turn — the server auto-dispatches the first pending message.
            await sync.pinPendingMessage(sessionId, pendingId);
            await sessionAbort(sessionId);
        } catch {
            Modal.alert(t('common.error'), t('status.operationFailed'));
        }
    }, [sessionId, pendingMessages]);

    const handlePinPending = React.useCallback(async (pendingId: string) => {
        const success = await sync.pinPendingMessage(sessionId, pendingId);
        if (!success) {
            Modal.alert(t('common.error'), t('status.operationFailed'));
        }
    }, [sessionId]);

    const handleDeletePending = React.useCallback(async (pendingId: string) => {
        const success = await sync.deletePendingMessage(sessionId, pendingId);
        if (!success) {
            Modal.alert(t('common.error'), t('status.operationFailed'));
        }
    }, [sessionId]);

    const handlePausePending = React.useCallback(async (pendingId: string) => {
        const success = await sync.pausePendingMessage(sessionId, pendingId);
        if (!success) {
            Modal.alert(t('common.error'), t('status.operationFailed'));
        }
    }, [sessionId]);

    const handleSaveEditPending = React.useCallback(async (pendingId: string, newText: string) => {
        const success = await sync.updatePendingMessageContent(sessionId, pendingId, newText);
        if (!success) {
            Modal.alert(t('common.error'), t('status.operationFailed'));
        }
    }, [sessionId]);

    const pendingQueuePanel = pendingMessages.length > 0 ? (
        <PendingQueuePanel
            sessionId={sessionId}
            messages={pendingMessages}
            canManage={canEdit}
            onSendNow={handleSendNowPending}
            onPin={handlePinPending}
            onDelete={handleDeletePending}
            onPause={handlePausePending}
            onSaveEdit={handleSaveEditPending}
        />
    ) : null;

    const input = canEdit ? (
        <AgentInput
            ref={inputRef}
            panelSideMargin
            placeholder={t('session.inputPlaceholder')}
            value={message}
            onChangeText={setMessage}
            sessionId={sessionId}
            permissionMode={permissionMode}
            onPermissionModeChange={updatePermissionMode}
            modelMode={modelMode as any}
            onModelModeChange={updateModelMode as any}
            fastMode={fastMode}
            onFastModeChange={updateFastMode}
            metadata={session.metadata}
            connectionStatus={inputConnectionStatus}
            onSend={async (textSnapshot) => {
                // Block sending during CLI upgrade
                if (session.upgrading) {
                    Modal.alert(
                        t('sessionInfo.cliUpgradeAvailable'),
                        t('sessionInfo.cliUpgradeSendBlocked')
                    );
                    return;
                }

                const messageToSend = (textSnapshot ?? message).trim();
                if (messageToSend || images.length > 0) {
                    const socketStatus = storage.getState().socketStatus;
                    log.log(`[SEND_DEBUG][UI] tap_send sid=${sessionId} hasText=${messageToSend.length > 0} images=${images.length} isSending=${isSending} socket=${socketStatus}`);

                    // Handle /duplicate command locally
                    if (messageToSend.toLowerCase() === '/duplicate') {
                        setMessage('');
                        clearDraft();
                        handleOpenDuplicateSheet();
                        return;
                    }

                    const imagesToSend = images.length > 0 ? [...images] : undefined;
                    const contentForRetry = messageToSend + JSON.stringify(imagesToSend || []);

                    // Check if this is a retry of the same content
                    const existingLocalId = failedMessageRef.current?.content === contentForRetry
                        ? failedMessageRef.current.localId
                        : undefined;

                    // Set sending state
                    setIsSending(true);
                    if (imagesToSend) {
                        setIsUploadingImages(true);
                    }

                    try {
                        const result = await sync.sendOrQueueMessage(
                            sessionId, messageToSend, undefined, imagesToSend, existingLocalId,
                            // Clear input before message appears in the list
                            () => {
                                setMessage('');
                                clearDraft();
                                clearImages();
                            }
                        );
                        const mode = result.success ? result.mode : 'failed';
                        const errorText = result.success ? 'none' : (result.error || 'none');
                        log.log(`[SEND_DEBUG][UI] send_result sid=${sessionId} success=${result.success} mode=${mode} localId=${result.localId} error=${errorText}`);

                        if (result.success) {
                            failedMessageRef.current = null;
                            trackMessageSent();
                        } else {
                            failedMessageRef.current = { localId: result.localId, content: contentForRetry };
                            log.log(`[SEND_DEBUG][UI] record_retry sid=${sessionId} localId=${result.localId} reason=${result.reason}`);
                            Modal.alert(t('common.error'), t(sendFailureKey(result.reason)));
                        }
                    } finally {
                        setIsSending(false);
                        setIsUploadingImages(false);
                    }
                }
            }}
            isSending={isSending}
            onMicPress={micButtonState.onMicPress}
            isMicActive={micButtonState.isMicActive}
            onAbort={() => sessionAbort(sessionId)}
            // A turn is in flight while it is thinking, while the send is still awaiting its
            // first signal, and while it is blocked on a permission request - all three can be
            // aborted; only the online-and-idle `waiting` state cannot.
            isBusy={sessionStatus.state === 'thinking' || sessionStatus.state === 'awaiting' || sessionStatus.state === 'permission_required'}
            onFileViewerPress={() => router.push(`/session/${sessionId}/files`)}
            // Autocomplete configuration
            autocompletePrefixes={(session.metadata?.flavor === 'codex' || session.metadata?.codexSessionId) ? ['@', '/', '$'] : ['@', '/']}
            autocompleteSuggestions={(query) => getSuggestions(sessionId, query)}
            usageData={sessionUsage ? {
                inputTokens: sessionUsage.inputTokens,
                outputTokens: sessionUsage.outputTokens,
                cacheCreation: sessionUsage.cacheCreation,
                cacheRead: sessionUsage.cacheRead,
                contextSize: sessionUsage.contextSize,
                contextWindowSize: sessionUsage.contextWindowSize,
            } : session.latestUsage ? {
                inputTokens: session.latestUsage.inputTokens,
                outputTokens: session.latestUsage.outputTokens,
                cacheCreation: session.latestUsage.cacheCreation,
                cacheRead: session.latestUsage.cacheRead,
                contextSize: session.latestUsage.contextSize,
                contextWindowSize: session.latestUsage.contextWindowSize,
            } : undefined}
            alwaysShowContextSize={alwaysShowContextSize}
            images={images}
            onImagesChange={(newImages) => {
                // Handle image removal by finding removed index
                // Since useImagePicker manages state, we call removeImage for each removed image
                const currentUris = new Set(newImages.map(img => img.uri));
                images.forEach((img, index) => {
                    if (!currentUris.has(img.uri)) {
                        removeImage(index);
                    }
                });
            }}
            onImageButtonPress={handleImageButtonPress}
            supportsImages={supportsImages}
            isUploadingImages={isUploadingImages}
        />
    ) : null;


    return (
        <>
            {/* Hidden file input for web image upload */}
            {Platform.OS === 'web' && (
                <input
                    ref={fileInputRef as any}
                    type="file"
                    accept="image/jpeg,image/png"
                    multiple
                    style={{ display: 'none' }}
                    onChange={handleFileInputChange as any}
                />
            )}


            {/* CLI Version Warning Overlay - Subtle centered pill */}
            {shouldShowCliWarning && !shouldUseCompactLandscapeSessionLayout && (
                <Pressable
                    onPress={handleDismissCliWarning}
                    style={{
                        position: 'absolute',
                        top: headerTopInset + 8, // Clear the overlay header; the content area no longer pads for it
                        alignSelf: 'center',
                        backgroundColor: '#FFF3CD',
                        borderRadius: 100, // Fully rounded pill
                        paddingHorizontal: 14,
                        paddingVertical: 7,
                        flexDirection: 'row',
                        alignItems: 'center',
                        zIndex: 998, // Below voice bar but above content
                        shadowColor: '#000',
                        shadowOffset: { width: 0, height: 2 },
                        shadowOpacity: 0.15,
                        shadowRadius: 4,
                        elevation: 4,
                    }}
                >
                    <Ionicons name="warning-outline" size={14} color="#FF9500" style={{ marginRight: 6 }} />
                    <Text style={{
                        fontSize: 12,
                        color: '#856404',
                        fontWeight: '600'
                    }}>
                        {t('sessionInfo.cliVersionOutdated')}
                    </Text>
                    <Ionicons name="close" size={14} color="#856404" style={{ marginLeft: 8 }} />
                </Pressable>
            )}

            {/* Main content area - no padding since header is overlay */}
            <View
                ref={dropZoneRef}
                onLayout={(event) => setContentAreaWidth(event.nativeEvent.layout.width)}
                {...edgeTouchHandlers}
                style={{ flexBasis: 0, flexGrow: 1, position: 'relative', paddingBottom: safeArea.bottom + ((isRunningOnMac() || Platform.OS === 'web') ? 8 : 0) }}
            >
                <AgentContentView
                    content={content}
                    input={input}
                    placeholder={placeholder}
                    betweenContentAndInput={pendingQueuePanel}
                />
                {isDraggingImage && (
                    <View
                        pointerEvents="none"
                        style={{
                            position: 'absolute',
                            top: 8,
                            left: 8,
                            right: 8,
                            bottom: 8,
                            zIndex: 997,
                            alignItems: 'center',
                            justifyContent: 'center',
                            borderWidth: 2,
                            borderStyle: 'dashed',
                            borderColor: '#007AFF',
                            borderRadius: 8,
                            backgroundColor: theme.dark ? 'rgba(0, 122, 255, 0.14)' : 'rgba(0, 122, 255, 0.08)',
                        }}
                    >
                        <Ionicons name="images-outline" size={42} color="#007AFF" />
                    </View>
                )}
            </View >

            <ConversationMinimap
                userMessages={minimapItems}
                activeMessageId={minimapActiveMessageId}
                onJumpToMessage={handleMinimapJump}
                contentWidth={contentAreaWidth}
                onRegisterMinimapEdgeTouch={handleRegisterMinimapEdgeTouch}
            />

            {/* Back button for landscape phone mode when header is hidden */}
            {
                shouldHideSessionHeaderForCompactLayout(shouldUseCompactLandscapeSessionLayout) && (
                    <Pressable
                        onPress={() => router.back()}
                        style={{
                            position: 'absolute',
                            top: safeArea.top + 8,
                            left: 16,
                            width: 44,
                            height: 44,
                            borderRadius: 22,
                            backgroundColor: `rgba(${theme.dark ? '28, 23, 28' : '255, 255, 255'}, 0.9)`,
                            alignItems: 'center',
                            justifyContent: 'center',
                            ...Platform.select({
                                ios: {
                                    shadowColor: '#000',
                                    shadowOffset: { width: 0, height: 2 },
                                    shadowOpacity: 0.1,
                                    shadowRadius: 4,
                                },
                                android: {
                                    elevation: 2,
                                }
                            }),
                        }}
                        hitSlop={15}
                    >
                        <Ionicons
                            name={Platform.OS === 'ios' ? 'chevron-back' : 'arrow-back'}
                            size={Platform.select({ ios: 28, default: 24 })}
                            color={theme.dark ? '#fff' : '#000'}
                        />
                    </Pressable>
                )
            }

            {/* Duplicate Sheet */}
            <DuplicateSheet
                visible={canForkSession(session) && duplicateSheetVisible}
                messages={duplicateMessages}
                loading={duplicateLoading}
                loadingMore={duplicateLoadingMore}
                hasMore={duplicateHasMore}
                confirming={duplicateConfirming}
                onClose={handleCloseDuplicateSheet}
                onSelect={handleDuplicateSelect}
                onLoadMore={handleLoadMoreDuplicateMessages}
            />

            {/* Image Picker Sheet */}
            <ActionMenuModal
                visible={imagePickerSheetVisible}
                items={imagePickerMenuItems}
                onClose={() => setImagePickerSheetVisible(false)}
                deferItemPress
            />

        </>
    )
}


const ChatHeaderRight = React.memo((props: {
    avatarId?: string;
    isConnected?: boolean;
    onAvatarPress?: () => void;
    hasRuns: boolean;
    runningTaskCount: number;
    onOpenRuns: () => void;
    onNewSession?: () => void;
}) => {
    const { theme } = useUnistyles();
    return (
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            {props.hasRuns ? (
                <Pressable
                    onPress={props.onOpenRuns}
                    hitSlop={15}
                    accessibilityRole="button"
                    accessibilityLabel={t('settings.orchestratorOpenRuns')}
                    style={{
                        width: 38,
                        height: 38,
                        alignItems: 'center',
                        justifyContent: 'center',
                        marginRight: HEADER_LEADING_ACTION_MARGIN,
                    }}
                >
                    <Ionicons
                        name="layers-outline"
                        size={22}
                        color={theme.colors.header.tint}
                    />
                    {props.runningTaskCount > 0 && (
                        <View style={{
                            position: 'absolute',
                            top: 2,
                            right: 0,
                            backgroundColor: theme.colors.button.primary.background,
                            borderRadius: 8,
                            minWidth: 16,
                            height: 16,
                            paddingHorizontal: 3,
                            justifyContent: 'center',
                            alignItems: 'center',
                        }}>
                            <Text style={{
                                color: theme.colors.button.primary.tint,
                                fontSize: 10,
                                fontWeight: '600',
                            }}>
                                {props.runningTaskCount > 99 ? '99+' : props.runningTaskCount}
                            </Text>
                        </View>
                    )}
                </Pressable>
            ) : props.onNewSession ? (
                <Pressable
                    onPress={props.onNewSession}
                    hitSlop={15}
                    accessibilityRole="button"
                    accessibilityLabel={t('newSession.startNewSessionInFolder')}
                    style={{
                        width: 38,
                        height: 38,
                        alignItems: 'center',
                        justifyContent: 'center',
                        marginRight: HEADER_LEADING_ACTION_MARGIN,
                    }}
                >
                    <Ionicons
                        name="add"
                        size={26}
                        color={theme.colors.header.tint}
                    />
                </Pressable>
            ) : null}
            {props.avatarId && props.onAvatarPress && (
                <Pressable
                    onPress={props.onAvatarPress}
                    hitSlop={15}
                    style={{
                        width: 38,
                        height: 38,
                        alignItems: 'center',
                        justifyContent: 'center',
                    }}
                >
                    <Avatar
                        id={props.avatarId}
                        size={36}
                        monochrome={!props.isConnected}
                        hideBadges
                    />
                </Pressable>
            )}
        </View>
    );
});
