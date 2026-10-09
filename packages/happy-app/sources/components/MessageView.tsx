import * as React from "react";
import { View, Text, Pressable, Platform, ActivityIndicator } from "react-native";
import { Image } from "expo-image";
import { Ionicons, SimpleLineIcons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import { ImageViewer } from "./ImageViewer";
import { MessageAttachments } from "./FileAttachments";
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { MarkdownView, OptionsLoadingState } from "./markdown/MarkdownView";
import { t } from '@/text';
import { storeTempText } from '@/sync/persistence';
import { Message, UserTextMessage, AgentTextMessage, ToolCallMessage, ToolCall } from "@/sync/typesMessage";
import { Metadata } from "@/sync/storageTypes";
import { layout } from "./layout";
import { ToolView } from "./tools/ToolView";
import { AgentEvent } from "@/sync/typesRaw";
import stripAnsi from 'strip-ansi';
import { Option } from './markdown/MarkdownView';
import { OptionItem as OptionItemData } from './markdown/parseMarkdown';
import { Modal } from "@/modal";
import { sync } from "@/sync/sync";
import { storage, useSetting } from "@/sync/storage";
import { showCopiedToast, showToast } from '@/components/Toast';
import { formatMessageTime, formatFullMessageTime } from '@/utils/messageTime';
import { hapticsLight } from './haptics';
import { TurnHeader } from './TurnHeader';
import { SegmentFoldLine } from './SegmentFoldLine';
import { useMessageTts } from '@/hooks/useMessageTts';
import { userTextPresentation, type CollapsedTextReason } from './messageCollapse';
import { textGroupAround } from './messageTextGroup';

export const MessageView = (props: {
  message: Message;
  metadata: Metadata | null;
  sessionId: string;
  getMessageById?: (id: string) => Message | null;
  isNewestMessage?: boolean;
  onFillInput?: (text: string, allOptions?: string[]) => void;
  readOnly?: boolean;
  isSharedSession?: boolean;
  currentUserId?: string;
  showSenderName?: boolean;
  onFork?: () => void;
  showActionBar?: boolean;
  forkLoading?: boolean;
  // The turn this row belongs to: `turnStartedAt` undefined = no timing known;
  // `turnCompletedAt` null = still running. Flat scalars rather than one object
  // so the list rows stay referentially stable.
  turnStartedAt?: number | null;
  turnCompletedAt?: number | null;
  /** This row opens its turn, so the turn's header sits above it. */
  isTurnStart?: boolean;
  /**
   * Whether this row's turn is showing one line instead of its process. Undefined when the turn has
   * nothing worth folding, which is also when there is no fold to toggle. Only the row that opens a
   * turn ever carries it: that is the row the folded line stands in for.
   */
  foldFolded?: boolean;
  /**
   * True on a row the fold leaves standing: a settled turn's answer, or a row the fold may never hide
   * — a landmark, or a tool call still waiting on a permission. Either can be the row the line sits
   * on, and that row keeps its content even though the line stands in for it. Only ever set alongside
   * `foldFolded`.
   */
  foldKeepsRow?: boolean;
  /**
   * Whether the folded line closes its row off from what follows. False only on a folded turn with
   * no answer of its own — the line is then the whole of what the turn shows, and a line there
   * would be dividing the row from empty space.
   */
  foldDivides?: boolean;
  /** Tool calls the folded line counts. */
  foldSteps?: number;
  /** What the folded rows are doing right now, for a turn that is still running. */
  foldSnapshot?: string;
  /** A delegated task the turn's folded line hides is still running: what it was asked to do, or null. */
  foldDelegated?: string | null;
  /** Flip the fold on the turn this row opens. Stable, so list rows keep their props. */
  onToggleFold?: (headerId: string) => void;
  /**
   * The element a fold's height animation clips this row's content in (web only). A fold is a height
   * change like any other, so the list animates it by writing heights onto one element — and that
   * element has to hold the row's content and nothing else, or the folded line would slide with it
   * (see `useFoldAnimation`). It is rendered for the whole life of a foldable line, so nothing inside
   * the row is torn down and rebuilt when a fold opens or closes.
   */
  foldBodyRef?: (el: HTMLElement | null) => void;
  /**
   * Whether the run of steps this row opens is showing one line instead of its rows. Undefined on a
   * row that opens no run, or whose turn is folded as a whole — the turn's line stands for the run
   * then. Unlike the turn's fold it is never kept back: a run's first row is a step, and the line
   * takes its content.
   */
  segmentFolded?: boolean;
  /**
   * True while the run's line is closing: the row keeps its content until the animation has taken
   * it away, the same way a turn's folded line keeps its row for the length of the slide.
   */
  segmentKeepsRow?: boolean;
  /** Tool calls the run's line counts. */
  segmentSteps?: number;
  /** The run's first tool call, whose icon its line opens with. */
  segmentTool?: ToolCall;
  /** What the run is doing right now. Only a run the turn has got no further than has one. */
  segmentSnapshot?: string;
  /** The same, for the run's folded line. */
  segmentDelegated?: string | null;
  /** The turn has got no further than this run. */
  segmentRunning?: boolean;
  /** Flip the fold on the run this row opens. Stable, so list rows keep their props. */
  onToggleSegment?: (startId: string) => void;
  /** The same as `foldBodyRef`, for a run's line: it clips the row's content under that line. */
  segmentBodyRef?: (el: HTMLElement | null) => void;
}) => {
  const { message, foldFolded, foldSnapshot, foldDelegated, onToggleFold, segmentFolded, onToggleSegment } = props;
  const foldSteps = props.foldSteps ?? 0;
  // The folded line takes the place of the row it sits on — unless the fold kept this row: a settled
  // turn's answer, or a landmark, either of which can be the row the line itself sits on.
  const foldHidesRow = foldFolded === true && props.foldKeepsRow !== true;
  const handleToggleFold = React.useCallback(() => {
    onToggleFold?.(message.id);
  }, [onToggleFold, message.id]);
  // Memoized so the memoized TurnHeader keeps its props: the list re-renders on every scroll frame.
  const fold = React.useMemo(
    () => foldFolded === undefined
      ? undefined
      : { folded: foldFolded, steps: foldSteps, snapshot: foldSnapshot, delegated: foldDelegated, onToggle: handleToggleFold },
    [foldFolded, foldSteps, foldSnapshot, foldDelegated, handleToggleFold],
  );

  // A folded turn is its header and nothing else: the folded line is the whole row, and the answer
  // below it is a row of its own. Nothing here is dropped from the list — the process rows were
  // filtered out upstream — so the row keeps its id and only its content changes.
  const header = props.isTurnStart && props.turnStartedAt != null ? (
    <View style={styles.turnHeaderRow}>
      <TurnHeader
        startedAt={props.turnStartedAt}
        completedAt={props.turnCompletedAt ?? null}
        fold={fold}
        divide={props.foldDivides ?? true}
      />
    </View>
  ) : null;

  const handleToggleSegment = React.useCallback(() => {
    onToggleSegment?.(message.id);
  }, [onToggleSegment, message.id]);
  // A run's line takes the place of the first row of the run, which is a step and never kept.
  const segmentHidesRow = segmentFolded === true && props.segmentKeepsRow !== true;

  const body = foldHidesRow || segmentHidesRow ? null : <RenderBlock
    message={props.message}
    metadata={props.metadata}
    sessionId={props.sessionId}
    getMessageById={props.getMessageById}
    isNewestMessage={props.isNewestMessage}
    onFillInput={props.onFillInput}
    readOnly={props.readOnly}
    isSharedSession={props.isSharedSession}
    currentUserId={props.currentUserId}
    showSenderName={props.showSenderName}
    onFork={props.onFork}
    showActionBar={props.showActionBar}
    forkLoading={props.forkLoading}
    isTurnStart={props.isTurnStart}
  />;

  // The same wrapper for a run's line, around the content alone: the line is what the reader tapped
  // and stays where it is while the content under it slides.
  const runBody = Platform.OS === 'web' && segmentFolded !== undefined
    ? <View ref={props.segmentBodyRef as unknown as React.Ref<View>} style={styles.foldBody}>{body}</View>
    : body;
  // In the same gutter as the turn's line, which is what lines the two up with the text between them.
  const segmentLine = segmentFolded === undefined ? null : (
    <View style={styles.turnHeaderRow}>
      <SegmentFoldLine
        folded={segmentFolded}
        steps={props.segmentSteps ?? 0}
        tool={props.segmentTool}
        snapshot={props.segmentSnapshot}
        delegated={props.segmentDelegated}
        running={props.segmentRunning === true}
        onToggle={handleToggleSegment}
      />
    </View>
  );
  const content = segmentLine === null ? runBody : <>{segmentLine}{runBody}</>;

  return (
    <View style={styles.messageContainer} renderToHardwareTextureAndroid={true}>
      <View style={styles.messageContent}>
        {header}
        {/* Only on web, and only on a row that carries a fold: the wrapper keeps the flex column the
            content used to sit in, so a row that folds lays out exactly as it did before. It holds a
            run's line too when the row carries both, so that the whole of what hangs under the turn's
            line slides with it. */}
        {Platform.OS === 'web' && foldFolded !== undefined
          // The declared ref type is the component instance, because that is what a ref is on
          // native; on web it is the DOM element underneath, which is what the animation needs.
          ? <View ref={props.foldBodyRef as unknown as React.Ref<View>} style={styles.foldBody}>{content}</View>
          : content}
      </View>
    </View>
  );
};

function MessageActionBar(props: {
  side: 'left' | 'right';
  hovered: boolean;
  // The newest message keeps its bar on screen on web: it is the row the eye is
  // already on, whether that is the reply landing or the prompt just sent.
  isNewestMessage?: boolean;
  createdAt: number;
  onCopy?: () => void;
  onFork?: () => void;
  forkLoading?: boolean;
  onSpeak?: () => void | Promise<void>;
  ttsState?: 'idle' | 'loading' | 'playing' | 'queued';
}) {
  const { theme } = useUnistyles();
  const ttsState = props.ttsState ?? 'idle';
  const label = formatMessageTime(props.createdAt);
  const fullTime = formatFullMessageTime(props.createdAt);
  const showFullTime = () => {
    hapticsLight();
    showToast(fullTime, { icon: null });
  };
  // Web: visible only on hover (but the row always occupies layout space).
  // Native: always visible. While a fork is in progress, or TTS is
  // loading/playing/queued, force the bar visible on web so the spinner /
  // play state stays shown even if the cursor moved away.
  const ttsActive = ttsState !== 'idle';
  const contentVisible = Platform.OS !== 'web' || props.hovered || !!props.forkLoading || ttsActive
    || !!props.isNewestMessage;
  return (
    <View
      style={[
        styles.actionBar,
        props.side === 'right' ? styles.actionBarRight : styles.actionBarLeft,
        Platform.OS === 'web' && { opacity: contentVisible ? 1 : 0 },
      ]}
      pointerEvents={contentVisible ? 'auto' : 'none'}
    >
      {props.onCopy ? (
        <Pressable
          style={styles.actionButton}
          onPress={props.onCopy}
          accessibilityLabel={t('common.copy')}
          hitSlop={6}
        >
          <Ionicons name="copy-outline" size={14} color={theme.colors.textSecondary} />
        </Pressable>
      ) : null}
      {props.onSpeak ? (
        <Pressable
          style={styles.actionButton}
          onPress={ttsState === 'loading' ? undefined : () => { hapticsLight(); props.onSpeak?.(); }}
          disabled={ttsState === 'loading'}
          accessibilityLabel={
            ttsState === 'playing' ? t('message.stopVoice')
              : ttsState === 'queued' ? t('message.queuedVoice')
                : t('message.playVoice')
          }
          hitSlop={6}
        >
          {ttsState === 'loading' ? (
            <ActivityIndicator size="small" color={theme.colors.textSecondary} style={styles.actionSpinner} />
          ) : ttsState === 'queued' ? (
            <Ionicons name="time-outline" size={15} color={theme.colors.textSecondary} />
          ) : (
            <SimpleLineIcons
              name={ttsState === 'playing' ? 'control-pause' : 'volume-2'}
              size={ttsState === 'playing' ? 12 : 14.5}
              color={theme.colors.textSecondary}
            />
          )}
        </Pressable>
      ) : null}
      {props.onFork ? (
        <Pressable
          style={styles.actionButton}
          onPress={props.forkLoading ? undefined : () => { hapticsLight(); props.onFork?.(); }}
          disabled={props.forkLoading}
          accessibilityLabel={t('message.forkFromHere')}
          hitSlop={6}
        >
          {props.forkLoading ? (
            <ActivityIndicator size="small" color={theme.colors.textSecondary} style={styles.actionSpinner} />
          ) : (
            <Ionicons name="git-branch-outline" size={14} color={theme.colors.textSecondary} />
          )}
        </Pressable>
      ) : null}
      {/* The time states the time and nothing more: no hover tooltip on web, here
          or on the turn header above a reply — pressing it gives the full
          timestamp in a toast, on both platforms. */}
      <Pressable onPress={showFullTime} hitSlop={6}>
        <Text style={styles.actionTime}>{label}</Text>
      </Pressable>
    </View>
  );
}

// The hover handlers live on the message container and the action bar is an
// in-flow child of it. This debounce just adds a small grace period on
// mouseleave so the bar doesn't flicker out when the cursor briefly crosses
// the container edge (e.g. over the inter-message gap) before settling.
const HOVER_LEAVE_DEBOUNCE_MS = 200;

function useMessageHover() {
  const [hovered, setHovered] = React.useState(false);
  const leaveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => () => {
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
  }, []);
  const handlers = Platform.OS === 'web'
    ? {
      onMouseEnter: () => {
        if (leaveTimer.current) {
          clearTimeout(leaveTimer.current);
          leaveTimer.current = null;
        }
        setHovered(true);
      },
      onMouseLeave: () => {
        if (leaveTimer.current) clearTimeout(leaveTimer.current);
        leaveTimer.current = setTimeout(() => setHovered(false), HOVER_LEAVE_DEBOUNCE_MS);
      },
    }
    : {};
  return { hovered, handlers };
}

