# Changes from Happy → Happy Next

[🇨🇳 中文](changes-from-happy.zh-CN.md)

This document summarizes what changed in Happy Next compared to the original Happy.

## TL;DR

| Area | What changed |
|---|---|
| Desktop apps | Direct-download macOS 12+ Universal and Windows x64/ARM64 clients with native windows, tray residency, notifications, shortcuts, diagnostics, and signed automatic updates |
| Orchestrator | Multi-agent DAG task scheduling with per-task model, working directory, real-time monitoring, execution history, and linked run navigation |
| Pending queue | Server-side message queue with auto-dispatch, queue panel UI, send-now, plus edit and pause/draft of queued messages |
| Multi-agent | Claude Code, Codex, and Gemini are all first-class agents |
| Voice | Volcano (Doubao) real-time voice gateway with streaming speech, native iOS voice calls, selectable timbre/speech rate, E2E-encrypted settings sync, plus streaming read-aloud (TTS) of AI replies with a global playback queue and floating player |
| Workspaces | Multi-repo worktree creation, switching, archiving, and PR flows |
| Code browser | File browser, Monaco editor, commit history, git stage/commit/discard, image preview |
| Session sharing | Direct invite and public link sharing with E2E encryption and access control |
| DooTask | Task list, detail, real-time chat, one-click AI session launch, globalized WebSocket |
| Self-hosting | One-command `docker-compose` stack with separate origins |
| Server discovery | API/voice service discovery plus fastest-default endpoint racing when no custom server is configured |
| Sync | v3 messages API, HTTP outbox, server-confirmed sends, race condition fixes |
| Chat UX | Image attachment, pagination, blue dot, compact view, session search, quick actions, Codex-skill autocomplete, pull-to-refresh, offline-cache minimap navigation, virtualized web conversation list with instant centered jumps, context usage tooltip, resizable web sidebar |
| Session mgmt | Per-machine session tabs, device and agent filters, hot-upgrade, metadata caching, smart new-session machine defaults, consistent header navigation |
| Bug fixes | 255+ fixes across message sending, sessions, rendering, navigation, security |
| Performance | Payload trimming, lazy-load diffs, rendering optimization, incremental session catch-up on open |
| CLI | Daemon auto-start, Codex fast mode, receipt tracking, self-upgrade |
| MCP tools | `preview_html`, colon-separated tool naming, dual-mode long-press copy |
| OpenClaw | External AI machine gateway with tunnel/direct connections and chat UI |
| Profiles | AI backend profiles with presets for DeepSeek, Z.AI, OpenAI, Azure, Google AI |
| Rebrand | CLI published as `happy-next-cli`, binary remains `happy` |

---

## Desktop Apps

Happy Next now ships as a native-feeling desktop client instead of requiring a browser tab.

- **Cross-platform distribution**: macOS 12+ Universal, Windows x64, and Windows ARM64 installers are published directly through GitHub Releases
- **Native window lifecycle**: authentication-aware sizing, state restoration, refined fullscreen/title-bar interactions, multi-monitor bounds protection, theme-correct startup with a native startup logo, macOS title-bar integration, an integrated Windows title bar, and reliable custom drag regions
- **Resident experience**: close to tray, explicit Quit, single-instance activation, optional launch at sign-in, and a global show/hide shortcut
- **Notifications and unread state**: clean plain-text native notifications reliably restore the app and open the associated Session, hidden windows return to the foreground, and unified unread state appears on the Dock or Windows taskbar
- **Desktop controls**: native application menus plus search, navigation, new-session, inbox, DooTask, and settings shortcuts
- **Signed updates**: updater payloads are cryptographically verified, downloaded quietly in the background, and installed only after the user clicks the in-app Update button
- **Diagnostics and recovery**: sanitized desktop diagnostics, rotating local logs, WebKit storage maintenance, upload timeouts and retry handling, and preserved composer content after failures
- **Security and media**: restricted Tauri capabilities, hardened CSP and navigation boundaries, native context menus, reliable theme-isolated HTML preview child windows, CSP-compatible code editing, system-browser external links, and explicit microphone/camera support
- **Platform visuals**: refreshed logos, favicons, splash screens, notification assets, and independent macOS and Windows icons, including the macOS 26 layered icon format and compatibility fallback for older macOS versions

