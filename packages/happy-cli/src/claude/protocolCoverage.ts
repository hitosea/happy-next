import type {
    ClaudeMessageType,
    ClaudeResultSubtype,
    ClaudeSystemSubtype,
    HappySystemSubtype,
} from './protocolVocabulary';

/**
 * What Happy does with each name Claude Code can send. One bucket, and only one, per name:
 *
 * - `shown` — it reaches the conversation (a message, a card update, or a header field).
 * - `ignored` — deliberately dropped: host/TUI bookkeeping, or a category we decided not to show.
 * - `pending` — a known gap. Not a promise to fix; the list exists so a gap is a decision, not an
 *   oversight.
 */
export type CoverageBucket = 'shown' | 'ignored' | 'pending';

export type Coverage = {
    bucket: CoverageBucket;
    note?: string;
};

export const CLAUDE_MESSAGE_TYPE_COVERAGE: Record<ClaudeMessageType, Coverage> = {
    system: { bucket: 'shown', note: 'Notices and card updates below are read from its subtypes.' },
    assistant: { bucket: 'shown' },
    user: { bucket: 'shown' },
    result: { bucket: 'shown', note: 'Errors and the turn-limit notice.' },
    rate_limit_event: { bucket: 'shown', note: 'Rejected resets the limit row; allowed_warning adds one.' },
    tool_progress: { bucket: 'pending', note: 'Fails schema validation, so the whole record is dropped with a warning.' },
    command_lifecycle: { bucket: 'ignored', note: 'TUI command state; nothing in the conversation.' },
};

