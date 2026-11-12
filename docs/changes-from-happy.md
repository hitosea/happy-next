# Changes from Happy → Happy Next

[🇨🇳 中文](changes-from-happy.zh-CN.md)

This document summarizes what changed in Happy Next compared to the original Happy.

## TL;DR

| Area | What changed |
|---|---|
| Desktop apps | Direct-download macOS 12+ Universal and Windows x64/ARM64 clients with native windows, tray residency, notifications, shortcuts, diagnostics, and signed automatic updates |
| Apple Watch | Permission notifications you can act on, a watch app with your sessions, messages and dictated or quick replies, and a complication counting the sessions that need you |
| Orchestrator | Multi-agent DAG task scheduling with per-task model, working directory, real-time monitoring, execution history, and linked run navigation |
| Pending queue | Server-side message queue with auto-dispatch, queue panel UI, send-now, plus edit and pause/draft of queued messages |
| Multi-agent | Claude Code, Codex, Gemini, and Qoder are all first-class agents |
| GitHub | Connected repositories, issue and pull request workflows, comments, and linked AI sessions |
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
| Rebrand | CLI published as `happy-next-cli`, binary remains `happy` |

---

## Desktop Apps

Happy Next now ships as a native-feeling desktop client instead of requiring a browser tab.

- **Cross-platform distribution**: macOS 12+ Universal, Windows x64, and Windows ARM64 installers are published directly through GitHub Releases
- **macOS home navigation**: click the sidebar title to return to the session home screen
- **Native window lifecycle**: authentication-aware sizing, state restoration, refined fullscreen/title-bar interactions, multi-monitor bounds protection, theme-correct startup with a native startup logo, macOS title-bar integration with stable traffic-light placement and a refined sidebar header, an integrated Windows title bar whose logo returns to Sessions, and reliable custom drag regions
- **Resident experience**: close to tray, explicit Quit, single-instance activation, optional launch at sign-in, and a global show/hide shortcut
- **Notifications and unread state**: clean plain-text native notifications use consistent app icons, reliably restore the app and open the associated Session, return hidden windows to the foreground, and expose unified unread state on the Dock or Windows taskbar
- **Desktop controls**: native application menus plus search, navigation, new-session, inbox, DooTask, and settings shortcuts
- **Signed updates**: update checks repeat periodically and when the app regains focus, updater payloads are cryptographically verified and downloaded quietly in the background, and installation begins only after the user clicks the in-app Update button
- **Diagnostics and recovery**: sanitized desktop diagnostics, rotating local logs, WebKit storage maintenance, upload timeouts and retry handling, and preserved composer content after failures
- **Security and media**: restricted Tauri capabilities, hardened CSP and navigation boundaries, native context menus, reliable theme-isolated HTML preview child windows, CSP-compatible code editing, system-browser external links, and explicit microphone/camera support
- **Platform visuals**: refreshed logos, favicons, splash screens, notification assets, and independent macOS and Windows icons, including the macOS 26 layered icon format and compatibility fallback for older macOS versions

- **Terminal windows**: a terminal opens in a window of its own with a tab bar, titled by the directory the shell is in
- **Direct local terminals**: terminals on this computer are reached directly through the local daemon rather than the server — typing is immediate, an open terminal keeps working while the server is down, and it falls back to the server when the daemon can't be reached; a tab's tooltip adds "(direct)" when connected directly
- **Compact macOS title bar**: the macOS title bar is a compact toolbar

## Apple Watch

- **Actionable notifications**: allow, allow for this session, deny, stop or reply straight from a permission notification on iPhone or the watch
- **Watch app**: sessions in the app's order with their avatars and pinned ones first; a session opens on its latest messages with earlier ones a tap away, and you reply by dictation or a quick reply; stopping a task asks first
- **Complication**: a watch face complication counts the sessions waiting for approval and those working

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
- **CLI auto-install**: the Happy CLI installs the orchestrator skill and `/orchestrator` slash commands on startup, so you can fan a task out to parallel or dependency-ordered Claude / Codex / Gemini / Qoder agents straight from the CLI
- **`/preview-html` built-in command**: a built-in CLI slash command that generates a self-contained HTML document and previews it directly in the app
- **Run and task durations**: runs and tasks show how long they take, counting up while running
- **Simplified run filters**: All, Active, Completed, Failed and Cancelled, which add up to All
- **Final-message results**: a task's result is just the agent's final message, and running tasks can be followed live
- **Follow-ups report to the sender**: a resumed task reports back to the session that sent the follow-up, and the run is listed in both sessions
- **`orchestrator_exec`**: run shell commands on one or every online machine; long output is saved on the machine
- **Encrypted tasks**: a task's title, prompt, command, working directory and target machines are end-to-end encrypted, so the server never sees them, and tasks only go to machines whose CLI can open them
- **`orchestrator_transfer`**: copy files and directories between machines — send from this one, fetch to it, or relay between two others — streamed end-to-end encrypted
- **Run search and filters**: search runs by title and filter them by status, agent and machine, each run showing its agent's icon
- **Selectable text**: text on the orchestrator pages can be selected and copied on web and desktop
- **Conversation run filter**: opened from a conversation, the run filter lists only the machines and executor kinds its runs used
- **Run timeline**: runs, tasks and attempts hang off one continuous rail with status dots — filled for running and done, rings for queued and cancelled — instead of separate cards

