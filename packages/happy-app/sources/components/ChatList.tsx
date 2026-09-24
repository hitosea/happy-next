import * as React from 'react';
import { useSession, useSessionMessages, useProfile, useSetting, storage } from "@/sync/storage";
import { ActivityIndicator, Platform, Pressable, Text, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollViewProps } from 'react-native';
import { useCallback, useRef, useState } from 'react';
import { LegendList, LegendListRef, LegendListRenderItemProps } from '@legendapp/list/react-native';
import { KeyboardChatScrollView } from 'react-native-keyboard-controller';
import { useHeaderHeight } from '@/utils/responsive';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUnistyles } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';
import { MessageView } from './MessageView';
import { ConversationMinimapItem } from './ConversationMinimap';
import { Metadata, Session } from '@/sync/storageTypes';
import { ChatFooter } from './ChatFooter';
import { AskUserQuestionMessage, isAskUserQuestionToolCall, isPreviewHtmlToolCall, Message, MinimapMessage, PreviewHtmlMessage, toAskUserQuestionMessage, toPreviewHtmlMessage, UserTextMessage } from '@/sync/typesMessage';
import { currentLandmark, shouldHideMessageInChatList, shouldHideMessageInMinimap } from './chatListVisibility';
import { useTurnAnalysis } from './messageTurnTiming';
import { AWAITING_RESPONSE_MAX_MS } from '@/utils/sessionUtils';
import { layout } from './layout';
import { createScrollButtonVisibilityController } from './scrollButtonVisibilityController';
import { buildChatRowModels, chatRowModelsAreEqual, distanceFromEnd, listIndexFromNewestFirst, toListOrder, type ChatRowModel } from './chatListRowModel';
import { CHAT_END_THRESHOLD_PX, CHAT_HISTORY_THRESHOLD, CHAT_MAINTAIN_SCROLL_AT_END, chatEndThreshold, chatScrollToEndOptions, createChatHistoryPager, waitForChatHistoryLayout } from './chatListScrollController';
import { buildChatKeyIndex, buildChatLandmarkRows, selectChatLandmarkMessages } from './chatListDerivedData';
import { t } from '@/text';

// Does a loaded list message correspond to the given minimap target (whose id may come from the
// throwaway reducer and therefore not match the store's id)?
function messageMatchesTarget(message: Message, target: MinimapMessage): boolean {
    if (target.seq != null && message.seq === target.seq) return true;
    if (target.localId && (message as { localId?: string | null }).localId === target.localId) return true;
    return message.id === target.id;
}

// Describes a fork initiated from a message's inline fork icon.
export interface ForkMessageRequest {
    // The user message to truncate before — the new session keeps everything
    // older than it. For a fork from an AI reply this is the user prompt that
    // FOLLOWS the reply (so the reply itself is kept); `null` means there is no
    // following prompt, so the whole session is duplicated with no truncation.
    target: UserTextMessage | null;
    // The message whose fork icon was tapped — drives the inline loading spinner.
    loadingMessageId: string;
    // Suppress the new-session draft. User-message forks pre-fill the tapped
    // prompt; AI-message forks continue after the reply, so there's nothing to
    // pre-fill.
    skipDraft: boolean;
}

export const ChatList = React.memo((props: { session: Session; onFillInput?: (text: string, allOptions?: string[]) => void; onLoadMore?: () => void | Promise<void>; onForkMessage?: (request: ForkMessageRequest) => void; forkingMessageId?: string | null; minimapCachedUserMessages?: MinimapMessage[]; onMinimapItemsChange?: (items: ConversationMinimapItem[]) => void; onActiveMessageIdChange?: (id: string | null) => void; onRegisterMinimapJump?: (jump: ((message: MinimapMessage) => void) | null) => void }) => {
    const { messages, hasMore } = useSessionMessages(props.session.id);
    const profile = useProfile();
    const isSharedSession = !!(props.session.isShared || props.session.accessLevel);
    return (
        <ChatListInternal
            key={props.session.id}
            metadata={props.session.metadata}
            sessionId={props.session.id}
            messages={messages}
            hasMore={hasMore}
            onFillInput={props.onFillInput}
            onLoadMore={props.onLoadMore}
            isSharedSession={isSharedSession}
            currentUserId={profile.id}
            onForkMessage={props.onForkMessage}
            thinking={props.session.thinking}
            taskCompleted={props.session.agentState?.taskCompleted}
            awaitingResponseSince={props.session.awaitingResponseSince}
            forkingMessageId={props.forkingMessageId}
            minimapCachedUserMessages={props.minimapCachedUserMessages}
            onMinimapItemsChange={props.onMinimapItemsChange}
            onActiveMessageIdChange={props.onActiveMessageIdChange}
            onRegisterMinimapJump={props.onRegisterMinimapJump}
        />
    )
});

