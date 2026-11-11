/**
 * The names Claude Code puts on the wire, pinned so a gap cannot appear unnoticed.
 *
 * `CLAUDE_SYSTEM_SUBTYPES` is extracted from the installed Claude Code binary
 * (`type:"system",subtype:"…"`, 76 at 2.1.322). The other two lists come from the SDK types and the
 * result subtypes the binary declares. When Claude adds a name, the local check script
 * (`scripts/check-claude-vocabulary.mjs`) reports it and `protocolCoverage` fails to compile until
 * the new name is classified.
 */

export const CLAUDE_MESSAGE_TYPES = [
    'system',
    'assistant',
    'user',
    'result',
    'rate_limit_event',
    'tool_progress',
    'command_lifecycle',
] as const;

export type ClaudeMessageType = typeof CLAUDE_MESSAGE_TYPES[number];

export const CLAUDE_SYSTEM_SUBTYPES = [
    'agents_killed',
    'api_error',
    'api_retry',
    'away_summary',
    'background_tasks_changed',
    'bridge_state',
    'bridge_status',
    'checkpoint_done',
    'cloud_session_delta',
    'cloud_session_status',
    'code_change_published',
    'commands_changed',
    'compact_boundary',
    'control_request_progress',
    'dev_intent',
    'elicitation_complete',
    'feedback_draft_queued',
    'file_attachments_missing',
    'file_snapshot',
    'hook_progress',
    'hook_response',
    'hook_started',
    'informational',
    'inherited_asks_settled',
    'init',
    'instruction_size_warning',
    'local_command',
    'memory_recall',
    'memory_saved',
    'mirror_error',
    'model_consent_fallback',
    'model_fallback',
    'model_refusal_fallback',
    'model_refusal_no_fallback',
    'notification',
    'peer_message_hold',
    'permission_check_status',
    'permission_denied',
    'permission_retry',
    'per_turn_effort_changed',
    'placed',
    'plugin_install',
    'post_turn_summary',
    'rewind_stand_in',
    'scheduled_task_fire',
    'session_metadata',
    'session_state_changed',
    'session_title_changed',
    'session_writes_lost',
    'start_folder',
    'status',
    'stop_hook_summary',
    'task_notification',
    'task_progress',
    'task_started',
    'task_summary',
    'task_updated',
    'thinking_tokens',
    'tool_host_result',
    'turn_began_before_init',
    'turn_duration',
    'turn_handoff_available',
    'turn_preempted',
    'turn_starting',
    'ui_focus',
    'ui_invalidate',
    'ui_log',
    'ui_notify',
    'ui_notify_cancel',
    'ui_panes',
    'ui_placed',
    'ui_scroll',
    'ui_status',
    'ui_toast',
    'vcs_state_changed',
    'worker_shutting_down',
] as const;

export type ClaudeSystemSubtype = typeof CLAUDE_SYSTEM_SUBTYPES[number];

export const CLAUDE_RESULT_SUBTYPES = [
    'success',
    'error_max_turns',
    'error_during_execution',
    'error_max_budget_usd',
    'error_max_structured_output_retries',
] as const;

export type ClaudeResultSubtype = typeof CLAUDE_RESULT_SUBTYPES[number];

/**
 * Happy's own system records: the CLI writes them where Claude only exposes something as a `result`
 * (which is not part of the conversation log), so they are not in the binary-extracted list.
 */
export const HAPPY_SYSTEM_SUBTYPES = [
    'happy_notice',
] as const;

export type HappySystemSubtype = typeof HAPPY_SYSTEM_SUBTYPES[number];