## Pending Message Queue

Messages sent while the CLI is busy are now queued and delivered automatically.

- **Server-side pending queue**: messages are queued per-session on the server
- **Auto-dispatch**: queued messages are dispatched to the CLI when it becomes ready
- **Queue panel UI**: view and manage pending messages from the app
- **Image count badge**: pending message preview shows image attachment count
- **Send-now option**: bypass queue and send immediately
- **Edit & pause/draft**: edit a queued message before it sends, or pause it / save it as a draft instead of dispatching
- **Reconnect sync**: queue state syncs on WebSocket reconnection
- **Concurrent safety**: hardened dispatch concurrency and cleanup semantics, and the next queued message goes out as soon as the turn ends
- **Steer into the running turn**: a queued message can be sent into the running turn without interrupting it (Claude, Codex and Qoder), next to "send now (interrupt)"; it waits as "waiting to be read" until the agent takes it in
- **Floating queue**: the queue is a floating stack above the composer — a capsule when collapsed, cards when expanded, a per-message menu with icons, and details in a bottom sheet
- **Scheduled messages**: schedule a message to send later from the composer's add menu — in 30 minutes, in an hour, after the usage limit resets, or at a time you pick
- **Persistent message cache**: session messages are stored locally so reopening a conversation can show existing history faster

## Multi-Agent Support

The original Happy only supported Claude Code. Happy Next treats Claude Code, Codex, Gemini, and Qoder as equal first-class agents.

- **Multi-agent history page** with per-provider tabs (Claude / Codex / Gemini / Qoder)
- **Session resume and duplicate/fork** for all four agents
- **Codex archive synchronization**: archive actions update native Codex history, keep archived state consistent in the app, and support restoring archived sessions when continuing work
- **Reliable Codex forks**: improved duplication and forking with clear active-session conflict errors
- **`/duplicate` slash command**: opens a message picker to fork a session from any point in the conversation — including directly from an AI reply — creating a new session with history up to the selected message and reliably resolving the corresponding user-message target
- **Per-agent model selection** cached independently, with context window display
- **Claude Opus 4.8** added to the model catalog
- **Claude Fable 5.1 and Fable 5** added to the model catalog, with 1M context and low / medium / high / xhigh / max reasoning effort presets
- **Claude Opus 5 and Claude Sonnet 5** added with 1M context, current reasoning-effort presets, fast-mode capability detection, and updated cost tracking
- **Refreshed Gemini catalog** adds Gemini 3.8 Flash alongside the existing Gemini models
- **Remote model catalog**: models are served by the server, so new ones show up without an app update — now with Claude Opus 5.5, Claude Sonnet 5.5, GPT-6.1-Sol, GPT-6-Sol, and GPT-6-Luna
- **Explained settings**: the settings popover explains each permission mode and AI vendor, and model descriptions follow the app language, including Simplified and Traditional Chinese
- **Codex "Approve for Me"**: Codex's approval mode routes approvals to Codex's own reviewer, and orchestrator tools that act — running commands, sending messages, transferring files, cancelling tasks — ask for permission under every agent
- **Streamlined model picker**: one entry per Claude model at its full context window; reasoning-effort presets show side by side on wide screens and Claude defaults to High effort
- **Context window choice**: pick the window a Claude or Qoder session runs with — 200K, 1M or a custom size — when creating a session or in model settings; Claude Fable 5.2 joins the model list
- **Claude context window**: the context bar follows the window Claude Code actually uses, and Qoder and Gemini sessions show context usage
- **Qoder over ACP**: the account's models and reasoning efforts, Qoder's permission modes, and its plan mode shown apart from them
- **Shell command rules**: "don't ask again" on a shell command picks which programs or subcommands it covers, for all four agents
- **GPT-6 Astra and GPT-5.6 catalog support**: current model families include their reasoning-effort and context settings
- **Codex v0.155.1**: bundled Codex CLI updated with current App-Server interaction support
- **Cost tracking** with accurate token usage for Claude models (cache tokens, reasoning tokens)
- **Codex reasoning effort** configuration (low / medium / high / xhigh)
- **ACP (Agent Client Protocol) backend**: JSON-RPC agent protocol (originally introduced for Codex to replace the MCP client approach, now used for Gemini)
- **Codex App-Server backend**: Codex's primary backend, using the `codex app-server` JSON-RPC protocol over stdin/stdout for improved session management and reliability
- **Codex interactive requests**: app-native questions support choices, custom Other values, free-form text, and masked sensitive answers; current command and permission approval requests are also handled
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
- **Codex quota warnings**: a usage window that passes 90% warns once and re-arms below 80%, while a reached quota, exhausted credits or a spent control limit each report once with the reset time
- **Codex output that was being dropped**: a generated image becomes a step whose preview opens, a finished plan becomes the turn's answer when the reply did not repeat it, hook runs fold into steps named by their event, and a refused or high-risk "Approve for me" decision reports its action and reason
- **Codex session metadata and notices**: Codex's own title and `/model` switches reach the session metadata (a pinned title still wins), warnings appear as notices, `/review` gets start and end markers, and a sleep shows as a timed step
- **Qoder plans as steps**: the plan Qoder reports appears as TodoWrite steps, one per changed snapshot
- **Claude notices**: information, retry attempts, refusals and model fallbacks, permission denials with their reason, oversized rule files and killed agents appear as one-line notices, and rate-limit warnings report once per window
- **Claude Task card and title**: the Task card follows progress without restarting its clock and closes when the task ends, Claude's own title reaches session metadata unless you pinned one, the history list uses Claude's titles, and running out of turns ends with a notice