## Orchestrator

A multi-agent orchestration system that lets you define task dependency graphs and execute them automatically.

- **DAG-based task scheduling**: define tasks with dependencies, Happy resolves execution order and schedules them across agents
- **Per-task model and working directory**: each task can target a specific model and directory
- **Auto-approve flags**: configure automatic approval for orchestrated tasks
- **Session resume for follow-up**: send follow-up messages to completed tasks via session resume
- **Available models API**: `get_context` exposes available models per provider
- **Real-time monitoring**: activity badge counting running and queued tasks, status-colored progress bars
- **Full app UI**: run list with filter tabs and run counts, run detail page, and task detail page with clearer execution history
- **Linked run navigation**: streamlined movement between run screens, with Orchestrator messages linking directly to their corresponding runs
- **Cancel with cascade**: cancelling a run cascades `dependency_failed` to dependent tasks
- **MCP tool integration**: orchestrator tools registered as MCP tools with auto-filled working directory
- **Tool description rewriting**: orchestrator rewrites tool descriptions for better agent comprehension
- **Complete i18n**: all orchestrator UI fully internationalized
- **CLI auto-install**: the Happy CLI installs the orchestrator skill and `/orchestrator` slash commands on startup, so you can fan a task out to parallel or dependency-ordered Claude / Codex / Gemini agents straight from the CLI
- **`/preview-html` built-in command**: a built-in CLI slash command that generates a self-contained HTML document and previews it directly in the app

## Pending Message Queue

Messages sent while the CLI is busy are now queued and delivered automatically.

- **Server-side pending queue**: messages are queued per-session on the server
- **Auto-dispatch**: queued messages are dispatched to the CLI when it becomes ready
- **Queue panel UI**: view and manage pending messages from the app
- **Image count badge**: pending message preview shows image attachment count
- **Send-now option**: bypass queue and send immediately
- **Edit & pause/draft**: edit a queued message before it sends, or pause it / save it as a draft instead of dispatching
- **Reconnect sync**: queue state syncs on WebSocket reconnection
- **Concurrent safety**: hardened dispatch concurrency and cleanup semantics, with dispatch timing tuned (3s) to avoid dropping a queued message on a busy CLI
- **Persistent message cache**: session messages are stored locally so reopening a conversation can show existing history faster

## Multi-Agent Support

The original Happy only supported Claude Code. Happy Next treats Claude Code, Codex, and Gemini as equal first-class agents.

- **Multi-agent history page** with per-provider tabs (Claude / Codex / Gemini)
- **Session resume and duplicate/fork** for all three agents
- **`/duplicate` slash command**: opens a message picker to fork a session from any point in the conversation — including directly from an AI reply — creating a new session with history up to the selected message and reliably resolving the corresponding user-message target
- **Per-agent model selection** cached independently, with context window display
- **Claude Opus 4.8** added to the model catalog
- **Claude Fable 5** added to the model catalog, with 1M-context variant and low / medium / high / xhigh / max reasoning effort presets
- **Claude Opus 5 and Claude Sonnet 5** added with 1M context, current reasoning-effort presets, fast-mode capability detection, and updated cost tracking
- **Refreshed Gemini catalog** adds Gemini 3.6 Flash and Gemini 3.5 Flash-Lite alongside Gemini 3.1 Pro and Gemini 3.5 Flash
- **Streamlined model picker**: Claude 1M-context variants collapse into a single toggle (7 models instead of 12); reasoning-effort presets show side by side on wide screens and Claude defaults to High effort
- **Codex v0.145.0**: bundled Codex CLI updated with a refreshed model catalog
- **Cost tracking** with accurate token usage for Claude models (cache tokens, reasoning tokens)
- **Codex reasoning effort** configuration (low / medium / high / xhigh)
- **ACP (Agent Client Protocol) backend**: JSON-RPC agent protocol (originally introduced for Codex to replace the MCP client approach, now used for Gemini)
- **Codex App-Server backend**: Codex's primary backend, using the `codex app-server` JSON-RPC protocol over stdin/stdout for improved session management and reliability
- **Gemini session persistence** with JSONL storage
- **Per-provider slash commands**: `/clear` for all agents, `/compact` Claude-only
- **Model/mode switching** per session with live metadata sync
- **Codex/Gemini diff processing**: per-file +N/-N statistics displayed in app
- **Message backfill** for Codex and Gemini when resuming/duplicating sessions
- **ACP result format normalization**: Gemini ACP results normalized to match Codex structure
- **Tool ID prefix fallback**: fallback matching for tool IDs with different prefixes
- **Codex v2 protocol fixes**: field-level incompatibilities resolved for v2 protocol
- **Dynamic permission mode**: permission mode changes via RPC during active sessions
- **Codex context restore**: `/duplicate` restores context using `thread/resume` with path
- **Tool name normalization**: `normalizeToolName` aligns MCP tool names with Codex convention