async function copyMessageText(text: string | null | undefined) {
  if (!text) return;
  await Clipboard.setStringAsync(text);
  hapticsLight();
  showCopiedToast();
}

// RenderBlock function that dispatches to the correct component based on message kind
function RenderBlock(props: {
  message: Message;
  metadata: Metadata | null;
  sessionId: string;
  getMessageById?: (id: string) => Message | null;
  isNewestMessage?: boolean;
  onFillInput?: (text: string, allOptions?: string[]) => void;
  readOnly?: boolean;
  isSharedSession?: boolean;
  currentUserId?: string;
  showSenderName?: boolean;
  onFork?: () => void;
  showActionBar?: boolean;
  forkLoading?: boolean;
  isTurnStart?: boolean;
}): React.ReactElement {
  switch (props.message.kind) {
    case 'user-text':
      return (
        <UserTextBlock
          message={props.message}
          sessionId={props.sessionId}
          sessionWorkingDirectory={props.metadata?.path ?? null}
          sessionHomeDirectory={props.metadata?.homeDir ?? null}
          isNewestMessage={props.isNewestMessage}
          onFillInput={props.onFillInput}
          readOnly={props.readOnly}
          isSharedSession={props.isSharedSession}
          currentUserId={props.currentUserId}
          showSenderName={props.showSenderName}
          onFork={props.onFork}
          showActionBar={props.showActionBar}
          forkLoading={props.forkLoading}
        />
      );

    case 'agent-text':
      return (
        <AgentTextBlock
          message={props.message}
          sessionId={props.sessionId}
          sessionWorkingDirectory={props.metadata?.path ?? null}
          sessionHomeDirectory={props.metadata?.homeDir ?? null}
          isNewestMessage={props.isNewestMessage}
          onFillInput={props.onFillInput}
          readOnly={props.readOnly}
          onFork={props.onFork}
          showActionBar={props.showActionBar}
          forkLoading={props.forkLoading}
        />
      );

    case 'tool-call':
      return <ToolCallBlock
        message={props.message}
        metadata={props.metadata}
        sessionId={props.sessionId}
        getMessageById={props.getMessageById}
      />;

    case 'agent-event':
      return <AgentEventBlock event={props.message.event} metadata={props.metadata} />;


    default:
      // Exhaustive check - TypeScript will error if we miss a case
      const _exhaustive: never = props.message;
      throw new Error(`Unknown message kind: ${_exhaustive}`);
  }
}