## GitHub Integration
- **Repository navigation**: browse connected repositories and navigate directly to GitHub-backed work from the app

- **Connected repositories**: connect your GitHub account and browse repositories, issues, and pull requests
- **Issue and pull request workflows**: create, comment on, close, and reopen work items from the app
- **Linked AI sessions**: start a session with issue or pull request context, then return to associated sessions from the detail page
- **Octicons and cached lists**: GitHub lists use Octicons, and the repository list is cached locally so returning to it is instant
- **Cached list totals**: list totals are cached with a spinner while they refresh
- **Scroll to bottom in comments**: issue and pull request comments get a scroll-to-bottom button

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
- **Secure previews and downloads**: preview supported images and files safely, and download files up to 100 MiB

The app now includes a full code browsing and git management experience.

- **File browser** with directory navigation and search (current directory filter + project-wide)
- **File viewer** with Monaco editor (readonly mode for viewing, edit mode for changes)
- **Commit history** with branch selector (local and remote branches)
- **Commit detail page** with diff viewing and action buttons (copy hash, copy message)
- **Git changes page**: stage, unstage, commit, and discard changes
- **Per-file diff statistics** (+N/-N lines) for Claude Code, Codex, and Gemini sessions
- **Clickable file path links** in markdown with editor reveal position
- **Staged file diff display** with accurate line count
- **Readable long paths**: long paths in the file list are shortened in the middle, so their start and end stay readable
- **Base64 decoding** fixed for UTF-8 (CJK characters)
- **Image preview** with sharing support in the file viewer
- **Upstream-tip marker** in the commits list to highlight the commit that matches the upstream branch tip
- **Breadcrumb path copy**: copy the current browser breadcrumb path directly from the navigation bar
- **Bulk git action feedback**: loading indicator shown while bulk git operations run
- **Git status file focus**: opening Files from git status focuses the relevant changed files
- **Steady folder picker**: the folder picker holds still when going into or out of a folder, with a back button beside home

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
- **Shared-session image uploads**: recipients of a session shared with them can upload chat images

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
- **Simplified DooTask sign-in** with Happy Next device identification and connection sync across devices
- **Task status management**: clickable status badges with workflow transitions
- **DooTask tab** in main navigation with connected account management
- **Create tasks and projects** directly from the app with dedicated form pages
- **Cross-platform date picker** (`react-native-ui-datepicker`) with bottom sheet confirm
- **Form caching** for task/project creation across navigation
- **Globalized WebSocket connection**: single persistent connection with real-time task updates
- **Related task in session info**: session info page shows the linked DooTask task
- **Persistent connection**: DooTask connection saved to server via UserKVStore
- **Simple status badge**: tasks without workflow show a simple status badge
- **Centered empty chats**: the empty state stays centered consistently when a chat has no messages
- **Cached task list**: the task list is cached per filter and refreshed in the background
- **Chat image gallery**: tap any image in a chat to browse every image in it
- **Select-copy**: messages offer select-copy, and copy takes a long message's full text
- **Person card**: a one-to-one chat's details show the other person's avatar, online status, title, department and email

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
- **Automatic migrations**: the server image runs database migrations on container start; set `SKIP_DB_MIGRATIONS=true` to opt out