## Voice Assistant (Happy Voice)

Happy Next includes a complete voice gateway stack built on the Volcano (火山引擎 / Doubao) real-time gateway, which replaced the earlier LiveKit / Cartesia stack.

- **Short-lived token auth**: voice gateway authentication now uses short-lived tokens for improved security
- **Volcano (Doubao) real-time gateway** (`happy-voice`) driving speech-to-text, LLM, and text-to-speech through Volcano RTC AIGC + a custom-LLM bridge
- **Native in-call voice on iOS**: streaming text-to-speech during a live call, connection state gated on room-state changes, and the microphone guarded while the call is active
- **Selectable voice timbre and speech rate**, with multilingual replies defaulting to the seed-tts-2.0 voice
- **LLM text cleaning before speech** tuned for latency: trivial short text skips cleaning, in-call announcements are localized (i18n framings), capped token budget
- **Voice settings sync** across devices via end-to-end-encrypted user settings
- **Microphone mute** in voice conversations (Happy Voice)
- **Voice tools**: refreshed session-management tools (start / switch / message a session) with a single session-settings `mode` parameter, clearer titles, hardened parameters, and an auto-close countdown on the session-picker cancel button
- **Voice message send confirmation** with configurable countdown
- **"Thinking" indicator** in voice status bar
- **Context-aware voice**: full app state (sessions, git status, etc.) injected as structured context
- **Volcano ASR silence/VAD tuning** via the `VOLC_ASR_SILENCE_MS` environment variable
- **Speech fragment merging** for interrupted user turns
- **Configurable welcome message** from app settings
- **System prompt engineering**: English prompts, semantic XML separation, inline LLM hints
- **Read-aloud for AI replies**: a voice button in the message footer synthesizes a message's text (using the message-playback Volcano TTS, `VOLC_TTS_*`) with **true streaming TTS** — audio is played as it is synthesized, so playback starts sooner and no longer dies mid-message or silently drops the tail. A **global read-aloud queue** with a **draggable floating player** lets you line up messages and control playback from anywhere, and a **v2 text-cleanup prompt with a digest mode** condenses long messages for smoother narration

## Multi-Repo Worktree Workspaces

A major new capability: manage multiple repositories as a unified workspace.

- **Create workspaces** with multiple repos from the new session wizard
- **RepoPickerBar** and **RepoSelector** components for workspace creation and switching
- **Per-repo settings**: branch selection (local + remote), scripts, configuration
- **Git status aggregation** across all workspace repos
- **Auto-generate workspace `CLAUDE.md` and `AGENTS.md`** with `@import` references
- **Workspace lifecycle management**: metadata tracking, git operations, archive/cleanup via daemon RPC
- **Worktree merge and PR creation** with target branch selection
- **AI-powered PR code review**: one-click launch of an AI session to review a PR, results posted as a GitHub PR comment
- **Path display** with `~/` notation instead of absolute paths

## Code Browser & Git Management

The app now includes a full code browsing and git management experience.

- **File browser** with directory navigation and search (current directory filter + project-wide)
- **File viewer** with Monaco editor (readonly mode for viewing, edit mode for changes)
- **Commit history** with branch selector (local and remote branches)
- **Commit detail page** with diff viewing and action buttons (copy hash, copy message)
- **Git changes page**: stage, unstage, commit, and discard changes
- **Per-file diff statistics** (+N/-N lines) for Claude Code, Codex, and Gemini sessions
- **Clickable file path links** in markdown with editor reveal position
- **Staged file diff display** with accurate line count
- **Base64 decoding** fixed for UTF-8 (CJK characters)
- **Image preview** with sharing support in the file viewer
- **Upstream-tip marker** in the commits list to highlight the commit that matches the upstream branch tip
- **Breadcrumb path copy**: copy the current browser breadcrumb path directly from the navigation bar
- **Bulk git action feedback**: loading indicator shown while bulk git operations run
- **Git status file focus**: opening Files from git status focuses the relevant changed files

