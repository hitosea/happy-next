import { AgentContentView } from '@/components/AgentContentView';
import { layout } from '@/components/layout';
import { AgentInput } from '@/components/AgentInput';
import { Avatar } from '@/components/Avatar';
import { MultiTextInputHandle } from '@/components/MultiTextInput';
import { getSuggestions } from '@/components/autocomplete/suggestions';
import { ChatHeaderTitle } from '@/components/ChatHeaderTitle';
import { HeaderBackButton } from '@/components/navigation/Header';
import { ChatList, type ForkMessageRequest } from '@/components/ChatList';
import { ConversationMinimap, type ConversationMinimapEdgeTouch, type ConversationMinimapItem } from '@/components/ConversationMinimap';
import type { MessageJumpTarget, MinimapMessage } from '@/sync/typesMessage';
import { subscribeSessionMessageJump, takeSessionMessageJump } from '@/sync/sessionMessageJump';
import { Deferred } from '@/components/Deferred';
import { DuplicateSheet } from '@/components/DuplicateSheet';
import { ActionMenuModal } from '@/components/ActionMenuModal';
import { NativeMenu } from '@/components/NativeMenu';
import { hapticsLight } from '@/components/haptics';
import type { ActionMenuItem } from '@/components/ActionMenu';
import { EmptyMessages } from '@/components/EmptyMessages';
import { PendingQueuePanel } from '@/components/PendingQueuePanel';
import { ScheduleMessageSheet } from '@/components/ScheduleMessageSheet';
import { subscribeScheduleAtLimit } from '@/sync/usageLimitNotice';
import { VoiceAssistantStatusBar } from '@/components/VoiceAssistantStatusBar';
import { useDraft } from '@/hooks/useDraft';
import { useChatHeaderMenu } from '@/hooks/useChatHeaderMenu';
import { DEFAULT_ALLOWED_TYPES, useImagePicker } from '@/hooks/useImagePicker';
import { useFileAttachments } from '@/hooks/useFileAttachments';
import { useSharedContentIntake } from '@/hooks/useSharedContentIntake';
import type { ShareTarget } from '@/share/sharedContent';
import { useWebFileDrop } from '@/hooks/useWebFileDrop';
import { Modal } from '@/modal';
import { voiceHooks } from '@/realtime/hooks/voiceHooks';
import { startRealtimeSession, stopRealtimeSession } from '@/realtime/RealtimeSession';
import { sessionAbort, machineGetClaudeSessionUserMessages, machineDuplicateClaudeSession, machineForkClaudeSession, machineSpawnNewSession, machineGetGeminiSessionUserMessages, machineDuplicateGeminiSession, machineForkGeminiSession, machineGetCodexSessionUserMessages, machineDuplicateCodexSession, machineForkCodexSession, machineResolveClaudeForkTarget, machineResolveGeminiForkTarget, machineResolveCodexForkTarget, machineGetClaudeSessionUserMessage, machineGetGeminiSessionUserMessage, machineGetCodexSessionUserMessage, machineGetQoderSessionUserMessages, machineGetQoderSessionUserMessage, machineResolveQoderForkTarget, machineDuplicateQoderSession, machineForkQoderSession, type UserMessageWithUuid, type UserMessagePage, type ResolvedForkTarget } from '@/sync/ops';
import { storage, useIsDataReady, useOrchestratorRunningTaskCount, useOrchestratorHasRuns, useRealtimeStatus, useSessionMessages, useSessionMessagesFetching, useSessionPendingMessages, useSessionUsage, useSetting } from '@/sync/storage';
import { useMachine, useRememberedModelMode, useSession } from '@/sync/storage';
import type { SessionModeAgentType } from '@/sync/sessionModeConfig';
import { useInputHistory } from '@/hooks/useInputHistory';
import { rememberSentSuggestions } from '@/sync/recentSuggestions';
import { useQoderModels } from '@/hooks/useQoderModels';
import { Session } from '@/sync/storageTypes';
import { sync } from '@/sync/sync';
import { t } from '@/text';
import { tracking, trackMessageSent } from '@/track';
import { handleFilePasteEvent } from '@/utils/filePaste';
import { splitComposerFiles } from '@/utils/fileDrop';
import { isRunningOnMac } from '@/utils/platform';
import { softHeaderOptions } from '@/components/navigation/softHeader';
import { floatingComposerAvailable, floatingComposerScreenOptions } from '@/components/floatingComposer';
import { useSharedValue } from 'react-native-reanimated';

// iOS 26+ with Liquid Glass: the composer floats over the conversation as glass, and the list
// scrolls on under it behind the soft bottom scroll edge effect.
import { useDeviceType, useIsLandscape, useIsTablet } from '@/utils/responsive';
import { formatPathRelativeToHome, generateCopyTitle, getSessionAvatarId, getSessionName, useSessionStatus, copySessionMetadata, copySessionModeSettings } from '@/utils/sessionUtils';
import { canEditSession, canForkSession } from '@/utils/sessionLifecycle';
import { ArchivedSessionBanner } from '@/components/ArchivedSessionBanner';
import { sendFailureKey } from '@/utils/sendFailure';
import { getNativeHeaderTitleWidth } from '@/utils/nativeHeaderTitleWidth';
import { getSessionCliUpgrade } from '@/utils/cliUpdate';
import { log } from '@/log';
import { Ionicons } from '@expo/vector-icons';
import { useHeaderHeight as useNavigationHeaderHeight } from '@react-navigation/elements';
import { useFocusEffect, useIsFocused, useNavigation } from '@react-navigation/native';
import { Stack, useRouter } from 'expo-router';
import * as React from 'react';
import { useMemo } from 'react';
import { ActivityIndicator, Platform, Pressable, Text, useWindowDimensions, View, type GestureResponderEvent } from 'react-native';
import { buildClaudeModelMode, parseClaudeModelMode, type ModelMode } from 'happy-wire';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUnistyles } from 'react-native-unistyles';

const SILENT_REFRESH_INDICATOR_DELAY_MS = 3000;
const SILENT_REFRESH_FAILED_TIMEOUT_MS = 12000;

// Gap between the leading header-right action (orchestrator / new-session) and the avatar.
// Web (custom header) gets a roomier gap; native apps stay at the 4px baseline that
// `getNativeHeaderTitleWidth` assumes. Any value above 4 is compensated out of the iOS title
// width below, otherwise the system shifts the centered title to avoid the wider buttons.
const HEADER_LEADING_ACTION_MARGIN = Platform.OS === 'web' ? 8 : 4;