function UserTextBlock(props: {
  message: UserTextMessage;
  sessionId: string;
  sessionWorkingDirectory?: string | null;
  sessionHomeDirectory?: string | null;
  isNewestMessage?: boolean;
  onFillInput?: (text: string, allOptions?: string[]) => void;
  readOnly?: boolean;
  isSharedSession?: boolean;
  currentUserId?: string;
  showSenderName?: boolean;
  onFork?: () => void;
  showActionBar?: boolean;
  forkLoading?: boolean;
}) {
  const router = useRouter();
  const [imageViewerVisible, setImageViewerVisible] = React.useState(false);
  const [imageViewerIndex, setImageViewerIndex] = React.useState(0);
  const [optionsLoadingState, setOptionsLoadingState] = React.useState<OptionsLoadingState>({ loadingIndex: null });

  // Click to send
  const handleOptionPress = React.useCallback(async (option: Option, allOptions: OptionItemData[]) => {
    if (option.destructive) {
      // Destructive confirmation takes priority (skip old-option confirmation)
      const confirmed = await Modal.confirm(
        t('message.confirmDestructive'),
        t('message.confirmDestructiveMessage'),
        { destructive: true }
      );
      if (!confirmed) return;
    } else if (!props.isNewestMessage) {
      const confirmed = await Modal.confirm(
        t('message.confirmOldOption'),
        t('message.confirmOldOptionMessage')
      );
      if (!confirmed) return;
    }

    // Find the index of this option for loading state
    const index = allOptions.findIndex(o => o.title === option.title);
    setOptionsLoadingState({ loadingIndex: index });

    try {
      await sync.sendOrQueueMessage(props.sessionId, option.title);
    } finally {
      setOptionsLoadingState({ loadingIndex: null });
    }
  }, [props.sessionId, props.isNewestMessage]);

  // Long press to fill input (mobile only, handled in MarkdownView)
  const handleOptionLongPress = React.useCallback((option: Option, allOptions: OptionItemData[]) => {
    props.onFillInput?.(option.title, allOptions.map(o => o.title));
  }, [props.onFillInput]);

  const images = props.message.images ?? [];
  const imageViewingImages = images.map(img => ({ uri: img.url }));

  const handleImagePress = React.useCallback((index: number) => {
    setImageViewerIndex(index);
    setImageViewerVisible(true);
  }, []);

  const senderLabel = React.useMemo(() => {
    if (!props.isSharedSession || !props.showSenderName || !props.message.sentBy) return null;
    if (props.message.sentBy === props.currentUserId) return t('message.you');
    return props.message.sentByName || t('message.unknownSender');
  }, [props.isSharedSession, props.showSenderName, props.message.sentBy, props.currentUserId, props.message.sentByName]);

  const { hovered, handlers: hoverHandlers } = useMessageHover();
  const messageText = props.message.text;
  const handleCopy = React.useCallback(() => {
    copyMessageText(messageText);
  }, [messageText]);

  const renderedText = props.message.displayText || props.message.text;
  const attachments = props.message.meta?.attachments ?? [];
  const presentation = userTextPresentation(renderedText, props.message.meta);
  // The reason travels as the entry point, so the screen it opens knows what to call itself.
  const handleOpenFullText = React.useCallback((reason: CollapsedTextReason) => {
    try {
      const textId = storeTempText(renderedText);
      router.push({ pathname: '/text-selection', params: { textId, from: reason, format: 'markdown' } });
    } catch (error) {
      console.error('Error opening long message:', error);
    }
  }, [renderedText, router]);

  return (
    <View style={styles.userMessageContainer} {...hoverHandlers}>
      {senderLabel && (
        <Text style={styles.senderLabel}>{senderLabel}</Text>
      )}
      <View style={styles.userMessageBubble}>
        {images.length > 0 && (
          <>
            <View style={styles.messageImages}>
              {images.map((img, index) => (
                <Pressable key={index} onPress={() => handleImagePress(index)}>
                  <Image
                    source={{ uri: img.url }}
                    style={{ width: 120, height: 120, borderRadius: 8 }}
                    contentFit="cover"
                    placeholder={img.thumbhash ? { thumbhash: img.thumbhash } : undefined}
                  />
                </Pressable>
              ))}
            </View>
            <ImageViewer
              images={imageViewingImages}
              initialIndex={imageViewerIndex}
              visible={imageViewerVisible}
              onClose={() => setImageViewerVisible(false)}
            />
          </>
        )}
        {attachments.length > 0 && (
          <MessageAttachments sessionId={props.sessionId} attachments={attachments} />
        )}
        {attachments.length > 0 && !renderedText.trim() ? null : presentation.kind === 'collapsed' ? (
          <Pressable
            onPress={() => handleOpenFullText(presentation.reason)}
            onLongPress={() => handleOpenFullText(presentation.reason)}
            style={styles.longMessagePlaceholder}
          >
            <Text style={styles.longMessagePlaceholderText}>
              {presentation.reason === 'compaction'
                ? t('message.compactSummaryPlaceholder', { chars: presentation.chars })
                : t('message.tooLongPlaceholder', { chars: presentation.chars })}
            </Text>
          </Pressable>
        ) : (
          <MarkdownView
            markdown={renderedText}
            sessionId={props.sessionId}
            sessionWorkingDirectory={props.sessionWorkingDirectory}
            sessionHomeDirectory={props.sessionHomeDirectory}
            onOptionPress={props.readOnly ? undefined : handleOptionPress}
            onOptionLongPress={props.readOnly ? undefined : handleOptionLongPress}
            optionsLoadingState={props.readOnly ? undefined : optionsLoadingState}
            hideOptions={props.readOnly}
          />
        )}
        {props.message.deliveryError ? (
          <Text style={styles.deliveryErrorText}>{props.message.deliveryError}</Text>
        ) : null}
      </View>
      {props.showActionBar !== false && (
        <MessageActionBar
          side="right"
          hovered={hovered}
          isNewestMessage={props.isNewestMessage}
          createdAt={props.message.createdAt}
          onCopy={messageText ? handleCopy : undefined}
          onFork={props.onFork}
          forkLoading={props.forkLoading}
        />
      )}
    </View>
  );
}

