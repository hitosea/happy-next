import { Ionicons, Octicons, MaterialCommunityIcons, FontAwesome6 } from '@expo/vector-icons';
import * as React from 'react';
import { View, Platform, useWindowDimensions, ViewStyle, Text, ActivityIndicator, TouchableWithoutFeedback, Image as RNImage, Pressable, Keyboard, Modal as RNModal, ScrollView } from 'react-native';
import { Image } from 'expo-image';
import { layout } from './layout';
import { MultiTextInput, KeyPressEvent } from './MultiTextInput';
import { Typography } from '@/constants/Typography';
import { PermissionMode, ModelMode } from './PermissionModeSelector';
import { hapticsLight, hapticsError } from './haptics';
import { Shaker, ShakeInstance } from './Shaker';
import { StatusDot } from './StatusDot';
import { useActiveWord } from './autocomplete/useActiveWord';
import { useActiveSuggestions } from './autocomplete/useActiveSuggestions';
import { AgentInputAutocomplete } from './AgentInputAutocomplete';
import { FloatingOverlay } from './FloatingOverlay';
import { AnimatedHeight } from './AnimatedHeight';
import { FullWindowOverlay } from 'react-native-screens';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { TextInputState, MultiTextInputHandle } from './MultiTextInput';
import { applySuggestion } from './autocomplete/applySuggestion';
import { ABORT_ESCAPE_WINDOW_MS, resolveEscapeAbort, shouldSendOnEnter } from './agentInputKeyboard';
import { initialInputHistoryCursor, shouldNavigateInputHistory, stepInputHistory, type InputHistoryCursor } from './inputHistory';
import { GitStatusBadge, useHasLoadedGitStatus } from './GitStatusBadge';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { KeyboardEvents, useKeyboardState } from 'react-native-keyboard-controller';
import { ComposerKeyboardOffsetContext } from './composerKeyboardOffset';
import { useSetting } from '@/sync/storage';
import { Theme } from '@/theme';
import { getCurrentLanguage, t } from '@/text';
import { Metadata } from '@/sync/storageTypes';
import { log } from '@/log';
import { ImagePreview, LocalImage } from '@/components/ImagePreview';
import { ComposerFiles } from '@/components/FileAttachments';
import { ExpandedComposerModal } from './ExpandedComposerModal';
import type { ComposerFile } from '@/hooks/useFileAttachments';
import { Switch } from '@/components/Switch';
import { Modal } from '@/modal';
import { useWebFileDrop } from '@/hooks/useWebFileDrop';
import { useModelCatalog } from '@/hooks/useModelCatalog';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { isRunningOnMac } from '@/utils/platform';
import { NativeMenu } from './NativeMenu';
import { DropdownMenu } from './DropdownMenu';
import { ContextWindowSegments, type ContextWindowSegment } from './ContextWindowSegments';
import { ContextWindowEditor } from './ContextWindowEditor';
import { ScrollToSelectedList, type ItemLayoutHandler } from './ScrollToSelectedList';
import type { ActionMenuItem } from './ActionMenu';
import {
    buildClaudeModelMode,
    buildCodexModelMode,
    ClaudeModelFamily,
    ClaudeReasoningEffort,
    CodexModelFamily,
    CodexReasoningEffort,
    formatReasoningEffortLabel,
    FAST_MODE_ICON_COLOR,
    getClaudeContextWindowOptions,
    getClaudeReasoningOptions,
    getCodexReasoningOptions,
    getMaxContextSize,
    getModelFamilyOptions,
    type ModelOption,
    MODEL_MODE_DEFAULT,
    parseClaudeModelMode,
    parseCodexModelMode,
    buildQoderModelMode,
    parseQoderModelMode,
} from 'happy-wire';
import type { QoderPickerModel } from '@/hooks/useQoderModels';

// Room the text keeps clear on its right for the expand button over the field's corner.
const EXPAND_BUTTON_TEXT_INSET = Platform.OS === 'web' ? 24 : 32;

interface AgentInputProps {
    value: string;
    placeholder: string;
    onChangeText: (text: string) => void;
    sessionId?: string;
    /** Previously sent inputs, newest first. Enables ArrowUp/ArrowDown recall when non-empty. */
    inputHistory?: string[];
    onSend: (textSnapshot?: string) => void;
    sendIcon?: React.ReactNode;
    onMicPress?: () => void;
    isMicActive?: boolean;
    permissionMode?: PermissionMode;
    onPermissionModeChange?: (mode: PermissionMode) => void;
    modelMode?: ModelMode;
    onModelModeChange?: (mode: ModelMode) => void;
    /** The last model mode other than `default`, so picking a model after the CLI's own choice returns to its effort and context window. */
    rememberedModelMode?: string;
    metadata?: Metadata | null;
    onAbort?: () => void | Promise<void>;
    // True while the agent is working on a turn: the round button turns into a stop
    // button and a double press of Escape aborts the turn.
    isBusy?: boolean;
    connectionStatus?: {
        text: string;
        color: string;
        dotColor: string;
        isPulsing?: boolean;
        onPress?: () => void;
        action?: 'openPermission';
        cliStatus?: {
            claude: boolean | null;
            codex: boolean | null;
            gemini?: boolean | null;
            qoder?: boolean | null;
        };
    };
    autocompletePrefixes: string[];
    autocompleteSuggestions: (query: string) => Promise<{ key: string, text: string, component: React.ElementType }[]>;
    usageData?: {
        inputTokens: number;
        outputTokens: number;
        cacheCreation: number;
        cacheRead: number;
        contextSize: number;
        contextWindowSize?: number;
    };
    alwaysShowContextSize?: boolean;
    onFileViewerPress?: () => void;
    agentType?: 'claude' | 'codex' | 'gemini' | 'qoder';
    // Models offered by the agent itself (Qoder lists them per account over ACP), as the machine reports
    // them: with each model's efforts and Qoder's own description. A session's list still comes from metadata.models.
    agentModels?: QoderPickerModel[];
    // New sessions only: the agents to choose from, offered as the first tab of the settings overlay.
    availableAgents?: readonly ('claude' | 'codex' | 'gemini' | 'qoder')[];
    onAgentChange?: (agent: 'claude' | 'codex' | 'gemini' | 'qoder') => void;
    machineName?: string | null;
    onMachineClick?: () => void;
    currentPath?: string | null;
    onPathClick?: () => void;
    fastMode?: boolean;
    onFastModeChange?: (enabled: boolean) => void;
    isSendDisabled?: boolean;
    isSending?: boolean;
    // When true, the send button stays active and fires onSend even with an empty
    // input (e.g. the new-session wizard, which can create a session without an
    // initial message). Defaults to the usual "only send when there is text".
    allowEmptySend?: boolean;
    minHeight?: number;
    // Extra 8px of side margin on the input panel. The session composer asks for it so the
    // panel's rounded edge lines up with the message column; the new-session page, which
    // stacks the same panel under its own sections, keeps the panel flush.
    panelSideMargin?: boolean;
    // Rows of the machine/path card above and below the machine and path — the new-session page
    // puts its session type selector on top and its repo picker at the bottom, so everything about
    // where the session runs sits in one card.
    contextHeader?: React.ReactNode;
    contextFooter?: React.ReactNode;
    // Draw the panel as Liquid Glass instead of an opaque fill — for a composer that floats over
    // the conversation. Only honoured where Liquid Glass exists (iOS 26+).
    glassPanel?: boolean;
    images?: LocalImage[];
    onImagesChange?: (images: LocalImage[]) => void;
    onImageButtonPress?: () => void;
    // Image-only entry points use the landscape icon; menus with more actions default to add (+).
    imageButtonIcon?: 'add' | 'image-outline';
    // The attachment button's menu (images, scheduling, ...): opened natively from the button on iOS,
    // while `onImageButtonPress` opens the page's own sheet elsewhere. Items that don't apply
    // (e.g. images on an AI without image support) are passed as `disabled` rather than hidden.
    imageMenuItems?: ActionMenuItem[];
    supportsImages?: boolean;
    isUploadingImages?: boolean;
    // Files attached to the next message, already uploading to the session's machine
    files?: ComposerFile[];
    onRemoveFile?: (id: string) => void;
    onRetryFile?: (id: string) => void;
    onFileDrop?: (files: File[]) => void;
}

const agentFlavorIcons = {
    claude: require('@/assets/images/icon-claude.png'),
    codex: require('@/assets/images/icon-gpt.png'),
    gemini: require('@/assets/images/icon-gemini.png'),
    qoder: require('@/assets/images/icon-qoder.png'),
};

// The vendor mark keeps one slot across flavors so the row cannot shift, and only the artwork
// inside it is scaled. Codex's knot fills its frame while Claude's starburst carries ~18%
// padding of its own, so identical frames would still read as different sizes - measured ink
// in a 12px frame: Codex 12px, Claude 9.8px.
const AGENT_MARK_SLOT = 12;
// Every text in the status row (connection, context, model, permission mode) sits on this fixed line:
// Latin and CJK glyphs measure differently, so an auto-sized line made the row jump as the labels changed language.
const STATUS_LINE_HEIGHT = 16;
const agentMarkArtworkSize: Record<keyof typeof agentFlavorIcons, number> = {
    claude: 12,
    codex: 10,
    gemini: 12,
    qoder: 11,
};

// Vendor marks at full size, as on the agent button in the input and the agent picker rows. Same
// correction as above at a larger scale: Codex and Qoder fill their frames, so they are drawn
// smaller than Claude and Gemini to read as the same size.
const AGENT_ICON_SLOT = 18;
const agentIconArtworkSize: Record<keyof typeof agentFlavorIcons, number> = {
    claude: 18,
    codex: 15,
    gemini: 18,
    qoder: 16,
};

// The settings overlay grows out of the input below it and sinks back into it when closed. These are
// driven by shared values rather than entering/exiting layout animations: on web those pin the
// overlay's top and height, so it would grow downward over the input when its content changes.
const SETTINGS_OVERLAY_OPEN_TIMING = { duration: 200, easing: Easing.out(Easing.cubic) };
const SETTINGS_OVERLAY_CLOSE_TIMING = { duration: 140, easing: Easing.in(Easing.cubic) };
const SETTINGS_TAB_CONTENT_TIMING = { duration: 180, easing: Easing.out(Easing.cubic) };
const SETTINGS_TAB_TIMING = { duration: 220, easing: Easing.out(Easing.cubic) };
// Padding of the segmented tab bar, around the tabs and the sliding selection behind them.
const SETTINGS_TAB_BAR_PADDING = 2;

const stylesheet = StyleSheet.create((theme, runtime) => ({
    container: {
        alignItems: 'center',
        paddingBottom: 8,
        paddingTop: 8,
    },
    innerContainer: {
        width: '100%',
        position: 'relative',
    },
    dragOverlay: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        borderWidth: 2,
        borderColor: '#007AFF',
        borderStyle: 'dashed',
        borderRadius: Platform.select({ default: 16, android: 20 }),
        backgroundColor: 'rgba(0, 122, 255, 0.05)',
        pointerEvents: 'none',
        zIndex: 10,
    },
    unifiedPanel: {
        backgroundColor: theme.colors.input.background,
        borderRadius: Platform.select({ default: 16, android: 20 }),
        overflow: 'hidden',
        paddingVertical: 2,
        paddingBottom: 8,
        paddingHorizontal: 8,
    },
    // The iOS card, whose status row already spaces the input from the top: the action row's own
    // button padding does the rest at the bottom.
    unifiedPanelCompact: {
        paddingBottom: 4,
        borderRadius: 24,
    },
    unifiedPanelGlass: {
        backgroundColor: 'transparent',
    },
    glassBackground: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        borderRadius: Platform.select({ default: 16, android: 20 }),
    },
    inputContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        borderWidth: 0,
        paddingLeft: 8,
        paddingRight: 8,
        paddingVertical: 4,
        minHeight: 40,
    },
    inputContainerCompact: {
        minHeight: 34,
    },
    // Native fields show a scroll indicator at their right edge: the field reaches nearer the
    // panel's edge so the indicator runs clear of the expand button.
    inputContainerOverflowing: {
        paddingRight: Platform.OS === 'web' ? 8 : 2,
    },
    expandButton: {
        position: 'absolute',
        top: 8,
        right: Platform.OS === 'web' ? 6 : 8,
        width: 24,
        height: 24,
        borderRadius: 6,
        alignItems: 'center',
        justifyContent: 'center',
    },
    // Hides the text scrolling under it.
    expandButtonFilled: {
        backgroundColor: theme.colors.input.background,
    },

    // Overlay styles
    autocompleteOverlay: {
        position: 'absolute',
        bottom: '100%',
        left: 0,
        right: 0,
        marginBottom: 8,
        zIndex: 1000,
    },
    settingsOverlay: {
        position: 'absolute',
        bottom: '100%',
        left: 0,
        right: 0,
        marginBottom: 8,
        zIndex: 1000,
        transformOrigin: 'bottom',
    },
    settingsContent: {
        flexShrink: 1,
        minHeight: 0,
    },
    settingsTabIndicator: {
        position: 'absolute',
        top: SETTINGS_TAB_BAR_PADDING,
        bottom: SETTINGS_TAB_BAR_PADDING,
        left: SETTINGS_TAB_BAR_PADDING,
        borderRadius: 8,
        backgroundColor: theme.colors.floatingOverlay.segmentedSelected,
    },
    overlayBackdrop: {
        position: 'absolute',
        top: -1000,
        left: -1000,
        right: -1000,
        bottom: -1000,
        zIndex: 999,
    },
    overlaySection: {
        paddingTop: 12,
        paddingBottom: 8,
    },
    // The flexShrink/minHeight chain lets the lists inside shrink to the overlay's maxHeight and scroll.
    modelSection: {
        flexShrink: 1,
        minHeight: 0,
    },
    modelColumns: {
        flexDirection: 'row',
        flexShrink: 1,
        minHeight: 0,
    },
    modelColumn: {
        flex: 1,
        minHeight: 0,
    },
    // The scroll container touches the tab bar and the dividers; the breathing room is inside it.
    modelListScroll: {
        flexShrink: 1,
        minHeight: 0,
    },
    modelListContent: {
        paddingVertical: 8,
    },
    modelColumnTitle: {
        paddingTop: 8,
    },
    effortDropdown: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        paddingHorizontal: 16,
    },
    // A long title gives way to the value beside it.
    effortDropdownLabel: {
        flexShrink: 1,
    },
    effortDropdownValue: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        flexShrink: 0,
    },
    // Wide layout: the effort and context window column, one list with a sticky title per section.
    settingsListContent: {
        paddingBottom: 8,
    },
    // Opaque, so the radios scroll under it; spaced from its radios as the other columns' titles are.
    settingsColumnTitle: {
        paddingTop: 8,
        paddingBottom: 12,
        backgroundColor: theme.colors.floatingOverlay.background,
    },
    // The effort list sits at the top of the column, the context window row at the bottom, level with the model list's ends.
    settingsColumnBox: {
        justifyContent: 'space-between',
    },
    settingsColumnGap: {
        height: 20,
    },
    effortDropdownValueText: {
        fontSize: 14,
        color: theme.colors.text,
        ...Typography.default(),
    },
    overlaySectionTitle: {
        fontSize: 12,
        fontWeight: '600',
        color: theme.colors.textSecondary,
        paddingHorizontal: 16,
        paddingBottom: 4,
        ...Typography.default('semiBold'),
    },
    // In the app the lines match the overlay's own hairline border; the web keeps its 1px divider.
    overlayDivider: {
        height: Platform.OS === 'web' ? 1 : StyleSheet.hairlineWidth,
        backgroundColor: theme.colors.floatingOverlay.divider,
        marginHorizontal: 16,
    },
    overlayColumnDivider: {
        width: Platform.OS === 'web' ? 1 : StyleSheet.hairlineWidth,
        backgroundColor: theme.colors.floatingOverlay.divider,
        marginVertical: 8,
    },
    // A native switch can be taller than the row; centring it in a slot keeps it level with the label.
    fastModeSwitchSlot: {
        justifyContent: 'center',
    },
    fastModeRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
    },
    contextWindowRow: {
        marginBottom: 8,
        // Room between the label and a typed size.
        gap: 24,
    },
    fastModeLabel: {
        fontSize: 12,
        fontWeight: '600',
        color: theme.colors.textSecondary,
        ...Typography.default('semiBold'),
    },

    // Selection styles
    selectionItem: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 8,
        backgroundColor: 'transparent',
    },
    selectionItemPressed: {
        backgroundColor: theme.colors.floatingOverlay.pressed,
    },
    radioButton: {
        width: 16,
        height: 16,
        borderRadius: 8,
        borderWidth: 2,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 12,
    },
    radioButtonActive: {
        borderColor: theme.colors.radio.active,
    },
    radioButtonInactive: {
        borderColor: theme.colors.radio.inactive,
    },
    radioButtonDot: {
        width: 6,
        height: 6,
        borderRadius: 3,
        backgroundColor: theme.colors.radio.dot,
    },
    selectionLabel: {
        fontSize: 14,
        ...Typography.default(),
    },
    selectionLabelActive: {
        color: theme.colors.radio.active,
    },
    selectionLabelInactive: {
        color: theme.colors.text,
    },
    selectionDescription: {
        fontSize: 11,
        color: theme.colors.textSecondary,
        ...Typography.default(),
    },
    selectionContent: {
        flex: 1,
    },
    selectionTrailing: {
        marginLeft: 12,
        fontSize: 12,
        color: theme.colors.textSecondary,
        ...Typography.default(),
    },

    // Status styles
    statusContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingBottom: 4,
    },
    statusRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    statusText: {
        fontSize: 11,
        ...Typography.default(),
    },
    permissionModeContainer: {
        flexDirection: 'column',
        alignItems: 'flex-end',
    },
    permissionModeText: {
        fontSize: 11,
        ...Typography.default(),
    },
    contextWarningText: {
        fontSize: 11,
        marginLeft: 8,
        ...Typography.default(),
    },

    // Button styles
    actionButtonsContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 0,
    },
    actionButtonsLeft: {
        flexDirection: 'row',
        gap: 8,
        flex: 1,
        overflow: 'hidden',
    },
    actionButton: {
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: Platform.select({ default: 16, android: 20 }),
        paddingHorizontal: 8,
        paddingVertical: 6,
        justifyContent: 'center',
        height: 32,
    },
    actionButtonPressed: {
        opacity: 0.7,
    },
    actionButtonIcon: {
        color: theme.colors.button.secondary.tint,
    },
    sendButton: {
        width: 32,
        height: 32,
        borderRadius: 16,
        justifyContent: 'center',
        alignItems: 'center',
        flexShrink: 0,
        marginLeft: 8,
    },
    sendButtonActive: {
        backgroundColor: theme.colors.button.primary.background,
    },
    sendButtonInactive: {
        backgroundColor: theme.colors.button.primary.disabled,
    },
    sendButtonInner: {
        width: '100%',
        height: '100%',
        alignItems: 'center',
        justifyContent: 'center',
    },
    sendButtonInnerPressed: {
        opacity: 0.7,
    },
    sendButtonIcon: {
        color: theme.colors.button.primary.tint,
    },
    iconButton: {
        width: 40,
        height: 40,
        justifyContent: 'center',
        alignItems: 'center',
    },
    iconButtonDisabled: {
        opacity: 0.4,
    },
}));