## Session Sharing

Share AI coding sessions with others through direct invites or public links, with full end-to-end encryption.

- **Direct sharing** with NaCl Box end-to-end encryption via uploaded content public keys
- **Public link sharing** with token-derived key encryption
- **Access levels**: view-only, edit, and admin permissions with server-side enforcement
- **Real-time sync**: messages, git status, and voice chat broadcast to all shared users via socket events
- **"All / Shared with me / Shared by me" filter tabs** in session list
- **Share indicator** on sessions shared with others
- **Sharer avatar** and **sender name** display in shared sessions
- **Public share web viewer** for link-based access without the app, with paginated message loading so long shared conversations open faster
- **Sharing list refresh**: the Shared by me list updates after sharing changes, and machine tabs stay visible when shared sessions are present
- **Shared sessions on user profile** page
- **Permission-aware UI**: input bar, voice button, and session actions adapt to access level
- **Server-side access control** module with permission validation for messages, RPC calls, and voice
- **Access logging** for public share views

## OpenClaw Integration

Connect to external AI machines through a gateway system with its own chat interface.

- **Machine management**: add, edit, and remove OpenClaw machines from the app
- **Two connection modes**: Happy relay (tunnel through the Happy server) or direct WebSocket gateway
- **Ed25519 key exchange** for secure machine pairing
- **Chat interface** with real-time streaming AI responses, message retry, and typing indicators
- **Session management**: create, browse, and resume OpenClaw sessions
- **Server-side CRUD API** with encrypted metadata and optimistic concurrency
- **CLI tunnel manager** for relay connections

## AI Backend Profiles

Configure alternative LLM backends for Claude Code through environment variable profiles.

- **Built-in provider presets**: Anthropic (default), DeepSeek, Z.AI, OpenAI, Azure OpenAI, Google AI
- **Environment variable mapping**: automatically maps provider-specific env vars (e.g. `DEEPSEEK_*` → `ANTHROPIC_*`)
- **Custom profiles**: create profiles with arbitrary environment variables and `${VAR:-default}` expansion
- **Per-profile settings**: tmux session name, startup scripts, default permission mode, agent type compatibility
- **Profile editor**: full-page settings UI for creating and editing profiles

## DooTask Integration

Deep integration with DooTask project management, from browsing tasks to launching AI sessions.

- **Task list page** with filters (project, status, priority), search, and pagination
- **Task detail page** with HTML content rendering, status workflows, assignees, files, sub-tasks, tags
- **Real-time WebSocket chat** with Slack-style layout and avatars
- **Chat features**: emoji reactions, voice message playback, image/video messages, file cards
- **Optimistic UI** for message sending with HTTP/WebSocket race
- **One-click AI session launch** from task detail (with MCP server passthrough)
- **External context linking**: sessions launched from DooTask show a context banner and are linked back
- **DooTask connection page** with login, captcha support, and field caching
- **Task status management**: clickable status badges with workflow transitions
- **DooTask tab** in main navigation with connected account management
- **Create tasks and projects** directly from the app with dedicated form pages
- **Cross-platform date picker** (`react-native-ui-datepicker`) with bottom sheet confirm
- **Form caching** for task/project creation across navigation
- **Globalized WebSocket connection**: single persistent connection with real-time task updates
- **Related task in session info**: session info page shows the linked DooTask task
- **Persistent connection**: DooTask connection saved to server via UserKVStore
- **Simple status badge**: tasks without workflow show a simple status badge

## Self-Hosting

Happy Next adds a first-class self-hosting path.

- **Root `docker-compose.yml`** with all services: Web app (Nginx), API server, Voice gateway, Postgres, Redis, MinIO
- **Custom server shortcut**: a quick-access button in desktop settings to configure a custom server
- **Service discovery**: API and voice config endpoints are now discoverable automatically
- **Fast default endpoint selection**: when no custom server or env override is configured, the app races the official API config endpoints and uses the fastest successful response
- **Separate origins architecture**: Web, API, and Voice each use different ports/domains (no path reverse proxy)
- **`.env.example`** as the single source of truth for all configuration
- **Runtime env var injection** in Dockerfile/entrypoint for Docker builds
- **`APP_URL`** configuration for connect flows
- **`VOICE_TOOL_BRIDGE_BASE_URL`** for voice-to-server communication in Docker networks
- **Self-host documentation**: `docs/self-host.md`
- **`/healthz` endpoint** served directly by nginx for load-balancer and uptime probes (no app round-trip)