function AgentTextBlock(props: {
  message: AgentTextMessage;
  sessionId: string;
  sessionWorkingDirectory?: string | null;
  sessionHomeDirectory?: string | null;
  isNewestMessage?: boolean;
  onFillInput?: (text: string, allOptions?: string[]) => void;
  readOnly?: boolean;
  onFork?: () => void;
  showActionBar?: boolean;
  forkLoading?: boolean;
  isTurnStart?: boolean;
}) {
  const showThinkingMessages = useSetting('showThinkingMessages');
  const [optionsLoadingState, setOptionsLoadingState] = React.useState<OptionsLoadingState>({ loadingIndex: null });

  // Click to send
  const handleOptionPress = React.useCallback(async (option: Option, allOptions: OptionItemData[]) => {
    if (option.destructive) {
      // Destructive confirmation takes priority (skip old-option confirmation)
      const confirmed = await Modal.confirm(
        t('message.confirmDestructive'),
        t('message.confirmDestructiveMessage'),
        { destructive: true }
      );
      if (!confirmed) return;
    } else if (!props.isNewestMessage) {
      const confirmed = await Modal.confirm(
        t('message.confirmOldOption'),
        t('message.confirmOldOptionMessage')
      );
      if (!confirmed) return;
    }

    // Find the index of this option for loading state
    const index = allOptions.findIndex(o => o.title === option.title);
    setOptionsLoadingState({ loadingIndex: index });

    try {
      await sync.sendOrQueueMessage(props.sessionId, option.title);
    } finally {
      setOptionsLoadingState({ loadingIndex: null });
    }
  }, [props.sessionId, props.isNewestMessage]);

  // Long press to fill input (mobile only, handled in MarkdownView)
  const handleOptionLongPress = React.useCallback((option: Option, allOptions: OptionItemData[]) => {
    props.onFillInput?.(option.title, allOptions.map(o => o.title));
  }, [props.onFillInput]);

  const hasOptions = props.message.text.includes('<options>');
  const { hovered, handlers: hoverHandlers } = useMessageHover();
  const messageText = props.message.text;
  // Copy, read aloud and long-press take the whole run of texts this row sits in, looked up when
  // the reader acts (see textGroupAround).
  const resolveText = React.useCallback(() => {
    const state = storage.getState();
    const messages = state.sessionMessages[props.sessionId]?.messages;
    return (messages && textGroupAround(messages, props.message.id, state.settings.showThinkingMessages)) || messageText;
  }, [props.sessionId, props.message.id, messageText]);
  const handleCopy = React.useCallback(() => {
    copyMessageText(resolveText());
  }, [resolveText]);
  const { state: ttsState, toggle: handleSpeak } = useMessageTts(props.message.id, props.sessionId, resolveText);

  // Hide thinking messages if setting is disabled. Must run AFTER all hooks so
  // the hook count stays constant across renders (Rules of Hooks).
  if (props.message.isThinking && !showThinkingMessages) {
    return null;
  }

  return (
    <View
      style={[
        styles.agentMessageContainer,
        props.message.isThinking && { opacity: 0.3 },
        // The turn header carries a rule under it, so the row that opens a turn
        // has to fill the column — a short first line would otherwise leave the
        // rule stopping in the middle of it.
        (hasOptions || props.isTurnStart) && styles.agentMessageContainerStretch,
      ]}
      {...hoverHandlers}
    >
      <MarkdownView
        markdown={props.message.text}
        sessionId={props.sessionId}
        sessionWorkingDirectory={props.sessionWorkingDirectory}
        sessionHomeDirectory={props.sessionHomeDirectory}
        onOptionPress={props.readOnly ? undefined : handleOptionPress}
        onOptionLongPress={props.readOnly ? undefined : handleOptionLongPress}
        optionsLoadingState={props.readOnly ? undefined : optionsLoadingState}
        hideOptions={props.readOnly}
        getSelectionMarkdown={resolveText}
      />
      {props.showActionBar !== false && !props.message.isThinking && (
        <MessageActionBar
          side="left"
          hovered={hovered}
          isNewestMessage={props.isNewestMessage}
          createdAt={props.message.createdAt}
          onCopy={messageText ? handleCopy : undefined}
          onFork={props.onFork}
          forkLoading={props.forkLoading}
          onSpeak={messageText ? handleSpeak : undefined}
          ttsState={ttsState}
        />
      )}
    </View>
  );
}