// 200000 → 200K, 1000000 → 1M, as Qoder and Claude Code label context windows.
const formatContextWindowLabel = (tokens: number) => tokens >= 1_000_000 && tokens % 1_000_000 === 0
    ? `${tokens / 1_000_000}M`
    : `${Math.round(tokens / 1000)}K`;

// The context window option that asks for a size instead of being one.
const CUSTOM_CONTEXT_WINDOW = 'custom';

const formatCompactTokenCount = (value: number) => {
    if (value >= 1000) {
        return `${Math.round(value / 1000)}k`;
    }
    return value.toLocaleString();
};

const CONTEXT_DETAILS_TOOLTIP_WIDTH = 160;
const CONTEXT_DETAILS_TOOLTIP_HEIGHT = 76;
const CONTEXT_DETAILS_TOOLTIP_GAP = 20;
const CONTEXT_DETAILS_SCREEN_MARGIN = 8;
// The settings overlay opens above the composer: up to 414 tall, shrinking on short screens but never under 200.
const SETTINGS_OVERLAY_MAX_HEIGHT = 414;
const SETTINGS_OVERLAY_MIN_HEIGHT = 200;
// Rough height taken by the header, status bar, composer and safe area, which the overlay must leave visible.
const SETTINGS_OVERLAY_RESERVED_HEIGHT = 320;

const getContextWarning = (contextSize: number, maxContextSize: number, alwaysShow: boolean = false, theme: Theme) => {
    if (!maxContextSize || maxContextSize <= 0) {
        return null;
    }
    const percentageUsed = (contextSize / maxContextSize) * 100;
    const percentageRemaining = Math.max(0, Math.min(100, 100 - percentageUsed));
    const roundedUsed = Math.max(0, Math.min(100, Math.round(percentageUsed)));
    const roundedRemaining = Math.round(percentageRemaining);
    const details = t('agentInput.context.details', {
        usedPercent: roundedUsed,
        remainingPercent: roundedRemaining,
        usedTokens: formatCompactTokenCount(contextSize),
        totalTokens: formatCompactTokenCount(maxContextSize),
    });

    if (percentageRemaining <= 10) {
        return { text: t('agentInput.context.remaining', { percent: roundedRemaining }), color: theme.colors.warningCritical, details };
    } else if (percentageRemaining <= 30) {
        return { text: t('agentInput.context.remaining', { percent: roundedRemaining }), color: theme.colors.warning, details };
    } else if (alwaysShow) {
        // Show context remaining in neutral color when not near limit
        return { text: t('agentInput.context.remaining', { percent: roundedRemaining }), color: theme.colors.warning, details };
    }
    return null; // No display needed
};