/** The breathing room the list leaves under the overlay header, above the oldest message. */
const LIST_TOP_GAP = 32;
/** The load-older row's padding (16 × 2) plus its small spinner, for the header size hint below. */
const LOAD_OLDER_ROW_HEIGHT = 52;

const ListHeader = React.memo(() => {
    const headerHeight = useHeaderHeight();
    const safeArea = useSafeAreaInsets();
    return <View style={{ flexDirection: 'row', alignItems: 'center', height: headerHeight + safeArea.top + LIST_TOP_GAP }} />;
});

const ListFooter = React.memo((props: { sessionId: string }) => {
    const session = useSession(props.sessionId)!;
    return (
        <ChatFooter controlledByUser={session.agentState?.controlledByUser || false} />
    )
});

/**
 * The chat list's scroll view on iOS. While the keyboard is up it keeps its own frame and lifts the
 * *content* instead (native chat-style inset handling), so the top edge of the scroll view stays
 * beneath the navigation bar. Translating the list itself — what the `KeyboardStickyView` around
 * the whole list used to do — drags that edge off screen, and with it the iOS 26 scroll-edge effect
 * the transparent header draws there.
 *
 * `offset` is how much of the keyboard is already covered by chrome below the scroll view: the
 * composer is a sibling beneath the list, so only the home-indicator inset still sits between them
 * and the keyboard, and that much gets subtracted from the lift.
 */
const ChatScrollView = React.forwardRef<
    React.ElementRef<typeof KeyboardChatScrollView>,
    ScrollViewProps & { bottomInset: number }
>(({ bottomInset, ...props }, ref) => (
    <KeyboardChatScrollView
        ref={ref}
        automaticallyAdjustContentInsets={false}
        contentInsetAdjustmentBehavior="never"
        keyboardDismissMode="interactive"
        keyboardLiftBehavior="always"
        offset={bottomInset}
        {...props}
    />
));
ChatScrollView.displayName = 'ChatScrollView';

// Avoid flashing the return-to-bottom button during transient layout adjustments.
const SHOW_SCROLL_BUTTON_DELAY_MS = 300;

/**
 * Roughly how tall a row is, before any has been measured. Only the first frame and a far jump read
 * it — `keyExtractor` keeps every height the list has measured, so a session opened once is exact
 * from then on. The value is a starting point, not a measurement: every row here carries a turn
 * header and margins, so it sits a little above the library's 100px default, and the way to settle
 * it is to read `getState().getAverageItemSizes()` off a session that has been open for a while.
 */
const ESTIMATED_ITEM_SIZE = 120;

/**
 * How far past the viewport rows are rendered in advance. The inverted FlatList ran FlatList's
 * default `windowSize` (21) — ten screens of mounted rows — and this list is full of code blocks
 * and diffs a screen or more tall, so a few of them are worth keeping ready without mounting the
 * conversation twice over.
 */
const DRAW_DISTANCE = 600;

/**
 * What every row of a conversation renders with, as opposed to what each row's own message brings:
 * the session it belongs to, who is reading it, and the two callbacks a row can raise. Held in one
 * object so `ChatRow` can compare it by reference, and handed to the list as `extraData` — the
 * mounted rows re-render when this changes, and only then.
 *
 * Both callbacks are taken by reference rather than passed straight through. `onFillInput` is
 * rebuilt by the session view on every keystroke in the input box (it reads the draft), and a row
 * needs *a* way to fill the input, not the newest closure — so holding it steady here is what keeps
 * typing from invalidating every row on screen.
 */
type ChatRowEnv = {
    metadata: Metadata | null;
    sessionId: string;
    isSharedSession: boolean;
    currentUserId: string;
    onFillInput?: (text: string, allOptions?: string[]) => void;
    onForkMessage?: (request: ForkMessageRequest) => void;
};

/**
 * One message row.
 *
 * Memoized against the row model and the environment, and that comparison is the point of the pair:
 * a row re-renders when its own message changed, when its turn settled, when its fork spinner
 * turned on — and not when a token arrived somewhere else in the conversation. The heavy half of a
 * row is `MessageView` and the markdown, code and tool views under it, and before this it was
 * re-rendered for every mounted row on every streaming token, because the list's `renderItem`
 * closed over the whole conversation.
 */