function AgentEventBlock(props: {
  event: AgentEvent;
  metadata: Metadata | null;
}) {
  if (props.event.type === 'switch') {
    return (
      <View style={styles.agentEventContainer}>
        <Text style={styles.agentEventText}>{t('message.switchedToMode', { mode: props.event.mode })}</Text>
      </View>
    );
  }
  if (props.event.type === 'message') {
    // Strip ANSI escape codes so terminal color sequences (e.g. \x1b[90m…\x1b[0m
    // from a CLI startup banner) don't leak into the bubble as raw text.
    return (
      <View style={styles.agentEventContainer}>
        <Text style={styles.agentEventText}>{stripAnsi(props.event.message)}</Text>
      </View>
    );
  }
  if (props.event.type === 'limit-reached') {
    const formatTime = (timestamp: number): string => {
      try {
        const date = new Date(timestamp * 1000); // Convert from Unix timestamp
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      } catch {
        return t('message.unknownTime');
      }
    };

    return (
      <View style={styles.agentEventContainer}>
        <Text style={styles.agentEventText}>
          {t('message.usageLimitUntil', { time: formatTime(props.event.endsAt) })}
        </Text>
      </View>
    );
  }
  return (
    <View style={styles.agentEventContainer}>
      <Text style={styles.agentEventText}>{t('message.unknownEvent')}</Text>
    </View>
  );
}