## Sync & Messaging Reliability

Major reliability improvements to the real-time sync layer.

- **v3 messages API** with seq-based sync, batch writes, and cursor pagination
- **HTTP outbox** for reliable message delivery when WebSocket is unavailable
- **Server-confirmed message sending** with retry on failure
- **Fixes**: cursor skip on first push, outbox concurrent flush race, message duplication, seq gap message loss, syncing cursor reset, outbox drain on close, out-of-order completed-permission synthesis
- **Message loss prevention** when CLI is offline
- **Message receipt tracking**: CLI confirms message receipt with legacy compatibility
- **happy-wire** shared protocol types package to deduplicate schemas across CLI/app/server
- **Session loading reliability**: message-fetch timeout raised from 20s to 60s, sessions stuck in permanent load failure now recover, refresh indicator stays visible across the entire retry loop and on user-opened incremental loads, and base64 encoding is chunked so very large message payloads no longer trigger a stack overflow when restoring sessions

## Chat & Session UX

Extensive improvements to the chat and session management experience.

- **Image attachment** in new session wizard and during chat
- **Image paste from clipboard** on web
- **Message pagination** for loading older messages
- **Unread blue dot indicator** when tasks complete (synced across devices via metadata)
- **Compact session list view**
- **Session search** in history page
- **Session rename** with lock to prevent AI auto-update
- **Session quick actions** in session info for common session tasks
- **Session preview** on history page
- **`/duplicate` command** in chat input to fork a session from any message, including directly from an AI reply (with DuplicateSheet picker)
- **Optimistic send status**: an immediate "Processing…" status after sending, plus a "refreshing" indicator while the message list reloads
- **Slash-command autocomplete** shows each command's source scope (repo / user / plugin / system) and kind, including installed Codex skills; session capabilities are stored separately from metadata and sync live (atomic CAS write + socket broadcast) so command and skill lists stay fresh
- **Per-message action bar**: copy, fork-from-here (with progress spinner), read-aloud (TTS), and full timestamp on web hover / native tap
- **Options**: click-to-send and long-press-to-fill
- **Context menu** improvements (web backdrop blur, mobile action sheets)
- **Scroll-to-bottom button**
- **Markdown rendering**: tables with horizontal scroll, inline code in headers, nested code fences, inline markdown in table cells
- **Permission mode**: live updates, privileged/YOLO mode distinction, per-agent caching
- **QR scanner** migrated from expo-camera to vision-camera
- **Toast notifications** replacing modal alerts for lightweight feedback
- **Pull-to-refresh** for session list and inbox
- **Inset dividers** for cleaner list layouts
- **Agent tool display** with robot icon in known tools list
- **Tool input/output** formatted as key-value pairs instead of raw JSON
- **AskUserQuestion** "Other" custom input option with markdown preview
- **In-memory SWR cache** and search for agent session history
- **Real-time friend request updates** via socket events
- **Swipe-to-delete** for feed notifications
- **Friend search** with flat layout, GitHub connect prompt for users without username
- **Conversation minimap**: a minimap panel for jumping to any part of a long conversation at a glance, now populated from the offline message cache so the overview is available even before messages finish loading or while offline
- **Virtualized web conversation list**: the web chat list is rebuilt as a model-driven virtualized list — jumping to a message centers instantly (with a subtle shake when you're already there) and history loads on demand as you scroll; scrolling is stabilized so gestures don't jump, scroll-to-bottom lands on the true bottom, and a proxy scrollbar replaces the distorted native one for an honest scroll position
- **Context usage tooltip**: hover the context indicator to see a token-count breakdown
- **Resizable web sidebar**: drag the sidebar edge to adjust its width
- **Smart session defaults**: new session creation automatically picks the best available machine
- **Per-machine session tabs**: the active/inactive split is replaced by per-machine tabs that group sessions by the machine they run on, so multi-machine setups are easier to navigate; each tab carries a stable status dot — orange when a session on that machine needs permission, reflecting the live thinking state — while the aggregate 'all' tab stays dot-free
- **Collapsible project folders**: related sessions are grouped into folders that can be collapsed, with folder state retained locally
- **Device and agent filter dropdowns**: filter session history by machine and agent type
- **Session preview expand/collapse**: expand messages inline with increased preview limit
- **Metadata caching**: session listing performance improved via metadata cache
- **CLI hot-upgrade**: upgrade the CLI version mid-session without restart
- **Per-agent permission mode**: permission mode stored and restored per agent type
- **Shared-by-me filter**: filter sessions that you shared with others
- **Image support in drafts**: attach images to message drafts
- **`preview_html` tool**: full-page HTML preview tool for rendering HTML content, with supported tool messages opening previews directly
- **Codex plan progress**: in-progress plan steps remain visible while a session is running
- **Dual-mode long-press copy**: long-press to copy in tool detail views (text or JSON)
- **Colon-separated tool naming**: support MCP tool names with colons (`server:tool`)
- **Tool input as display name**: use tool input title for MCP tool display name
- **Unified session header**: left-aligned title across iOS / Android / web, new-session button on the header right, header title in the session info screen, and a dedicated OpenClaw session info sheet
- **Consistent header navigation**: back buttons and header actions align consistently across session and machine screens
- **Narrow-phone header**: title left-aligns instead of center-overflowing on narrow phones; back icon fixed in dark-theme landscape
- **Short-screen empty state**: simplified layout keeps the empty conversation state usable on short displays
- **Initial web message layout**: the first chat message no longer gets clipped when the virtualized list opens
- **Long user messages**: messages over ~20k characters collapse to a preview with a Show More toggle
- **Web text selection**: text selection inside chat messages on web fixed
- **Action bar stability**: per-message action bar no longer flickers when the message flips between thinking and streaming states
- **Session draft as single source of truth**: rewritten to eliminate drafts vanishing or reappearing
- **Generic 'other' tool block**: unrecognized tool calls render with a dynamic title and icon instead of an empty placeholder
- **Agent event ANSI strip**: agent event messages strip ANSI escape codes from child-CLI stderr so subprocess banner color sequences no longer leak into the chat as raw `[90m…[0m`

## CLI Improvements

The CLI (`happy-next-cli`) received substantial upgrades.

- **Multi-agent support**: Claude Code, Codex (via App-Server backend), and Gemini as first-class agents
- **Session resume/duplicate** for all agents with proper message backfill
- **Multi-repo worktree** workspace creation/cleanup via daemon RPC
- **Diff processing**: per-file +N/-N statistics for all agents
- **Payload optimization**: trim redundant fields, lazy-load diffs on demand
- **MCP config centralization** with per-agent adapter pattern (Claude HTTP, Codex stdio, Gemini HTTP)
- **Worktree detection** using native git instead of hardcoded path matching
- **Accurate cost calculation** for Claude models
- **Shell command injection fix** with unified escaping
- **Settings persistence**: "don't ask again" for tool approvals saved to `settings.local.json`
- **Session title management**: `change_title` tool with lock support
- **CI**: smoke tests, happy-wire build dependency
- **`happy update`** self-upgrade command
- **`happy --version`** displays Claude, Codex, and Gemini CLI versions
- **Worktree subdirectory detection** in workspace root
- **Latest CLI version** fetched from npm instead of hardcoded minimum
- **Daemon auto-start on boot**: `happy daemon enable` / `happy daemon disable`
- **Daemon restart command**: restart the daemon without manual kill
- **Codex v0.145.0 with fast mode**: upgraded Codex with fast mode support
- **Attribution setting**: new setting to control commit attribution, default off
- **Unified system prompt injection**: shared prompt injection for Codex and Gemini
- **Orchestrator guidance**: first-turn prompts include orchestrator usage guidance
- **Refined Orchestrator skill discovery**: skill installation and discovery behave consistently across Codex homes and sessions
- **Cleaner file search results**: ripgrep diagnostics stay out of returned file matches
- **Delegated completion notifications**: completion pushes are gated on delegated activity so notifications reflect the actual run state
- **`set_permission_mode` forwarding**: permission-mode switches from the app are forwarded synchronously to the active Claude subprocess via the stream-json `set_permission_mode` control request, instead of taking effect only on the next user message
- **Graceful interrupts**: Stop / ESC / "send pending message" no longer SIGTERM the Claude subprocess and Codex `app-server`. The graceful path awaits `interrupt()` / `cancel()` and, when acked, keeps the backend alive; the loop reuses the warm process for the next message instead of cold-restarting (MCP reload, session resume from disk). The hard kill is kept as a fallback when the ack times out and for switch / exit. As part of this, `AgentBackend.cancel()` now returns boolean (acked vs failed/timed-out); the Codex ACP `turn/interrupt` ack timeout is aligned to Claude's 3s; and Codex always emits a `[Request interrupted by user]` marker on interrupt, even mid-stream
- **Gemini interrupt marker alignment**: Gemini's abort feedback now sends `[Request interrupted by user]` as a gemini agent message — the same marker bubble Claude and Codex use — instead of the centered "Aborted by user" status event, so the interrupt UX is consistent across all three providers
- **Hot-swap model & plan mode**: switching the model or toggling plan mode no longer cold-restarts the Claude subprocess. When only the model or permission/plan mode changes on an already-warm process, the change is applied in place via the stream-json control channel, so it takes effect instantly mid-session instead of paying a session-resume restart
- **Remote→local stdin cleanup**: switching a session from remote back to local now cleans up terminal stdin, so leftover raw-mode input no longer leaks into the terminal
- **Skill metadata and plugin discovery**: multiline skill metadata parses correctly, and enabled Codex plugin skills are discovered consistently

## Server

- **v3 messages API** with batch seq allocation and cursor pagination
- **GitHub OAuth** backward-compatible alias (`GITHUB_REDIRECT_URL` / `GITHUB_REDIRECT_URI`)
- **Usage metrics** merged incrementally instead of overwriting
- **S3 region/path normalization** for broader compatibility
- **Message loss prevention** when CLI is offline
- **Session sharing API**: direct sharing routes, public share routes, content key upload, access control
- **Socket events** for session sharing (real-time broadcast to shared users)
- **Public share access logging**
- **Session pending queue API**: server-side message queue with auto-dispatch
- **Session spawning endpoint**: HTTP endpoint for external session creation

## UI & Polish

- **Brand refresh**: refreshed Happy Next logos, favicons, splash screens, notification assets, and mobile/desktop icons
- **Adaptive themes**: system-theme changes apply reliably across the app and desktop authentication windows
- **iOS polish and permissions**: action menus remain stable while the keyboard is visible, the scanner permission explanation proceeds directly to the iOS system request, and the unused motion permission is removed
- **Dark mode** fixes throughout (text contrast, chips, status badges, input fields)
- **i18n**: Chinese Simplified/Traditional system locale declaration, CJK input height handling, internationalized pickers
- **Keyboard handling**: content follows keyboard smoothly, no jitter
- **Loading states**: skeleton screens, inline indicators, timeout feedback
- **Navigation**: static route fix for dynamic `[id]` matching, reset on login/logout
- **Header alignment**: unified back buttons and aligned header actions across session and machine screens
- **Image handling**: compression, MIME preservation, gallery viewer with zoom/gestures
- **Status bar**: expanded model/permission display, auto-collapse timeout, mobile mic button

## Bug Fixes & Stability

Over 255 bug fixes landed. The following are grouped by area.

### Message Sending
- Fix stale text state causing double-tap send and ghost resend (use ref-based text snapshot)
- Preserve `localId` on retry to prevent duplicate sends
- Enforce 800ms minimum interval between sends
- Fix input not clearing when WebSocket push beats send-ack
- Return failure on send timeout instead of assuming success
- Fix AskUserQuestion options submitting duplicate messages
- Harden message send on flaky networks
- Suppress draft restore while a send is in flight
- Stop the sessions list cache from resurrecting drafts you've already sent

### Unread Blue Dot Indicator
- Fix blue dot not showing for offline sessions
- Fix flickering when task completes while user is viewing the session
- Persist `lastViewedAt` to survive process kill
- Refresh on app resume from background
- Use timestamp comparison instead of complex clearing logic
- Sync dismissal across devices via metadata
- Fix tablet sidebar dot not updating (Zustand re-render trigger)

### Session Lifecycle
- Fix session flicker race condition during archive (optimistic update)
- Fix duplicate session numbering (use incremental counters)
- Fix Claude session resume path inconsistency
- Prevent session title overwrite by directory name on resume
- Fix Codex session ID collision after fork/restart (extract from filename)
- Fix newly created session briefly showing "deleted" status
- Fix copy/resume navigation causing detail page to freeze
- Open sessions via incremental catch-up instead of a full re-bootstrap (faster open on large sessions)
- Preserve late tool results that arrive after a task is marked complete

### Orchestrator
- Clear stale activity badges when stored run state is refreshed
- Keep completion notifications tied to real delegated activity

### Codex & Gemini Agents
- Correct Codex token usage field mapping for accurate statistics
- Preserve reasoning effort when not explicitly changed
- Prevent keepalive race during Codex session archive
- Fix Gemini MCP tool registration failure
- Fix Codex icon invisible in dark mode
- Fix sub-agent messages overwriting session model metadata

### Markdown Rendering
- Fix table horizontal scroll and row height measurement
- Fix empty table cells causing column loss
- Fix nested code fences being truncated early
- Fix inline code in headers rendering too small
- Support inline markdown in table cells
- Fix table inline code line height stretching cells
- Lock row height after all columns are measured to eliminate jitter

### Voice
- Fix provider switching causing navigation stack reset
- Fix `getLatestAssistantReply` tool schema causing OpenAI 400 errors
- Unify voice language setting across providers
- Report "cancelled" instead of "sent" when user cancels message
- Allow closing voice session from error state
- Align language-search box height on Android; center the language-search header with a max-width layout
- Default the agent TTS resource to seed-tts-2.0 for multilingual voices
- Escape double quotes in tool name XML attributes

### DooTask
- Fix WebSocket pending message cleanup (FIFO order, error-state cleanup)
- Fix optimistic UI edge cases (HTTP/WS race)
- Fix invisible self-sent markdown messages
- Fix status badge layout shift during loading
- Fix due date highlighting for completed tasks
- Fix infinite re-render and web input polish
- Fix image extraction (DOM-based instead of regex)
- Fix member avatars and layout in create task form
- Fix date validation, clearDootaskData reset in create sheets
- Fix paginated column response in create task sheet

### Worktree
- Fix metadata race condition (pass via spawn params instead of async write)
- Add path-pattern fallback for worktree detection (not just metadata flag)
- Fix archive flow and align swipe options
- Fix branch selector disappearing on repo re-click

### Navigation & Routing
- Fix static routes matched by dynamic `[id]` on native
- Fix double title bar after session resume
- Reset navigation stack on login/logout
- Fix keyboard content jitter on new session page
- Unify navigation back buttons and align header actions across session and machine screens
- Prevent the initial web chat message from being clipped

### Security
- Fix shell command injection in CLI command assembly (unified escaping)
- Require user approval for ExitPlanMode in bypass-permissions mode
- Preserve privileged mode after plan approval (prevent regression to default)

### Sharing
- Fix shared session unable to display git status data
- Fix shared session unable to save drafts, switch model and permission mode
- Fix 10s delay when sending messages in shared sessions
- Fix shared session name display and online status sync
- Fix public share page owner display and message ordering
- Fix divider display in sharing dialogs
- Remove backoff retry from sharing API, fix 403 log spam
- Allow shared users to make RPC calls to session CLI
- Restrict session info actions by access level
- Hide input and voice button for view-only shared users

### Performance
- Optimize `applySessions` to avoid redundant re-renders when state unchanged
- Trim Codex/Gemini payloads before sending to mobile (remove large tool results)
- Lazy-load diffs: CLI persists to storage, app fetches on file-name click
- Pace per-session WebSocket updates to avoid autoscroll race
- Lock table row height measurement to eliminate measuring jitter
- Enable `removeClippedSubviews` for session list FlatList
- Git status retry no longer infinite; resets on session focus

## Repo Hygiene

- `LICENSE` (MIT), `SECURITY.md`, `SUPPORT.md`, `CONTRIBUTING.md` added
- GitHub Issue and PR templates
- Documentation refreshed
- `happy-wire` shared types package
- TypeScript upgraded across the monorepo
- Subscription/RevenueCat system removed