export const AgentInput = React.memo(React.forwardRef<MultiTextInputHandle, AgentInputProps>((props, ref) => {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const renderRadioOptions = <T extends string>(
        options: readonly { value: T; label: string; description?: string; trailing?: string }[],
        selectedValue: T | null,
        onSelect: (value: T) => void,
        onItemLayout?: ItemLayoutHandler,
    ) => options.map(option => {
        const isSelected = selectedValue === option.value;
        return (
            <Pressable key={option.value}
                onLayout={onItemLayout ? (e) => onItemLayout(option.value, e.nativeEvent.layout.y, e.nativeEvent.layout.height) : undefined}
                onPress={() => { hapticsLight(); onSelect(option.value); }}
                style={({ pressed, hovered }: any) => [styles.selectionItem, (pressed || hovered) && styles.selectionItemPressed]}>
                <View style={[styles.radioButton, isSelected ? styles.radioButtonActive : styles.radioButtonInactive]}>
                    {isSelected && <View style={styles.radioButtonDot} />}
                </View>
                {option.description ? (
                    <View style={styles.selectionContent}>
                        <Text style={[styles.selectionLabel, isSelected ? styles.selectionLabelActive : styles.selectionLabelInactive]}>
                            {option.label}
                        </Text>
                        <Text
                            style={styles.selectionDescription}
                            numberOfLines={1}
                            // react-native-web drops `title`, so the full text goes on the DOM node for the hover tooltip.
                            ref={Platform.OS === 'web' ? (node: any) => node?.setAttribute?.('title', option.description) : undefined}
                        >
                            {option.description}
                        </Text>
                    </View>
                ) : (
                    <Text style={[styles.selectionLabel, styles.selectionContent, isSelected ? styles.selectionLabelActive : styles.selectionLabelInactive]}>
                        {option.label}
                    </Text>
                )}
                {option.trailing && <Text style={styles.selectionTrailing}>{option.trailing}</Text>}
            </Pressable>
        );
    });
    // The model tab's only scrolling part: the tab bar above and the rows below it stay put.
    const renderScrollableList = <T extends string>(
        options: readonly { value: T; label: string; description?: string; trailing?: string }[],
        selectedValue: T | null,
        onSelect: (value: T) => void,
    ) => (
        <ScrollToSelectedList
            style={styles.modelListScroll}
            contentContainerStyle={styles.modelListContent}
            selectedValue={selectedValue}
            renderItems={(onItemLayout) => renderRadioOptions(options, selectedValue, onSelect, onItemLayout)}
        />
    );

    // Narrow layout: the effort is a dropdown row, so the model list keeps the height.
    const renderEffortDropdown = <T extends string>(
        options: readonly { value: T; label: string }[],
        selectedValue: T | null,
        onSelect: (value: T) => void,
        title: string = t('agentInput.model.reasoningEffort'),
    ) => (
        <DropdownMenu
            accessibilityLabel={title}
            placement="topCenter"
            style={[styles.effortDropdown, { height: modelFooterRowHeight }]}
            items={options.map(option => ({
                label: option.label,
                selected: option.value === selectedValue,
                onPress: () => { hapticsLight(); onSelect(option.value); },
            }))}
        >
            <Text style={[styles.fastModeLabel, styles.effortDropdownLabel]} numberOfLines={1}>{title}</Text>
            <View style={styles.effortDropdownValue}>
                <Text style={styles.effortDropdownValueText}>
                    {options.find(option => option.value === selectedValue)?.label ?? ''}
                </Text>
                <Ionicons name="chevron-forward" size={14} color={theme.colors.textSecondary} />
            </View>
        </DropdownMenu>
    );
    const { width: screenWidth, height: screenHeight } = useWindowDimensions();
    // Keep the settings and autocomplete overlays aligned with the panel in both new and existing sessions.
    const panelHorizontalInset = props.panelSideMargin ? 8 : 0;
    const useGlassPanel = !!props.glassPanel && Platform.OS === 'ios' && isLiquidGlassAvailable();
    // Wide layout: show the reasoning-effort column beside the model list instead of below it.
    const isWideModelLayout = screenWidth > 700;
    // Height of the rows under the model lists (effort dropdown, Fast mode).
    const modelFooterRowHeight = isWideModelLayout ? 44 : 40;
    /**
     * The model tab of an agent whose models may come with an effort and a context window (Claude, Qoder).
     * Wide screens: the context window's radios follow the effort's in one list in the column beside the
     * models, each under its own title that stays on top while its radios scroll. Narrow screens: effort and
     * context window are rows of their own under the models; up to three sizes are picked in place, more
     * open a dropdown. `effort` and `contextWindow` are null when the picked model offers no choice.
     */
    const renderModelSettings = <T extends string, E extends string>(
        models: { options: readonly { value: T; label: string; description?: string; trailing?: string }[]; selected: T | null; onChange: (value: T) => void },
        effort: { options: readonly { value: E; label: string }[]; selected: E | null; onChange: (value: E) => void } | null,
        contextWindow: { options: readonly (ContextWindowSegment & { trailing?: string; segmentLabel?: string })[]; selected: string; onChange: (value: string) => void } | null,
        // Where a custom size is typed: `full` replaces the lists on narrow screens (short enough to stay clear of
        // the keyboard it raises); `inline` takes the place of the segments in the context window row on wide ones.
        editor: { full: React.ReactNode; inline: React.ReactNode } | null = null,
    ) => {
        if (editor && !isWideModelLayout) return editor.full;
        const contextWindowTitle = t('agentInput.model.contextWindow');
        const contextWindowRadios = contextWindow?.options ?? [];
        const pickContextWindow = (value: string) => contextWindow?.onChange(value);
        const selectedContextWindow = contextWindow?.selected ?? null;
        if (isWideModelLayout) {
            const settingsColumn = [
                ...(effort ? [{
                    title: t('agentInput.model.reasoningEffort'),
                    render: (onItemLayout: ItemLayoutHandler) => renderRadioOptions(effort.options, effort.selected, effort.onChange, onItemLayout),
                }] : []),
            ];
            // Only the effort's title is sticky; the context window is one row (label left, sizes right) under it.
            const settingsColumnHeaders = effort ? [0] : [];
            const contextWindowRow = contextWindow && (
                <View key="context-window-row" style={[styles.fastModeRow, styles.contextWindowRow, { height: modelFooterRowHeight }]}>
                    <Text style={styles.fastModeLabel}>{contextWindowTitle}</Text>
                    {editor?.inline ?? (
                        <ContextWindowSegments
                            options={contextWindow.options.map((option) => ({ ...option, label: option.segmentLabel ?? option.label, accessibilityLabel: option.trailing ? `${option.label} ${option.trailing}` : option.label }))}
                            value={contextWindow.selected}
                            onChange={contextWindow.onChange}
                            accessibilityLabel={contextWindowTitle}
                        />
                    )}
                </View>
            );
            // The model list keeps its place in the tree whether or not the settings column exists, so it is
            // not rebuilt (and its scroll position lost) when the picked model changes between having one and not.
            return (
                <View style={styles.modelColumns}>
                    <View style={styles.modelColumn}>
                        {renderScrollableList(models.options, models.selected, models.onChange)}
                    </View>
                    {(settingsColumn.length > 0 || contextWindowRow) && <View style={styles.overlayColumnDivider} />}
                    {(settingsColumn.length > 0 || contextWindowRow) && (
                        <View style={[styles.modelColumn, styles.settingsColumnBox]}>
                            <ScrollToSelectedList
                                style={styles.modelListScroll}
                                contentContainerStyle={styles.settingsListContent}
                                selectedValue={effort ? effort.selected : null}
                                stickyHeaderIndices={settingsColumnHeaders}
                                renderItems={(onItemLayout) => settingsColumn.flatMap((section, index) => [
                                    <Text key={`title-${section.title}`} style={[styles.overlaySectionTitle, styles.settingsColumnTitle]}>
                                        {section.title}
                                    </Text>,
                                    ...section.render(onItemLayout),
                                    ...(index < settingsColumn.length - 1 ? [<View key={`gap-${section.title}`} style={styles.settingsColumnGap} />] : []),
                                ])}
                            />
                            {contextWindowRow}
                        </View>
                    )}
                </View>
            );
        }
        return (
            <>
                {renderScrollableList(models.options, models.selected, models.onChange)}
                {effort && <View style={styles.overlayDivider} />}
                {effort && renderEffortDropdown(effort.options, effort.selected, effort.onChange)}
                {contextWindow && <View style={styles.overlayDivider} />}
                {contextWindow && (contextWindow.options.length <= 3 ? (
                    <View style={[styles.fastModeRow, { height: modelFooterRowHeight }]}>
                        <Text style={styles.fastModeLabel}>{contextWindowTitle}</Text>
                        <ContextWindowSegments
                            options={contextWindow.options.map((option) => ({ ...option, label: option.segmentLabel ?? option.label, accessibilityLabel: option.trailing ? `${option.label} ${option.trailing}` : option.label }))}
                            value={contextWindow.selected}
                            onChange={contextWindow.onChange}
                            accessibilityLabel={contextWindowTitle}
                        />
                    </View>
                ) : renderEffortDropdown(contextWindowRadios, selectedContextWindow, pickContextWindow, contextWindowTitle))}
            </>
        );
    };

    // Check if this is a Codex or Gemini session
    // Use metadata.flavor for existing sessions, agentType prop for new sessions
    const isCodex = props.metadata?.flavor === 'codex' || props.agentType === 'codex';
    const isGemini = props.metadata?.flavor === 'gemini' || props.agentType === 'gemini';
    const isQoder = props.metadata?.flavor === 'qoder' || props.agentType === 'qoder';
    const isClaude = !isCodex && !isGemini && !isQoder;
    // Vendor mark beside the model label. Claude is the fallback for sessions without a flavor.
    const agentFlavorKey: keyof typeof agentFlavorIcons = isCodex ? 'codex' : isGemini ? 'gemini' : isQoder ? 'qoder' : 'claude';

    const permissionModeOptions: PermissionMode[] = isCodex
        ? ['default', 'read-only', 'on-failure', 'full-auto']
        : isGemini
            ? ['default', 'auto_edit', 'plan', 'yolo']
            : isQoder
                ? ['default', 'acceptEdits', 'auto', 'yolo']
                : ['default', 'acceptEdits', 'plan', 'auto', 'bypassPermissions'];

    const getPermissionModeLabel = React.useCallback((mode: PermissionMode | undefined, badge = false): string => {
        if (!mode) return '';
        if (isCodex) {
            if (mode === 'default') return t('agentInput.codexPermissionMode.default');
            if (mode === 'read-only') return badge ? t('agentInput.codexPermissionMode.badgeReadOnly') : t('agentInput.codexPermissionMode.readOnly');
            if (mode === 'on-failure') return badge ? t('agentInput.codexPermissionMode.badgeOnFailure') : t('agentInput.codexPermissionMode.onFailure');
            if (mode === 'full-auto') return badge ? t('agentInput.codexPermissionMode.badgeFullAuto') : t('agentInput.codexPermissionMode.fullAuto');
            return '';
        }
        if (isGemini) {
            if (mode === 'default') return t('agentInput.geminiPermissionMode.default');
            if (mode === 'auto_edit') return badge ? t('agentInput.geminiPermissionMode.badgeAutoEdit') : t('agentInput.geminiPermissionMode.autoEdit');
            if (mode === 'plan') return badge ? t('agentInput.geminiPermissionMode.badgePlan') : t('agentInput.geminiPermissionMode.plan');
            if (mode === 'yolo') return badge ? t('agentInput.geminiPermissionMode.badgeYolo') : t('agentInput.geminiPermissionMode.yolo');
            return '';
        }
        if (isQoder) {
            if (mode === 'default') return t('agentInput.qoderPermissionMode.default');
            if (mode === 'acceptEdits') return badge ? t('agentInput.qoderPermissionMode.badgeAcceptEdits') : t('agentInput.qoderPermissionMode.acceptEdits');
            if (mode === 'auto') return badge ? t('agentInput.qoderPermissionMode.badgeAuto') : t('agentInput.qoderPermissionMode.auto');
            if (mode === 'yolo') return badge ? t('agentInput.qoderPermissionMode.badgeYolo') : t('agentInput.qoderPermissionMode.yolo');
            if (mode === 'plan') return badge ? t('agentInput.permissionMode.badgePlanMode') : t('agentInput.permissionMode.plan');
            return '';
        }
        if (mode === 'default') return t('agentInput.permissionMode.default');
        if (mode === 'acceptEdits') return badge ? t('agentInput.permissionMode.badgeAcceptAllEdits') : t('agentInput.permissionMode.acceptEdits');
        if (mode === 'auto') return badge ? t('agentInput.permissionMode.badgeAuto') : t('agentInput.permissionMode.auto');
        if (mode === 'bypassPermissions') return badge ? t('agentInput.permissionMode.badgeBypassAllPermissions') : t('agentInput.permissionMode.bypassPermissions');
        if (mode === 'plan') return badge ? t('agentInput.permissionMode.badgePlanMode') : t('agentInput.permissionMode.plan');
        return '';
    }, [isCodex, isGemini, isQoder]);

    const permissionModeDescriptions: Partial<Record<PermissionMode, string>> = isQoder ? {
        default: t('agentInput.qoderPermissionMode.defaultDescription'),
        acceptEdits: t('agentInput.qoderPermissionMode.acceptEditsDescription'),
        auto: t('agentInput.qoderPermissionMode.autoDescription'),
        yolo: t('agentInput.qoderPermissionMode.yoloDescription'),
    } : isCodex ? {
        default: t('agentInput.codexPermissionMode.defaultDescription'),
        'read-only': t('agentInput.codexPermissionMode.readOnlyDescription'),
        'on-failure': t('agentInput.codexPermissionMode.onFailureDescription'),
        'full-auto': t('agentInput.codexPermissionMode.fullAutoDescription'),
    } : isGemini ? {
        default: t('agentInput.geminiPermissionMode.defaultDescription'),
        auto_edit: t('agentInput.geminiPermissionMode.autoEditDescription'),
        plan: t('agentInput.geminiPermissionMode.planDescription'),
        yolo: t('agentInput.geminiPermissionMode.yoloDescription'),
    } : {
        default: t('agentInput.permissionMode.defaultDescription'),
        acceptEdits: t('agentInput.permissionMode.acceptEditsDescription'),
        plan: t('agentInput.permissionMode.planDescription'),
        auto: t('agentInput.permissionMode.autoDescription'),
        bypassPermissions: t('agentInput.permissionMode.bypassPermissionsDescription'),
    };
    // Qoder's plan mode stands apart from its permission mode and only an approved plan ends it.
    // The badge shows it; the picker keeps the chosen mode, which applies once the plan is approved.
    const isQoderPlanning = isQoder && !!props.metadata?.inPlanMode;
    const shownPermissionMode = isQoderPlanning ? 'plan' : props.permissionMode;

    // Qoder has no "CLI default" entry (its own Auto plays that part), so a session still on `default` shows the model Qoder reports.
    const qoderModels = React.useMemo<QoderPickerModel[]>(() => {
        const machineModels = new Map((props.agentModels ?? []).map((model) => [model.code, model]));
        return (props.metadata?.models ?? props.agentModels ?? []).map((model) => ({ ...machineModels.get(model.code), ...model }));
    }, [props.metadata?.models, props.agentModels]);
    const selectedModelMode: ModelMode = isQoder && (props.modelMode || 'default') === MODEL_MODE_DEFAULT
        ? (props.metadata?.currentModelCode
            ? buildQoderModelMode(props.metadata.currentModelCode, props.metadata.currentThoughtLevelCode)
            : qoderModels[0]?.code ?? MODEL_MODE_DEFAULT)
        : props.modelMode || 'default';
    const qoderSelection = parseQoderModelMode(selectedModelMode);
    const qoderSelectedModel = qoderModels.find((model) => model.code === qoderSelection.model);
    // The machine lists every model's efforts; without it, the session knows those of the model it runs.
    const qoderEffortLevels = qoderSelectedModel?.efforts
        ?? (qoderSelection.model === props.metadata?.currentModelCode ? props.metadata?.thoughtLevels : undefined)
        ?? [];
    const qoderEffort = qoderSelection.effort
        ?? qoderSelectedModel?.defaultEffort
        ?? (qoderSelection.model === props.metadata?.currentModelCode ? props.metadata?.currentThoughtLevelCode : undefined)
        ?? null;
    // qodercli lists efforts in no particular order; like the other agents they read strongest first.
    const qoderEffortRank = (code: string) => (['max', 'xhigh', 'high', 'medium', 'low', 'none'].indexOf(code) + 7) % 7;
    const qoderEffortOptions = [...qoderEffortLevels]
        .sort((a, b) => qoderEffortRank(a.code) - qoderEffortRank(b.code))
        .map((level) => ({ value: level.code, label: formatReasoningEffortLabel(level.code) ?? level.value }));
    // Context windows the model can run with (from the machine's list); offered only when there is a choice.
    // Unpicked, it shows the one the session reports running with, else the model's default.
    const qoderContextWindows = qoderSelectedModel?.contextWindows ?? [];
    const qoderContextWindow = qoderSelection.contextWindow
        ?? qoderContextWindows.find((tokens) => tokens === props.usageData?.contextWindowSize)
        ?? qoderSelectedModel?.defaultContextWindow
        ?? null;
    const qoderContextWindowOptions = qoderContextWindows.length > 1
        ? qoderContextWindows.map((tokens) => ({ value: String(tokens), label: formatContextWindowLabel(tokens) }))
        : [];
    // Like qodercli's own /model, a newly picked model starts on its own default effort; a picked
    // context window is kept while the new model takes it.
    const handleQoderModelChange = React.useCallback((code: string) => {
        const model = qoderModels.find((candidate) => candidate.code === code);
        const contextWindow = model?.contextWindows?.find((tokens) => tokens === qoderSelection.contextWindow);
        props.onModelModeChange?.(buildQoderModelMode(code, model?.defaultEffort, contextWindow));
    }, [qoderModels, qoderSelection.contextWindow, props.onModelModeChange]);
    const handleQoderEffortChange = React.useCallback((effort: string) => {
        props.onModelModeChange?.(buildQoderModelMode(qoderSelection.model, effort, qoderSelection.contextWindow));
    }, [qoderSelection.model, qoderSelection.contextWindow, props.onModelModeChange]);
    const handleQoderContextWindowChange = React.useCallback((contextWindow: number) => {
        props.onModelModeChange?.(buildQoderModelMode(qoderSelection.model, qoderSelection.effort, contextWindow));
    }, [qoderSelection.model, qoderSelection.effort, props.onModelModeChange]);
    const modelCatalog = useModelCatalog();
    const codexSelection = React.useMemo<{ family: CodexModelFamily; effort: CodexReasoningEffort }>(() => {
        return parseCodexModelMode(selectedModelMode);
    }, [selectedModelMode, modelCatalog]);
    // The catalog's "use the CLI's model" entry is English-only; every agent shows the translated one.
    // Catalog descriptions are English, with translations for some languages.
    const localizeModelOptions = (options: readonly ModelOption[]): ModelOption[] => options.map((option) => option.value === MODEL_MODE_DEFAULT
        ? { ...option, label: t('agentInput.model.useCliConfigured'), description: t('agentInput.model.useCliDefaults') }
        : { ...option, description: option.descriptionTranslations?.[getCurrentLanguage()] ?? option.description });
    const codexFamilyOptions = React.useMemo(() => localizeModelOptions(getModelFamilyOptions('codex')), [modelCatalog]);
    const codexReasoningOptions = React.useMemo<Array<{ value: CodexReasoningEffort; label: string }>>(() => {
        const options = getCodexReasoningOptions(codexSelection.family);
        return options.map((value) => ({
            value,
            label: formatReasoningEffortLabel(value) ?? value,
        }));
    }, [codexSelection.family, modelCatalog]);
    const handleCodexFamilyChange = React.useCallback((family: CodexModelFamily) => {
        if (!props.onModelModeChange) return;
        if (family === MODEL_MODE_DEFAULT) {
            props.onModelModeChange(MODEL_MODE_DEFAULT);
            return;
        }
        // Clamp the carried-over effort to what the new family supports (e.g. switching
        // from a Sol `ultra` selection to a family that only goes up to `xhigh`).
        const validOptions = getCodexReasoningOptions(family);
        const effort = codexSelection.effort && validOptions.includes(codexSelection.effort) ? codexSelection.effort : validOptions[0];
        props.onModelModeChange(buildCodexModelMode(family, effort));
    }, [codexSelection.effort, props.onModelModeChange]);
    const handleCodexReasoningChange = React.useCallback((effort: CodexReasoningEffort) => {
        if (!props.onModelModeChange || codexSelection.family === MODEL_MODE_DEFAULT) return;
        props.onModelModeChange(buildCodexModelMode(codexSelection.family, effort));
    }, [codexSelection.family, props.onModelModeChange]);
    const claudeSelection = React.useMemo<{ family: ClaudeModelFamily; effort: ClaudeReasoningEffort | null; contextWindow: number | null }>(() => {
        return parseClaudeModelMode(selectedModelMode);
    }, [selectedModelMode, modelCatalog]);
    // Claude Code's auto-compact window, offered when the model runs with more than 200K: 200K and 1M with
    // one tap, any other size typed in. Unpicked, it shows the one the session reports running with (Claude
    // Code's own setting), before any report Claude Code's default, 200K; a tap on it still picks it.
    const claudeContextWindowRange = React.useMemo(() => getClaudeContextWindowOptions(claudeSelection.family), [claudeSelection.family, modelCatalog]);
    const claudeContextWindow = claudeSelection.contextWindow
        ?? props.usageData?.contextWindowSize
        ?? claudeContextWindowRange?.presets[0]
        ?? null;
    const claudeCustomContextWindow = claudeContextWindow !== null && !claudeContextWindowRange?.presets.includes(claudeContextWindow)
        ? claudeContextWindow
        : null;
    const claudeContextWindowOptions = claudeContextWindowRange ? [
        ...claudeContextWindowRange.presets.map((tokens) => ({ value: String(tokens), label: formatContextWindowLabel(tokens) })),
        {
            value: CUSTOM_CONTEXT_WINDOW,
            label: t('agentInput.model.customContextWindow'),
            // Once there is a custom size, the segment shows it with the edit icon instead of the word.
            segmentLabel: claudeCustomContextWindow ? formatContextWindowLabel(claudeCustomContextWindow) : undefined,
            edited: !!claudeCustomContextWindow,
            trailing: claudeCustomContextWindow ? formatContextWindowLabel(claudeCustomContextWindow) : undefined,
            opensEditor: true,
        },
    ] : [];
    const claudeFamilyOptions = React.useMemo(() => localizeModelOptions(getModelFamilyOptions('claude')), [modelCatalog]);
    const claudeReasoningOptions = React.useMemo<Array<{ value: ClaudeReasoningEffort; label: string }>>(() => {
        const options = getClaudeReasoningOptions(claudeSelection.family);
        return options.map((value) => ({
            value,
            label: formatReasoningEffortLabel(value) ?? value,
        }));
    }, [claudeSelection.family, modelCatalog]);
    const handleClaudeFamilyChange = React.useCallback((family: ClaudeModelFamily) => {
        if (!props.onModelModeChange) return;
        if (family === MODEL_MODE_DEFAULT) {
            props.onModelModeChange(MODEL_MODE_DEFAULT);
            return;
        }
        const validOptions = getClaudeReasoningOptions(family);
        // Coming from `default` (the CLI's own choice, which carries neither), the effort picked before it
        // comes back. The window does not: the one the session reports running with wins, and is left unpicked
        // (it is already what Claude Code runs with, so nothing restarts); the remembered one only stands in
        // until the session has reported.
        const fromDefault = claudeSelection.family === MODEL_MODE_DEFAULT;
        const remembered = fromDefault && props.rememberedModelMode ? parseClaudeModelMode(props.rememberedModelMode) : null;
        const previous = remembered
            ? { ...remembered, contextWindow: props.usageData?.contextWindowSize ? null : remembered.contextWindow }
            : claudeSelection;
        // Default to Medium (not the list's top-of-order Max) when nothing compatible carries over.
        const fallbackEffort = validOptions.includes('medium') ? 'medium' : validOptions[0];
        const effort = previous.effort && validOptions.includes(previous.effort) ? previous.effort : fallbackEffort;
        props.onModelModeChange(buildClaudeModelMode(family, effort, previous.contextWindow));
    }, [claudeSelection, props.rememberedModelMode, props.usageData?.contextWindowSize, props.onModelModeChange]);
    const handleClaudeReasoningChange = React.useCallback((effort: ClaudeReasoningEffort) => {
        if (!props.onModelModeChange || claudeSelection.family === MODEL_MODE_DEFAULT) return;
        props.onModelModeChange(buildClaudeModelMode(claudeSelection.family, effort, claudeSelection.contextWindow));
    }, [claudeSelection.family, claudeSelection.contextWindow, props.onModelModeChange]);
    // The custom size is typed in place of the settings lists; null while none is being typed.
    const [customContextWindowDraft, setCustomContextWindowDraft] = React.useState<string | null>(null);
    const buildClaudeContextWindowMode = (tokens: number) =>
        // A model without effort control ignores the effort it is built with.
        buildClaudeModelMode(claudeSelection.family, claudeSelection.effort ?? 'medium', tokens);
    const handleClaudeContextWindowChange = (value: string) => {
        if (value === CUSTOM_CONTEXT_WINDOW) {
            setCustomContextWindowDraft(claudeCustomContextWindow ? String(Math.round(claudeCustomContextWindow / 1000)) : '');
            return;
        }
        props.onModelModeChange?.(buildClaudeContextWindowMode(Number(value)));
    };
    const submitCustomContextWindow = (thousands: number) => {
        const tokens = thousands * 1000;
        if (!claudeContextWindowRange || tokens < claudeContextWindowRange.min || tokens > claudeContextWindowRange.max) return false;
        props.onModelModeChange?.(buildClaudeContextWindowMode(tokens));
        setCustomContextWindowDraft(null);
        return true;
    };
    const modelOptions = React.useMemo<Array<{ value: ModelMode; label: string; shortLabel: string; description: string; trailing?: string }>>(() => {
        if (isGemini) return localizeModelOptions(getModelFamilyOptions('gemini'));
        const cliDefault = { value: MODEL_MODE_DEFAULT, label: t('agentInput.model.useCliConfigured'), shortLabel: 'CLI', description: t('agentInput.model.useCliDefaults') };
        if (isQoder) {
            // Qoder ends each tag list with the credit multiplier ("Vision · 0.50x Credit"); it is shown on the right as "0.5x".
            // Qoder's own sentence replaces the tags when the machine could read it.
            return qoderModels.map((model) => {
                const credit = model.description?.match(/^(.*?)(?:\s*·\s*)?\b(\d+(?:\.\d+)?)x Credit\s*$/);
                return {
                    value: model.code,
                    label: model.value,
                    shortLabel: model.value,
                    description: model.detail ?? (credit ? credit[1] : model.description ?? ''),
                    trailing: credit ? `${Number(credit[2])}x` : undefined,
                };
            });
        }
        return [cliDefault];
    }, [isGemini, isQoder, qoderModels, modelCatalog]);

    const currentModelLabel = React.useMemo(() => {
        if (isCodex) {
            return (codexFamilyOptions.find(o => o.value === codexSelection.family)?.shortLabel ?? '') + (codexSelection.family !== 'default' ? ` (${codexReasoningOptions.find(o => o.value === codexSelection.effort)?.label ?? codexSelection.effort})` : '');
        }
        if (isClaude && claudeSelection.family !== 'default') {
            const base = claudeFamilyOptions.find(o => o.value === claudeSelection.family)?.shortLabel ?? '';
            const effortLabel = claudeReasoningOptions.find(o => o.value === claudeSelection.effort)?.label;
            return base + (effortLabel ? ` (${effortLabel})` : '');
        }
        if (isQoder) {
            const effortLabel = qoderEffortOptions.find(o => o.value === qoderEffort)?.label;
            // A saved model the stand-in list lacks shows by its code until the machine's own list arrives.
            return (modelOptions.find(o => o.value === qoderSelection.model)?.shortLabel ?? qoderSelection.model) + (effortLabel ? ` (${effortLabel})` : '');
        }
        return modelOptions.find(o => o.value === selectedModelMode)?.shortLabel ?? '';
    }, [isCodex, isClaude, isQoder, codexFamilyOptions, codexSelection, codexReasoningOptions, claudeFamilyOptions, claudeSelection, claudeReasoningOptions, modelOptions, selectedModelMode, qoderSelection.model, qoderEffort, qoderEffortOptions]);

    // Calculate context warning
    // Prefer dynamic contextWindowSize from CLI (e.g. Codex reports model_context_window,
    // Claude reports its /autocompact-aware window via agentState), fall back to static lookup
    // by model/agent flavor
    const agentFlavor = props.metadata?.flavor || props.agentType || null;
    const maxContextSize = props.usageData?.contextWindowSize || getMaxContextSize(props.modelMode, agentFlavor, props.metadata?.model, props.usageData?.contextSize);
    const contextWarning = props.usageData?.contextSize
        ? getContextWarning(props.usageData.contextSize, maxContextSize, props.alwaysShowContextSize ?? false, theme)
        : null;

    const agentInputEnterToSend = useSetting('agentInputEnterToSend');
    const [isContextDetailsHovered, setIsContextDetailsHovered] = React.useState(false);
    const [isContextDetailsPinned, setIsContextDetailsPinned] = React.useState(false);
    const [contextDetailsAnchor, setContextDetailsAnchor] = React.useState<{ x: number; y: number; width: number; height: number } | null>(null);
    const contextDetailsAnchorRef = React.useRef<View>(null);
    const composerKeyboardOffset = React.useContext(ComposerKeyboardOffsetContext);
    const keyboardHeight = useKeyboardState((state) => state.height);
    // Opening the overlay dismisses the keyboard, so size it for the keyboard-down screen from the start
    // instead of opening short and growing once the keyboard has gone.
    const settingsOverlayMaxHeight = Math.min(
        SETTINGS_OVERLAY_MAX_HEIGHT,
        Math.max(SETTINGS_OVERLAY_MIN_HEIGHT, screenHeight - SETTINGS_OVERLAY_RESERVED_HEIGHT),
    );
    // measureInWindow reads layout, which the keyboard lift of the composer never touches — see
    // ComposerKeyboardOffsetContext. Read at press time so the keyboard is already settled.
    const composerKeyboardLiftRef = React.useRef(0);
    composerKeyboardLiftRef.current = composerKeyboardOffset === null ? 0 : Math.max(0, keyboardHeight - composerKeyboardOffset);
    const contextDetailsHoverTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const isContextDetailsVisible = isContextDetailsHovered || isContextDetailsPinned;
    const isContextDetailsInlineVisible = isContextDetailsHovered || (Platform.OS === 'web' && isContextDetailsPinned);

    React.useEffect(() => {
        return () => {
            if (contextDetailsHoverTimerRef.current) {
                clearTimeout(contextDetailsHoverTimerRef.current);
            }
        };
    }, []);

    React.useEffect(() => {
        if (!contextWarning) {
            setIsContextDetailsHovered(false);
            setIsContextDetailsPinned(false);
            setContextDetailsAnchor(null);
        }
    }, [contextWarning]);

    // The popover is placed once, at press time, and the composer then moves with the keyboard:
    // close it rather than leave it hanging where the composer used to be. The `Will` events fire as
    // the keyboard starts to move; useKeyboardState only flips once the animation has finished.
    React.useEffect(() => {
        const close = () => setIsContextDetailsPinned(false);
        const subscriptions = [
            KeyboardEvents.addListener('keyboardWillHide', close),
            KeyboardEvents.addListener('keyboardWillShow', close),
        ];
        return () => subscriptions.forEach((subscription) => subscription.remove());
    }, []);

    const showContextDetailsFromPress = React.useCallback(() => {
        setIsContextDetailsHovered(false);
        if (isContextDetailsPinned) {
            setIsContextDetailsPinned(false);
            return;
        }
        if (Platform.OS === 'web') {
            setIsContextDetailsPinned(true);
            return;
        }
        contextDetailsAnchorRef.current?.measureInWindow((x, y, width, height) => {
            setContextDetailsAnchor({ x, y: y - composerKeyboardLiftRef.current, width, height });
            setIsContextDetailsPinned(true);
        });
    }, [isContextDetailsPinned]);

    React.useEffect(() => {
        if (Platform.OS !== 'web' || !isContextDetailsPinned) {
            return;
        }

        const handlePointerDown = (event: MouseEvent | TouchEvent) => {
            const target = event.target as Node | null;
            const node = contextDetailsAnchorRef.current as unknown as Node | null;
            if (node && target && node.contains(target)) {
                return;
            }
            setIsContextDetailsPinned(false);
        };

        document.addEventListener('mousedown', handlePointerDown);
        document.addEventListener('touchstart', handlePointerDown);
        return () => {
            document.removeEventListener('mousedown', handlePointerDown);
            document.removeEventListener('touchstart', handlePointerDown);
        };
    }, [isContextDetailsPinned]);


    // Abort state - the round button doubles as a stop button while the agent works
    const [isAborting, setIsAborting] = React.useState(false);
    const shakerRef = React.useRef<ShakeInstance>(null);
    // Timestamp of the Escape press that armed the double-press abort, 0 when disarmed
    const escapeAbortArmedAtRef = React.useRef(0);
    // Mirrors the armed gesture for rendering: the stop icon hides until the window lapses
    const [isAbortArmed, setIsAbortArmed] = React.useState(false);
    const escapeAbortTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

    const disarmEscapeAbort = React.useCallback(() => {
        escapeAbortArmedAtRef.current = 0;
        if (escapeAbortTimerRef.current) {
            clearTimeout(escapeAbortTimerRef.current);
            escapeAbortTimerRef.current = null;
        }
        setIsAbortArmed(false);
    }, []);

    const armEscapeAbort = React.useCallback((now: number) => {
        escapeAbortArmedAtRef.current = now;
        setIsAbortArmed(true);
        if (escapeAbortTimerRef.current) {
            clearTimeout(escapeAbortTimerRef.current);
        }
        escapeAbortTimerRef.current = setTimeout(disarmEscapeAbort, ABORT_ESCAPE_WINDOW_MS);
    }, [disarmEscapeAbort]);

    // A finished turn ends the gesture, and unmount must not leave a timer behind
    React.useEffect(() => {
        if (!props.isBusy) {
            disarmEscapeAbort();
        }
    }, [props.isBusy, disarmEscapeAbort]);

    React.useEffect(() => () => {
        if (escapeAbortTimerRef.current) {
            clearTimeout(escapeAbortTimerRef.current);
        }
    }, []);

    const inputRef = React.useRef<MultiTextInputHandle>(null);

    const { dropZoneRef, isDragging } = useWebFileDrop({
        enabled: !!props.onFileDrop,
        onFileDrop: props.onFileDrop,
    });

    // Forward ref to the MultiTextInput
    React.useImperativeHandle(ref, () => inputRef.current!, []);

    // Autocomplete state - track text and selection together
    const [inputState, setInputState] = React.useState<TextInputState>({
        text: props.value,
        selection: { start: 0, end: 0 }
    });
    const hasText = inputState.text.trim().length > 0 || props.value.trim().length > 0;
    // Attached images or files alone are enough to send (e.g. an image-only chat message),
    // even when the text input is empty.
    const hasAttachments = (props.images?.length ?? 0) > 0 || (props.files?.length ?? 0) > 0;
    const imageButtonIcon = props.imageButtonIcon ?? 'add';
    const imageButtonIconSize = imageButtonIcon === 'image-outline' ? 24 : 25;
    // While the agent works and there is nothing to send, the round button stops the turn
    // instead of starting a voice session. Text/images keep the send button so messages can
    // still be queued.
    const showStopButton = !!(props.isBusy && props.onAbort && !hasText && !hasAttachments && !props.isSending);

    // Position while stepping through props.inputHistory with ArrowUp/ArrowDown. A ref is enough:
    // it never drives rendering, and stepInputHistory ends browsing itself once the text diverges.
    const inputHistoryCursorRef = React.useRef<InputHistoryCursor>(initialInputHistoryCursor);

    // Keep a latest text snapshot to avoid stale parent-state reads during fast click-after-type sends.
    const latestTextRef = React.useRef(props.value);
    React.useEffect(() => {
        latestTextRef.current = props.value;
    }, [props.value]);

    // Sync inputState.text when props.value changes externally (e.g., after send clears the input).
    // Without this, inputState.text retains the old message text because prop changes don't trigger
    // onStateChange from MultiTextInput, causing hasText to stay true and resolveSendSnapshot()
    // to return the old text — which makes the send button show an arrow on an empty input and
    // allows re-sending the previous message.
    React.useEffect(() => {
        setInputState(prev => {
            if (prev.text !== props.value) {
                return { ...prev, text: props.value };
            }
            return prev;
        });
    }, [props.value]);

    // Keep the latest text in sync immediately so a fast tap on send doesn't use stale state.
    const handleTextChange = React.useCallback((text: string) => {
        latestTextRef.current = text;
        props.onChangeText(text);
    }, [props.onChangeText]);

    // Handle combined text and selection state changes.
    // Guards against stale selection-change callbacks (which may carry an outdated text value)
    // from overwriting correct state set synchronously by handleTextChange.
    const handleInputStateChange = React.useCallback((newState: TextInputState) => {
        // Don't let stale callbacks overwrite latestTextRef with empty text
        if (newState.text || !latestTextRef.current) {
            latestTextRef.current = newState.text;
        }
        // Don't let stale callbacks overwrite non-empty inputState.text with empty text.
        // When the user legitimately clears text, latestTextRef is already empty
        // (set by handleTextChange first). When a stale callback fires, latestTextRef
        // still has the current text, so we can detect the stale case.
        setInputState(prev => {
            const sameSelection = prev.selection.start === newState.selection.start
                && prev.selection.end === newState.selection.end;
            if (!newState.text && prev.text && latestTextRef.current) {
                // Stale callback — only update selection, keep the correct text
                return sameSelection ? prev : { ...prev, selection: newState.selection };
            }
            // The web textarea reports its selection on every keyup and selectionchange, mostly
            // unchanged; a fresh object for those would re-render the whole composer each time.
            return sameSelection && prev.text === newState.text ? prev : newState;
        });
    }, []);

    // Long text gets a button in the field's corner that opens it on a page of its own.
    const [isInputOverflowing, setIsInputOverflowing] = React.useState(false);
    const [isExpanded, setIsExpanded] = React.useState(false);
    const openExpanded = React.useCallback(() => setIsExpanded(true), []);
    const closeExpanded = React.useCallback(() => setIsExpanded(false), []);

    const resolveSendSnapshot = React.useCallback((): string => {
        const candidates = [latestTextRef.current, inputState.text, props.value];
        for (const candidate of candidates) {
            if (candidate.trim().length > 0) {
                return candidate;
            }
        }
        return latestTextRef.current;
    }, [inputState.text, props.value]);

    // Use the tracked selection from inputState
    const activeWord = useActiveWord(inputState.text, inputState.selection, props.autocompletePrefixes);
    // Using default options: clampSelection=true, autoSelectFirst=true, wrapAround=true
    // To customize: useActiveSuggestions(activeWord, props.autocompleteSuggestions, { clampSelection: false, wrapAround: false })
    const [suggestions, selected, moveUp, moveDown] = useActiveSuggestions(activeWord, props.autocompleteSuggestions, { clampSelection: true, wrapAround: true });

    // Debug logging
    // React.useEffect(() => {
    //     console.log('🔍 Autocomplete Debug:', JSON.stringify({
    //         value: props.value,
    //         inputState,
    //         activeWord,
    //         suggestionsCount: suggestions.length,
    //         selected,
    //         prefixes: props.autocompletePrefixes
    //     }, null, 2));
    // }, [props.value, inputState, activeWord, suggestions.length, selected]);

    // Handle suggestion selection
    const handleSuggestionSelect = React.useCallback((index: number) => {
        if (!suggestions[index] || !inputRef.current) return;

        const suggestion = suggestions[index];

        // Apply the suggestion
        const result = applySuggestion(
            inputState.text,
            inputState.selection,
            suggestion.text,
            props.autocompletePrefixes,
            true // add space after
        );

        // Use imperative API to set text and selection
        inputRef.current.setTextAndSelection(result.text, {
            start: result.cursorPosition,
            end: result.cursorPosition
        });

        // console.log('Selected suggestion:', suggestion.text);

        // Small haptic feedback
        hapticsLight();
    }, [suggestions, inputState, props.autocompletePrefixes]);

    // Settings modal state: 'agent' shows agent picker (new sessions), 'model' shows model picker,
    // 'permission' shows permission picker, false = closed
    const [showSettings, setShowSettings] = React.useState<'agent' | 'model' | 'permission' | false>(false);

    // Dismiss keyboard when settings overlay opens
    React.useEffect(() => {
        if (showSettings) {
            Keyboard.dismiss();
        }
        // A size being typed does not outlive the overlay or its model tab.
        if (showSettings !== 'model') setCustomContextWindowDraft(null);
    }, [showSettings]);

    // The overlay stays mounted while it animates out, still showing the tab it was closed on.
    const isSettingsOpen = showSettings !== false;
    const [settingsOverlayMounted, setSettingsOverlayMounted] = React.useState(false);
    const lastSettingsTabRef = React.useRef<'agent' | 'model' | 'permission'>('model');
    if (showSettings) lastSettingsTabRef.current = showSettings;
    const shownSettingsTab = showSettings || lastSettingsTabRef.current;
    const settingsOverlayProgress = useSharedValue(0);
    React.useEffect(() => {
        if (isSettingsOpen) {
            setSettingsOverlayMounted(true);
            settingsOverlayProgress.value = withTiming(1, SETTINGS_OVERLAY_OPEN_TIMING);
            return;
        }
        settingsOverlayProgress.value = withTiming(0, SETTINGS_OVERLAY_CLOSE_TIMING);
        const timer = setTimeout(() => setSettingsOverlayMounted(false), SETTINGS_OVERLAY_CLOSE_TIMING.duration);
        return () => clearTimeout(timer);
    }, [isSettingsOpen, settingsOverlayProgress]);
    const settingsOverlayStyle = useAnimatedStyle(() => ({
        opacity: settingsOverlayProgress.value,
        transform: [
            { translateY: (1 - settingsOverlayProgress.value) * 8 },
            { scale: 0.97 + 0.03 * settingsOverlayProgress.value },
        ],
    }));

    // The selected tab's background slides between tabs; it is placed without animating when the overlay opens.
    const settingsTabKeys: ('agent' | 'model' | 'permission')[] = props.onAgentChange && props.agentType
        ? ['agent', 'model', 'permission']
        : ['model', 'permission'];
    const activeSettingsTabIndex = showSettings ? settingsTabKeys.indexOf(showSettings) : -1;
    const [settingsTabBarWidth, setSettingsTabBarWidth] = React.useState(0);
    // Height of the input panel with its status row, which the settings overlay sits on top of.
    // A shared value, not state: the panel's height changes every frame while its text field
    // animates, and state would re-render this whole component on each of them.
    const inputPanelHeight = useSharedValue(0);
    const settingsOverlayBottomStyle = useAnimatedStyle(() => ({ bottom: inputPanelHeight.value }));
    const settingsTabWidth = settingsTabBarWidth > 0 ? (settingsTabBarWidth - SETTINGS_TAB_BAR_PADDING * 2) / settingsTabKeys.length : 0;
    const settingsTabIndicatorX = useSharedValue(0);
    const settingsTabIndicatorPlacedRef = React.useRef(false);
    React.useEffect(() => {
        if (activeSettingsTabIndex < 0) {
            settingsTabIndicatorPlacedRef.current = false;
            return;
        }
        if (settingsTabWidth === 0) return;
        const x = activeSettingsTabIndex * settingsTabWidth;
        settingsTabIndicatorX.value = settingsTabIndicatorPlacedRef.current ? withTiming(x, SETTINGS_TAB_TIMING) : x;
        settingsTabIndicatorPlacedRef.current = true;
    }, [activeSettingsTabIndex, settingsTabWidth, settingsTabIndicatorX]);
    const settingsTabIndicatorStyle = useAnimatedStyle(() => ({
        transform: [{ translateX: settingsTabIndicatorX.value }],
    }));

    // The new tab's content fades in when switching tabs (a layout effect, so it never shows at full opacity first).
    const settingsContentOpacity = useSharedValue(1);
    const previousSettingsTabIndexRef = React.useRef(-1);
    React.useLayoutEffect(() => {
        const previous = previousSettingsTabIndexRef.current;
        previousSettingsTabIndexRef.current = activeSettingsTabIndex;
        if (previous < 0 || activeSettingsTabIndex < 0 || previous === activeSettingsTabIndex) return;
        settingsContentOpacity.value = 0;
        settingsContentOpacity.value = withTiming(1, SETTINGS_TAB_CONTENT_TIMING);
    }, [activeSettingsTabIndex, settingsContentOpacity]);
    const settingsContentStyle = useAnimatedStyle(() => ({ opacity: settingsContentOpacity.value }));

    // Handle settings button press (gear icon → model selection)
    const handleSettingsPress = React.useCallback(() => {
        hapticsLight();
        setShowSettings(prev => prev === 'model' ? false : 'model');
    }, []);

    // Handle permission mode text press (right-side text → permission mode selection)
    const handlePermissionPress = React.useCallback(() => {
        hapticsLight();
        setShowSettings(prev => prev === 'permission' ? false : 'permission');
    }, []);

    // Handle agent button press (bottom-left agent name → agent selection)
    const handleAgentPress = React.useCallback(() => {
        hapticsLight();
        setShowSettings(prev => prev === 'agent' ? false : 'agent');
    }, []);

    // Handle settings selection
    const handleSettingsSelect = React.useCallback((mode: PermissionMode) => {
        hapticsLight();
        props.onPermissionModeChange?.(mode);
        // Don't close the settings overlay - let users see the change and potentially switch again
    }, [props.onPermissionModeChange]);

    // Handle abort button press
    const handleAbortPress = React.useCallback(async () => {
        if (!props.onAbort) return;

        hapticsError();
        setIsAborting(true);
        const startTime = Date.now();

        try {
            await props.onAbort?.();

            // Ensure minimum 300ms loading time
            const elapsed = Date.now() - startTime;
            if (elapsed < 300) {
                await new Promise(resolve => setTimeout(resolve, 300 - elapsed));
            }
        } catch (error) {
            // Shake on error
            shakerRef.current?.shake();
            console.error('Abort RPC call failed:', error);
        } finally {
            setIsAborting(false);
        }
    }, [props.onAbort]);

    // Handle keyboard navigation
    const handleKeyPress = React.useCallback((event: KeyPressEvent): boolean => {
        // Handle autocomplete navigation first
        if (suggestions.length > 0) {
            if (event.key === 'ArrowUp') {
                moveUp();
                return true;
            } else if (event.key === 'ArrowDown') {
                moveDown();
                return true;
            } else if ((event.key === 'Enter' || (event.key === 'Tab' && !event.shiftKey))) {
                // Both Enter and Tab select the current suggestion
                // If none selected (selected === -1), select the first one
                const indexToSelect = selected >= 0 ? selected : 0;
                handleSuggestionSelect(indexToSelect);
                return true;
            } else if (event.key === 'Escape') {
                // Clear suggestions by collapsing selection (triggers activeWord to clear)
                if (inputRef.current) {
                    const cursorPos = inputState.selection.start;
                    inputRef.current.setTextAndSelection(inputState.text, {
                        start: cursorPos,
                        end: cursorPos
                    });
                }
                return true;
            }
        }

        // ArrowUp/ArrowDown recall previously sent inputs once autocomplete has declined the key.
        if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && !event.shiftKey && props.inputHistory?.length && inputRef.current) {
            const currentText = latestTextRef.current;
            if (shouldNavigateInputHistory(event.key, currentText, inputState.selection)) {
                const step = stepInputHistory(
                    inputHistoryCursorRef.current,
                    event.key === 'ArrowUp' ? 'older' : 'newer',
                    props.inputHistory,
                    currentText,
                );
                if (step) {
                    inputHistoryCursorRef.current = step.cursor;
                    inputRef.current.setTextAndSelection(step.text, { start: step.text.length, end: step.text.length });
                    return true;
                }
            }
        }

        // Handle Escape for abort when no suggestions are visible. A single press only arms
        // the gesture - a second press inside the window confirms it.
        const escapeAbortNow = Date.now();
        const escapeAbort = resolveEscapeAbort({
            key: event.key,
            isBusy: !!props.isBusy,
            isAborting,
            armedAt: escapeAbortArmedAtRef.current,
            now: escapeAbortNow,
        });
        if (escapeAbort !== 'ignore') {
            if (escapeAbort === 'abort') {
                disarmEscapeAbort();
                handleAbortPress();
            } else {
                armEscapeAbort(escapeAbortNow);
            }
            return true;
        }

        // Original key handling
        if (Platform.OS === 'web') {
            if (agentInputEnterToSend && event.key === 'Enter' && !event.shiftKey) {
                const textSnapshot = resolveSendSnapshot();
                if (shouldSendOnEnter({
                    key: event.key,
                    shiftKey: event.shiftKey,
                    enterToSendEnabled: agentInputEnterToSend,
                    textSnapshot,
                    isSending: props.isSending,
                    isSendDisabled: props.isSendDisabled,
                })) {
                    props.onSend(textSnapshot);
                    return true; // Key was handled
                }
                if (textSnapshot.trim() && (props.isSending || props.isSendDisabled)) {
                    return true;
                }
            }
            // Handle Shift+Tab for permission mode switching
            if (event.key === 'Tab' && event.shiftKey && props.onPermissionModeChange) {
                const modeOrder: PermissionMode[] = permissionModeOptions;
                const currentIndex = modeOrder.indexOf(props.permissionMode || 'default');
                const nextIndex = (currentIndex + 1) % modeOrder.length;
                props.onPermissionModeChange(modeOrder[nextIndex]);
                hapticsLight();
                return true; // Key was handled, prevent default tab behavior
            }

        }
        return false; // Key was not handled
    }, [suggestions, moveUp, moveDown, selected, handleSuggestionSelect, props.inputHistory, inputState.selection, props.isBusy, props.onAbort, isAborting, handleAbortPress, armEscapeAbort, disarmEscapeAbort, agentInputEnterToSend, resolveSendSnapshot, props.onSend, props.permissionMode, props.onPermissionModeChange, props.isSending, props.isSendDisabled, permissionModeOptions]);

    const connectionStatusIndicator = props.connectionStatus ? (
        <>
            <StatusDot
                color={props.connectionStatus.dotColor}
                isPulsing={props.connectionStatus.isPulsing}
                size={6}
            />
            <Text style={{
                fontSize: 11,
                lineHeight: STATUS_LINE_HEIGHT,
                height: STATUS_LINE_HEIGHT,
                color: props.connectionStatus.color,
                ...Typography.default()
            }}>
                {props.connectionStatus.text}
            </Text>
        </>
    ) : null;

    // Rendered outside the input tree on native. A React Native Modal presented while the
    // keyboard is up blanks everything behind it on iOS, and the keyboard is open by
    // definition whenever this indicator is tapped (see 1f51968d / b1fd050d).
    const contextDetailsPopover = contextWarning ? (
        <Pressable
            style={{ flex: 1, backgroundColor: 'transparent' }}
            onPress={() => setIsContextDetailsPinned(false)}
        >
            <Pressable
                onPress={(event) => event.stopPropagation()}
                style={{
                    position: 'absolute',
                    left: contextDetailsAnchor
                        ? Math.min(
                            Math.max(contextDetailsAnchor.x, CONTEXT_DETAILS_SCREEN_MARGIN),
                            Math.max(CONTEXT_DETAILS_SCREEN_MARGIN, screenWidth - CONTEXT_DETAILS_TOOLTIP_WIDTH - CONTEXT_DETAILS_SCREEN_MARGIN)
                        )
                        : CONTEXT_DETAILS_SCREEN_MARGIN,
                    top: contextDetailsAnchor
                        ? Math.min(
                            Math.max(
                                CONTEXT_DETAILS_SCREEN_MARGIN,
                                contextDetailsAnchor.y + contextDetailsAnchor.height - CONTEXT_DETAILS_TOOLTIP_GAP - CONTEXT_DETAILS_TOOLTIP_HEIGHT
                            ),
                            Math.max(CONTEXT_DETAILS_SCREEN_MARGIN, screenHeight - CONTEXT_DETAILS_TOOLTIP_HEIGHT - CONTEXT_DETAILS_SCREEN_MARGIN)
                        )
                        : CONTEXT_DETAILS_SCREEN_MARGIN,
                    minWidth: CONTEXT_DETAILS_TOOLTIP_WIDTH,
                    paddingHorizontal: 10,
                    paddingVertical: 8,
                    borderRadius: 10,
                    backgroundColor: theme.colors.surface,
                    borderWidth: 0.5,
                    borderColor: theme.colors.modal.border,
                    shadowColor: theme.colors.shadow.color,
                    shadowOffset: { width: 0, height: 2 },
                    shadowOpacity: theme.colors.shadow.opacity,
                    shadowRadius: 6,
                    elevation: 8,
                }}
            >
                <Text style={{
                    fontSize: 12,
                    lineHeight: 20,
                    color: theme.colors.text,
                    ...Typography.default()
                }}>
                    {contextWarning.details}
                </Text>
            </Pressable>
        </Pressable>
    ) : null;

    // Connection status, context warning, and permission mode. On iOS the row sits inside the
    // input panel's card, as the card's first line; elsewhere it stays above the panel.
    const statusInPanel = Platform.OS === 'ios' && !isRunningOnMac();
    // The machine/path card. On iOS the status row lives inside the input card, so nothing else
    // separates the two; elsewhere the row goes with the input card below, so it keeps further from this one.
    const hasContextCard = props.machineName !== undefined || !!props.currentPath || !!props.contextHeader || !!props.contextFooter;
    const contextCardMarginBottom = statusInPanel ? 16 : 12;
    const statusBar = (props.connectionStatus || contextWarning || props.permissionMode) ? (
        <View style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            // Inside the panel the row lines up with the panel's own content padding.
            paddingHorizontal: statusInPanel ? 8 : 16,
            paddingTop: statusInPanel ? 8 : 0,
            paddingBottom: 4,
            minHeight: 20, // Fixed minimum height to prevent jumping
        }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, gap: 11 }}>
                {props.connectionStatus && (
                    <>
                        {(props.connectionStatus.onPress || props.connectionStatus.action) ? (
                            <Pressable
                                hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
                                onPress={() => {
                                    if (props.connectionStatus?.action === 'openPermission') {
                                        hapticsLight();
                                        setShowSettings(prev => prev === 'permission' ? false : 'permission');
                                    } else {
                                        props.connectionStatus?.onPress?.();
                                    }
                                }}
                                style={({ pressed }) => ({
                                    flexDirection: 'row',
                                    alignItems: 'center',
                                    gap: 4,
                                    opacity: pressed ? 0.7 : 1
                                })}
                            >
                                {connectionStatusIndicator}
                            </Pressable>
                        ) : (
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                                {connectionStatusIndicator}
                            </View>
                        )}
                        {/* CLI Status - only shown when provided (wizard only) */}
                        {props.connectionStatus.cliStatus && (
                            <>
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                                    <Text style={{
                                        fontSize: 11,
                                        lineHeight: STATUS_LINE_HEIGHT,
                                        height: STATUS_LINE_HEIGHT,
                                        color: props.connectionStatus.cliStatus.claude
                                            ? theme.colors.success
                                            : theme.colors.textDestructive,
                                        ...Typography.default()
                                    }}>
                                        {props.connectionStatus.cliStatus.claude ? '✓' : '✗'}
                                    </Text>
                                    <Text style={{
                                        fontSize: 11,
                                        lineHeight: STATUS_LINE_HEIGHT,
                                        height: STATUS_LINE_HEIGHT,
                                        color: props.connectionStatus.cliStatus.claude
                                            ? theme.colors.success
                                            : theme.colors.textDestructive,
                                        ...Typography.default()
                                    }}>
                                        claude
                                    </Text>
                                </View>
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                                    <Text style={{
                                        fontSize: 11,
                                        lineHeight: STATUS_LINE_HEIGHT,
                                        height: STATUS_LINE_HEIGHT,
                                        color: props.connectionStatus.cliStatus.codex
                                            ? theme.colors.success
                                            : theme.colors.textDestructive,
                                        ...Typography.default()
                                    }}>
                                        {props.connectionStatus.cliStatus.codex ? '✓' : '✗'}
                                    </Text>
                                    <Text style={{
                                        fontSize: 11,
                                        lineHeight: STATUS_LINE_HEIGHT,
                                        height: STATUS_LINE_HEIGHT,
                                        color: props.connectionStatus.cliStatus.codex
                                            ? theme.colors.success
                                            : theme.colors.textDestructive,
                                        ...Typography.default()
                                    }}>
                                        codex
                                    </Text>
                                </View>
                                {props.connectionStatus.cliStatus.qoder !== undefined && (
                                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                                        <Text style={{
                                            fontSize: 11,
                                            lineHeight: STATUS_LINE_HEIGHT,
                                            height: STATUS_LINE_HEIGHT,
                                            color: props.connectionStatus.cliStatus.qoder
                                                ? theme.colors.success
                                                : theme.colors.textDestructive,
                                            ...Typography.default()
                                        }}>
                                            {props.connectionStatus.cliStatus.qoder ? '✓' : '✗'}
                                        </Text>
                                        <Text style={{
                                            fontSize: 11,
                                            lineHeight: STATUS_LINE_HEIGHT,
                                            height: STATUS_LINE_HEIGHT,
                                            color: props.connectionStatus.cliStatus.qoder
                                                ? theme.colors.success
                                                : theme.colors.textDestructive,
                                            ...Typography.default()
                                        }}>
                                            qoder
                                        </Text>
                                    </View>
                                )}
                                {props.connectionStatus.cliStatus.gemini !== undefined && (
                                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                                        <Text style={{
                                            fontSize: 11,
                                            lineHeight: STATUS_LINE_HEIGHT,
                                            height: STATUS_LINE_HEIGHT,
                                            color: props.connectionStatus.cliStatus.gemini
                                                ? theme.colors.success
                                                : theme.colors.textDestructive,
                                            ...Typography.default()
                                        }}>
                                            {props.connectionStatus.cliStatus.gemini ? '✓' : '✗'}
                                        </Text>
                                        <Text style={{
                                            fontSize: 11,
                                            lineHeight: STATUS_LINE_HEIGHT,
                                            height: STATUS_LINE_HEIGHT,
                                            color: props.connectionStatus.cliStatus.gemini
                                                ? theme.colors.success
                                                : theme.colors.textDestructive,
                                            ...Typography.default()
                                        }}>
                                            gemini
                                        </Text>
                                    </View>
                                )}
                            </>
                        )}
                    </>
                )}
                {contextWarning && (
                    <>
                        <View
                            ref={contextDetailsAnchorRef}
                            style={{
                                position: 'relative',
                                marginLeft: props.connectionStatus ? 8 : 0,
                                zIndex: isContextDetailsVisible ? 1002 : 1,
                            }}
                        >
                            <Pressable
                                onPress={() => {
                                    hapticsLight();
                                    showContextDetailsFromPress();
                                }}
                                onHoverIn={() => {
                                    if (contextDetailsHoverTimerRef.current) {
                                        clearTimeout(contextDetailsHoverTimerRef.current);
                                    }
                                    contextDetailsHoverTimerRef.current = setTimeout(() => {
                                        setIsContextDetailsHovered(true);
                                        contextDetailsHoverTimerRef.current = null;
                                    }, 600);
                                }}
                                onHoverOut={() => {
                                    if (contextDetailsHoverTimerRef.current) {
                                        clearTimeout(contextDetailsHoverTimerRef.current);
                                        contextDetailsHoverTimerRef.current = null;
                                    }
                                    setIsContextDetailsHovered(false);
                                }}
                                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            >
                                <Text style={{
                                    fontSize: 11,
                                    lineHeight: STATUS_LINE_HEIGHT,
                                    height: STATUS_LINE_HEIGHT,
                                    color: contextWarning.color,
                                    ...Typography.default()
                                }}>
                                    {props.connectionStatus ? '• ' : ''}{contextWarning.text}
                                </Text>
                            </Pressable>
                            {isContextDetailsInlineVisible && (
                                <View
                                    style={{
                                        position: 'absolute',
                                        left: 0,
                                        bottom: CONTEXT_DETAILS_TOOLTIP_GAP,
                                        minWidth: CONTEXT_DETAILS_TOOLTIP_WIDTH,
                                        paddingHorizontal: 10,
                                        paddingVertical: 8,
                                        borderRadius: 10,
                                        backgroundColor: theme.colors.surface,
                                        borderWidth: 0.5,
                                        borderColor: theme.colors.modal.border,
                                        shadowColor: theme.colors.shadow.color,
                                        shadowOffset: { width: 0, height: 2 },
                                        shadowOpacity: theme.colors.shadow.opacity,
                                        shadowRadius: 6,
                                        elevation: 8,
                                    }}
                                >
                                    <Text style={{
                                        fontSize: 12,
                                        lineHeight: 20,
                                        color: theme.colors.text,
                                        ...Typography.default()
                                    }}>
                                    {contextWarning.details}
                                </Text>
                            </View>
                        )}
                        </View>
                        {Platform.OS === 'ios' ? (
                            isContextDetailsPinned && contextDetailsAnchor ? (
                                <FullWindowOverlay>
                                    {contextDetailsPopover}
                                </FullWindowOverlay>
                            ) : null
                        ) : (
                            <RNModal
                                transparent
                                visible={Platform.OS !== 'web' && isContextDetailsPinned && !!contextDetailsAnchor}
                                animationType="none"
                                onRequestClose={() => setIsContextDetailsPinned(false)}
                            >
                                {contextDetailsPopover}
                            </RNModal>
                        )}
                    </>
                )}
            </View>
            <View style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                zIndex: 1001,
            }}>
                {props.onModelModeChange && (
                    <Pressable hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }} onPress={() => { hapticsLight(); setShowSettings(prev => prev === 'model' ? false : 'model'); }} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                            {/* The model labels are vendor-less ("5.4", "3.8 Flash"), so the mark
                                sits here to say whose model this session runs. Not pressable on its
                                own - the vendor of a session cannot change. */}
                            <View style={{ width: AGENT_MARK_SLOT, height: AGENT_MARK_SLOT, alignItems: 'center', justifyContent: 'center' }}>
                                <Image
                                    source={agentFlavorIcons[agentFlavorKey]}
                                    style={{ width: agentMarkArtworkSize[agentFlavorKey], height: agentMarkArtworkSize[agentFlavorKey] }}
                                    contentFit="contain"
                                    tintColor={agentFlavorKey === 'codex' || agentFlavorKey === 'qoder' ? theme.colors.textSecondary : undefined}
                                />
                            </View>
                            <Text style={{
                                fontSize: 11,
                                lineHeight: STATUS_LINE_HEIGHT,
                                height: STATUS_LINE_HEIGHT,
                                color: theme.colors.textSecondary,
                                ...Typography.default()
                            }}>
                                {currentModelLabel}
                                {props.fastMode && <>{' '}<MaterialCommunityIcons name="lightning-bolt" size={11} color={FAST_MODE_ICON_COLOR} /></>}
                            </Text>
                        </View>
                    </Pressable>
                )}
                {shownPermissionMode && (
                    <Pressable hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }} onPress={handlePermissionPress} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
                        <Text style={{
                            fontSize: 11,
                            lineHeight: STATUS_LINE_HEIGHT,
                            height: STATUS_LINE_HEIGHT,
                            color: shownPermissionMode === 'acceptEdits' ? theme.colors.permission.acceptEdits :
                                shownPermissionMode === 'bypassPermissions' ? theme.colors.permission.yolo :
                                    shownPermissionMode === 'plan' ? theme.colors.permission.plan :
                                        shownPermissionMode === 'read-only' ? theme.colors.permission.readOnly :
                                            shownPermissionMode === 'on-failure' ? theme.colors.permission.onFailure :
                                                shownPermissionMode === 'full-auto' ? theme.colors.permission.yolo :
                                                    shownPermissionMode === 'auto' ? theme.colors.permission.bypass :
                                                        shownPermissionMode === 'auto_edit' ? theme.colors.permission.acceptEdits :
                                                            shownPermissionMode === 'yolo' ? theme.colors.permission.yolo :
                                                    theme.colors.textSecondary,
                            ...Typography.default()
                        }}>
                            {getPermissionModeLabel(shownPermissionMode, true)}
                        </Text>
                    </Pressable>
                )}
            </View>
        </View>
    ) : null;

    return (
        <View style={[
            styles.container,
            { paddingHorizontal: screenWidth > 700 ? 16 : 8 }
        ]}>
            <View
                style={[
                    styles.innerContainer,
                    { maxWidth: layout.maxWidth },
                ]}
            >
                {/* Autocomplete suggestions overlay */}
                {suggestions.length > 0 && (
                    <Animated.View style={[
                        styles.autocompleteOverlay,
                        { paddingHorizontal: screenWidth > 700 ? panelHorizontalInset : 8 },
                        // Like the settings overlay, it opens right above the input card, covering
                        // the machine/path card rather than sitting over it.
                        settingsOverlayBottomStyle,
                        hasContextCard && { marginBottom: contextCardMarginBottom },
                    ]}>
                        <AgentInputAutocomplete
                            suggestions={suggestions.map(s => {
                                const Component = s.component;
                                return <Component key={s.key} />;
                            })}
                            selectedIndex={selected}
                            onSelect={handleSuggestionSelect}
                            itemHeight={48}
                        />
                    </Animated.View>
                )}

                {/* Settings overlay */}
                {(showSettings || settingsOverlayMounted) && (
                    <>
                        {showSettings && (
                            <TouchableWithoutFeedback onPress={() => setShowSettings(false)}>
                                <View style={styles.overlayBackdrop} />
                            </TouchableWithoutFeedback>
                        )}
                        <Animated.View
                            pointerEvents={showSettings ? 'auto' : 'none'}
                            style={[
                                styles.settingsOverlay,
                                { paddingHorizontal: panelHorizontalInset },
                                // The overlay's triggers sit right above or in the input card, so it opens
                                // there, covering the machine/path card rather than sitting over it.
                                // Its bottom lines up with the machine/path card's when there is one.
                                settingsOverlayBottomStyle,
                                hasContextCard && { marginBottom: contextCardMarginBottom },
                                settingsOverlayStyle,
                            ]}
                        >
                            <FloatingOverlay maxHeight={settingsOverlayMaxHeight} scrollable={false} animateHeight keyboardShouldPersistTaps="always">
                                {/* Tab bar - segmented control style */}
                                <View
                                    onLayout={(e) => setSettingsTabBarWidth(e.nativeEvent.layout.width)}
                                    style={{
                                        flexDirection: 'row',
                                        borderRadius: 10,
                                        overflow: 'hidden',
                                        padding: SETTINGS_TAB_BAR_PADDING,
                                        backgroundColor: theme.colors.floatingOverlay.segmentedBackground,
                                        margin: 8,
                                        marginBottom: 0,
                                    }}
                                >
                                    {settingsTabWidth > 0 && (
                                        <Animated.View style={[styles.settingsTabIndicator, { width: settingsTabWidth }, settingsTabIndicatorStyle]} />
                                    )}
                                    {(() => {
                                        const permissionLabel = getPermissionModeLabel(shownPermissionMode);
                                        const currentModelSubtitle: React.ReactNode = props.fastMode
                                            ? <>{currentModelLabel} <MaterialCommunityIcons name="lightning-bolt" size={10} color={FAST_MODE_ICON_COLOR} /></>
                                            : currentModelLabel;
                                        const tabInfo: Record<'agent' | 'model' | 'permission', { label: string; subtitle: React.ReactNode }> = {
                                            agent: { label: t('agentInput.agent.title'), subtitle: props.agentType ? t(`agentInput.agent.${props.agentType}`) : null },
                                            model: { label: t('agentInput.model.title'), subtitle: currentModelSubtitle },
                                            permission: { label: t('agentInput.permissionMode.title'), subtitle: permissionLabel },
                                        };
                                        const tabs = settingsTabKeys.map((key) => ({ key, ...tabInfo[key] }));
                                        return tabs.map((tab) => {
                                            const isActive = shownSettingsTab === tab.key;
                                            return (
                                                <Pressable
                                                    key={tab.key}
                                                    onPress={() => {
                                                        if (showSettings === tab.key) return;
                                                        hapticsLight();
                                                        setShowSettings(tab.key);
                                                    }}
                                                    style={{
                                                        flex: 1,
                                                        alignItems: 'center',
                                                        paddingVertical: 6,
                                                        borderRadius: 8,
                                                    }}
                                                >
                                                    {/* Fixed line heights: Latin and CJK glyphs measure differently, so an auto-sized line would make the header jump as the labels change */}
                                                    <Text style={{
                                                        fontSize: 13,
                                                        lineHeight: 18,
                                                        height: 18,
                                                        color: isActive ? theme.colors.text : theme.colors.textSecondary,
                                                        ...Typography.default(isActive ? 'semiBold' : 'regular'),
                                                    }} numberOfLines={1}>
                                                        {tab.label}
                                                    </Text>
                                                    <Text style={{
                                                        fontSize: 10,
                                                        lineHeight: 14,
                                                        height: 14,
                                                        color: theme.colors.textSecondary,
                                                        marginTop: 1,
                                                        ...Typography.default(),
                                                    }} numberOfLines={1}>
                                                        {tab.subtitle}
                                                    </Text>
                                                </Pressable>
                                            );
                                        });
                                    })()}
                                </View>

                                <Animated.View style={[styles.settingsContent, settingsContentStyle]}>
                                    {/* Agent Section */}
                                    {shownSettingsTab === 'agent' && <ScrollView style={styles.modelListScroll} contentContainerStyle={styles.overlaySection} keyboardShouldPersistTaps="always">
                                        {(props.availableAgents ?? []).map((agent) => {
                                            const isSelected = props.agentType === agent;
                                            return (
                                                <Pressable
                                                    key={agent}
                                                    onPress={() => {
                                                        if (isSelected) return;
                                                        hapticsLight();
                                                        props.onAgentChange?.(agent);
                                                    }}
                                                    style={({ pressed, hovered }: any) => ({
                                                        flexDirection: 'row',
                                                        alignItems: 'center',
                                                        paddingHorizontal: 16,
                                                        paddingVertical: 10,
                                                        backgroundColor: pressed || hovered ? theme.colors.floatingOverlay.pressed : 'transparent'
                                                    })}
                                                >
                                                    <View style={{
                                                        width: 16,
                                                        height: 16,
                                                        borderRadius: 8,
                                                        borderWidth: 2,
                                                        borderColor: isSelected ? theme.colors.radio.active : theme.colors.radio.inactive,
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        marginRight: 12
                                                    }}>
                                                        {isSelected && (
                                                            <View style={{
                                                                width: 6,
                                                                height: 6,
                                                                borderRadius: 3,
                                                                backgroundColor: theme.colors.radio.dot
                                                            }} />
                                                        )}
                                                    </View>
                                                    <View style={{ width: AGENT_ICON_SLOT, height: AGENT_ICON_SLOT, alignItems: 'center', justifyContent: 'center', marginRight: 8 }}>
                                                        <Image
                                                            source={agentFlavorIcons[agent]}
                                                            style={{ width: agentIconArtworkSize[agent], height: agentIconArtworkSize[agent] }}
                                                            contentFit="contain"
                                                            tintColor={agent === 'codex' || agent === 'qoder' ? theme.colors.text : undefined}
                                                        />
                                                    </View>
                                                    <View style={{ flexShrink: 1 }}>
                                                        <Text style={{
                                                            fontSize: 14,
                                                            color: isSelected ? theme.colors.radio.active : theme.colors.text,
                                                            ...Typography.default()
                                                        }}>
                                                            {t(`agentInput.agent.${agent}`)}
                                                        </Text>
                                                        <Text style={{
                                                            fontSize: 11,
                                                            color: theme.colors.textSecondary,
                                                            marginTop: 2,
                                                            ...Typography.default()
                                                        }}>
                                                            {t(`agentInput.agent.${agent}Description`)}
                                                        </Text>
                                                    </View>
                                                </Pressable>
                                            );
                                        })}
                                    </ScrollView>}

                                    {/* Permission Mode Section */}
                                    {shownSettingsTab === 'permission' && <ScrollView style={styles.modelListScroll} contentContainerStyle={styles.overlaySection} keyboardShouldPersistTaps="always">
                                        {isQoderPlanning && (
                                            <View style={{
                                                flexDirection: 'row',
                                                alignItems: 'center',
                                                paddingHorizontal: 16,
                                                paddingVertical: 8,
                                            }}>
                                                <MaterialCommunityIcons name="clipboard-text-outline" size={16} color={theme.colors.permission.plan} style={{ marginRight: 12 }} />
                                                <View style={{ flexShrink: 1 }}>
                                                    <Text style={{
                                                        fontSize: 14,
                                                        color: theme.colors.permission.plan,
                                                        ...Typography.default()
                                                    }}>
                                                        {t('agentInput.permissionMode.plan')}
                                                    </Text>
                                                    <Text style={{
                                                        fontSize: 11,
                                                        color: theme.colors.textSecondary,
                                                        marginTop: 2,
                                                        ...Typography.default()
                                                    }}>
                                                        {t('agentInput.qoderPermissionMode.planningDescription')}
                                                    </Text>
                                                </View>
                                            </View>
                                        )}
                                        {permissionModeOptions.map((mode) => {
                                            const config = { label: getPermissionModeLabel(mode), description: permissionModeDescriptions[mode] };
                                            if (!config.label) return null;
                                            const isSelected = props.permissionMode === mode;

                                            return (
                                                <Pressable
                                                    key={mode}
                                                    onPress={() => handleSettingsSelect(mode)}
                                                    style={({ pressed, hovered }: any) => ({
                                                        flexDirection: 'row',
                                                        alignItems: 'center',
                                                        paddingHorizontal: 16,
                                                        paddingVertical: 8,
                                                        backgroundColor: pressed || hovered ? theme.colors.floatingOverlay.pressed : 'transparent'
                                                    })}
                                                >
                                                    <View style={{
                                                        width: 16,
                                                        height: 16,
                                                        borderRadius: 8,
                                                        borderWidth: 2,
                                                        borderColor: isSelected ? theme.colors.radio.active : theme.colors.radio.inactive,
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        marginRight: 12
                                                    }}>
                                                        {isSelected && (
                                                            <View style={{
                                                                width: 6,
                                                                height: 6,
                                                                borderRadius: 3,
                                                                backgroundColor: theme.colors.radio.dot
                                                            }} />
                                                        )}
                                                    </View>
                                                    <View style={{ flexShrink: 1 }}>
                                                        <Text style={{
                                                            fontSize: 14,
                                                            color: isSelected ? theme.colors.radio.active : theme.colors.text,
                                                            ...Typography.default()
                                                        }}>
                                                            {config.label}
                                                        </Text>
                                                        {config.description ? (
                                                            <Text style={{
                                                                fontSize: 11,
                                                                color: theme.colors.textSecondary,
                                                                marginTop: 2,
                                                                ...Typography.default()
                                                            }}>
                                                                {config.description}
                                                            </Text>
                                                        ) : null}
                                                    </View>
                                                </Pressable>
                                            );
                                        })}
                                    </ScrollView>}

                                    {/* Model Section: wide screens scroll the model and effort columns on their own;
                                        narrow ones scroll only the model list, with the effort as a dropdown row below it. */}
                                    {shownSettingsTab === 'model' && <View style={styles.modelSection}>
                                        {isCodex ? (() => {
                                            const hasEffort = codexSelection.family !== 'default';
                                            const reasoningColumn = (
                                                <>
                                                    <Text style={[styles.overlaySectionTitle, styles.modelColumnTitle]}>
                                                        {t('agentInput.model.reasoningEffort')}
                                                    </Text>
                                                    {renderScrollableList(codexReasoningOptions, codexSelection.effort, handleCodexReasoningChange)}
                                                </>
                                            );
                                            const fastModeRow = (
                                                <View style={[styles.fastModeRow, { height: modelFooterRowHeight }]}>
                                                    <Text style={styles.fastModeLabel}>
                                                        {t('agentInput.model.fastMode')}
                                                    </Text>
                                                    <View style={[styles.fastModeSwitchSlot, { height: modelFooterRowHeight }]}>
                                                        <Switch
                                                            value={!!props.fastMode}
                                                            onValueChange={(value) => {
                                                                hapticsLight();
                                                                props.onFastModeChange?.(value);
                                                            }}
                                                        />
                                                    </View>
                                                </View>
                                            );
                                            // Wide screens: effort sits beside the model list. The list keeps its place in the tree
                                            // whether or not the effort column exists, so it is not rebuilt (and its scroll position
                                            // lost) when the picked model changes between having effort and not.
                                            if (isWideModelLayout) {
                                                return (
                                                    <>
                                                        <View style={styles.modelColumns}>
                                                            <View style={styles.modelColumn}>
                                                                {renderScrollableList(codexFamilyOptions, codexSelection.family, handleCodexFamilyChange)}
                                                            </View>
                                                            {hasEffort && <View style={styles.overlayColumnDivider} />}
                                                            {hasEffort && <View style={styles.modelColumn}>{reasoningColumn}</View>}
                                                        </View>
                                                        {hasEffort && <View style={styles.overlayDivider} />}
                                                        {hasEffort && fastModeRow}
                                                    </>
                                                );
                                            }
                                            return (
                                                <>
                                                    {renderScrollableList(codexFamilyOptions, codexSelection.family, handleCodexFamilyChange)}
                                                    {hasEffort && (
                                                        <>
                                                            <View style={styles.overlayDivider} />
                                                            {renderEffortDropdown(codexReasoningOptions, codexSelection.effort, handleCodexReasoningChange)}
                                                            <View style={styles.overlayDivider} />
                                                            {fastModeRow}
                                                        </>
                                                    )}
                                                </>
                                            );
                                        })() : isClaude ? renderModelSettings(
                                            { options: claudeFamilyOptions, selected: claudeSelection.family, onChange: handleClaudeFamilyChange },
                                            claudeSelection.family !== MODEL_MODE_DEFAULT && claudeReasoningOptions.length > 0
                                                ? { options: claudeReasoningOptions, selected: claudeSelection.effort, onChange: handleClaudeReasoningChange }
                                                : null,
                                            claudeContextWindowOptions.length > 0
                                                ? { options: claudeContextWindowOptions, selected: claudeCustomContextWindow ? CUSTOM_CONTEXT_WINDOW : String(claudeContextWindow ?? ''), onChange: handleClaudeContextWindowChange }
                                                : null,
                                            customContextWindowDraft !== null && claudeContextWindowRange ? (() => {
                                                const editorProps = {
                                                    initialValue: customContextWindowDraft,
                                                    range: { min: claudeContextWindowRange.min / 1000, max: claudeContextWindowRange.max / 1000 },
                                                    onSubmit: submitCustomContextWindow,
                                                    onCancel: () => setCustomContextWindowDraft(null),
                                                };
                                                return { full: <ContextWindowEditor {...editorProps} />, inline: <ContextWindowEditor {...editorProps} inline /> };
                                            })() : null,
                                        ) : isQoder ? renderModelSettings(
                                            { options: modelOptions, selected: qoderSelection.model, onChange: handleQoderModelChange },
                                            qoderEffortOptions.length > 0
                                                ? { options: qoderEffortOptions, selected: qoderEffort, onChange: handleQoderEffortChange }
                                                : null,
                                            qoderContextWindowOptions.length > 0 && qoderContextWindow !== null
                                                ? { options: qoderContextWindowOptions, selected: String(qoderContextWindow), onChange: (value: string) => handleQoderContextWindowChange(Number(value)) }
                                                : null,
                                        ) : (
                                            renderScrollableList(modelOptions, selectedModelMode, (v) => props.onModelModeChange?.(v))
                                        )}
                                    </View>}

                                </Animated.View>
                            </FloatingOverlay>
                        </Animated.View>
                    </>
                )}

                {/* Box 1: Context Information (Machine + Path) - Only show if there is any */}
                {hasContextCard && (
                    <AnimatedHeight
                        style={{
                            backgroundColor: theme.colors.surfacePressed,
                            borderRadius: 12,
                            marginHorizontal: panelHorizontalInset,
                            marginBottom: contextCardMarginBottom,
                        }}
                        contentStyle={{ padding: 8, gap: 8 }}
                    >
                        {/* 8pt between the header and the rows under it, 4pt between those rows. */}
                        {props.contextHeader}
                        {(props.machineName !== undefined || !!props.currentPath || !!props.contextFooter) && (
                            <View style={{ gap: 4 }}>
                                {/* Machine chip */}
                                {props.machineName !== undefined && props.onMachineClick && (
                                    <Pressable
                                        onPress={() => {
                                            hapticsLight();
                                            props.onMachineClick?.();
                                        }}
                                        hitSlop={{ top: 5, bottom: 10, left: 0, right: 0 }}
                                        style={(p) => ({
                                            flexDirection: 'row',
                                            alignItems: 'center',
                                            borderRadius: Platform.select({ default: 16, android: 20 }),
                                            paddingHorizontal: 10,
                                            paddingVertical: 6,
                                            height: 32,
                                            opacity: p.pressed ? 0.7 : 1,
                                            gap: 6,
                                        })}
                                    >
                                        <Ionicons
                                            name="desktop-outline"
                                            size={14}
                                            color={theme.colors.textSecondary}
                                        />
                                        <Text style={{
                                            fontSize: 13,
                                            color: theme.colors.text,
                                            fontWeight: '600',
                                            ...Typography.default('semiBold'),
                                        }}>
                                            {props.machineName === null ? t('agentInput.noMachinesAvailable') : props.machineName}
                                        </Text>
                                    </Pressable>
                                )}

                                {/* Path chip */}
                                {props.currentPath && props.onPathClick && (
                                    <Pressable
                                        onPress={() => {
                                            hapticsLight();
                                            props.onPathClick?.();
                                        }}
                                        hitSlop={{ top: 5, bottom: 10, left: 0, right: 0 }}
                                        style={(p) => ({
                                            flexDirection: 'row',
                                            alignItems: 'center',
                                            borderRadius: Platform.select({ default: 16, android: 20 }),
                                            paddingHorizontal: 10,
                                            paddingVertical: 6,
                                            height: 32,
                                            opacity: p.pressed ? 0.7 : 1,
                                            gap: 6,
                                            flexShrink: 1,
                                            minWidth: 0,
                                        })}
                                    >
                                        <Ionicons
                                            name="folder-outline"
                                            size={14}
                                            color={theme.colors.textSecondary}
                                        />
                                        <Text
                                            numberOfLines={1}
                                            style={{
                                                fontSize: 13,
                                                color: theme.colors.text,
                                                fontWeight: '600',
                                                flexShrink: 1,
                                                ...Typography.default('semiBold'),
                                            }}
                                        >
                                            {props.currentPath}
                                        </Text>
                                    </Pressable>
                                )}
                                {/* Path hint (non-clickable) */}
                                {props.currentPath && !props.onPathClick && (
                                    <View
                                        style={{
                                            flexDirection: 'row',
                                            alignItems: 'center',
                                            paddingHorizontal: 10,
                                            paddingVertical: 6,
                                            height: 32,
                                            gap: 6,
                                            flexShrink: 1,
                                            minWidth: 0,
                                        }}
                                    >
                                        <Ionicons
                                            name="folder-outline"
                                            size={14}
                                            color={theme.colors.textSecondary}
                                        />
                                        <Text
                                            numberOfLines={1}
                                            style={{
                                                fontSize: 13,
                                                color: theme.colors.textSecondary,
                                                flexShrink: 1,
                                                ...Typography.default('regular'),
                                            }}
                                        >
                                            {props.currentPath}
                                        </Text>
                                    </View>
                                )}
                                {props.contextFooter}
                            </View>
                        )}
                    </AnimatedHeight>
                )}

                {/* The status row sits right above the input card, as close to it as on iOS, where it is in the card. */}
                <View onLayout={(e) => { inputPanelHeight.value = e.nativeEvent.layout.height; }}>
                {!statusInPanel && statusBar}

                {/* Box 2: Action Area (Input + Send) */}
                <View
                    ref={dropZoneRef}
                    style={[styles.unifiedPanel, statusInPanel && styles.unifiedPanelCompact, { marginHorizontal: panelHorizontalInset }, useGlassPanel && styles.unifiedPanelGlass]}
                >
                    {useGlassPanel && (
                        <GlassView pointerEvents="none" glassEffectStyle="regular" style={[styles.glassBackground, statusInPanel && styles.unifiedPanelCompact]} />
                    )}

                    {statusInPanel && statusBar}
                    {/* Drag overlay */}
                    {isDragging && <View style={styles.dragOverlay} />}

                    {/* Image preview */}
                    {props.images && props.images.length > 0 && props.onImagesChange && (
                        <ImagePreview
                            images={props.images}
                            onRemove={(index) => {
                                const newImages = props.images!.filter((_, i) => i !== index);
                                props.onImagesChange!(newImages);
                            }}
                            disabled={props.isUploadingImages}
                        />
                    )}

                    {props.files && props.onRemoveFile && props.onRetryFile && (
                        <ComposerFiles files={props.files} onRemove={props.onRemoveFile} onRetry={props.onRetryFile} />
                    )}

                    {/* Input field */}
                    <View style={[styles.inputContainer, statusInPanel && styles.inputContainerCompact, props.minHeight ? { minHeight: props.minHeight } : undefined, isInputOverflowing && styles.inputContainerOverflowing]}>
                        <MultiTextInput
                            ref={inputRef}
                            value={props.value}
                            paddingTop={Platform.OS === 'web' ? 10 : statusInPanel ? 6 : 8}
                            paddingBottom={Platform.OS === 'web' ? 10 : statusInPanel ? 2 : 8}
                            onChangeText={handleTextChange}
                            placeholder={props.placeholder}
                            onKeyPress={handleKeyPress}
                            onStateChange={handleInputStateChange}
                            onOverflowChange={setIsInputOverflowing}
                            paddingRight={isInputOverflowing ? EXPAND_BUTTON_TEXT_INSET : undefined}
                            maxHeight={120}
                            animateHeight
                        />
                        {isInputOverflowing && (
                            <Pressable
                                onPress={openExpanded}
                                hitSlop={8}
                                style={(p) => [styles.expandButton, !useGlassPanel && styles.expandButtonFilled, p.pressed && styles.actionButtonPressed]}
                                accessibilityRole="button"
                                accessibilityLabel={t('agentInput.expand')}
                            >
                                <MaterialCommunityIcons name="arrow-expand" size={16} color={theme.colors.textSecondary} />
                            </Pressable>
                        )}
                    </View>
                    <ExpandedComposerModal
                        visible={isExpanded}
                        value={props.value}
                        placeholder={props.placeholder}
                        onChangeText={handleTextChange}
                        onClose={closeExpanded}
                        onSend={(text) => props.onSend(text)}
                        canSend={!props.isSendDisabled && (props.value.trim().length > 0 || hasAttachments || !!props.allowEmptySend)}
                        isSending={props.isSending}
                    />

                    {/* Action buttons below input */}
                    <View style={styles.actionButtonsContainer}>
                        <View style={{ flexDirection: 'column', flex: 1, gap: 2 }}>
                            {/* Row 1: Settings, Profile (FIRST), Agent, Abort, Git Status */}
                            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                                <View style={styles.actionButtonsLeft}>

                                {/* Settings button */}
                                {props.onPermissionModeChange && (
                                    <Pressable
                                        onPress={handleSettingsPress}
                                        hitSlop={{ top: 5, bottom: 10, left: 0, right: 0 }}
                                        style={(p) => ({
                                            flexDirection: 'row',
                                            alignItems: 'center',
                                            borderRadius: Platform.select({ default: 16, android: 20 }),
                                            paddingHorizontal: 8,
                                            paddingVertical: 6,
                                            justifyContent: 'center',
                                            height: 32,
                                            opacity: p.pressed ? 0.7 : 1,
                                        })}
                                    >
                                        <Octicons
                                            name={'gear'}
                                            size={16}
                                            color={theme.colors.button.secondary.tint}
                                        />
                                    </Pressable>
                                )}

                                {/* Agent selector button */}
                                {props.agentType && props.onAgentChange && (
                                    <Pressable
                                        onPress={handleAgentPress}
                                        hitSlop={{ top: 5, bottom: 10, left: 0, right: 0 }}
                                        style={(p) => ({
                                            flexDirection: 'row',
                                            alignItems: 'center',
                                            borderRadius: Platform.select({ default: 16, android: 20 }),
                                            paddingHorizontal: 10,
                                            paddingVertical: 6,
                                            justifyContent: 'center',
                                            height: 32,
                                            opacity: p.pressed ? 0.7 : 1,
                                            gap: 6,
                                        })}
                                    >
                                        {(() => {
                                            const isCodex = props.agentType === 'codex';
                                            const isQoder = props.agentType === 'qoder';
                                            const iconSize = agentIconArtworkSize[props.agentType as keyof typeof agentFlavorIcons] ?? agentIconArtworkSize.claude;
                                            const iconStyle = {
                                                width: iconSize,
                                                height: iconSize,
                                                marginLeft: isCodex ? 2 : (isQoder ? 1 : 0),
                                                marginRight: (isCodex || isQoder) ? 1 : 0,
                                            };
                                            return (
                                                <Image
                                                    source={agentFlavorIcons[props.agentType as keyof typeof agentFlavorIcons] || agentFlavorIcons.claude}
                                                    style={iconStyle}
                                                    contentFit="contain"
                                                    tintColor={isCodex || props.agentType === 'qoder' ? theme.colors.button.secondary.tint : undefined}
                                                />
                                            );
                                        })()}
                                        <Text style={{
                                            fontSize: 13,
                                            color: theme.colors.button.secondary.tint,
                                            fontWeight: '600',
                                            ...Typography.default('semiBold'),
                                        }}>
                                            {props.agentType === 'claude' ? t('agentInput.agent.claude') : props.agentType === 'codex' ? t('agentInput.agent.codex') : props.agentType === 'qoder' ? t('agentInput.agent.qoder') : t('agentInput.agent.gemini')}
                                        </Text>
                                    </Pressable>
                                )}

                                {/* Git Status Badge */}
                                <GitStatusButton sessionId={props.sessionId} onPress={props.onFileViewerPress} onBlank={() => inputRef.current?.focus()} />
                                </View>

                                {/* Attachment button */}
                                {props.onImageButtonPress && (props.imageMenuItems ? (
                                    <NativeMenu
                                        items={props.imageMenuItems}
                                        opensUpward
                                        disabled={props.isUploadingImages}
                                        style={styles.iconButton}
                                        onFallbackOpen={props.onImageButtonPress}
                                    >
                                        <Ionicons name={imageButtonIcon} size={imageButtonIconSize} color={theme.colors.text} />
                                    </NativeMenu>
                                ) : (
                                    <Pressable
                                        onPress={props.supportsImages !== false ? props.onImageButtonPress : () => {
                                            Modal.alert('Not Supported', 'This AI does not support images');
                                        }}
                                        style={[
                                            styles.iconButton,
                                            props.supportsImages === false && styles.iconButtonDisabled
                                        ]}
                                        disabled={props.isUploadingImages}
                                    >
                                        <Ionicons
                                            name={imageButtonIcon}
                                            size={imageButtonIconSize}
                                            color={props.supportsImages !== false ? theme.colors.text : theme.colors.textSecondary}
                                        />
                                    </Pressable>
                                ))}

                                {/* Send/Voice/Stop button - aligned with first row */}
                                <Shaker ref={shakerRef}>
                                <View
                                    style={[
                                        styles.sendButton,
                                        (hasText || hasAttachments || props.isSending || props.allowEmptySend || showStopButton || (props.onMicPress && !props.isMicActive))
                                            ? styles.sendButtonActive
                                            : styles.sendButtonInactive
                                    ]}
                                >
                                    <Pressable
                                        style={(p) => ({
                                            width: '100%',
                                            height: '100%',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            opacity: p.pressed ? 0.7 : 1,
                                        })}
                                        hitSlop={{ top: 5, bottom: 10, left: 0, right: 0 }}
                                        onPress={() => {
                                            if (showStopButton) {
                                                handleAbortPress();
                                                return;
                                            }
                                            const textSnapshot = resolveSendSnapshot();
                                            log.log(`[SEND_DEBUG][INPUT] press hasText=${hasText} latestLen=${latestTextRef.current.trim().length} stateLen=${inputState.text.trim().length} propLen=${props.value.trim().length} pickedLen=${textSnapshot.trim().length} mic=${props.onMicPress ? 'yes' : 'no'} disabled=${props.isSendDisabled || props.isSending ? 'yes' : 'no'}`);
                                            if (textSnapshot.trim() || hasAttachments || props.allowEmptySend) {
                                                hapticsLight();
                                                props.onSend(textSnapshot);
                                                return;
                                            }
                                            if (props.onMicPress) {
                                                hapticsLight();
                                                props.onMicPress();
                                            }
                                        }}
                                        accessibilityState={{
                                            disabled: !!(props.isSending || (!showStopButton && (props.isSendDisabled || (!hasText && !hasAttachments && !props.onMicPress && !props.allowEmptySend)))),
                                        }}
                                        disabled={props.isSending || (!!props.isSendDisabled && !showStopButton)}
                                    >
                                        {props.isSending || isAborting ? (
                                            <ActivityIndicator
                                                size="small"
                                                color={theme.colors.button.primary.tint}
                                            />
                                        ) : (hasText || hasAttachments) ? (
                                            <Octicons
                                                name="arrow-up"
                                                size={16}
                                                color={theme.colors.button.primary.tint}
                                                style={[
                                                    styles.sendButtonIcon,
                                                    { marginTop: Platform.OS === 'web' ? 2 : 0 }
                                                ]}
                                            />
                                        ) : showStopButton ? (
                                            // Armed by the first Escape: the button goes blank
                                            // until the double press lands or the window lapses
                                            isAbortArmed ? null : (
                                                <FontAwesome6
                                                    name="stop"
                                                    size={14}
                                                    color={theme.colors.button.primary.tint}
                                                />
                                            )
                                        ) : props.onMicPress && !props.isMicActive ? (
                                            <Image
                                                source={require('@/assets/images/icon-voice-white.png')}
                                                style={{
                                                    width: 24,
                                                    height: 24,
                                                }}
                                                tintColor={theme.colors.button.primary.tint}
                                            />
                                        ) : (
                                            <Octicons
                                                name="arrow-up"
                                                size={16}
                                                color={theme.colors.button.primary.tint}
                                                style={[
                                                    styles.sendButtonIcon,
                                                    { marginTop: Platform.OS === 'web' ? 2 : 0 },
                                                    theme.dark && !props.allowEmptySend && { opacity: 0.5 },
                                                ]}
                                            />
                                        )}
                                    </Pressable>
                                </View>
                                </Shaker>
                            </View>
                        </View>
                    </View>
                </View>
                </View>
            </View>
        </View>
    );
}));