function shouldHideSessionHeaderForCompactLayout(shouldUseCompactLandscapeSessionLayout: boolean) {
    return shouldUseCompactLandscapeSessionLayout && Platform.OS !== 'web';
}

export const SessionView = React.memo((props: { id: string }) => {
    const sessionId = props.id;
    const router = useRouter();
    const navigation = useNavigation();
    const session = useSession(sessionId);
    // The machine's daemon runs a newer CLI than this session: the header's right button becomes an
    // upgrade icon that opens the session info page, where the session can restart on it
    const machine = useMachine(session?.metadata?.machineId ?? '');
    const headerCliUpgrade = session?.presence === 'online' ? getSessionCliUpgrade(session.metadata?.version, machine) : null;
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
    // Voice status bar below header - not on tablet (shown in sidebar), hidden in landscape phone
    const showVoiceStatusBar = !(shouldUseCompactLandscapeSessionLayout && Platform.OS !== 'web') && !isTablet && realtimeStatus !== 'disconnected';
    // On iOS the conversation runs under the transparent header. The voice bar is a fixed row, so
    // while it shows it takes the header's place at the top and the list starts below it.
    const headerInset = shouldUseTransparentNativeHeader ? headerHeight : 0;
    const listUnderHeader = shouldUseTransparentNativeHeader && !showVoiceStatusBar;
    const { width: screenWidth } = useWindowDimensions();
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

    const baseHeaderTitleWidth = getNativeHeaderTitleWidth({
        screenWidth: Math.min(screenWidth, layout.headerMaxWidth),
        leftActionCount: Platform.OS === 'web' ? 1 : undefined,
        rightActionCount: 2,
    });
    // iOS uses the system header: UIKit shifts the fixed-width title to avoid overlapping the
    // header-right buttons, which breaks centering when the leading action gap grows past the
    // 4px baseline assumed by getNativeHeaderTitleWidth. Trim the extra gap symmetrically (×2)
    // so the title stays geometrically centered.
    const headerTitleWidth = Platform.OS === 'ios' && baseHeaderTitleWidth !== undefined
        ? baseHeaderTitleWidth - (HEADER_LEADING_ACTION_MARGIN - 4) * 2
        : baseHeaderTitleWidth;

    // Narrow phones left-align the header title; tablets, web and Mac stay centered.
    const isNarrowPhone = Platform.OS !== 'web' && !isRunningOnMac() && !isTablet;
    // iOS centers the titleView regardless of alignment options, so give it the full available
    // width and left-align the text inside it. Reserve room on the right so a long title keeps
    // clear of the two header-right buttons.
    const leftAlignTitleWidth = Math.max(140, Math.min(screenWidth, layout.headerMaxWidth) - 192);

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

    // Compute header props based on session state. Keyed on what the header shows rather than on
    // the session object, which every streamed message replaces: the header options below follow
    // these, and new options re-render the whole stack navigator.
    const headerTitle = !isDataReady
        ? ''
        : session
            ? getSessionName(session)
            : (sessionNotFound ? t('errors.sessionDeleted') : '');
    const headerSubtitle = isDataReady && session?.metadata?.path
        ? formatPathRelativeToHome(session.metadata.path, session.metadata?.homeDir)
        : undefined;
    const headerAvatarId = isDataReady && session ? getSessionAvatarId(session) : undefined;
    const headerConnected = isDataReady && session?.presence === 'online';
    const hasHeaderSession = isDataReady && !!session;
    const handleAvatarPress = React.useCallback(() => {
        router.push(`/session/${sessionId}/info`);
    }, [router, sessionId]);
    const headerProps = useMemo(() => ({
        title: headerTitle,
        subtitle: headerSubtitle,
        avatarId: headerAvatarId,
        onAvatarPress: hasHeaderSession ? handleAvatarPress : undefined,
        isConnected: headerConnected,
    }), [headerTitle, headerSubtitle, headerAvatarId, hasHeaderSession, handleAvatarPress, headerConnected]);

    const hasSession = !!session;
    const isSharedSession = !!session?.accessLevel;
    // The + opens /new pre-filled with this session's machine and path, which only works on a
    // machine of my own — a session shared with me points at the owner's.
    const headerNewSession = isSharedSession ? undefined : handleNewSession;
    const { items: headerMenu, archiveMenu: headerArchiveMenu } = useChatHeaderMenu(session, {
        onDetails: headerProps.onAvatarPress,
        onOpenRuns: hasRuns ? handleOpenSessionRuns : undefined,
        onNewSessionHere: headerNewSession,
        cliUpgrade: headerCliUpgrade,
    });
    const [headerMenuVisible, setHeaderMenuVisible] = React.useState(false);
    const openHeaderMenu = React.useCallback(() => {
        hapticsLight();
        setHeaderMenuVisible(true);
    }, []);
    const closeHeaderMenu = React.useCallback(() => setHeaderMenuVisible(false), []);
    // Stack.Screen hands new options to the navigator, which re-renders the whole stack and its
    // headers, so they are rebuilt only when something they show changes.
    // `theme` from useUnistyles is a fresh proxy on every render, so the memo keys on the colors it reads.
    const headerSubtitleColor = theme.colors.textSecondary;
    const headerTintColor = theme.colors.header.tint;
    const screenOptions = useMemo(() => ({
        headerShown: !shouldHideHeader,
        ...(shouldUseTransparentNativeHeader ? softHeaderOptions : {}),
        ...(shouldUseTransparentNativeHeader ? floatingComposerScreenOptions : {}),
        headerTitleAlign: (isNarrowPhone ? 'left' : 'center') as 'left' | 'center',
        // The soft scroll-edge effect needs plain strings: a custom title view makes
        // UIKit drop both the effect and the subtitle (iOS centers the title regardless).
        headerTitle: shouldUseTransparentNativeHeader ? headerProps.title : () => (
            <ChatHeaderTitle
                title={headerProps.title}
                subtitle={headerProps.subtitle}
                align={isNarrowPhone ? 'left' : 'center'}
                width={isNarrowPhone ? (Platform.OS === 'ios' ? leftAlignTitleWidth : undefined) : headerTitleWidth}
            />
        ),
        headerSubtitle: shouldUseTransparentNativeHeader ? headerProps.subtitle : undefined,
        headerSubtitleColor: shouldUseTransparentNativeHeader ? headerSubtitleColor : undefined,
        headerLeft: Platform.OS === 'web' ? () => (
            <HeaderBackButton
                tintColor={headerTintColor}
                onPress={handleBackPress}
            />
        ) : undefined,
        headerRight: hasSession ? () => (
            <ChatHeaderRight
                avatarId={headerProps.avatarId}
                isConnected={headerProps.isConnected}
                onAvatarPress={headerProps.onAvatarPress}
                cliUpgrade={headerCliUpgrade}
                hasRuns={hasRuns}
                runningTaskCount={runningTaskCount}
                onOpenRuns={handleOpenSessionRuns}
                onNewSession={headerNewSession}
                menu={headerMenu}
                onOpenMenu={openHeaderMenu}
            />
        ) : undefined,
    }), [
        shouldHideHeader, shouldUseTransparentNativeHeader, isNarrowPhone, headerProps, leftAlignTitleWidth,
        headerTitleWidth, headerSubtitleColor, headerTintColor, handleBackPress, hasSession, hasRuns, runningTaskCount, handleOpenSessionRuns,
        headerNewSession, headerCliUpgrade, headerMenu, openHeaderMenu,
    ]);

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

            {/* Native header config — iOS uses system header, Android/Web go through createHeader */}
            <Stack.Screen options={screenOptions} />
            {headerArchiveMenu}
            {headerMenu && (
                <ActionMenuModal
                    visible={headerMenuVisible}
                    items={headerMenu}
                    onClose={closeHeaderMenu}
                />
            )}

            {/* Content based on state */}
            <View style={{ flex: 1 }}>
                {showVoiceStatusBar && (
                    <VoiceAssistantStatusBar
                        variant="full"
                        style={{
                            position: 'relative',
                            marginTop: headerInset,
                            zIndex: 20,
                            elevation: 20,
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
                    <SessionViewLoaded key={sessionId} sessionId={sessionId} session={session} headerInset={headerInset} listUnderHeader={listUnderHeader} />
                ) : null}
            </View>
        </>
    );
});


/**
 * `headerInset` is the height of a header drawn over this view (the transparent iOS header), zero
 * otherwise; `listUnderHeader` says whether the conversation starts under it or below a fixed row.
 */
function SessionViewLoaded({ sessionId, session, headerInset, listUnderHeader }: { sessionId: string, session: Session, headerInset: number, listUnderHeader: boolean }) {
    const { theme } = useUnistyles();
    // iOS (not Catalyst) and Android use the safe-area chat layout: the composer rides the keyboard
    // (a margin above the home indicator on iOS), and the list lifts its content natively to follow.
    const useNativeChatLayout = (Platform.OS === 'ios' && !isRunningOnMac()) || Platform.OS === 'android';
    const useFloatingComposer = useNativeChatLayout && floatingComposerAvailable;
    // Written by AgentContentView as the floating composer lays out, read by the list on the UI thread.
    const composerHeight = useSharedValue(0);
    const router = useRouter();
    const safeArea = useSafeAreaInsets();
    const isFocused = useIsFocused();
    const isLandscape = useIsLandscape();
    const deviceType = useDeviceType();
    const isIpad = Platform.OS === 'ios' && Platform.isPad;
    const shouldUseCompactLandscapeSessionLayout = isLandscape && !isIpad && deviceType === 'phone';
    const [message, setMessage] = React.useState('');
    // Read by callbacks handed to the message list, which would otherwise change on every keystroke.
    const messageRef = React.useRef(message);
    messageRef.current = message;
    const { inputHistory, rememberSentInput } = useInputHistory();
    const realtimeStatus = useRealtimeStatus();
    const { messages, isLoaded, fetchVersion } = useSessionMessages(sessionId);
    const messagesFetching = useSessionMessagesFetching(sessionId);
    const pendingMessages = useSessionPendingMessages(sessionId);

    const machineId = session.metadata?.machineId;
    const { models: qoderModels } = useQoderModels(machineId, session.metadata?.path ?? '', session.metadata?.flavor === 'qoder');
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

    // useSessionStatus builds a new object on every render; keyed on it, the composer's status would
    // be new each time and re-render the composer with every streamed message.
    const { statusText, statusColor, statusDotColor, isPulsing: statusPulsing, state: statusState } = sessionStatus;
    // A resumed or copied session whose CLI is still sending its history in reads "loading…" where
    // it would read "online", rather than passing for an empty new session. It reads "online" as
    // soon as the history shows, without waiting on the CLI's own "done" round trip.
    const historyLoading = session.metadata?.historyBackfill === 'pending' && messages.length === 0;
    const inputConnectionStatus = React.useMemo(() => {
        if (isListRefreshing) {
            return {
                text: t('status.refreshing'),
                color: theme.colors.status.refreshing,
                dotColor: theme.colors.status.refreshing,
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
                color: theme.colors.status.refreshing,
                dotColor: theme.colors.status.refreshing,
                isPulsing: true
            };
        }
        if (historyLoading && statusState === 'waiting') {
            return {
                text: t('status.loading'),
                color: theme.colors.status.refreshing,
                dotColor: theme.colors.status.refreshing,
                isPulsing: true
            };
        }
        return {
            text: statusText,
            color: statusColor,
            dotColor: statusDotColor,
            isPulsing: statusPulsing,
            ...(statusState === 'permission_required' && { action: 'openPermission' as const }),
        };
    }, [isListRefreshing, silentRefreshPhase, isRefreshingStatus, historyLoading, statusText, statusColor, statusDotColor, statusPulsing, statusState, theme.colors.status.refreshing, theme.colors.status.error, handleRetryStatusRefresh]);

    // Ref for the input component (used for web auto-focus)
    const inputRef = React.useRef<MultiTextInputHandle>(null);

    // Handler for filling the input from option selection
    const handleFillInput = React.useCallback(async (text: string, allOptions?: string[]) => {
        const currentMessage = messageRef.current.trim();
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
    }, []);

    // Image picker hook for handling image attachments
    const {
        images,
        pickFromGallery,
        pickFromCamera,
        addImagesFromFiles,
        removeImage,
        clearImages,
        initImages,
        addSharedImages,
    } = useImagePicker({ maxImages: 4 });

    // Use draft hook for auto-saving message drafts
    const { clearDraft } = useDraft(sessionId, message, setMessage, images, initImages);

    // Files upload to the session's machine as soon as they are picked; messages carry their paths
    const fileAttachments = useFileAttachments(sessionId);

    // What another app shared, when the share-target page sent it to this session
    const shareTarget = React.useMemo<ShareTarget>(() => ({ type: 'session', sessionId }), [sessionId]);
    useSharedContentIntake({
        target: shareTarget,
        enabled: isFocused,
        setText: setMessage,
        addImages: addSharedImages,
        addFiles: fileAttachments.addSharedFiles,
    });
    const { attachments, clearFiles } = fileAttachments;
    // Paths only exist once every attached file has landed on the machine
    const filesBlockSend = React.useCallback(() => {
        if (fileAttachments.isUploading) {
            Modal.alert(t('common.error'), t('session.files.stillUploading'));
            return true;
        }
        if (fileAttachments.hasFailed) {
            Modal.alert(t('common.error'), t('session.files.removeFailed'));
            return true;
        }
        return false;
    }, [fileAttachments.isUploading, fileAttachments.hasFailed]);

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

    // Add (+) menu sheet state
    const [imagePickerSheetVisible, setImagePickerSheetVisible] = React.useState(false);
    // Schedule sheet: `limitEndsAt` is captured when it opens (epoch seconds, or null).
    const [scheduleSheet, setScheduleSheet] = React.useState<{ visible: boolean; limitEndsAt: number | null; autoFocus: boolean }>({ visible: false, limitEndsAt: null, autoFocus: false });
    // Whether the composer had the cursor when the add (+) sheet was opened. The sheet's own
    // presentation can take focus from it, so it is read on the press, before the sheet opens.
    const composerFocusedOnAddRef = React.useRef(false);
    const [reschedulePendingId, setReschedulePendingId] = React.useState<string | null>(null);
    const messagesRef = React.useRef(messages);
    messagesRef.current = messages;

    // Check if the current session flavor supports images
    const supportsImages = React.useMemo(() => {
        const flavor = session?.metadata?.flavor;
        return flavor === 'claude' || flavor === 'gemini' || flavor === 'codex' || flavor === 'qoder';
    }, [session?.metadata?.flavor]);

    // Function to update permission mode
    const updatePermissionMode = React.useCallback((mode: 'default' | 'acceptEdits' | 'auto' | 'bypassPermissions' | 'plan' | 'read-only' | 'on-failure' | 'full-auto' | 'auto_edit' | 'yolo') => {
        storage.getState().updateSessionPermissionMode(sessionId, mode);
    }, [sessionId]);

    // Function to update model mode
    const updateModelMode = React.useCallback((mode: string) => {
        storage.getState().updateSessionModelMode(sessionId, mode);
    }, [sessionId]);

    // Claude Code's auto-compact window can change under the App's pick (`/autocompact` in the session), and
    // what the session reports it runs with is the truth: when that report changes to a size other than the
    // picked one, the pick is dropped, so the model settings show the size in effect and the next message
    // doesn't restart Claude Code to put the old pick back. Only a report that differs from the one seen before
    // counts: the first report is what the session started with (200K by default), before any message has
    // restarted Claude Code with the pick, and a pick made since is not contradicted by an older report.
    const reportedContextWindow = session.agentState?.contextWindowSize;
    const previousReportRef = React.useRef<number | undefined>(undefined);
    const modelModeRef = React.useRef(modelMode);
    modelModeRef.current = modelMode;
    const isClaudeSession = (session.metadata?.flavor ?? 'claude') === 'claude';
    React.useEffect(() => {
        if (!isClaudeSession || !reportedContextWindow) return;
        const previous = previousReportRef.current;
        previousReportRef.current = reportedContextWindow;
        if (previous === undefined || previous === reportedContextWindow) return;
        const { family, effort, contextWindow } = parseClaudeModelMode(modelModeRef.current as ModelMode);
        if (contextWindow && contextWindow !== reportedContextWindow) {
            updateModelMode(buildClaudeModelMode(family, effort ?? 'medium'));
        }
    }, [reportedContextWindow, isClaudeSession, updateModelMode]);

    const updateFastMode = React.useCallback((enabled: boolean) => {
        storage.getState().setSessionFastMode(sessionId, enabled);
    }, [sessionId]);

    const loadDuplicateMessagesPage = React.useCallback(async (beforeIndex?: number): Promise<UserMessagePage> => {
        const flavor = session.metadata?.flavor;
        const claudeSessionId = session.metadata?.claudeSessionId;
        const codexSessionId = session.metadata?.codexSessionId;
        const qoderSessionId = session.metadata?.qoderSessionId;
        if (!machineId) return { messages: [], hasMore: false, nextBeforeIndex: null };

        if (flavor === 'gemini') {
            return machineGetGeminiSessionUserMessages(machineId, session.id, { beforeIndex });
        }
        if (flavor === 'codex' && codexSessionId) {
            return machineGetCodexSessionUserMessages(machineId, codexSessionId, { beforeIndex });
        }
        if (flavor === 'qoder' && qoderSessionId) {
            return machineGetQoderSessionUserMessages(machineId, qoderSessionId, { beforeIndex });
        }
        if (claudeSessionId) {
            const result = await machineGetClaudeSessionUserMessages(machineId, claudeSessionId, { beforeIndex });
            return result;
        }
        return { messages: [], hasMore: false, nextBeforeIndex: null };
    }, [machineId, session.id, session.metadata?.flavor, session.metadata?.claudeSessionId, session.metadata?.codexSessionId, session.metadata?.qoderSessionId]);

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
        const canDuplicate = Boolean(claudeSessionId || flavor === 'gemini' || codexSessionId || session.metadata?.qoderSessionId);
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
    }, [machineId, session.id, session.metadata?.flavor, session.metadata?.claudeSessionId, session.metadata?.codexSessionId, session.metadata?.qoderSessionId, loadDuplicateMessagesPage, applyDuplicatePage]);

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
        const qoderSessionId = session.metadata?.qoderSessionId;
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
            let agent: 'claude' | 'gemini' | 'codex' | 'qoder' = 'claude';

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
                // A copy leaves the source as it was, so archived native history goes back to the archive.
                const duplicateResult = uuid
                    ? await machineDuplicateCodexSession(machineId, codexSessionId, uuid, { borrowArchived: true })
                    : await machineForkCodexSession(machineId, codexSessionId, { borrowArchived: true });
                if (!duplicateResult.success || !duplicateResult.newFilePath) {
                    setDuplicateConfirming(false);
                    Modal.alert(t('common.error'), duplicateResult.errorMessage || t('duplicate.failed'));
                    return;
                }
                resumeSessionId = duplicateResult.newFilePath;
                agent = 'codex';
            } else if (flavor === 'qoder' && qoderSessionId) {
                const duplicateResult = uuid
                    ? await machineDuplicateQoderSession(machineId, qoderSessionId, sessionPath, uuid)
                    : await machineForkQoderSession(machineId, qoderSessionId, sessionPath);
                if (!duplicateResult.success || !duplicateResult.newSessionId) {
                    setDuplicateConfirming(false);
                    Modal.alert(t('common.error'), duplicateResult.errorMessage || t('duplicate.failed'));
                    return;
                }
                resumeSessionId = duplicateResult.newSessionId;
                agent = 'qoder';
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
                forkedFrom: { sessionId: session.id, title: getSessionName(session), contextWindowSize: session.agentState?.contextWindowSize ?? undefined },
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
    }, [machineId, session.id, session.metadata?.flavor, session.metadata?.claudeSessionId, session.metadata?.codexSessionId, session.metadata?.qoderSessionId, session.metadata?.path, router]);

    // Handle selecting a message in the duplicate sheet. Picker rows are previews,
    // so fetch the full prompt by UUID before creating the new-session draft.
    const handleDuplicateSelect = React.useCallback(async (uuid: string) => {
        if (!canForkSession(storage.getState().sessions[session.id])) return;
        const flavor = session.metadata?.flavor;
        const claudeSessionId = session.metadata?.claudeSessionId;
        const codexSessionId = session.metadata?.codexSessionId;
        const qoderSessionId = session.metadata?.qoderSessionId;
        if (!machineId) return;
        setDuplicateConfirming(true);
        try {
            let selected: UserMessageWithUuid | null = null;
            if (flavor === 'gemini') {
                selected = await machineGetGeminiSessionUserMessage(machineId, session.id, uuid);
            } else if (flavor === 'codex' && codexSessionId) {
                selected = await machineGetCodexSessionUserMessage(machineId, codexSessionId, uuid);
            } else if (flavor === 'qoder' && qoderSessionId) {
                selected = await machineGetQoderSessionUserMessage(machineId, qoderSessionId, uuid);
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
    }, [machineId, session.id, session.metadata?.flavor, session.metadata?.claudeSessionId, session.metadata?.codexSessionId, session.metadata?.qoderSessionId, forkSessionFromUuid, duplicateMessages]);

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
        const qoderSessionId = session.metadata?.qoderSessionId;
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
                } else if (flavor === 'qoder' && qoderSessionId) {
                    resolved = await machineResolveQoderForkTarget(machineId, qoderSessionId, target.text, target.createdAt);
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
    }, [machineId, session.id, session.metadata?.flavor, session.metadata?.claudeSessionId, session.metadata?.codexSessionId, session.metadata?.qoderSessionId, forkSessionFromUuid, handleOpenDuplicateSheet]);

    // Handle the per-message fork icon: show the confirm dialog immediately,
    // then do the network work in performForkFromMessage once confirmed.
    const handleForkFromMessage = React.useCallback((request: ForkMessageRequest) => {
        if (!canForkSession(storage.getState().sessions[session.id])) return;
        const flavor = session.metadata?.flavor;
        const claudeSessionId = session.metadata?.claudeSessionId;
        const codexSessionId = session.metadata?.codexSessionId;
        const canDuplicate = Boolean(claudeSessionId || flavor === 'gemini' || codexSessionId || session.metadata?.qoderSessionId);
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
    }, [machineId, session.id, session.metadata?.flavor, session.metadata?.claudeSessionId, session.metadata?.codexSessionId, session.metadata?.qoderSessionId, performForkFromMessage]);

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

    // Add (+) button: opens the sheet (also the fallback where the native menu isn't available)
    const handleImageButtonPress = React.useCallback(() => {
        composerFocusedOnAddRef.current = inputRef.current?.isFocused() ?? false;
        setImagePickerSheetVisible(true);
    }, []);

    // Open the schedule sheet, offering "when the limit resets" for the given reset time, or else
    // for the newest usage-limit notice in the chat that is still in the future.
    const handleOpenScheduleSheet = React.useCallback((atLimitEndsAt?: number) => {
        const nowSeconds = Math.floor(Date.now() / 1000);
        let limitEndsAt: number | null = atLimitEndsAt ?? null;
        if (limitEndsAt === null) {
            for (const item of messagesRef.current) {
                const endsAt = item.kind === 'agent-event' && item.event.type === 'limit-reached'
                    ? item.event.endsAt
                    : item.kind === 'agent-text' ? item.limitEndsAt : undefined;
                if (endsAt !== undefined && endsAt > nowSeconds) {
                    limitEndsAt = Math.max(limitEndsAt ?? 0, endsAt);
                }
            }
        }
        // On native the schedule editor only takes the cursor if the composer had it: the native
        // iOS menu leaves the composer as it was, so it is read now; the add sheet recorded it on
        // the press. On web it always does.
        const autoFocus = Platform.OS === 'web'
            || composerFocusedOnAddRef.current
            || (inputRef.current?.isFocused() ?? false);
        composerFocusedOnAddRef.current = false;
        setScheduleSheet({ visible: true, limitEndsAt, autoFocus });
    }, []);

    // A usage-limit notice's reset time was pressed in this session's chat.
    React.useEffect(() => subscribeScheduleAtLimit((pressedSessionId, endsAt) => {
        if (pressedSessionId === sessionId) {
            handleOpenScheduleSheet(endsAt);
        }
    }), [sessionId, handleOpenScheduleSheet]);

    // Add (+) menu items. Image rows are disabled (not hidden) when the AI has no image support, so
    // scheduling stays reachable. Web has no camera and opens the file picker for the library.
    // Files write to the owner's machine, which a shared session's guests may not do.
    const pickFiles = fileAttachments.pickFiles;
    const addVideos = fileAttachments.addVideos;
    const canAttachFiles = !session.accessLevel;
    const handleCloseImagePickerSheet = React.useCallback(() => setImagePickerSheetVisible(false), []);
    const handleCloseScheduleSheet = React.useCallback(() => setScheduleSheet((current) => ({ ...current, visible: false })), []);
    const handleCloseRescheduleSheet = React.useCallback(() => setReschedulePendingId(null), []);

    const imagePickerMenuItems: ActionMenuItem[] = React.useMemo(() => [
        ...(Platform.OS === 'web' ? [] : [{ label: t('session.takePhoto'), icon: { ionicon: 'camera-outline', sfSymbol: 'camera' }, onPress: pickFromCamera, disabled: !supportsImages } satisfies ActionMenuItem]),
        {
            label: t('session.chooseFromLibrary'),
            icon: { ionicon: 'images-outline', sfSymbol: 'photo.on.rectangle' },
            onPress: Platform.OS === 'web' ? () => fileInputRef.current?.click() : () => void pickFromGallery(canAttachFiles ? { onVideos: addVideos } : undefined),
            disabled: !supportsImages,
        },
        ...(canAttachFiles ? [{ label: t('session.files.menu'), icon: { ionicon: 'document-outline', sfSymbol: 'doc' }, onPress: () => void pickFiles() } satisfies ActionMenuItem] : []),
        { label: t('session.scheduleMessage'), icon: { ionicon: 'time-outline', sfSymbol: 'clock' }, onPress: () => handleOpenScheduleSheet() },
    ], [pickFromCamera, pickFromGallery, addVideos, supportsImages, canAttachFiles, pickFiles, handleOpenScheduleSheet]);

    // Files dropped or pasted into the composer (web): images the AI can see go as images, the
    // rest upload to the machine as files.
    const addFiles = fileAttachments.addFiles;
    const splitIncomingFiles = React.useCallback((files: File[]) => splitComposerFiles(files, {
        imageTypes: DEFAULT_ALLOWED_TYPES,
        supportsImages,
        canAttachFiles,
    }), [supportsImages, canAttachFiles]);
    const addIncomingFiles = React.useCallback(async (files: File[]) => {
        const split = splitIncomingFiles(files);
        if (split.files.length > 0) addFiles(split.files);
        if (split.images.length > 0) await addImagesFromFiles(split.images);
    }, [splitIncomingFiles, addFiles, addImagesFromFiles]);

    // Handle file input change (web only)
    const handleFileInputChange = React.useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        const files = event.target.files;
        if (!files || files.length === 0) return;

        void addIncomingFiles(Array.from(files));

        // Reset input so same file can be selected again
        event.target.value = '';
    }, [addIncomingFiles]);

    const handlePaste = React.useCallback(async (event: ClipboardEvent) => {
        await handleFilePasteEvent(event, {
            isScreenFocused: isFocused,
            accept: (files) => {
                const split = splitIncomingFiles(files);
                return [...split.images, ...split.files];
            },
            onFiles: addIncomingFiles,
        });
    }, [isFocused, splitIncomingFiles, addIncomingFiles]);

    const { dropZoneRef, isDragging: isDraggingFile } = useWebFileDrop({
        enabled: isFocused && (supportsImages || canAttachFiles),
        onFileDrop: addIncomingFiles,
    });

    // Handle loading more older messages when scrolling to top
    const [minimapItems, setMinimapItems] = React.useState<ConversationMinimapItem[]>([]);
    const [minimapActiveMessageId, setMinimapActiveMessageId] = React.useState<string | null>(null);
    const [minimapCachedMessages, setMinimapCachedMessages] = React.useState<MinimapMessage[]>([]);
    const [contentAreaWidth, setContentAreaWidth] = React.useState(0);
    const minimapJumpRef = React.useRef<((target: MessageJumpTarget) => void | Promise<void>) | null>(null);
    const [isJumpReady, setIsJumpReady] = React.useState(false);
    const handleRegisterMinimapJump = React.useCallback((jump: ((target: MessageJumpTarget) => void | Promise<void>) | null) => {
        minimapJumpRef.current = jump;
        setIsJumpReady(jump !== null);
    }, []);
    // A search hit opened from the command palette: scroll to it once the list can jump and the
    // messages are in, whether the session was just opened or was already on screen.
    React.useEffect(() => {
        if (!isJumpReady || !isLoaded) return;
        const consume = () => {
            const target = takeSessionMessageJump(sessionId);
            if (target) void minimapJumpRef.current?.(target);
        };
        consume();
        return subscribeSessionMessageJump(sessionId, consume);
    }, [isJumpReady, isLoaded, sessionId]);
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
            sync.onSessionChatFocused(sessionId);
            startSilentRefreshTracking();
            // Keep the message-list refreshing indicator suppressed for the first 3s, matching
            // the existing silent-refresh behavior, then let it reflect the real fetch state.
            setRefreshGateOpen(false);
            const gateTimer = setTimeout(() => setRefreshGateOpen(true), SILENT_REFRESH_INDICATOR_DELAY_MS);
            void sync.refreshSessions().catch(() => {
                // Silent refresh indicator handles delayed feedback if status stays stale.
            });
            return () => {
                clearTimeout(gateTimer);
                // Its files, info and other pages stack on top of it and do not read it.
                sync.onSessionChatBlurred(sessionId);
            };
        }, [sessionId, startSilentRefreshTracking])
    );

    // Add paste event listener for images and files (web only)
    React.useEffect(() => {
        if (Platform.OS !== 'web') return;

        const pasteListener = (e: Event) => handlePaste(e as ClipboardEvent);
        document.addEventListener('paste', pasteListener);

        return () => {
            document.removeEventListener('paste', pasteListener);
        };
    }, [handlePaste]);

    // The empty state (loading, or a session with no messages) is the list's own, so the list and
    // the scroll view under the header and the floating composer stay the same from the first
    // frame: a composer over a separate, shorter empty-state view had no soft edge under it.
    const emptyComponent = React.useMemo(() => isLoaded ? (
        <EmptyMessages sessionId={sessionId} />
    ) : (
        <ActivityIndicator size="small" color={theme.colors.textSecondary} />
    ), [isLoaded, sessionId, theme.colors.textSecondary]);

    let content = (
        <>
            <Deferred>
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
                    headerOverlayInset={listUnderHeader ? headerInset : 0}
                    keyboardChatScroll={useNativeChatLayout}
                    composerInset={useFloatingComposer ? composerHeight : undefined}
                    emptyComponent={emptyComponent}
                />
            </Deferred>
        </>
    );

    const canEdit = canEditSession(session);

    // Schedule what the user typed (plus any attached images) for later. The sheet's text is
    // authoritative: it was prefilled from the input and may have been edited there.
    const handleScheduleSubmit = React.useCallback(async (scheduledText: string, deliverAt: number) => {
        if (session.upgrading) {
            Modal.alert(t('sessionInfo.cliUpgradeAvailable'), t('sessionInfo.cliUpgradeSendBlocked'));
            return;
        }
        if (filesBlockSend()) return;

        const imagesToSend = images.length > 0 ? [...images] : undefined;
        if (imagesToSend) {
            setIsUploadingImages(true);
        }
        try {
            const result = await sync.sendOrQueueMessage(
                sessionId, scheduledText, undefined, imagesToSend, undefined,
                () => {
                    setMessage('');
                    clearDraft();
                    clearImages();
                    clearFiles();
                },
                deliverAt,
                attachments,
            );
            if (!result.success) {
                Modal.alert(t('common.error'), t(sendFailureKey(result.reason)));
                return;
            }
            setScheduleSheet((current) => ({ ...current, visible: false }));
            trackMessageSent();
        } finally {
            setIsUploadingImages(false);
        }
    }, [clearDraft, clearImages, clearFiles, attachments, filesBlockSend, images, session.upgrading, sessionId]);

    const rescheduleTarget = reschedulePendingId
        ? pendingMessages.find((pending) => pending.id === reschedulePendingId) ?? null
        : null;
    const handleRescheduleSubmit = React.useCallback(async (_text: string, deliverAt: number) => {
        if (!reschedulePendingId) return;
        const success = await sync.updatePendingMessageDeliverAt(sessionId, reschedulePendingId, deliverAt);
        if (!success) {
            Modal.alert(t('common.error'), t('status.operationFailed'));
            return;
        }
        setReschedulePendingId(null);
    }, [reschedulePendingId, sessionId]);

    const handleSendNowPending = React.useCallback(async (pendingId: string) => {
        try {
            // The server resumes, unschedules and pins the message, then dispatches it
            // right away if the session is idle.
            const sentNow = await sync.sendPendingMessageNow(sessionId, pendingId);
            if (!sentNow.success) {
                throw new Error('send-now failed');
            }
            // Session is busy: the message now heads the queue, so abort the running turn
            // and the server dispatches it when the turn ends.
            if (!sentNow.dispatched) {
                await sessionAbort(sessionId);
            }
        } catch {
            Modal.alert(t('common.error'), t('status.operationFailed'));
        }
    }, [sessionId]);

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
            onReschedule={setReschedulePendingId}
        />
    ) : null;

    // The composer is memoized, and every streamed message re-renders this screen: handing it fresh
    // callbacks and objects each time would re-render it — and re-measure its textarea — per message.
    const handleSendRef = React.useRef<(textSnapshot?: string) => Promise<void>>(async () => {});
    handleSendRef.current = async (textSnapshot?: string) => {
        // Block sending during CLI upgrade
        if (session.upgrading) {
            Modal.alert(
                t('sessionInfo.cliUpgradeAvailable'),
                t('sessionInfo.cliUpgradeSendBlocked')
            );
            return;
        }

        const messageToSend = (textSnapshot ?? message).trim();
        if (messageToSend || images.length > 0 || fileAttachments.files.length > 0) {
            const socketStatus = storage.getState().socketStatus;
            log.log(`[SEND_DEBUG][UI] tap_send sid=${sessionId} hasText=${messageToSend.length > 0} images=${images.length} isSending=${isSending} socket=${socketStatus}`);

            // Handle /duplicate command locally
            if (messageToSend.toLowerCase() === '/duplicate') {
                setMessage('');
                clearDraft();
                handleOpenDuplicateSheet();
                return;
            }

            if (filesBlockSend()) return;

            // Remembered before the send resolves so a failed message can still be recalled.
            rememberSentInput(messageToSend);
            rememberSentSuggestions(session.metadata?.flavor ?? 'claude', messageToSend);

            const imagesToSend = images.length > 0 ? [...images] : undefined;
            const contentForRetry = messageToSend + JSON.stringify(imagesToSend || []) + JSON.stringify(attachments);

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
                        clearFiles();
                    },
                    undefined,
                    attachments,
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
    };
    const handleSend = React.useCallback((textSnapshot?: string) => handleSendRef.current(textSnapshot), []);
    const handleAbort = React.useCallback(() => sessionAbort(sessionId), [sessionId]);
    const handleFileViewerPress = React.useCallback(() => router.push(`/session/${sessionId}/files`), [router, sessionId]);
    const usesDollarPrefix = session.metadata?.flavor === 'codex' || !!session.metadata?.codexSessionId;
    const autocompletePrefixes = React.useMemo(() => usesDollarPrefix ? ['@', '/', '$'] : ['@', '/'], [usesDollarPrefix]);
    const autocompleteSuggestions = React.useCallback((query: string) => getSuggestions(sessionId, query), [sessionId]);
    const contextWindowSize = session.agentState?.contextWindowSize;
    const latestUsage = session.latestUsage;
    const usageData = React.useMemo(() => sessionUsage ? {
        inputTokens: sessionUsage.inputTokens,
        outputTokens: sessionUsage.outputTokens,
        cacheCreation: sessionUsage.cacheCreation,
        cacheRead: sessionUsage.cacheRead,
        contextSize: sessionUsage.contextSize,
        contextWindowSize: sessionUsage.contextWindowSize ?? contextWindowSize ?? undefined,
    } : latestUsage ? {
        inputTokens: latestUsage.inputTokens,
        outputTokens: latestUsage.outputTokens,
        cacheCreation: latestUsage.cacheCreation,
        cacheRead: latestUsage.cacheRead,
        contextSize: latestUsage.contextSize,
        contextWindowSize: latestUsage.contextWindowSize ?? contextWindowSize ?? undefined,
    } : undefined, [sessionUsage, latestUsage, contextWindowSize]);
    const handleImagesChange = React.useCallback((newImages: { uri: string }[]) => {
        // Handle image removal by finding removed index
        // Since useImagePicker manages state, we call removeImage for each removed image
        const currentUris = new Set(newImages.map(img => img.uri));
        images.forEach((img, index) => {
            if (!currentUris.has(img.uri)) {
                removeImage(index);
            }
        });
    }, [images, removeImage]);

    const rememberedModelMode = useRememberedModelMode(sessionId, (session.metadata?.flavor ?? 'claude') as SessionModeAgentType);
    const input = canEdit ? (
        <AgentInput
            ref={inputRef}
            rememberedModelMode={rememberedModelMode}
            panelSideMargin
            glassPanel={useFloatingComposer}
            placeholder={t('session.inputPlaceholder')}
            value={message}
            onChangeText={setMessage}
            sessionId={sessionId}
            inputHistory={inputHistory}
            permissionMode={permissionMode}
            onPermissionModeChange={updatePermissionMode}
            modelMode={modelMode as any}
            onModelModeChange={updateModelMode as any}
            fastMode={fastMode}
            onFastModeChange={updateFastMode}
            metadata={session.metadata}
            agentModels={qoderModels}
            connectionStatus={inputConnectionStatus}
            onSend={handleSend}
            isSending={isSending}
            onMicPress={micButtonState.onMicPress}
            isMicActive={micButtonState.isMicActive}
            onAbort={handleAbort}
            // A turn is in flight while it is thinking, while the send is still awaiting its
            // first signal, and while it is blocked on a permission request - all three can be
            // aborted; only the online-and-idle `waiting` state cannot.
            isBusy={sessionStatus.state === 'thinking' || sessionStatus.state === 'awaiting' || sessionStatus.state === 'permission_required'}
            onFileViewerPress={handleFileViewerPress}
            // Autocomplete configuration
            autocompletePrefixes={autocompletePrefixes}
            autocompleteSuggestions={autocompleteSuggestions}
            usageData={usageData}
            alwaysShowContextSize={alwaysShowContextSize}
            images={images}
            onImagesChange={handleImagesChange}
            onImageButtonPress={handleImageButtonPress}
            imageMenuItems={imagePickerMenuItems}
            supportsImages={supportsImages}
            isUploadingImages={isUploadingImages}
            files={fileAttachments.files}
            onRemoveFile={fileAttachments.removeFile}
            onRetryFile={fileAttachments.retryFile}
        />
    ) : session.metadata?.lifecycleState === 'archived' ? (
        <ArchivedSessionBanner session={session} glass={useFloatingComposer} />
    ) : null;


    return (
        <>
            {/* Hidden file input for web image upload */}
            {Platform.OS === 'web' && (
                <input
                    ref={fileInputRef as any}
                    type="file"
                    accept={canAttachFiles ? 'image/jpeg,image/png,video/*' : 'image/jpeg,image/png'}
                    multiple
                    style={{ display: 'none' }}
                    onChange={handleFileInputChange as any}
                />
            )}


            {/* Main content area - no padding since header is overlay */}
            <View
                ref={dropZoneRef}
                onLayout={(event) => setContentAreaWidth(event.nativeEvent.layout.width)}
                {...edgeTouchHandlers}
                style={{ flexBasis: 0, flexGrow: 1, position: 'relative', paddingBottom: useNativeChatLayout ? 0 : safeArea.bottom + ((isRunningOnMac() || Platform.OS === 'web') ? 8 : 0) }}
            >
                <AgentContentView
                    safeAreaLayout={useNativeChatLayout}
                    floatingInput={useFloatingComposer}
                    composerHeight={composerHeight}
                    content={content}
                    input={input}
                    betweenContentAndInput={pendingQueuePanel}
                />
                {isDraggingFile && (
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
                        <Ionicons name="cloud-upload-outline" size={42} color="#007AFF" />
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
                visible={duplicateSheetVisible}
                messages={duplicateMessages}
                loading={duplicateLoading}
                loadingMore={duplicateLoadingMore}
                hasMore={duplicateHasMore}
                confirming={duplicateConfirming}
                onClose={handleCloseDuplicateSheet}
                onSelect={handleDuplicateSelect}
                onLoadMore={handleLoadMoreDuplicateMessages}
            />

            {/* Add (+) menu sheet */}
            <ActionMenuModal
                visible={imagePickerSheetVisible}
                items={imagePickerMenuItems}
                title={t('session.addMenuTitle')}
                onClose={handleCloseImagePickerSheet}
                deferItemPress
            />

            <ScheduleMessageSheet
                visible={scheduleSheet.visible}
                mode="create"
                // Read when the sheet opens; while it is closed the composer's text would only re-render it.
                initialText={scheduleSheet.visible ? message : ''}
                imageCount={images.length}
                fileCount={fileAttachments.files.length}
                limitEndsAt={scheduleSheet.limitEndsAt}
                autoFocus={scheduleSheet.autoFocus}
                onClose={handleCloseScheduleSheet}
                onSubmit={handleScheduleSubmit}
            />
            <ScheduleMessageSheet
                visible={rescheduleTarget !== null}
                mode="reschedule"
                initialDeliverAt={rescheduleTarget?.deliverAt}
                onClose={handleCloseRescheduleSheet}
                onSubmit={handleRescheduleSubmit}
            />

        </>
    )
}


/**
 * The chat header's two buttons: delegations or a new session, then the avatar. A tap on either
 * does what it always did; a long press on either opens the header's menu — on iOS natively, out
 * of the button pressed, as the sessions list's "+" in the same capsule does; elsewhere as a sheet
 * (`onOpenMenu`).
 */
const ChatHeaderRight = React.memo((props: {
    avatarId?: string;
    isConnected?: boolean;
    onAvatarPress?: () => void;
    /** The CLI version this session can restart on; its icon then takes the avatar's place. */
    cliUpgrade: string | null;
    hasRuns: boolean;
    runningTaskCount: number;
    onOpenRuns: () => void;
    onNewSession?: () => void;
    menu: ActionMenuItem[] | null;
    onOpenMenu: () => void;
}) => {
    const { theme } = useUnistyles();
    const menu = props.menu ? { items: props.menu, onOpen: props.onOpenMenu } : undefined;
    return (
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            {props.hasRuns ? (
                <HeaderButton
                    onPress={props.onOpenRuns}
                    menu={menu}
                    accessibilityLabel={t('settings.orchestratorOpenRuns')}
                    leading
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
                </HeaderButton>
            ) : props.onNewSession ? (
                <HeaderButton
                    onPress={props.onNewSession}
                    menu={menu}
                    accessibilityLabel={t('newSession.startNewSessionInFolder')}
                    leading
                >
                    <Ionicons
                        name="add"
                        size={26}
                        color={theme.colors.header.tint}
                    />
                </HeaderButton>
            ) : null}
            {props.onAvatarPress && props.cliUpgrade ? (
                <HeaderButton
                    onPress={props.onAvatarPress}
                    menu={menu}
                    accessibilityLabel={t('sessionInfo.sessionUpgradeBanner', { version: props.cliUpgrade })}
                >
                    <Ionicons name="arrow-up-circle-outline" size={30} color={theme.colors.box.success.text} />
                </HeaderButton>
            ) : props.avatarId && props.onAvatarPress && (
                <HeaderButton
                    onPress={props.onAvatarPress}
                    menu={menu}
                >
                    <Avatar
                        id={props.avatarId}
                        size={36}
                        monochrome={!props.isConnected}
                        hideBadges
                    />
                </HeaderButton>
            )}
        </View>
    );
});

function HeaderButton({ leading, accessibilityLabel, menu, onPress, children }: {
    onPress: () => void;
    /** Opened on a long press; `onOpen` shows it where there is no native menu. */
    menu?: { items: ActionMenuItem[]; onOpen: () => void };
    accessibilityLabel?: string;
    /** The leading button keeps a gap to the avatar. */
    leading?: boolean;
    children: React.ReactNode;
}) {
    const style = {
        width: 38,
        height: 38,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: leading ? HEADER_LEADING_ACTION_MARGIN : 0,
    } as const;
    if (menu) {
        return (
            <NativeMenu
                items={menu.items}
                activation="longPress"
                onPress={onPress}
                onFallbackOpen={menu.onOpen}
                style={style}
            >
                <View style={{ flex: 1, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' }} accessible accessibilityRole="button" accessibilityLabel={accessibilityLabel}>
                    {children}
                </View>
            </NativeMenu>
        );
    }
    return (
        <Pressable
            onPress={onPress}
            hitSlop={15}
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel}
            style={style}
        >
            {children}
        </Pressable>
    );
}