const ChatRow = React.memo((props: { env: ChatRowEnv; model: ChatRowModel }) => {
    const { env, model } = props;
    const { message } = model;

    // Fork is offered on user prompts and on AI replies (private sessions only):
    // - User message: fork truncates before this prompt; its text becomes the new session's draft.
    // - AI reply: fork keeps the conversation through this reply by truncating before the NEXT user
    //   prompt, which is the newer one (see `forkTarget`). Only the turn's last segment offers it.
    let onFork: (() => void) | undefined;
    if (env.onForkMessage && !env.isSharedSession) {
        if (message.kind === 'user-text') {
            const target = message;
            onFork = () => env.onForkMessage!({ target, loadingMessageId: message.id, skipDraft: false });
        } else if (message.kind === 'agent-text' && model.showActionBar) {
            onFork = () => env.onForkMessage!({ target: model.forkTarget, loadingMessageId: message.id, skipDraft: true });
        }
    }

    return (
        <MessageView
            message={message}
            metadata={env.metadata}
            sessionId={env.sessionId}
            isNewestMessage={model.isNewestMessage}
            onFillInput={env.onFillInput}
            onFork={onFork}
            showActionBar={model.showActionBar}
            forkLoading={model.forkLoading}
            isSharedSession={env.isSharedSession}
            currentUserId={env.currentUserId}
            showSenderName={model.showSenderName}
            isTurnStart={model.isTurnStart}
            turnStartedAt={model.turnStartedAt}
            turnCompletedAt={model.turnCompletedAt}
        />
    );
}, (previous, next) => previous.env === next.env && chatRowModelsAreEqual(previous.model, next.model));