## Sync & Messaging Reliability

Major reliability improvements to the real-time sync layer.

- **v3 messages API** with seq-based sync, batch writes, and cursor pagination
- **HTTP outbox** for reliable message delivery when WebSocket is unavailable
- **Server-confirmed message sending** with retry on failure
- **Fixes**: cursor skip on first push, outbox concurrent flush race, message duplication, seq gap message loss, syncing cursor reset, outbox drain on close, out-of-order completed-permission synthesis
- **Account-safe push tokens**: a device token belongs to only the active account and is cleaned up reliably during logout
- **DooPush mobile notifications**: push registration cleanup when switching accounts or signing out
- **Message loss prevention** when CLI is offline
- **Message receipt tracking**: CLI confirms message receipt with legacy compatibility
- **happy-wire** shared protocol types package to deduplicate schemas across CLI/app/server
- **Session loading reliability**: message-fetch timeout raised from 20s to 60s, sessions stuck in permanent load failure now recover, refresh indicator stays visible across the entire retry loop and on user-opened incremental loads, and base64 encoding is chunked so very large message payloads no longer trigger a stack overflow when restoring sessions
- **Updates between releases**: the app picks up updates between store releases from Happy's server, checking at launch and each time it returns to the foreground; once one is downloaded, the inbox offers to restart into it from any screen

## Chat & Session UX

Extensive improvements to the chat and session management experience.