// Git Status Button Component
function GitStatusButton({ sessionId, onPress, onBlank }: { sessionId?: string, onPress?: () => void, onBlank?: () => void }) {
    const hasLoadedGitStatus = useHasLoadedGitStatus(sessionId || '');
    const styles = stylesheet;
    const { theme } = useUnistyles();

    if (!sessionId || !onPress) {
        return null;
    }

    return (
        <View
            style={{
                flexDirection: 'row',
                alignItems: 'center',
                borderRadius: Platform.select({ default: 16, android: 20 }),
                paddingHorizontal: 8,
                paddingVertical: 6,
                height: 32,
                flex: 1,
                overflow: 'hidden',
            }}
        >
            <Pressable
                style={(p) => ({
                    opacity: p.pressed ? 0.7 : 1,
                })}
                hitSlop={{ top: 5, bottom: 10, left: 0, right: 0 }}
                onPress={() => {
                    hapticsLight();
                    onPress?.();
                }}
            >
                {hasLoadedGitStatus ? (
                    <GitStatusBadge sessionId={sessionId} />
                ) : (
                    <Octicons
                        name="git-branch"
                        size={16}
                        color={theme.colors.button.secondary.tint}
                    />
                )}
            </Pressable>
            <Pressable
                style={{
                    flex: 1
                }}
                hitSlop={{ top: 5, bottom: 10, left: 0, right: 0 }}
                onPress={() => {
                    onBlank?.();
                }}
            >
                <Text>
                    
                </Text>
            </Pressable>
        </View>
    );
}
