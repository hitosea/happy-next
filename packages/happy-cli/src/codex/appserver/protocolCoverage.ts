/**
 * How much of Codex app-server 0.167.1's vocabulary the CLI actually maps.
 *
 * Every name in `protocolVocabulary.ts` must appear in exactly one group below; the coverage test
 * fails otherwise, so a Codex upgrade that adds an item type or notification is a failing test
 * instead of a silent drop in `handleNotification`'s default branch.
 *
 * Keep these lists in sync with the switches in `CodexAppServerBackend` when an entry moves.
 */

/** Item types that produce something in the conversation. */
export const HANDLED_ITEM_TYPES = [
  'userMessage',
  'agentMessage',
  'reasoning',
  'commandExecution',
  'fileChange',
  'mcpToolCall',
  'webSearch',
  'imageView',
  'sleep',
  'enteredReviewMode',
  'exitedReviewMode',
  'contextCompaction',
  'plan',
  'imageGeneration',
] as const;

/** Item types deliberately not surfaced: hook prompt fragments are Codex's own bookkeeping, and
 *  dynamic tools are not hosted (Happy reaches tools through MCP instead). */
export const IGNORED_ITEM_TYPES = [
  'hookPrompt',
  'dynamicToolCall',
] as const;

/** Known gaps, each with a later batch that owns it. */
export const PENDING_ITEM_TYPES = [
  // New in 0.167.1; no captured session yet, so the pairing with its call is unverified.
  'functionCallOutput',
  // Codex multi-agent visibility.
  'collabAgentToolCall',
  'subAgentActivity',
] as const;

/** Notifications that produce something in the conversation. */
export const HANDLED_NOTIFICATIONS = [
  'error',
  'guardianWarning',
  'warning',
  'item/agentMessage/delta',
  'item/commandExecution/outputDelta',
  'item/started',
  'item/completed',
  'item/reasoning/textDelta',
  'item/reasoning/summaryTextDelta',
  'item/reasoning/summaryPartAdded',
  'hook/started',
  'hook/completed',
  'item/autoApprovalReview/completed',
  'autoApprovalReview/strictReviewRequired',
  'thread/closed',
  'thread/compacted',
  'thread/goal/updated',
  'thread/goal/cleared',
  'thread/name/updated',
  'thread/settings/updated',
  'thread/tokenUsage/updated',
  'turn/started',
  'turn/completed',
  'turn/diff/updated',
  'turn/plan/updated',
] as const;

/** Notifications deliberately dropped. Mostly host-side state (account, login, MCP servers, realtime
 *  voice, Windows sandbox, file search) plus the streaming updates the app already gets in full when
 *  the item completes (command output/diff/progress deltas), and notices the CLI only logs. */
export const IGNORED_NOTIFICATIONS = [
  'account/gatewayOAuth/changed',
  'account/login/completed',
  'account/updated',
  'app/list/updated',
  'command/exec/outputDelta',
  'configWarning',
  'deprecationNotice',
  'externalAgentConfig/import/completed',
  'externalAgentConfig/import/progress',
  'fs/changed',
  'fuzzyFileSearch/sessionCompleted',
  'fuzzyFileSearch/sessionUpdated',
  'item/commandExecution/terminalInteraction',
  'item/fileChange/outputDelta',
  'item/fileChange/patchUpdated',
  'item/mcpToolCall/progress',
  'item/plan/delta',
  // The review's start carries no decision; only its completed outcome is surfaced.
  'item/autoApprovalReview/started',
  'mcpServer/event/stream/notification',
  'mcpServer/oauthLogin/completed',
  'mcpServer/startupStatus/updated',
  'model/rerouted',
  'model/safetyBuffering/updated',
  'model/verification',
  'modelProvider/authRecoveryCompleted',
  'modelProvider/authRecoveryStarted',
  'process/exited',
  'process/outputDelta',
  'project/changed',
  'remoteControl/status/changed',
  'serverRequest/resolved',
  'skills/changed',
  'thread/archived',
  'thread/attachment/updated',
  'thread/deleted',
  'thread/environment/connected',
  'thread/environment/disconnected',
  'thread/prediction/updated',
  'thread/project/updated',
  'thread/queue/changed',
  'thread/readState/changed',
  'thread/realtime/closed',
  'thread/realtime/error',
  'thread/realtime/item/completed',
  'thread/realtime/item/started',
  'thread/realtime/item/transcript/delta',
  'thread/realtime/itemAdded',
  'thread/realtime/outputAudio/delta',
  'thread/realtime/sdp',
  'thread/realtime/started',
  'thread/realtime/transcript/delta',
  'thread/realtime/transcript/done',
  'thread/reverted',
  'thread/section/changed',
  'thread/started',
  'thread/status/changed',
  'thread/unarchived',
  'turn/moderationMetadata',
  'windows/worldWritableWarning',
  'windowsSandbox/setupCompleted',
] as const;

/** Known gaps, each with a later batch that owns it. */
export const PENDING_NOTIFICATIONS = [
  // Account-wide usage limit, surfaced as a notice.
  'account/rateLimits/updated',
] as const;