function ToolCallBlock(props: {
  message: ToolCallMessage;
  metadata: Metadata | null;
  sessionId: string;
  getMessageById?: (id: string) => Message | null;
}) {
  if (!props.message.tool) {
    return null;
  }
  return (
    <View style={styles.toolContainer}>
      <ToolView
        tool={props.message.tool}
        metadata={props.metadata}
        messages={props.message.children}
        sessionId={props.sessionId}
        messageId={props.message.id}
        localId={props.message.localId}
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  messageContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  messageContent: {
    flexDirection: 'column',
    flexGrow: 1,
    flexBasis: 0,
    maxWidth: layout.maxWidth,
  },
  userMessageContainer: {
    maxWidth: '100%',
    flexDirection: 'column',
    alignItems: 'flex-end',
    justifyContent: 'flex-end',
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  userMessageBubble: {
    backgroundColor: theme.colors.userMessageBackground,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    marginBlock: 4,
    maxWidth: '100%',
    position: 'relative',
  },
  senderLabel: {
    color: theme.colors.textSecondary,
    fontSize: 12,
    marginBottom: 2,
    paddingRight: 4,
  },
  deliveryErrorText: {
    color: theme.colors.textDestructive,
    fontSize: 12,
    marginTop: 4,
    marginBottom: 4,
  },
  longMessagePlaceholder: {
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  longMessagePlaceholderText: {
    color: theme.colors.userMessageText,
    fontSize: 14,
    fontStyle: 'italic',
    opacity: 0.85,
  },
  agentMessageContainer: {
    paddingHorizontal: 16,
    marginBottom: 16,
    borderRadius: 16,
    alignSelf: 'flex-start',
    maxWidth: '100%',
    position: 'relative',
  },
  actionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
    paddingHorizontal: 4,
  },
  actionBarRight: {
    alignSelf: 'flex-end',
  },
  actionBarLeft: {
    alignSelf: 'flex-start',
  },
  actionButton: {
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionTime: {
    fontSize: 11,
    height: 20,
    lineHeight: 20,
    color: theme.colors.textSecondary,
  },
  actionSpinner: {
    transform: [{ scale: 0.7 }],
  },
  agentMessageContainerStretch: {
    alignSelf: 'stretch',
  },
  agentEventContainer: {
    marginHorizontal: 16,
    alignItems: 'center',
    paddingVertical: 8,
  },
  agentEventText: {
    color: theme.colors.agentEventText,
    fontSize: 14,
  },
  toolContainer: {
    marginHorizontal: 16,
  },
  // The header stands where the block's own inset would have put it: the two
  // blocks that used to render it are inset 16px (one by padding, one by
  // margin), and it now sits outside both.
  turnHeaderRow: {
    paddingHorizontal: 16,
  },
  // The content of a row that carries a fold, on its own element so a fold can animate its height
  // without touching the line above it. Nothing is set on it that a height could fight: the height
  // and the clip are written by the animation, and cleared with it.
  foldBody: {
    flexDirection: 'column',
    flexShrink: 0,
  },
  debugText: {
    color: theme.colors.agentEventText,
    fontSize: 12,
  },
  messageImages: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 8,
    marginBottom: 8,
    gap: 12,
  },
}));