const ChatListInternal = React.memo((props: {
    metadata: Metadata | null,
    sessionId: string,
    messages: Message[],
    hasMore: boolean,
    onFillInput?: (text: string, allOptions?: string[]) => void,
    onLoadMore?: () => void | Promise<void>,
    isSharedSession: boolean,
    currentUserId: string,
    onForkMessage?: (request: ForkMessageRequest) => void,
    thinking?: boolean,
    /** `session.agentState.taskCompleted` — the CLI's stamp for the newest finished task. */
    taskCompleted?: number | null,
    /** `session.awaitingResponseSince` — set the moment a message is sent. */
    awaitingResponseSince?: number | null,
    forkingMessageId?: string | null,
    minimapCachedUserMessages?: MinimapMessage[],
    onMinimapItemsChange?: (items: ConversationMinimapItem[]) => void,
    /** The landmark the rail should mark as the reader's — see `currentLandmark`. */
    onActiveMessageIdChange?: (id: string | null) => void,
    onRegisterMinimapJump?: (jump: ((message: MinimapMessage) => void) | null) => void,
}) => {
    const { theme } = useUnistyles();
    const headerHeight = useHeaderHeight();
    const safeArea = useSafeAreaInsets();
    const listRef = useRef<LegendListRef | null>(null);
    const [viewportHeight, setViewportHeight] = useState(0);
    // iOS only — the platform where the header floats over the list. Android already keeps the list
    // in place and pads the container instead (see AgentContentView.tsx).
    const renderScrollComponent = useCallback(
        (props: ScrollViewProps) => <ChatScrollView {...props} bottomInset={safeArea.bottom} />,
        [safeArea.bottom]
    );
    const showThinkingMessages = useSetting('showThinkingMessages');
    const visibleMessages = React.useMemo(
        () => props.messages.filter((message) => !shouldHideMessageInChatList(message, showThinkingMessages)),
        [props.messages, showThinkingMessages]
    );

    // Compute which user-text messages should show sender name labels.
    // The list is newest-first (index 0 = newest), so show the name when the next item
    // in the array (= the older message at a higher index) is from a different sender
    // or is not a user-text message, so only the first in a consecutive group shows it.
    const senderVisibility = React.useMemo(() => {
        if (!props.isSharedSession) return null;
        const map = new Map<string, boolean>();
        for (let i = 0; i < visibleMessages.length; i++) {
            const msg = visibleMessages[i];
            if (msg.kind !== 'user-text') continue;
            const nextMsg = visibleMessages[i + 1];
            const nextSentBy = nextMsg?.kind === 'user-text' ? nextMsg.sentBy : null;
            map.set(msg.id, msg.sentBy !== nextSentBy);
        }
        return map;
    }, [visibleMessages, props.isSharedSession]);

    // Which rows carry the action bar, which rows carry their turn's header, and
    // how long each turn took. See messageTurnTiming.ts for the rules.
    //
    // In flight means the CLI says it is thinking *or* the optimistic marker set
    // when a message is sent is still standing: the marker is written in the same
    // store update that lands the message, so a reply's header arrives with the
    // message instead of a CLI heartbeat later.
    const turnInFlight = !!props.thinking
        || (props.awaitingResponseSince != null
            && Date.now() - props.awaitingResponseSince < AWAITING_RESPONSE_MAX_MS);
    const turns = useTurnAnalysis({
        visibleMessages,
        turnInFlight,
        taskCompletedAt: props.taskCompleted,
        includeFold: false,
    });

    // Track if scroll-to-bottom button should be visible
    const [showScrollButton, setShowScrollButton] = useState(false);
    const visibilityControllerRef = useRef<ReturnType<typeof createScrollButtonVisibilityController> | null>(null);
    const visibleMessagesRef = useRef(visibleMessages);

    // Track the newest message timestamp when button became visible (for unread count)
    const lastSeenTimestampRef = useRef<number>(visibleMessages[0]?.createdAt ?? 0);

    // Calculate unread count: count messages newer than the last seen timestamp
    let unreadCount = 0;
    if (showScrollButton) {
        for (const msg of visibleMessages) {
            if (msg.createdAt > lastSeenTimestampRef.current) {
                unreadCount++;
            } else {
                break; // messages are sorted newest-first, no need to continue
            }
        }
    }

    // Reuse the last committed rows without mutating a dataset that LegendList may still read.
    const committedRowsRef = useRef<ChatRowModel[]>([]);
    const rows = React.useMemo(
        () => buildChatRowModels({
            visibleMessages,
            completedIds: turns.completedIds,
            headerById: turns.headerById,
            senderVisibility,
            forkingMessageId: props.forkingMessageId,
            previousRows: committedRowsRef.current,
        }),
        [visibleMessages, turns, senderVisibility, props.forkingMessageId],
    );

    React.useLayoutEffect(() => { committedRowsRef.current = rows; }, [rows]);

    // The list renders oldest-first; everything else here — the turn analysis, the rail's landmark
    // indexes, `visibleMessages` itself — stays newest-first. The two orders meet at the index
    // translations in `scrollToLoadedMessage` and `handleViewableItemsChanged`, and nowhere else.
    const listRows = React.useMemo(() => toListOrder(rows), [rows]);

    // Where each row sits in the newest-first order, by key. A viewability report arrives with the
    // list's own positions in it, and this is how they are placed in the order the rail's landmarks
    // are in — by looking the row up where it now is, rather than by arithmetic on a row count the
    // two sides could briefly disagree about (the list reports before this component's effects run).
    const committedKeyIndexRef = useRef<ReadonlyMap<string, number> | undefined>(undefined);
    const newestFirstIndexByKey = React.useMemo(
        () => buildChatKeyIndex(visibleMessages, committedKeyIndexRef.current),
        [visibleMessages],
    );
    React.useLayoutEffect(() => { committedKeyIndexRef.current = newestFirstIndexByKey; }, [newestFirstIndexByKey]);
    const newestFirstIndexByKeyRef = useRef(newestFirstIndexByKey);
    React.useEffect(() => {
        newestFirstIndexByKeyRef.current = newestFirstIndexByKey;
    }, [newestFirstIndexByKey]);

    // The callbacks are read through refs so that their identity never enters `env`: the session
    // view rebuilds `onFillInput` on every keystroke, and a changed `env` invalidates every row.
    const envRef = useRef({ onFillInput: props.onFillInput, onForkMessage: props.onForkMessage });
    envRef.current = { onFillInput: props.onFillInput, onForkMessage: props.onForkMessage };
    const callFillInput = useCallback((text: string, allOptions?: string[]) => {
        envRef.current.onFillInput?.(text, allOptions);
    }, []);
    const callForkMessage = useCallback((request: ForkMessageRequest) => {
        envRef.current.onForkMessage?.(request);
    }, []);
    const hasFillInput = !!props.onFillInput;
    const hasForkMessage = !!props.onForkMessage;
    const rowEnv = React.useMemo<ChatRowEnv>(() => ({
        metadata: props.metadata,
        sessionId: props.sessionId,
        isSharedSession: props.isSharedSession,
        currentUserId: props.currentUserId,
        onFillInput: hasFillInput ? callFillInput : undefined,
        onForkMessage: hasForkMessage ? callForkMessage : undefined,
    }), [props.metadata, props.sessionId, props.isSharedSession, props.currentUserId, hasFillInput, hasForkMessage, callFillInput, callForkMessage]);

    const keyExtractor = useCallback((row: ChatRowModel) => row.key, []);
    const getItemType = useCallback((row: ChatRowModel) => row.message.kind, []);
    const itemsAreEqual = useCallback((previous: ChatRowModel, next: ChatRowModel) => chatRowModelsAreEqual(previous, next), []);
    const renderItem = useCallback(({ item }: LegendListRenderItemProps<ChatRowModel>) => (
        <ChatRow env={rowEnv} model={item} />
    ), [rowEnv]);

    // Streaming normal replies must not rebuild the minimap and trigger a parent SessionView
    // update. Tool landmark conversion still reruns when a question/preview's own message changes.
    const committedLandmarksRef = useRef<Message[]>([]);
    const landmarkMessages = React.useMemo(
        () => selectChatLandmarkMessages(visibleMessages, committedLandmarksRef.current),
        [visibleMessages],
    );
    React.useLayoutEffect(() => { committedLandmarksRef.current = landmarkMessages; }, [landmarkMessages]);
    const loadedUserMessages = React.useMemo(
        () => landmarkMessages.filter((message): message is UserTextMessage => message.kind === 'user-text').reverse(),
        [landmarkMessages],
    );

    // AskUserQuestion calls the rail places a marker for, in the same ascending order as
    // `loadedUserMessages`. Sub-agent (sidechain) questions live inside their parent's children and
    // are never top-level list rows, so they are not jump targets either.
    const loadedQuestionMessages = React.useMemo<MinimapMessage[]>(() => {
        return landmarkMessages
            .filter(isAskUserQuestionToolCall)
            .map(toAskUserQuestionMessage)
            .filter((message): message is AskUserQuestionMessage => message !== null)
            .reverse();
    }, [landmarkMessages]);

    // `preview_html` calls the rail places a marker for, in the same ascending order. Only calls
    // that produced a document qualify — see buildPreviewHtmlMessage.
    const loadedPreviewMessages = React.useMemo<MinimapMessage[]>(() => {
        return landmarkMessages
            .filter(isPreviewHtmlToolCall)
            .map(toPreviewHtmlMessage)
            .filter((message): message is PreviewHtmlMessage => message !== null)
            .reverse();
    }, [landmarkMessages]);

    // Merge offline-cached landmarks with the loaded ones so the minimap can show prompts,
    // questions and previews that live in the persistent cache but haven't been paged into the list
    // yet. Loaded messages win on id (they carry an accurate scroll position); rows the rail leaves
    // out (see shouldHideMessageInMinimap) are dropped from both sources.
    const minimapItems = React.useMemo<ConversationMinimapItem[]>(() => {
        // Loaded messages always win (they carry the store's id → accurate scroll position + active
        // highlight). A cached entry is dropped if a loaded message matches it by EITHER seq OR
        // localId: the same message can be represented differently on each side (e.g. loaded is the
        // just-sent optimistic copy with a localId and no seq, cache has the acked copy with a seq),
        // so a single-key match would leak duplicates.
        const loadedBySeq = new Set<number>();
        const loadedByLocalId = new Set<string>();
        const merged: MinimapMessage[] = [];
        for (const loaded of [
            ...loadedUserMessages,
            ...loadedQuestionMessages,
            ...loadedPreviewMessages,
        ]) {
            if (shouldHideMessageInMinimap(loaded)) continue;
            merged.push(loaded);
            if (loaded.seq != null) loadedBySeq.add(loaded.seq);
            if (loaded.localId) loadedByLocalId.add(loaded.localId);
        }
        for (const cached of props.minimapCachedUserMessages ?? []) {
            if (shouldHideMessageInMinimap(cached)) continue;
            if (cached.seq != null && loadedBySeq.has(cached.seq)) continue;
            if (cached.localId && loadedByLocalId.has(cached.localId)) continue;
            merged.push(cached);
        }
        // Order oldest→newest to match the list (which sorts by createdAt, seq as tiebreaker).
        // createdAt must be primary: just-sent messages have no seq yet, so keying on seq would
        // sort them as seq 0 and shove them to the very top instead of the bottom.
        return merged
            .sort((a, b) => a.createdAt - b.createdAt || (a.seq ?? 0) - (b.seq ?? 0))
            .map((message) => ({ message }));
    }, [props.minimapCachedUserMessages, loadedUserMessages, loadedQuestionMessages, loadedPreviewMessages]);

    // Landmark rows in the list's own order — newest first — carrying the index each has there. Only a
    // row the rail draws a mark for counts, so the landmark the rail is told to light is always one it
    // has; the rail's current landmark is read off these and the rows on screen, see `currentLandmark`.
    const landmarkRows = React.useMemo(
        () => buildChatLandmarkRows(newestFirstIndexByKey, minimapItems.map((item) => item.message.id)),
        [newestFirstIndexByKey, minimapItems],
    );
    const landmarkRowsRef = useRef(landmarkRows);
    const activeMessageIdRef = useRef<string | null>(null);

    const scrollToLoadedMessage = useCallback((target: MinimapMessage, animated = true): boolean => {
        // Searched in the newest-first order every other index here means, then translated: the list
        // counts its rows from the oldest end.
        const loaded = visibleMessagesRef.current;
        const index = loaded.findIndex((m) => messageMatchesTarget(m, target));
        if (index >= 0) {
            void listRef.current?.scrollToIndex({
                index: listIndexFromNewestFirst(index, loaded.length),
                animated,
                viewPosition: 0.5,
            });
            return true;
        }
        return false;
    }, []);

    // Scroll to a just-paged-in target, retrying until the row is actually rendered. visibleMessagesRef
    // only updates after React commits the re-render triggered by the store change, which a single tick
    // doesn't guarantee — on a slow frame a one-shot scroll misses and the jump silently fails. Retry on
    // a bounded schedule instead.
    const scrollToTargetWithRetries = useCallback((target: MinimapMessage, animated: boolean) => {
        let attempts = 0;
        const MAX_ATTEMPTS = 20; // ~1s at 50ms
        const attempt = () => {
            if (scrollToLoadedMessage(target, animated)) return;
            if (++attempts >= MAX_ATTEMPTS) return;
            setTimeout(attempt, 50);
        };
        attempt();
    }, [scrollToLoadedMessage]);

    // Guards against a jump-triggered load-more racing with the scroll-driven one.
    const isJumpingRef = useRef(false);
    const historyPagerRef = useRef<ReturnType<typeof createChatHistoryPager> | null>(null);
    const committedListRef = useRef({ messages: props.messages, rows: listRows, onLoadMore: props.onLoadMore });
    React.useLayoutEffect(() => {
        committedListRef.current = { messages: props.messages, rows: listRows, onLoadMore: props.onLoadMore };
    }, [props.messages, listRows, props.onLoadMore]);

    React.useLayoutEffect(() => {
        let cancelled = false;
        const pager = createChatHistoryPager({
            read: () => {
                const page = storage.getState().sessionMessages[props.sessionId];
                const list = listRef.current?.getState();
                return {
                    oldestSeq: page?.oldestSeq ?? null,
                    hasMore: !!page?.hasMore && !!committedListRef.current.onLoadMore,
                    nearStart: !!list && list.scrollLength > 0
                        && list.scroll <= list.scrollLength * CHAT_HISTORY_THRESHOLD,
                };
            },
            loadMore: () => committedListRef.current.onLoadMore?.(),
            isJumping: () => isJumpingRef.current,
            onError: (error) => console.warn('Failed to load older chat messages', error),
            // A completed request precedes React commit and native row measurements. Stop
            // rather than continuing against stale geometry if layout has not settled in time.
            waitForLayout: () => waitForChatHistoryLayout({
                isCancelled: () => cancelled,
                readGeometry: () => {
                    const committed = committedListRef.current;
                    const page = storage.getState().sessionMessages[props.sessionId];
                    const list = listRef.current?.getState();
                    if (!list || committed.messages !== page?.messages || list.data !== committed.rows) return null;
                    return `${list.contentLength}:${list.scroll}:${list.scrollLength}`;
                },
            }),
        });
        historyPagerRef.current = pager;
        return () => {
            cancelled = true;
            pager.dispose();
            historyPagerRef.current = null;
        };
    }, [props.sessionId]);
    // The target of the in-flight jump. A second minimap click updates this so the running paging
    // loop retargets instead of the click being silently dropped.
    const activeJumpTargetRef = useRef<MinimapMessage | null>(null);
    // Shows a bottom-centered hint while a minimap jump pages in older history before locating.
    const [isLocating, setIsLocating] = useState(false);
    const handleJumpToMessage = useCallback(async (target: MinimapMessage) => {
        const pager = historyPagerRef.current;
        if (!pager) return;
        activeJumpTargetRef.current = target;
        // A paging jump is already running — it will pick up the new target above. Keep the hint.
        if (isJumpingRef.current) return;
        // Already loaded → scroll straight away.
        if (scrollToLoadedMessage(target)) return;
        isJumpingRef.current = true;
        setIsLocating(true);
        try {
            // Page older messages until the (possibly retargeted) message enters the list, there's
            // nothing older left, or a load can't make progress.
            const MAX_PAGES = 200;
            for (let i = 0; i < MAX_PAGES; i++) {
                if (historyPagerRef.current !== pager) return;
                const current = activeJumpTargetRef.current;
                if (!current) break;
                const state = storage.getState().sessionMessages[props.sessionId];
                if (!state || !state.hasMore) break;
                if (state.messages.some((m) => messageMatchesTarget(m, current))) break;
                const beforeOldestSeq = state.oldestSeq;
                if (!await pager.loadNext()) break;
                // Let the store subscription flush into visibleMessagesRef before re-checking.
                await new Promise<void>((resolve) => setTimeout(resolve, 0));
                const loaded = storage.getState().sessionMessages[props.sessionId];
                if (!loaded) break;
                const retargeted = activeJumpTargetRef.current ?? current;
                if (loaded.messages.some((m) => messageMatchesTarget(m, retargeted))) break;
                // Safety: if we've paged at/past the target's seq without finding it, stop.
                if (retargeted.seq != null && loaded.oldestSeq != null && loaded.oldestSeq <= retargeted.seq) break;
                // No progress (e.g. encryption briefly unavailable, or oldestSeq null) — stop instead
                // of spinning through all MAX_PAGES iterations.
                if (loaded.oldestSeq === beforeOldestSeq) break;
            }
        } finally {
            isJumpingRef.current = false;
            if (historyPagerRef.current === pager) setIsLocating(false);
        }
        // Far target (just paged in): jump instantly (with retries). An animated scroll over a long
        // distance would render/measure every intervening row frame-by-frame (janky); a direct jump
        // only lays out around the target.
        if (historyPagerRef.current !== pager) return;
        const finalTarget = activeJumpTargetRef.current;
        if (finalTarget) {
            scrollToTargetWithRetries(finalTarget, false);
        }
    }, [scrollToLoadedMessage, scrollToTargetWithRetries, props.sessionId]);

    React.useEffect(() => {
        props.onRegisterMinimapJump?.(handleJumpToMessage);
        return () => props.onRegisterMinimapJump?.(null);
    }, [props.onRegisterMinimapJump, handleJumpToMessage]);

    React.useEffect(() => {
        props.onMinimapItemsChange?.(minimapItems);

        // A landmark the rail no longer carries cannot be marked — the reader was on it and it has left
        // the rail (a summary dropped by the list filter, a page reloaded away) — so rest on the newest.
        const activeId = activeMessageIdRef.current;
        if (activeId !== null && minimapItems.some((item) => item.message.id === activeId)) return;

        const newest = minimapItems[minimapItems.length - 1];
        activeMessageIdRef.current = newest ? newest.message.id : null;
        props.onActiveMessageIdChange?.(activeMessageIdRef.current);
    }, [props.onMinimapItemsChange, props.onActiveMessageIdChange, minimapItems]);

    const handleViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ReadonlyArray<{ key?: string; index?: number | null }> }) => {
        // The list indexes its rows from the oldest end, the rail's landmarks from the newest, so
        // each visible row is placed by its key rather than by its index. A row that is no longer
        // in the conversation is simply not placed.
        const positions = newestFirstIndexByKeyRef.current;
        const visibleIndexes: number[] = [];
        for (const viewable of viewableItems) {
            const index = viewable.key === undefined ? undefined : positions.get(viewable.key);
            if (typeof index === 'number') {
                visibleIndexes.push(index);
            }
        }

        // Which landmark the reader is on is a question about the whole list — where they sit among its
        // landmarks — not about the rows that happen to be on screen; see `currentLandmark`. The marker
        // follows them back through prompts, questions and previews alike, so no landmark on the rail is
        // unreachable.
        const next = currentLandmark(landmarkRowsRef.current, visibleIndexes);
        // No row measured at all, which RN reports now and then as the list settles: keep the last
        // answer rather than flicking the rail to an endpoint.
        if (next === null || next === activeMessageIdRef.current) return;
        activeMessageIdRef.current = next;
        props.onActiveMessageIdChange?.(next);
    }).current;

    const viewabilityConfig = useRef({
        itemVisiblePercentThreshold: 10,
        minimumViewTime: 80,
    }).current;

    React.useEffect(() => {
        visibleMessagesRef.current = visibleMessages;
    }, [visibleMessages]);

    React.useEffect(() => {
        landmarkRowsRef.current = landmarkRows;
    }, [landmarkRows]);

    React.useEffect(() => {
        const controller = createScrollButtonVisibilityController({
            showDelayMs: SHOW_SCROLL_BUTTON_DELAY_MS,
            onShow: () => {
                setShowScrollButton((prev) => {
                    if (prev) return prev;
                    lastSeenTimestampRef.current = visibleMessagesRef.current[0]?.createdAt ?? 0;
                    return true;
                });
            },
            onHide: () => {
                setShowScrollButton(false);
            },
        });

        visibilityControllerRef.current = controller;
        return () => {
            controller.dispose();
            visibilityControllerRef.current = null;
        };
    }, []);

    // Handle scroll position changes. The list is not inverted, so the reader's distance from the
    // newest message is arithmetic on the event rather than `contentOffset.y` itself.
    const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
        const shouldShow = distanceFromEnd(event.nativeEvent) > CHAT_END_THRESHOLD_PX;
        visibilityControllerRef.current?.update(shouldShow);
    }, []);

    // Decide at the time of the tap using live geometry (including keyboard/rotation changes).
    const handleScrollToBottom = useCallback(() => {
        const list = listRef.current;
        if (list) void list.scrollToEnd(chatScrollToEndOptions(list.getState()));
    }, []);

    const handleListLayout = useCallback((event: LayoutChangeEvent) => {
        setViewportHeight(event.nativeEvent.layout.height);
    }, []);

    const handleStartReached = useCallback(() => {
        void historyPagerRef.current?.loadNearStart();
    }, []);

    // The oldest end of the conversation: the space the overlay header takes, and the load-older
    // spinner while there is history left to page in. It is the list's HEADER now — the top of the
    // content is the oldest message once the list is not inverted.
    const listHeader = React.useMemo(() => (
        <View>
            <ListHeader />
            {props.hasMore && (
                <View style={{ paddingVertical: 16, alignItems: 'center' }}>
                    <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                </View>
            )}
        </View>
    ), [props.hasMore, theme.colors.textSecondary]);

    // Height of that header, so the list can lay out its first frame without waiting a commit to
    // measure it. Exact, not estimated: it is the same arithmetic `ListHeader` renders with.
    const listHeaderSize = headerHeight + safeArea.top + LIST_TOP_GAP + (props.hasMore ? LOAD_OLDER_ROW_HEIGHT : 0);


    return (
        <View style={{ flex: 1 }}>
            <LegendList<ChatRowModel>
                ref={listRef}
                data={listRows}
                renderItem={renderItem}
                keyExtractor={keyExtractor}
                getItemType={getItemType}
                itemsAreEqual={itemsAreEqual}
                // A different conversation is a different dataset: measured heights belong to the
                // session they were read in, so they are not carried across.
                dataKey={props.sessionId}
                style={{ flex: 1 }}
                estimatedItemSize={ESTIMATED_ITEM_SIZE}
                estimatedHeaderSize={listHeaderSize}
                drawDistance={DRAW_DISTANCE}
                // Bottom-aligned, opening on the newest message and following the tail while the
                // reader is at it — what replaced `inverted`. `maintainVisibleContentPosition` is
                // the other half: paging older history in above the viewport, and a new message
                // arriving while the reader is up in the history, both leave them where they were.
                alignItemsAtEnd
                initialScrollAtEnd
                maintainScrollAtEnd={CHAT_MAINTAIN_SCROLL_AT_END}
                maintainScrollAtEndThreshold={chatEndThreshold(viewportHeight)}
                maintainVisibleContentPosition
                // `extraData` is the whole-list invalidation switch: it re-renders the mounted rows
                // with the current `renderItem`, which is what carries a changed `env` to them.
                // Held steady across keystrokes and streaming tokens (see `ChatRowEnv`), so this
                // only fires when a row's environment really changed.
                extraData={rowEnv}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'none'}
                renderScrollComponent={Platform.OS === 'ios' ? renderScrollComponent : undefined}
                ListHeaderComponent={listHeader}
                ListFooterComponent={<ListFooter sessionId={props.sessionId} />}
                onLayout={handleListLayout}
                onScroll={handleScroll}
                scrollEventThrottle={16}
                onStartReached={handleStartReached}
                onStartReachedThreshold={CHAT_HISTORY_THRESHOLD}
                onViewableItemsChanged={handleViewableItemsChanged}
                viewabilityConfig={viewabilityConfig}
            />

            {/* Bottom-centered hint shown while a minimap jump is paging in older messages */}
            {isLocating && (
                <View
                    pointerEvents="none"
                    style={{
                        position: 'absolute',
                        bottom: 16,
                        left: 0,
                        right: 0,
                        alignItems: 'center',
                    }}
                >
                    <View
                        style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            backgroundColor: theme.colors.surfaceHighest,
                            borderRadius: 20,
                            paddingHorizontal: 14,
                            height: 36,
                            shadowColor: theme.colors.shadow.color,
                            shadowOffset: { width: 0, height: 2 },
                            shadowOpacity: theme.colors.shadow.opacity,
                            shadowRadius: 4,
                            elevation: 4,
                        }}
                    >
                        <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                        <Text style={{ marginLeft: 8, color: theme.colors.text, fontSize: 14 }}>
                            {t('session.locatingMessage')}
                        </Text>
                    </View>
                </View>
            )}

            {/* Scroll to bottom button - positioned relative to content area */}
            {showScrollButton && (
                <View
                    pointerEvents="box-none"
                    style={{
                        position: 'absolute',
                        bottom: 16,
                        left: 0,
                        right: 0,
                        alignItems: 'center',
                    }}
                >
                    <View
                        pointerEvents="box-none"
                        style={{
                            width: '100%',
                            maxWidth: layout.maxWidth,
                            alignItems: 'flex-end',
                            paddingRight: 16,
                        }}
                    >
                        <Pressable
                            onPress={handleScrollToBottom}
                            style={{
                                backgroundColor: theme.colors.surfaceHighest,
                                borderRadius: 20,
                                width: 40,
                                height: 40,
                                alignItems: 'center',
                                justifyContent: 'center',
                                shadowColor: theme.colors.shadow.color,
                                shadowOffset: { width: 0, height: 2 },
                                shadowOpacity: theme.colors.shadow.opacity,
                                shadowRadius: 4,
                                elevation: 4,
                            }}
                        >
                            <Ionicons name="chevron-down" size={24} color={theme.colors.text} />
                            {unreadCount > 0 && (
                                <View style={{
                                    position: 'absolute',
                                    top: -4,
                                    right: -4,
                                    backgroundColor: theme.colors.status.connected,
                                    borderRadius: 10,
                                    minWidth: 20,
                                    height: 20,
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    paddingHorizontal: 4,
                                }}>
                                    <Text style={{
                                        color: '#fff',
                                        fontSize: 12,
                                        fontWeight: '600',
                                    }}>
                                        {unreadCount > 99 ? '99+' : unreadCount}
                                    </Text>
                                </View>
                            )}
                        </Pressable>
                    </View>
                </View>
            )}
        </View>
    )
});