- **Image attachment** in the new-session wizard and during chat, including desktop drag-and-drop with a clear drop indicator; multi-image previews remain on the selected image
- **Image paste from clipboard** on web
- **Any file by drop or paste** on web: files that are not images (or images the AI cannot see) are attached as files
- **Message pagination** for loading older messages
- **Unread blue dot indicator** when tasks complete (synced across devices via metadata)
- **Compact session list view**
- **Session search** in history page
- **Session rename** with lock to prevent AI auto-update
- **Session quick actions** in session info for common session tasks
- **Session color markers**: assign or clear one of seven colors from session menus for quick visual organization across session lists
- **Session preview** on history page
- **`/duplicate` command** in chat input to fork a session from any message, including directly from an AI reply (with DuplicateSheet picker)
- **Optimistic send status**: an immediate "Processing…" status after sending, plus a "refreshing" indicator while the message list reloads
- **Slash-command autocomplete** shows each command's source scope (repo / user / plugin / system) and kind, including installed Codex skills; after selecting a root command, suggestions stay limited to its matching subcommands instead of mixing skills into free-form arguments; session capabilities are stored separately from metadata and sync live (atomic CAS write + socket broadcast) so command and skill lists stay fresh
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
- **AskUserQuestion** supports choices, custom "Other" values, free-form text, masked sensitive answers, and markdown preview
- **In-memory SWR cache** and search for agent session history
- **Real-time friend request updates** via socket events
- **Inbox menus**: a long press or right-click deletes an update, and accepts, denies or withdraws a friend request or removes a friend; the person's page menu has the same actions
- **Friend search** with flat layout, GitHub connect prompt for users without username
- **Conversation minimap**: a minimap panel for jumping to any part of a long conversation at a glance, now populated from the offline message cache so the overview is available even before messages finish loading or while offline
- **Virtualized web conversation list**: the web chat list is rebuilt as a model-driven virtualized list — jumping to a message centers instantly (with a subtle shake when you're already there) and history loads on demand as you scroll; scrolling is stabilized so gestures don't jump, scroll-to-bottom lands on the true bottom, and a proxy scrollbar replaces the distorted native one for an honest scroll position
- **Context usage tooltip**: hover the context indicator to see a token-count breakdown
- **Resizable web sidebar**: drag the sidebar edge to adjust its width
- **Smart session defaults**: new session creation automatically picks the best available machine
- **Per-machine session tabs**: the active/inactive split is replaced by per-machine tabs that group sessions by the machine they run on, so multi-machine setups are easier to navigate; each tab carries a stable status dot — orange when a session on that machine needs permission, reflecting the live thinking state — while the aggregate 'all' tab stays dot-free
- **Collapsible project folders**: related sessions are grouped into folders that can be collapsed, with folder state retained locally
- **Project header action**: desktop project headers can start a new session directly
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
- **Unified session header**: left-aligned title across iOS / Android / web, new-session button on the header right, header title in the session info screen
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
- **iOS modal reliability**: image viewing waits for the keyboard to dismiss, and the duplicate-session sheet no longer leaves a white overlay when opened with the keyboard visible
- **Session context menu actions**: rename a session, or mark it read or unread, from the session menu (web right-click, native long-press); the acting row carries a ring and a wash so the menu's target stays unambiguous
- **Clean iOS long-press menus**: menus on sessions and files no longer leave a blank row or a black block behind, a file's menu no longer opens the file as it appears, and the lifted row has rounded corners
- **Chat header menu**: a long press on either of the chat header's buttons opens a menu — session details, delegations, the session's CLI upgrade, a new session here or elsewhere, a terminal and archiving
- **Session color marker as an edge bar**: the marker is a 4dp bar down the row's leading edge, shared by the flat compact list, the grouped rows, and the session cards, so a column of markers can be scanned and an unmarked row reserves no space
- **Every session state marked in the compact list**: the compact row is a single line with no status text, so `syncing` and `awaiting` — the two states that mean the session is working — no longer fall through to a blank spacer, and a disconnected session gets a hollow ring rather than sharing the idle grey fill
- **Compact list view per platform**: `compactSessionViewDesktop` (default on) and `compactSessionViewMobile` (default off) let the denser desktop list and the mobile list keep their own setting; the legacy flag migrates to the desktop setting as-is, including an explicit "off"
- **Assistant turn timing**: each assistant turn carries a status line above its first row — counting up while the turn runs, reading as a duration once it settles, with the exact start and end on hover (web) or tap (native); a reply from before the app was open still shows its duration
- **Minimap landmarks**: AskUserQuestion calls and HTML previews are landmarks on the conversation rail with a hover preview, and post-compaction summaries are kept off the rail so they cannot swamp the real prompts around them
- **AskUserQuestion drafts**: in-progress answers — ticks and typed "Other" text — survive scrolling the row out of the window, a stream of new messages, and a message-syncing reload, and are aged out after 7 days
- **File-reading tool image previews**: images opened by file-reading tools render as previews
- **`preview_html` from a file path**: the tool takes `filePath` as an alternative to an inline document — the CLI reads the file on the machine that owns it and folds the contents into the tool call args, so previews survive offline, archived, and shared sessions
- **New session requires ownership**: "Start a session in this directory" is no longer offered from a session shared with you, on the context menu, the directory header, the session info screen, or the session header
- **Thinking rows hidden**: thinking and image placeholder rows are hidden, and "show thinking messages" now defaults to off for new users
- **Minimap beyond the cache**: the conversation minimap reaches prompts and questions the device never paged in — senders stamp a landmark on each record before it is encrypted, the server answers a walk over just those rows, and the app paints local landmarks first, then walks older ones. Hovering the rail opens a card listing every landmark, hovering a row previews it in full, and clicking jumps without closing the card
- **Thinking stays off the server**: when the device that opened a turn hides thinking, the CLI drops thinking-only records before they are buffered or encrypted, saving bandwidth and CPU
- **Small fixes**: a usage-limit reset names its timezone as UTC+8 instead of a glued GMT offset, and the navigation scroll edge stays soft on iOS 27

- **Turn folding**: a long turn's tool calls, their output and the notes between them fold into one line reading how long the turn took and how many tool calls it hid; tapping opens it, and while the turn runs the line names the newest hidden step under a band of light travelling across it. A running turn folds from its first hidden row, while a settled one keeps the threshold — a rule about reading a turn, not about watching one work
- **Compaction summary collapse**: a post-compaction summary — a machine record of what the context window dropped, not something anyone typed — collapses to a single tap-to-view line however short it is, opening in the text-selection screen's rendered and as-authored tabs
- **Landmark rail on touch**: the minimap rail is summoned by a swipe in from the right edge, the finger slides over a fixed window of marks while a card previews the mark under it, and release jumps. Web and touch light the same mark from one rule, so a question, an HTML preview or a compaction summary can no longer leave the rail dark or light the wrong mark
- **Composer abort**: the standalone abort button is gone — the round button becomes a stop button while the agent is busy and there is nothing to send — and Escape aborts on a double press within 1.5s
- **Session menu**: reveal a local session's folder in Finder, or in Explorer on Windows, matched against the ids the local CLI is registered under rather than a hostname guess; the nine-item menu is split into three sections — the session, where it runs, and leaving it behind
- **Plan proposal shape**: a plan proposal renders folded at the shape of a proposal rather than as a generic tool block — marked on the landmark rail, kept out of the turn's fold, and submitted as the request it is
- **Permission steps stay out of the fold**: a step waiting on a permission is never folded away, so the question stays where it can be answered
- **Fold line holds its place**: the fold line keeps the position it was tapped at on web and native alike, instead of snapping when the page settles around it

- **Docked glass composer**: on iOS a glass composer floats over every chat screen, docked to the keyboard, so new messages, short chats, and empty states stay in step as it opens and closes
- **LegendList message list**: the native message list scrolls more smoothly, follows new messages to the end even in bursts, and starts short chats at the top
- **Read state and presence**: an open session is no longer marked read while the window is unfocused or idle, and archived sessions stay offline

- **Machine-scoped session list**: a machine rail beside the list on tablets and desktop and a machine switcher sheet on phones; shared sessions fold into their own sections, and machines can be reordered by dragging in Settings
- **Project naming**: projects are named by their directory, with the machine or parent directory added only where two projects would read the same; a setting brings back full paths
- **Folding in runs**: a turn's steps fold in runs between the agent's words, so narration, questions and permissions stay on screen, and folded lines show running delegated tasks
- **Scrolling and timing**: long-running tool times read as mm:ss and HH:mm:ss, the web minimap sits at the right edge, and the web chat list no longer jumps while scrolling
- **Text selection format**: the selection preview opens as code, JSON or markdown to match the source, with a switch to plain text
- **Web history preview**: select text, scroll smoothly and see timestamps in the session history preview
- **Built-in command descriptions**: Claude's built-in slash commands show their descriptions
- **Header status color**: the connection status under the header title keeps its color on Android and the web

- **File attachments**: attach files to a message from the add menu; the agent reads them on the session's machine, and they show as cards with typed, colored file icons that open in the file viewer
- **Pinned sessions**: pin sessions to the top of the list, including in the shared-with-me and shared-by-me views
- **Session hover card**: hover a session on web to rename it, find its project in the list, pin it or archive it
- **Flat session list**: projects lie on the background, each machine in the all machines view heads its sessions with a pinned band, rows are inset and rounded, a session marked with a colour is tinted with it, and the selected one gets a bar at the list's edge
- **Menus instead of swipes**: session rows no longer swipe; archive and delete stay in the long-press and right-click menu
- **Jump to sessions that want a look**: double-tap the sessions tab, or tap the shown machine on the rail
- **Whole replies**: copy, read aloud and long-press take a reply split across several blocks as one whole
- **Translated wizard**: the new session wizard and the remaining English strings follow the app language
- **Machine avatars**: give a machine a preset avatar (12 glyphs on 8 colors), shown wherever the machine appears
- **Sidebar machine reordering**: reorder machines by dragging in the sidebar, from the rail's right-click menu; Escape takes back a drag, or the whole reordering
- **Machine right-click menu and idle hiding**: right-click a machine for new session, open terminal and details, and hide idle machines from the rail and the switcher
- **Machine page**: reordered rows with icons, a terminal in the machine's home directory, and recent sessions that link to that machine's full session history

- **Qoder agent**: Qoder CLI is a fourth agent (`happy qoder`), with its account's models and reasoning efforts, permission modes and plan mode, session history, resume, forks and `/duplicate`, image input and context usage
- **Command palette search**: search every machine's message history, with hits grouped by session, a search history, and command tiles when idle
- **Terminal panel**: a terminal panel docks along the bottom of the app on web and desktop, holding every shell under whatever page is open
- **Terminal tab order**: on iOS, terminal tabs can be dragged along the tab strip into a new order, and long-pressing an inactive tab no longer switches to it
- **New session card**: session type, machine, path and repos sit in one animated card, the agent is picked from an AI tab, and `/` command and `$` skill autocomplete, file attachments and scheduled send work before the session starts
- **Input history**: recall sent messages with ArrowUp/ArrowDown, and `/` and `$` suggestions rank by match quality and recent use
- **Scheduled message markers**: sessions with scheduled messages are marked in the list with a countdown in the hover card, and the list sorts by last message time
- **Native folding**: turns fold on iOS and Android as on web, the previous turn slides shut when you send, and thinking folds like a tool call
- **Compaction notice**: automatic compaction is announced like a manual `/compact`
- **Bottom sheets**: every bottom sheet shares one look and returns to its place when the keyboard hides

- **Lean copied history**: copying or resuming a session brings over only what was said, with a divider naming where it came from
- **Forking archived sessions**: archived sessions, Codex included, can be forked, and show a banner offering resume in place of the composer
- **Self-started turns**: a turn an agent starts on its own, such as a background task reporting in, gets its own place in the chat for all four agents
- **Resumed read-aloud**: speech cut off by a flaky network picks up where it stopped, retrying through an outage of up to 30 seconds
- **Schedule from a usage-limit notice**: the reset time in a Claude usage-limit notice opens the schedule sheet
- **Calmer session list**: rows tell when a session last moved, a project's header opens its card, and machines fold in the all machines view
- **Search page**: on phones the session list opens a search page over sessions, machines, pages, actions and messages, with recent searches, and every search field shares the iOS system look on every platform
- **Quicker "+"**: the session list's "+" starts a new session on a tap and opens its menu on a long press — as does the CLI update beside it, whose row is in that menu — and menus show an icon on each row
- **Finer scheduling**: scheduled messages offer relative times from 10 minutes to 5 hours
- **Copied context**: a copied Claude session's context bar reads right from the start
- **Image viewer navigation**: arrow keys on web and desktop, previous and next buttons on the web, and a tap on a pagination dot move between images
- **Archived in the palette**: the command palette marks archived sessions with an Archived badge
- **Share into Happy**: photos, videos, files, text and links shared from another app open in a new or online session's composer, nothing sent; on iOS you pick the session right in the share sheet
- **Full-page composer**: long text opens on a page of its own, with a send button at the bottom
- **Videos from the library**: the Library entry takes videos too, uploaded to the session's machine as files
- **Delegated task icon**: a running delegated task on a folded line is named by the chat header's own icon — the one its "+" turns into once a conversation has delegations — instead of repeating "delegated task"
- **Mid-cut fold lines**: a folded line's path, command or search is cut in the middle, so the file or flag that tells two steps apart stays visible
- **Vendor watermark**: the session hover card stamps the agent's mark faintly beside the title, cropped by the card's corner
- **Commit details on the page**: the commit detail page lays the message, totals and changed files directly on the surface, as rows matching the commit list

## CLI Improvements

The CLI (`happy-next-cli`) received substantial upgrades.

- **Multi-agent support**: Claude Code, Codex (via App-Server backend), Gemini, and Qoder as first-class agents
- **Session resume/duplicate** for all agents with proper message backfill
- **Multi-repo worktree** workspace creation/cleanup via daemon RPC
- **Diff processing**: per-file +N/-N statistics for all agents
- **Payload optimization**: trim redundant fields, lazy-load diffs on demand
- **MCP config centralization** with per-agent adapter pattern (Claude HTTP, Codex stdio, Gemini HTTP)
- **Worktree detection** using native git instead of hardcoded path matching
- **Accurate cost calculation** for Claude models, including corrected rate matching for Opus 4.5-4.8 and Haiku model IDs
- **Fast mode cost**: fast mode bills at $10/$50 per MTok across the full context window, so a `-fast` model id no longer falls through to the standard Opus rate and under-reports by half; Opus 4.7 and 4.6 keep standard rates
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
- **Happy CLI v0.9.1 with Codex v0.155.1**: current App-Server interaction support and fast mode
- **Codex session resume**: select from a scrolling session picker, resume by ID or continue the latest session, and choose the working directory
- **Clean Codex exit**: avoid leaving the terminal hanging when a session ends
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

- **Terminals on the machine**: a terminal is a shell owned by the daemon rather than by the window showing it. Each one runs in a forked worker of its own, so a misbehaving shell cannot take the daemon down; creating, attaching, input, resize and disposal are RPC, while output streams as its own event rather than riding RPC; and the server relays the frames with the control bytes inside the opaque payload escaped, so a terminal's own output cannot be read as the envelope around it
- **Durable terminals**: where tmux is installed, those shells outlive the daemon — the next daemon attaches to what the last one left, so a restart costs the connection and not the session. Where tmux is absent nothing changes, and the daemon asks again on each new terminal, because having installed it since is not a reason to restart. Re-attaching is strict: a session that ended between being listed and being attached to is reported, never silently replaced by a fresh shell
- **Automatic compaction summaries**: flagged on the same path as manual ones
- **Happy's own UI tools**: never put to the user as permission questions
- **Durable terminals on Linux**: the tmux listing is no longer read through a control byte tmux rewrites, which had made the listing answer nothing on tmux 3.3-3.6 — a daemon restart dropped every terminal instead of taking the shells back
- **Happy CLI v0.9.2 with Codex v0.155.1**: terminal shells start from better defaults and handle input more predictably
- **Cold Codex download**: a first-run Codex download is no longer reported as a failed handshake
- **Codex model lineup**: GPT-6-Astra gains its `ultra` effort, and the families OpenAI retired from Codex (GPT-5.4, GPT-5.4-Mini, GPT-5.2) are no longer offered; a session saved on one of them keeps the model and effort it was created with, resolved from a retired-mode table rather than passed through as a model name

- **Happy CLI v0.10.0 with Codex v0.159.1**: follows the server's model catalog and drops the deprecated OpenClaw integration
- **Codex v0.159.3 and archiving**: new Codex sessions start on Codex v0.159.3, and archiving a Codex session goes through the running app-server daemon

- **Happy CLI v0.11.0 with Codex v0.160.1**: Codex fast mode stays off unless a delegated task asks for it, and Claude, Codex and Gemini history lists count messages correctly

- **Happy CLI v0.12.0 with Codex v0.162.0**: attached files are sent to the agent, session profiles stay separate per agent, and `sudo happy update` no longer misreports not-logged-in
- **Codex v0.162.1**: new Codex sessions start on Codex v0.162.1

- **Happy CLI v0.13.0**: adds Qoder, checks for new releases on its own and installs them when you ask from the app, upgrades a root-owned global install through passwordless sudo, archives each session's messages for search, and sends Gemini's and Qoder's reasoning as one thinking message

- **Happy CLI v0.14.0 with Codex v0.163.0**: adds `orchestrator_transfer` and encrypted orchestrator tasks, forks archived Codex sessions, keeps Qoder's model list cached, and a daemon started from inside a session no longer makes new sessions resume it

- **Happy CLI v0.15.0**: serves terminals to the desktop app on the same computer over a local, token-protected connection

- **Happy CLI v0.16.0**: fixes Codex's "Approve for Me" mode, asks before orchestrator tools act, carries a copied session's context window, and marks each message as text or other so the watch loads only text

- **Happy CLI v0.16.1**: describes the orchestrator and `preview_html` tools more accurately, so agents pick the right working directory and prefer a file path for HTML previews

- **Happy CLI v0.18.0**: shows what Codex used to drop — generated images, finished plans, hook runs, review decisions, warnings, thread titles and `/model` switches, `/review` markers and sleeps — warns before a Codex account's quota runs out, and shows Qoder's plan as TodoWrite steps

- **Happy CLI v0.19.0**: surfaces the notices Claude already sends, keeps the Task card and session title in step, and classifies 76 Claude system subtypes so a CLI upgrade fails a test instead of dropping them
- **Happy CLI v0.20.0**: keeps a turn's thinking off the server when the device that opened it hides thinking, and stamps landmarks (prompt, question, answer, preview) on records so the minimap can reach messages a device never paged in

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
- **Last message time**: the server tracks each session's last message time for sorting and the command palette

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
- **System font**: text is set in the system font, so Chinese takes the same weights as Latin
- **Flat lists**: the inbox, DooTask and GitHub lists lie flat like the session list
- **Flat page headers**: session info and Settings open under the page's own header instead of a rounded white card
- **Avatars at small sizes**: the fifth brutalist pair is ice-white on a slate disc instead of sky blue on near-black, and 43 thin-line icons are redrawn so they no longer fade at 24pt

- **Vendor mark**: a small logo derived from the session's flavor — the same source the model list uses — sits in front of the model's short label, so a session's vendor no longer needs the model list opened to be known
- **SVG wordmark**: the desktop sidebar, the welcome screen and the settings logo view draw the brand wordmark from the outlined SVG exports instead of rasterised PNGs

- **iOS 26 Liquid Glass**: floating buttons and the action menu use Liquid Glass, and every bottom sheet floats as a Liquid Glass card, centered at a readable width in wide windows
- **Native iOS menus**: header, row, long-press, picker, filter, and attachment menus open as native iOS menus
- **Soft header everywhere**: every screen sits under the soft scroll-edge header, with connection status in its subtitle
- **Pressed-row highlight**: session rows, task cards, and GitHub rows highlight when pressed, like the other lists
- **Terminal entry and preview titles**: terminals open from the Features group in Settings, and the HTML preview takes the page's own title
- **Terminal quick action**: a terminal also opens from the quick actions in a session's details
- **Terminals on the web**: terminals are drawn with xterm.js, keeping CJK text, spaces and styled runs on their cells; desktop browsers open them in a popup window, and recently shown terminals stay mounted while hidden
- **Terminal input**: the cursor is drawn hollow while the input is unfocused, and a Command chord no longer types its letter
- **Empty-session placeholder**: the placeholder shows on web and desktop and is localized in every language, including DooTask's empty chat
- **Small layout fixes**: the iOS new session card spacing is even, and the DooTask error banner floats above the tab bar
- **Pending message details**: the detail sheet keeps the dark theme background

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
- Name the real reason a message failed to send

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
- Remove stale archived session index entries
- Fix a blank assistant row splitting a run of steps into separate fold lines

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
- Allow shared-session recipients to upload chat images
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