export const CLAUDE_SYSTEM_SUBTYPE_COVERAGE: Record<ClaudeSystemSubtype, Coverage> = {
    agents_killed: { bucket: 'shown', note: 'One-line notice.' },
    api_error: { bucket: 'shown', note: 'First retry of a burst; the rest are silent.' },
    api_retry: { bucket: 'pending', note: 'Declared by the binary but never seen on the wire; api_error covers observed retries.' },
    away_summary: { bucket: 'ignored', note: 'Away-mode bookkeeping.' },
    background_tasks_changed: { bucket: 'ignored', note: 'Task-store bookkeeping; task_progress carries what to show.' },
    bridge_state: { bucket: 'ignored' },
    bridge_status: { bucket: 'ignored' },
    checkpoint_done: { bucket: 'ignored' },
    cloud_session_delta: { bucket: 'ignored' },
    cloud_session_status: { bucket: 'ignored' },
    code_change_published: { bucket: 'ignored' },
    commands_changed: { bucket: 'ignored', note: 'Autocomplete refresh; deliberately not refreshed live.' },
    compact_boundary: { bucket: 'shown', note: 'Anchors the compaction summary; the usage bar resets on it.' },
    control_request_progress: { bucket: 'ignored' },
    dev_intent: { bucket: 'ignored' },
    elicitation_complete: { bucket: 'pending', note: 'MCP elicitation flow; no UI yet.' },
    feedback_draft_queued: { bucket: 'ignored' },
    file_attachments_missing: { bucket: 'pending', note: 'Would explain a prompt that lost its files.' },
    file_snapshot: { bucket: 'ignored' },
    hook_progress: { bucket: 'ignored', note: 'Hook display deliberately left out.' },
    hook_response: { bucket: 'ignored', note: 'Hook display deliberately left out.' },
    hook_started: { bucket: 'ignored', note: 'Hook display deliberately left out.' },
    informational: { bucket: 'shown', note: 'One-line notice; the usage-limit wording is left to its own row.' },
    inherited_asks_settled: { bucket: 'ignored' },
    init: { bucket: 'shown', note: 'Model, tools and slash commands.' },
    instruction_size_warning: { bucket: 'shown', note: 'One-line notice.' },
    local_command: { bucket: 'pending', note: 'Slash-command output; only the user-text copy of it is hidden today.' },
    memory_recall: { bucket: 'ignored' },
    memory_saved: { bucket: 'ignored' },
    mirror_error: { bucket: 'ignored' },
    model_consent_fallback: { bucket: 'shown', note: 'One-line notice.' },
    model_fallback: { bucket: 'shown', note: 'One-line notice.' },
    model_refusal_fallback: { bucket: 'shown', note: 'One-line notice.' },
    model_refusal_no_fallback: { bucket: 'shown', note: 'One-line notice.' },
    notification: { bucket: 'pending', note: 'Generic host notification; unknown text source.' },
    peer_message_hold: { bucket: 'ignored' },
    permission_check_status: { bucket: 'ignored' },
    permission_denied: { bucket: 'shown', note: 'Only with a reason the tool result does not carry.' },
    permission_retry: { bucket: 'ignored', note: 'Permission-flow bookkeeping.' },
    per_turn_effort_changed: { bucket: 'ignored' },
    placed: { bucket: 'ignored' },
    plugin_install: { bucket: 'ignored' },
    post_turn_summary: { bucket: 'ignored', note: 'Prompt suggestions; not in the conversation.' },
    rewind_stand_in: { bucket: 'ignored' },
    scheduled_task_fire: { bucket: 'ignored' },
    session_metadata: { bucket: 'ignored' },
    session_state_changed: { bucket: 'ignored' },
    session_title_changed: { bucket: 'shown', note: 'Updates the session title; no row of its own.' },
    session_writes_lost: { bucket: 'pending', note: 'Could explain missing transcript records.' },
    start_folder: { bucket: 'ignored' },
    status: { bucket: 'shown', note: 'Compacting state.' },
    stop_hook_summary: { bucket: 'ignored' },
    task_notification: { bucket: 'shown', note: 'Closes or fails the Task/Bash card that started the task.' },
    task_progress: { bucket: 'shown', note: 'Refreshes the Task card description.' },
    task_started: { bucket: 'shown', note: 'The card already exists; nothing new to draw.' },
    task_summary: { bucket: 'ignored' },
    task_updated: { bucket: 'ignored', note: 'task_notification carries the final state.' },
    thinking_tokens: { bucket: 'ignored' },
    tool_host_result: { bucket: 'ignored' },
    turn_began_before_init: { bucket: 'ignored' },
    turn_duration: { bucket: 'ignored' },
    turn_handoff_available: { bucket: 'ignored' },
    turn_preempted: { bucket: 'ignored' },
    turn_starting: { bucket: 'ignored' },
    ui_focus: { bucket: 'ignored', note: 'Host UI channel.' },
    ui_invalidate: { bucket: 'ignored', note: 'Host UI channel.' },
    ui_log: { bucket: 'ignored', note: 'Host UI channel.' },
    ui_notify: { bucket: 'ignored', note: 'Host UI channel.' },
    ui_notify_cancel: { bucket: 'ignored', note: 'Host UI channel.' },
    ui_panes: { bucket: 'ignored', note: 'Host UI channel.' },
    ui_placed: { bucket: 'ignored', note: 'Host UI channel.' },
    ui_scroll: { bucket: 'ignored', note: 'Host UI channel.' },
    ui_status: { bucket: 'ignored', note: 'Host UI channel.' },
    ui_toast: { bucket: 'ignored', note: 'Host UI channel.' },
    vcs_state_changed: { bucket: 'ignored' },
    worker_shutting_down: { bucket: 'ignored' },
};

export const CLAUDE_RESULT_SUBTYPE_COVERAGE: Record<ClaudeResultSubtype, Coverage> = {
    success: { bucket: 'shown' },
    error_max_turns: { bucket: 'shown', note: 'One-line notice, written by the CLI.' },
    error_during_execution: { bucket: 'shown', note: 'One-line error notice.' },
    error_max_budget_usd: { bucket: 'pending', note: 'Budget stop; no notice yet.' },
    error_max_structured_output_retries: { bucket: 'pending', note: 'Structured-output stop; no notice yet.' },
};

export const HAPPY_SYSTEM_SUBTYPE_COVERAGE: Record<HappySystemSubtype, Coverage> = {
    happy_notice: { bucket: 'shown', note: 'The CLI writes a notice Claude only exposes as a result.' },
};
