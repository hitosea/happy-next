# Changelog

## Version 30 - 2026-10-10

Happy Next v2.15.1 gives machines preset avatars, lets you reorder machines by dragging in the sidebar and hide idle ones, and reworks the machine page with a terminal and the full session history. It also includes the file attachments, pinned sessions, web session hover card and flatter all machines view introduced in v2.15.0. Happy CLI is updated to v0.12.0, and new Codex sessions start on Codex v0.162.1.

- Composer: attach files to a message from the add menu; the agent reads them on the session's machine, and they show as cards with typed, colored file icons that open in the file viewer
- Composer: reorder the add menu to camera, photos and schedule, with shorter labels
- Sessions: pin sessions to the top of the list, including in the shared-with-me and shared-by-me views
- Sessions: hover a session on web to see a card where you can rename it, find its project in the list, pin it or archive it
- Sessions: show the all machines view as plain machine dividers, and double-tap a divider to fold or unfold its projects
- Sessions: double-tap the sessions tab, or tap the shown machine on the rail, to jump to the next session that wants a look
- Sessions: highlight a row on hover, leave room around a session that a link or reload brings up, and open the selected machine's page from the rail
- Sessions: archiving from session details stays on the page, archived sessions no longer offer archive, and swipe to delete only works on your own stopped sessions
- Sessions: show a status dot on the sessions header title, and refresh sharing state as soon as a share changes
- Sidebar: open the add menu on hover, enable search on native tablets, and enlarge the rail buttons
- Conversation: copy, read aloud and long-press now take a reply split across several blocks as one whole
- Machines: give a machine a preset avatar (12 glyphs on 8 colors), shown in the sidebar rail, the machine switcher, settings, the machine page and the new session pickers
- Machines: reorder machines by dragging in the sidebar, from the rail's right-click menu; Escape takes back a drag, or the whole reordering
- Machines: right-click a machine in the sidebar for new session, open terminal and details, and hide idle machines from the rail and the machine switcher
- Machines: the machine page is reordered with icons on its rows, opens a terminal in the machine's home directory, shows recent sessions as session history cards with a More link to that machine's full history, and shows the daemon's CLI version and start time
- Appearance: remove the inline tool calls, expand todo lists and diff line number switches, which had no effect
- iOS: a session row no longer opens when its context menu lifts, and the bottom tabs are updated for iOS 27
- Desktop: lower the macOS title bar to a compact toolbar, and keep the traffic lights working through full screen
- Languages: translate the new session wizard and other strings that still showed in English
- Orchestrator: report a resumed task to the session that sent the follow-up
- Self-hosting: the server runs database migrations automatically on container start
- CLI: Happy CLI v0.12.0 sends attached files to the agent, keeps session profiles separate per agent, and no longer misreports not-logged-in on sudo happy update
- Codex: new Codex sessions start on Codex v0.162.1

## Version 29 - 2026-10-07

Happy Next v2.14.0 scopes the session list by machine — a machine rail on tablets and desktop, a machine switcher on phones, and machines you can reorder — and lets you schedule a message to send later. A turn's steps now fold in runs between the agent's words, orchestrator runs show how long they take, and Happy CLI is updated to v0.11.0 with Codex v0.160.1.

- Sessions: scope the session list by machine, with a machine rail beside the list on tablets and desktop and a machine switcher sheet on phones
- Sessions: fold shared sessions into their own sections in the all machines view, and keep settings at the foot of the machine rail
- Sessions: name projects by their directory, adding the machine or parent directory only where two projects would read the same, with a setting to bring back full paths
- Settings: reorder machines by dragging, synced across devices
- Composer: schedule a message to send later — in 30 minutes, in an hour, after the usage limit resets, or at a time you pick
- Conversation: fold a turn's steps in runs between the agent's words, so narration, questions and permissions stay on screen
- Conversation: show running delegated tasks on folded turn and run lines, and show long tool times as mm:ss and HH:mm:ss
- Conversation: move the web minimap to the right edge, and stop the web chat list from jumping while scrolling
- Orchestrator: show how long runs and tasks take, simplify the run filters to All, Active, Completed, Failed and Cancelled, and make task parameters and context easier to read
- Orchestrator: use only the agent's final message as a task's result, and follow running tasks live
- Text selection: open the preview as code, JSON or markdown to match the source, with a switch to plain text
- History: select text, scroll smoothly and see timestamps in the session history preview on web
- Commands: show descriptions for Claude's built-in slash commands
- Header: keep the connection status color under the title on Android and the web
- Desktop: use a full-width title bar over a rounded content panel
- CLI: Happy CLI v0.11.0 keeps Codex fast mode off unless a delegated task asks for it, and counts messages correctly in Claude, Codex and Gemini history lists
- Codex: new Codex sessions start on Codex v0.160.1

## Version 28 - 2026-10-01

Happy Next v2.13.1 brings the terminal to the web and the session details — drawn with xterm.js, openable in a popup window on desktop browsers and kept alive while hidden — and shows the empty-session placeholder everywhere. New Codex sessions start on Codex v0.159.3.

- Terminal: open a terminal from the quick actions in a session's details
- Terminal: draw the terminal with xterm.js on the web, keeping CJK text, spaces and styled runs on their cells
- Terminal: open terminals in a popup window in desktop browsers, and keep recently shown terminals mounted while hidden
- Terminal: draw the cursor hollow when the input is unfocused, and stop typing the letter when a Command chord is pressed
- Sessions: show the empty-session placeholder on web and desktop, localized in every language, including DooTask's empty chat
- Sessions: even out the spacing of the new session card on iOS
- DooTask: float the error banner above the tab bar
- CLI: archive Codex sessions through the running app-server daemon
- Codex: new Codex sessions start on Codex v0.159.3

## Version 27 - 2026-09-29

Happy Next v2.13.0 gives iOS 26 its native look — Liquid Glass buttons, menus and sheets, a soft header across the app, and a floating composer docked to the keyboard — and moves the chat onto a faster native list. Models now arrive from the server without an app update, adding Claude Opus 5.5, Sonnet 5.5 and the GPT-6 family, and Happy CLI is updated to v0.10.0 with Codex v0.159.1.

- iOS: float buttons, the action menu and bottom sheets as Liquid Glass on iOS 26
- iOS: open header "more" menus, session row actions, long-press menus, pickers, filters and composer attachment menus as native iOS menus
- iOS: put every screen under the soft scroll-edge header, with connection status in the header subtitle and forms following the keyboard natively
- Composer: float a glass composer over every iOS chat screen, docked to the keyboard, so new messages, short chats and empty states stay in step as it opens and closes
- Conversation: render the native message list with LegendList for smoother scrolling, follow new messages to the end even in bursts, and start short chats at the top
- Models: pick up new models from the server without an app update, now including Claude Opus 5.5, Claude Sonnet 5.5, GPT-6.1-Sol, GPT-6-Sol and GPT-6-Luna
- Sessions: an open session is no longer marked read while the window is unfocused or idle, and archived sessions stay offline
- Lists: highlight pressed session rows, task cards and GitHub rows
- GitHub: cache list totals with a spinner while refreshing, and add a scroll-to-bottom button to issue and pull request comments
- DooTask: cache the task list per filter and refresh it in the background
- Terminal: open terminals from the Features group in Settings, sized to the keyboard and clear of the home indicator
- Preview: title the HTML preview with the page's own title
- CLI: Happy CLI v0.10.0 bundles Codex v0.159.1, follows the server's model catalog, and drops the deprecated OpenClaw integration

## Version 26 - 2026-09-23

Happy Next v2.12.1 adds terminals that live on the machine — a shell owned by the daemon rather than by the window showing it, with its own desktop window and tabs — and folds a turn's working-out into one line you can open. Plan proposals now show folded at the shape of a proposal, the fold line holds where you tapped it, the minimap becomes a swipe-in landmark rail on touch, HTML previews render as authored, and Happy CLI is updated to v0.9.2 with Codex v0.155.1 and GPT-6-Astra's Ultra effort.

- Terminals: run a shell on the machine, one worker per terminal, shown in its own desktop window with tabs
- Terminals: keep running across a daemon restart by living under tmux, and come back attached to the same shell
- Conversation: fold a turn's process into one line — how long it took and how many tool calls it hid — that opens on a tap and says what the agent is doing while the turn runs
- Conversation: collapse a compacted conversation's summary to a single tap-to-view line
- Minimap: summon the landmark rail with a swipe in from the right edge on touch, with a card previewing the mark under your finger
- Files: render HTML as authored inside the sandbox, switch a file's views through one tab bar, and move the version notice into the header
- Sessions: reveal a local session's folder in Finder or Explorer, and split the session menu into sections
- Models: mark the session's vendor beside the model label
- Composer: turn the voice button into a stop button while the agent works, and abort on a double press of Escape
- Desktop: draw the brand wordmark from the SVG logos in the sidebar, welcome screen and settings
- CLI: Happy CLI v0.9.1 bundles Codex v0.155.1, flags automatic compaction summaries too, and takes durable terminals back correctly on Linux
- Plan proposals: show folded at the shape of a proposal, marked on the landmark rail and kept out of the turn's fold, and a proposal is sent as the request it is
- Conversation: a step waiting on a permission stays out of the fold, so the question is never folded away, and the fold line holds the position it was tapped at instead of snapping when the page settles around it
- CLI: Happy CLI v0.9.2 bundles Codex v0.155.1, terminal shells start with better defaults and handle input more predictably, and a cold Codex download no longer reads as a failed handshake
- Models: GPT-6-Astra gains its Ultra effort, and the Codex models OpenAI retired (GPT-5.4, GPT-5.4-Mini, GPT-5.2) are no longer offered

## Version 25 - 2026-09-18

Happy Next v2.11.0 reworks the session list — rename, read/unread, and a scannable color bar — and times every assistant turn above its reply. Questions and HTML previews now appear on the conversation minimap, in-progress answers survive as drafts, and Happy CLI is updated to v0.9.0 with Codex v0.155.0.

- Sessions: rename a session, or mark it read or unread, from its context menu
- Sessions: draw the color marker as a bar down the row edge, give every session state a mark in the compact list, and remember the compact list per platform
- Sessions: stop offering a new session from a session shared with you, let recipients of a shared session upload images, and name the real reason a message failed to send
- Conversation: time each assistant turn above its reply, counting up while the turn runs
- Minimap: mark AskUserQuestion calls and HTML previews, and keep compaction summaries off the rail
- Drafts: keep in-progress AskUserQuestion answers so they survive scrolling away
- Tools: preview images that file-reading tools open, and let HTML previews read a document from a file path
- GitHub: use Octicons for lists and keep the repository list cached
- Appearance: hide thinking and image placeholder rows, and default "show thinking messages" to off
- CLI: Happy CLI v0.9.0 bundles Codex v0.155.0, and Claude fast-mode cost estimates are corrected

## Version 24 - 2026-09-12

Happy Next v2.10.1 improves DooTask sign-in and cross-device connection sync, and adds a quick new-session action to desktop project headers. It also includes the GitHub workflows, safer file previews, and downloads introduced in v2.10.0.

- GitHub: browse repositories and navigate directly to GitHub-backed work from the app
- Files: preview images and supported files securely, with clearer preview controls
- Downloads: download arbitrary files up to 100 MiB from sessions
- Diff viewer: preserve web text selection and prevent Safari proxy scrolling from undoing minimap jumps
- Tools: show localized tool details alongside secure image previews
- CLI: Happy CLI v0.8.0 bundles Codex v0.154.0
- DooTask: simplify connection login and keep connections synchronized across devices
- Desktop: start a new session directly from a project header

## Version 23 - 2026-09-09

Happy Next v2.9.0 brings GitHub repositories, issues, and pull requests into the app, with linked AI sessions for follow-up work. Codex sessions are easier to resume and archive, mobile notifications gain DooPush support, and macOS navigation and Claude cost estimates are more reliable. Happy CLI is updated to v0.7.0 with Codex v0.153.4.

- GitHub: connect your account, browse repositories, and view, create, comment on, close, and reopen issues and pull requests
- GitHub sessions: start an AI session from an issue or pull request with its context, and return to linked sessions from the detail page
- Codex resume: choose a session from a scrolling list, resume by ID or continue the latest session, and select the working directory
- Codex archive: synchronize archive actions with native Codex history, show archived state consistently, and restore archived sessions when continuing work
- Codex reliability: improve session duplication and forking, report active-session conflicts clearly, and prevent terminal exit from hanging
- Push notifications: add DooPush support and improve push registration cleanup when switching accounts or signing out
- macOS: click the sidebar title to return to the session home screen
- Cost estimates: correct rate matching for Claude Opus 4.5-4.8 and Haiku model IDs
- CLI: Happy CLI v0.7.0 bundles Codex v0.153.4

## Version 22 - 2026-09-04

Codex sessions now support interactive questions and richer approval requests, while the model picker is ready for the newest Codex, Claude, and Gemini model families. This release also keeps push tokens tied to the active account, improves multi-image viewing, polishes the macOS sidebar and window controls, and updates Happy CLI to v0.6.7.

- Codex: answer interactive questions with choices, custom Other values, free-form text, and masked sensitive responses
- Codex permissions: handle current command and permission approval requests from the App-Server protocol
- Models: add catalog support for GPT-6 Astra, Claude Fable 5.1, Gemini 3.8 Flash, and Gemini 3.7 Flash with their current reasoning and context settings
- Push notifications: keep each device token bound to only the active account and clean it up reliably during logout
- Desktop images: keep the selected image in view while browsing multi-image previews
- macOS: refine the sidebar header and stabilize traffic-light button placement across startup and window changes
- CLI: Happy CLI v0.6.7 bundles Codex v0.153.2 and the latest interaction support

## Version 21 - 2026-08-11

Sessions can now be labeled with seven color markers for quicker visual organization. Desktop users can drag images directly into new or active sessions, slash-command completion stays focused on relevant subcommands after a command is selected, and iOS download links now point to the App Store. This release also improves iOS image opening and duplicate-sheet behavior when the keyboard is visible, and centers the empty state in DooTask chats.

- Sessions: assign or clear one of seven color markers from the session menu, visible throughout session lists
- Desktop images: drag images into the new-session composer or an active chat, with a clear drop indicator
- Slash commands: after selecting a root command, autocomplete only shows its matching subcommands and no longer mixes skills into free-form arguments
- iOS: download links now point to the App Store, with Web app guidance for users in mainland China
- iOS: dismiss the keyboard before opening images to prevent presentation conflicts
- iOS: prevent a white overlay when opening the duplicate-session sheet with the keyboard visible
- DooTask: center the empty-chat state consistently

## Version 20 - 2026-07-30

Happy Next is now ready for direct desktop distribution on macOS and Windows, with a more native and reliable window experience, refreshed Claude and Gemini model support, easier HTML and Git workflows, collapsible session folders, refreshed branding, and further polish across notifications, session progress, iOS action menus, adaptive themes, message duplication, permissions, and the CLI.

- Desktop apps: native-feeling desktop clients for macOS 12+ Universal, Windows x64, and Windows ARM64, distributed directly through GitHub Releases
- Window experience: authentication-aware window sizing, native state restoration, frameless macOS title bar integration, reliable dragging, multi-monitor bounds protection, and theme-correct startup
- Tray and notifications: close to tray, single-instance activation, native notifications that open the corresponding Session, and Dock/taskbar unread indicators
- Desktop controls: native application menus, search and navigation shortcuts, optional launch at sign-in, and a global show/hide shortcut
- Automatic updates: signed update packages download quietly in the background and expose an in-app Update button when ready; installation and restart remain user initiated
- Reliability: desktop diagnostics, rotating native logs, upload failure recovery, persistent composer content, and significantly lower idle CPU usage
- Security and permissions: restricted Tauri capabilities, hardened navigation and CSP boundaries, system-browser external links, and explicit microphone and camera support
- Visual polish: refreshed logos, favicons, splash screens, notification assets, and platform-specific macOS and Windows icons, including the macOS 26 layered icon format and compatibility icons for older macOS versions
- Session organization: sessions can be grouped into collapsible project folders, with folder state retained locally
- Desktop polish: added a native startup logo and improved empty-state branding, title-bar interactions, fullscreen behavior, and native context menus
- Windows desktop: added an integrated native-style title bar, refined sidebar and unauthenticated navigation, hid menus in child windows, improved taskbar unread indicators, and polished icon rendering
- Desktop reliability: prevented long-running WebKit storage growth, stabilized macOS traffic-light positioning at startup, restored notification routing, and unified notification, attention, Dock, and taskbar unread behavior
- HTML previews and editing: supported tool messages can open HTML previews directly, preview windows retain isolated theme-correct behavior, and code editing works under the desktop CSP
- Sessions and Git: Codex in-progress plan steps remain visible, and opening Files from git status focuses the relevant changes
- Models: added Claude Opus 5, Claude Sonnet 5, Gemini 3.6 Flash, and Gemini 3.5 Flash-Lite with updated reasoning options, context limits, fast-mode support, and Claude 5 cost calculation
- Messages and iOS: duplicate/fork actions resolve the intended user-message target more reliably; action menus remain stable with the keyboard visible; scanner camera permissions are clearer and an unused motion permission is removed
- Notifications and themes: notification previews use clean plain text, while adaptive system-theme changes apply reliably across app and desktop authentication windows
- iOS privacy: the camera permission explanation now proceeds directly to the iOS system permission request without offering a cancel action
- Desktop notifications: clicking macOS notifications reliably restores the app and opens the associated session
- Desktop updates: automatic update checks now repeat periodically and when the app regains focus, while avoiding redundant requests
- Windows notifications: native notifications now display the Happy Next app icon consistently
- Windows navigation: clicking the title-bar logo now returns directly to the Sessions home screen
- CLI: Happy CLI updated to v0.6.6 with refreshed model support and pricing, multiline skill-metadata parsing, enabled plugin-skill discovery, and more reliable message-target resolution

## Version 19 - 2026-07-22

Sessions gain convenient quick actions, Orchestrator runs become easier to inspect and navigate, Codex skills join slash-command autocomplete, navigation headers are more consistent, and chat reliability improves across web and smaller screens.

- Sessions: quick actions in session info make common session tasks easier to access
- Orchestrator: task pages now present execution history more clearly, run navigation is streamlined, and Orchestrator messages link directly to their corresponding runs
- Codex skills: installed Codex skills now appear in slash-command autocomplete
- Navigation: back buttons and header actions are aligned consistently across session and machine screens
- Chat: the empty state adapts better to short screens, and the initial message is no longer clipped on web
- Reliability: late tool results are retained after task completion, and stale Orchestrator activity badges are cleared correctly
- CLI: Happy CLI updated to v0.6.4 with Codex 0.145.0, refined Orchestrator skill behavior, cleaner file-search results, and more accurate delegated-activity completion notifications

## Version 18 - 2026-07-17

Message read-aloud is rebuilt around true streaming TTS with a global playback queue and a draggable floating player, a new /preview-html CLI command renders self-contained HTML previews right inside the app, web conversation-list scrolling gets more polish, and the iOS status bar stays correct after the keyboard animates.

- Voice: message read-aloud now streams audio as it's synthesized, so playback starts sooner and no longer dies mid-message or silently drops the tail
- Voice: a global read-aloud queue with a draggable floating player lets you line up messages and control playback from anywhere
- Voice: an improved text-cleanup prompt (v2) with a digest mode condenses long messages for smoother, more natural narration
- Preview HTML: the CLI adds a built-in /preview-html slash command that generates a self-contained HTML document and previews it directly in the app
- Web conversation list: scroll position is now preserved when returning from a covered screen, and the proxy scrollbar strip is sized to match the platform's native scrollbar width
- iOS: the status bar is reapplied after keyboard animations so it no longer gets left in the wrong state
- Server: background service-discovery retries are fixed so connection setup recovers more reliably
- Docs: the documentation site is synced with the last five weeks of shipped features
- CLI: Happy CLI updated to v0.6.3 — unknown commands are now rejected before launching Claude

## Version 17 - 2026-07-12

The web conversation list is rebuilt as a model-driven virtualized list with instant centered jumps and refined, stable scrolling, the minimap now fills in from the offline message cache, the model picker is streamlined to seven entries with side-by-side reasoning-effort presets, and the CLI updates to v0.6.2 with Codex 0.144.1.

- Web conversation list: rebuilt as a model-driven virtualized list — jumping to a message centers instantly, with a subtle shake when you're already there; history now loads on demand as you scroll
- Web scrolling: scroll geometry is frozen during gestures to stop scroll jumps, scroll-to-bottom now lands on the true bottom, jumps from far away teleport into place, and a proxy scrollbar replaces the distorted native one for an honest scroll position
- Minimap: the conversation minimap now populates from the offline message cache, so the navigation overview is available even before messages finish loading or while offline
- Models: the model picker is streamlined from 12 to 7 entries — Claude 1M-context variants collapse into a single toggle instead of separate rows
- Models: on wide screens the reasoning-effort presets show side by side, and Claude now defaults to High effort
- Codex: updated to Codex 0.144.1 with a refreshed model catalog
- Sessions: mode settings now carry over when a session is restarted with the latest CLI, and the message cache is cleared after archiving a session
- Fixes: sub-agent token usage no longer overwrites the main session's context-window indicator; the message outbox no longer overflows on large batches, and noisy 4xx server logs are reduced; a stale message-coverage retry loop that could leave sessions stuck loading is resolved; the iOS tab notification dot now renders correctly and is smaller; the update banner is removed from the sessions list
- CLI: Happy CLI updated to v0.6.2 — the daemon now starts reliably after update and login

## Version 16 - 2026-07-08

Conversations gain a minimap for quick navigation, a context-usage tooltip, a persistent message cache for faster reopens, and a resizable sidebar on web; server connectivity is streamlined with service discovery, fastest-default API endpoint racing, and improved self-host deployment setup; shared-session lists and machine tabs update more reliably; voice auth is hardened with short-lived tokens; and the CLI updates to v0.6.0 with new Codex slash commands for compact review and goal-setting.

- Minimap: tap the new minimap panel to jump to any part of a long conversation at a glance, with polished overlay placement for smoother navigation
- Context usage: a tooltip on the context indicator shows token-count breakdown details
- Message cache: session messages are persisted locally so reopening a conversation can show existing history faster with less blank loading time
- Web sidebar: the sidebar is now resizable by dragging its edge
- Settings: a shortcut button to configure a custom server is now visible on desktop settings
- Breadcrumb: copy the current browser breadcrumb path directly from the navigation bar
- Git: bulk git actions now show loading feedback while the operation runs
- Voice: voice gateway auth now uses short-lived tokens for improved security
- Server: service discovery for API and voice config endpoints is now supported; when no custom server or env override is configured, the app races the official default API endpoints and uses the fastest available config response
- Self-hosting: Docker/self-host deployment setup and documentation were improved
- Sessions: new session defaults now pick the best available machine automatically, and machine tabs remain visible when shared sessions are present
- Sharing: the Shared by me list now updates after sharing changes
- Fixes: user display name fallbacks improved; shared session permissions corrected; diff text selection enabled in the file viewer; pending-messages 404 loop resolved for view-only sessions
- CLI: Happy CLI updated to v0.6.0 with Codex slash commands for compact review and goal-setting

## Version 15 - 2026-06-29

Pending messages can now be edited and paused or saved as drafts before they send, machine tabs surface live status dots for sessions that need permission or are thinking, and the CLI orchestrator's activity count now includes queued tasks.

- Pending messages: edit a queued message before it sends, or pause it / save it as a draft instead of dispatching — the pending detail sheet now sizes its text area to fit the content
- Machine tabs: a machine's tab shows an orange dot when a session on it needs permission, and its status dot reflects the live thinking state; the aggregate 'all' tab no longer shows a dot
- Orchestrator: the activity count now includes queued tasks, so the badge reflects work waiting to start and not just running agents
- CLI: Happy CLI updated to v0.5.7

## Version 14 - 2026-06-26

The Happy CLI gains a built-in orchestrator that fans work out to parallel Claude / Codex / Gemini agents, publicly shared sessions paginate their messages for faster loads, and reliability fixes land for the remote→local terminal handoff and pending-message delivery.

- Orchestrator: the Happy CLI now auto-installs an orchestrator skill and `/orchestrator` slash commands on startup — delegate a task to multiple Claude / Codex / Gemini agents running in parallel or in dependency order
- Public sharing: publicly shared sessions now load their messages in pages instead of all at once, so long shared conversations open faster
- CLI reliability: switching a session from remote back to local now cleans up terminal stdin, so leftover raw-mode input no longer leaks into the terminal
- Reliability: pending-message dispatch delay raised to 3s to avoid a race that could drop a queued message
- CLI: Happy CLI updated to v0.5.6

## Version 13 - 2026-06-18

Session header is reworked with a left-aligned title and a new-session button; the sessions list is reorganized into per-machine tabs; session loading gets a reliability sweep (longer fetch timeout, retry-loop refresh indicator, stuck-load recovery, base64 stack-overflow fix); long user messages collapse and select cleanly on web; the commits list tags the upstream tip; nginx adds a /healthz endpoint; unrecognized tool calls now render as a generic 'other' block and agent-event messages strip ANSI escape codes; Happy CLI updates to v0.5.5 with mid-turn permission-mode forwarding, graceful Stop/ESC interrupts that keep the Claude and Codex backends warm, and hot-swappable model / plan-mode switching on a warm subprocess; and Claude Fable 5 (with 1M-context variant) joins the Claude model catalog.

- Session header: unified left-aligned title across iOS / Android / web — new-session button on the header right and a header title in the session info screen
- Session header: left-align the title on narrow phones (was center-overflowing), and fix the invisible back icon in dark-theme landscape
- Sessions: the active/inactive split is replaced by per-machine tabs — sessions are grouped by the machine they run on, so multi-machine setups are easier to navigate
- Messages: long user messages (>20k chars) now collapse to a preview with a Show More toggle; web text selection inside messages is fixed
- Messages: per-message action bar no longer flickers when the message flips between thinking and streaming states
- Session loading reliability: message fetch timeout raised 20s → 60s; sessions stuck in permanent load failure now recover; refresh indicator stays visible across the entire retry loop and also on user-opened incremental loads
- Session loading reliability: chunk base64 encoding so very large message payloads no longer trigger a stack overflow when restoring sessions
- Session draft: rewritten as a single source of truth — fewer cases of drafts vanishing or reappearing
- Commits view: the commit at the upstream tip is now tagged
- Deploy: nginx serves a zero-cost `/healthz` endpoint so load balancers and uptime checks have a cheap target
- Tools: unrecognized tool calls now render as a generic 'other' block with a dynamic title and icon, instead of an empty placeholder
- Agent events: agent event messages strip ANSI escape codes from child-CLI stderr so subprocess banner color sequences no longer leak into the chat as raw `[90m…[0m`
- CLI: Happy CLI updated to v0.5.5 — permission-mode switches from the app forward synchronously to the Claude subprocess; Stop/ESC interrupts now keep the Claude and Codex backends warm so the next message resumes instantly instead of cold-restarting; switching model or toggling plan mode now hot-swaps on the already-warm Claude subprocess instead of cold-restarting, so changes apply instantly mid-session; Gemini's interrupt feedback now matches Claude/Codex with a "[Request interrupted by user]" marker
- Models: add Claude Fable 5 (and Fable 5 1M) to the Claude model catalog, with low / medium / high / xhigh / max reasoning effort presets

## Version 12 - 2026-06-02

Happy Voice moves to a new Volcano (Doubao) real-time gateway with streaming speech and native iOS voice calls, selectable voice timbre and speech rate, end-to-end-encrypted voice settings sync, and richer slash-command autocomplete with live capability sync. This update also speeds up session open with incremental catch-up and fixes draft restore and the Claude Opus 4.8 context window.

- Voice: migrated Happy Voice to a new Volcano (火山引擎 / Doubao) real-time gateway, replacing the previous LiveKit / ElevenLabs stack — lower latency and a curated multilingual voice set
- Voice calls: streaming message text-to-speech and native in-call voice on iOS, with connection state gated on room-state changes and the microphone guarded during a call
- Voice personalization: choose your assistant's voice timbre and speech rate; multilingual replies default to the seed-tts-2.0 voice
- Voice quality: smarter LLM text cleaning before speech — trivial short text skips cleaning to cut latency, in-call announcements are localized, and reply length caps were raised
- Voice settings: voice assistant configuration now syncs across devices via end-to-end-encrypted user settings; refreshed language-search header and layout
- Voice tools: refreshed session-management voice tools (start / switch / message a session) with a single-parameter session-settings mode, clearer titles, and an auto-close countdown on the session-picker cancel button
- Autocomplete: slash-command suggestions now show their source scope (repo / user / plugin / system) and kind; session capabilities are stored separately from metadata and sync live so command and skill lists stay fresh
- Messages: fork a conversation directly from an AI reply; sending now shows an optimistic "Processing…" status immediately and a "refreshing" indicator while the list reloads
- Composer: send a message with only attached images and no text — the send button now enables when images are attached even if the text field is empty
- New session: start a session with an empty initial message — no prompt required
- Sessions: tidied "vibing" activity messages and lowercased the "awaiting" status label
- Reliability: message send is hardened for flaky networks, and draft restore is suppressed while a send is in flight
- Reliability: the chat reducer no longer synthesizes out-of-order completed-permission messages
- Performance: opening a session now does an incremental catch-up instead of a full re-bootstrap — large sessions open noticeably faster
- Messages: drafts you've already sent no longer reappear when the sessions list cache refreshes
- Models: added Claude Opus 4.8 to the model catalog, which now correctly defaults to its 1M-token context window
- iOS: transparent native session header with proper top padding, and the chat placeholder is centered in the visible area above the keyboard
- Deploy: docker-compose Happy Voice service points at the Volcano gateway, with the gateway port standardized to 3040
- CLI: Happy CLI updated to v0.5.2

## Version 11 - 2026-05-25

Voice playback for AI replies, a per-message action bar, richer chat formatting, DooTask project autofill, session reliability fixes, and updated model catalogs.

- Messages: read AI replies aloud with a new voice button in the message footer (text-to-speech via Happy Voice), one message at a time
- Messages: per-message action bar with copy, fork-from-here (with progress spinner), and full timestamp on web hover / native tap
- Messages: richer markdown rendering — code-block header with copy button, improved chat formatting
- Composer: keep the keyboard-selected autocomplete suggestion in view; remove the hardcoded cap on slash-command and file autocomplete
- Sessions: preserve 1M context when duplicating a session; several session-encryption reliability fixes (restore from cache, rebuild when entering an unencrypted session)
- DooTask: auto-fill machine and working directory from the project's defaults; markdown indentation / underline / strikethrough; long sender-name truncation and localized assistant label
- Models: curated Claude / Codex / Gemini catalogs, add Gemini 2.5 Flash Lite, centralized per-agent permission modes; Codex updated to 0.133.0
- Agents: sync Claude tools and slash commands from the session init message; Codex skill autocomplete
- Web & platform: theme-consistent native controls, color-scheme guard, HMR bundle-URL fix, refreshed iOS/Android splash images
- CLI: prevent transient image-download failures from killing sessions; spawn Claude CLI via shell on Windows

## Version 10 - 2026-05-18

Sessions cold-start reliability overhaul, local session list cache, agent picker on the machine page, ChatBubble text-overflow fix, iOS build fix, and Happy CLI v0.3.4 with PATH injection for system daemons.

- Sessions cold-start: gate first-load through a state machine that waits for sync to settle before listing, eliminating empty-list flashes and duplicate fetches on app launch
- Sessions cold-start: hydrate machine picker on the new-session screen only after sync completes, so the last-used machine reliably preselects
- Sessions cold-start: fire reconnect listeners on the socket's first successful connect, not just on subsequent reconnects, so initial sync is no longer missed
- Sessions list: cache the session list locally and reconcile server state via deletion tombstones, so opening the app shows yesterday's sessions instantly while the server catches up
- Machine page: pick the agent type (Claude / Codex / Gemini) when spawning a session — choices are limited to whichever CLIs the daemon reports as available, and the new session inherits that agent's last-used permission / model / fast mode
- ChatBubble: tighter text wrapping and overflow handling so long URLs, code, and CJK runs no longer push the bubble past the message column
- Settings: hide the header action button when no actions apply, removing an empty tap target
- iOS build: compile fmt as C++17 to unblock Xcode 26 native builds
- Happy CLI v0.3.4: inject the user's PATH into macOS LaunchAgent plists and Linux systemd unit files so the daemon can find `node` and `npx` after install; surface real `systemctl` errors instead of swallowing them
- Performance: keep older recent-page sessions out of the global session store, lowering memory pressure on long browsing sessions

## Version 9 - 2026-05-15

Native iOS/Android navigation overhaul, deeper DooTask inbox integration, directory autocomplete for path pickers, Gemini 3.1 Pro support, and broad iPad/Mac/Web polish.

- Native navigation: switch iOS and Android to the platform-native bottom tab bar and native header on home, chat, and inbox screens for an OS-consistent feel
- Tabs: reorder bottom tabs to put inbox before sessions, rename "Terminal" to "Session", and replace brutalist placeholders with dedicated navigation icons
- iOS polish: chevron-only back button, header avatar geometry/clipping fixes, centered title in native header, status bar controller, and iOS 26 fixes for scroll-edge fade, full-screen translucent chat overlay, and prompt modal presentation
- DooTask inbox: merge DooTask recents into the main inbox with persistent cache and silent background refresh; session avatars now show for DooTask-related sessions; chat header adapts to dialog type; self HTML messages align correctly
- Path picker: directory autocomplete via remote machine listing, extracted to a shared hook used by web and mobile; web autocomplete focus handling fixed
- Sessions: paginate recent session history for faster loading
- Models: add Gemini 3.1 Pro to the catalog, promote Gemini 3 Flash to GA, and drop the deprecated Gemini 3 Pro Preview; wizard handles new flash model variants; Codex updated to v0.130.0
- Always-on context size: default the "always show context size" setting to on so usage is visible without opening session details
- iPad / Mac: pad sidebar header for windowed-mode window controls, fix session header resize, top-tab insets, list divider rendering, and windowed keyboard overlap; sidebar logo dismisses to root, nav buttons use stack-friendly navigation
- Web: fix bottom tab bundling and session header navigation
- Misc: refresh React Native scroll-edge patch, clean up API endpoint detail styling, downgrade message validation failure log to warn

## Version 8 - 2026-05-07

Claude Opus 4.7 and GPT-5.5 support, image upload quality, session title polish, Claude 4.x compatibility fixes, web desktop polish, and mobile text-selection rebuild.

- Models: add Claude Opus 4.7 to available model list
- Models: add GPT-5.5 to available Codex model list with low/medium/high/xhigh reasoning levels
- Image uploads: raise max dimension to 1568px and skip redundant compression when originals are already within limits, preserving text sharpness in code and UI screenshots
- Session title: seed new sessions with the first user message instead of the project directory name, until an AI summary takes over
- Web: return to home screen after archiving a session instead of staying on the archived page
- Claude Opus 4.7: drop empty thinking blocks emitted by 4.x models that previously caused rendering glitches
- Slash commands: surface Claude Code's result text when a turn (e.g. unknown slash command) produces no assistant message, preventing blank mobile replies
- Web desktop: hover-to-show copy button on chat messages (≥850 width); right-click on options reuses the mobile long-press behavior (fills input instead of sending)
- Mobile text selection: in-app selection page rebuilt to use browser-native long-press with static syntax highlighting (Lezer), fixing first-tap selection on Android and removing the markdownCopyV2 toggle so all mobile users get the improved experience
- Mobile reliability: fix Android text-selection page crash caused by iOS-only WebView props under the new Fabric architecture
- AskUserQuestion: fix empty/missing answers — frontend now keys answers by the full question text to match Claude Code CLI's internal lookup
- iOS 26: align navigation header icons and pin App Store builds to Xcode 26.4.1 (required by Apple for App Store Connect uploads)
- Header action menus: refine action menus on session edit/status/commits and script editor pages for cleaner interactions
- Dependencies: upgrade react-native-audio-api and react-native-keyboard-controller for improved iOS audio recording and keyboard handling

## Version 7 - 2026-03-18

Orchestrator arrives — define multi-agent task DAGs and let Happy schedule, execute, and monitor them automatically, plus offline message queuing, session management upgrades, and dozens of reliability fixes.

- Orchestrator: define task dependency graphs (DAGs) with per-task model and working directory, auto-schedule execution across Claude, Codex, and Gemini, monitor progress with real-time status badges, and follow up on completed tasks via session resume.
- Pending message queue: messages sent while the CLI is busy are queued server-side and auto-dispatched when ready, with a queue panel UI, image count badges, and send-now option.
- Session management: Active/Inactive tab filter replaces the old toggle, device and agent filter dropdowns in history, session preview expand/collapse, metadata caching for faster listing, and CLI hot-upgrade support.
- File viewer: image preview with sharing support directly from the code browser.
- CLI: daemon auto-start on boot (`happy daemon enable`), restart command, Codex v0.116.0 with fast mode, message receipt tracking, and attribution setting (default off).
- DooTask: globalized WebSocket connection with real-time task updates, related task entry in session info, and persistent server-side connection.
- MCP tools: `preview_html` for full-page HTML preview, dual-mode long-press copy in tool details, and colon-separated tool naming support.
- Gemini and Codex compatibility: ACP result format normalization, tool ID prefix fallback matching, Codex v2 protocol fixes, and dynamic permission mode changes.
- 50+ bug fixes across session sharing, feed lifecycle, toast positioning, icon font preloading, markdown rendering, and git status reliability.

## Version 6 - 2026-03-04

The biggest Happy update ever — multi-agent, voice, workspaces, code browser, DooTask, session sharing, and self-hosting all land in one release, plus 200+ bug fixes across the board.

- Full multi-agent support: Claude Code, Codex, and Gemini are now equal first-class agents with session resume, duplicate/fork, per-agent model selection, and accurate cost tracking.
- LiveKit-based voice assistant with pluggable STT/LLM/TTS providers, microphone mute, thinking indicator, and context-aware conversations that understand your full app state.
- Multi-repo worktree workspaces: create workspaces spanning multiple repositories, manage branches per-repo, auto-generate CLAUDE.md, and create PRs with AI-powered code review.
- Built-in code browser with file navigation, Monaco editor, commit history, branch selector, and a full git changes page for staging, committing, and discarding changes.
- Session sharing: share sessions with friends via direct invite (NaCl Box E2E encryption) or public links (token-derived keys), with real-time sync, access control, and a public share web viewer.
- DooTask integration with task lists, detail pages, real-time WebSocket chat, emoji reactions, voice message playback, one-click AI session launch, and in-app task/project creation.
- AI backend profiles with built-in presets for DeepSeek, Z.AI, OpenAI, Azure, and Google AI — switch LLM backends for Claude Code with custom environment variable mapping.
- Self-hosting with a single `docker-compose` command: Web app, API server, Voice gateway, Postgres, Redis, and MinIO all configured out of the box.
- Major sync reliability improvements: v3 messages API with seq-based sync, HTTP outbox for offline delivery, server-confirmed sends, and message loss prevention.
- Chat UX polish: image attachment and clipboard paste, message pagination, unread blue dot indicator, compact view, session search, /duplicate command, pull-to-refresh, and improved markdown tables.
- CLI: `happy update` self-upgrade command, `happy --version` displays all agent versions, worktree subdirectory detection.

## Version 5 - 2025-12-22

This release expands AI agent support and refines the voice experience, while improving markdown rendering for a better chat experience.

- We are working on adding Gemini support using ACP and hopefully fixing codex stability issues using the same approach soon! Stay tuned.
- Removed model configurations from agents. We were not able to keep up with the models so for now we are removing the configuration from the mobile app. You can still configure it through your CLIs, happy will simply use defaults.
- Elevenlabs ... is epxensive. Voice conversations will soon require a subscription after 3 free trials - we'll soon allow connecting your own ElevenLabs agent if you want to manage your own spendings.
- Improved markdown table rendering in chat - no more ASCII pipes `|--|`, actual formatted tables (layout still needs work, but much better!)

## Version 4 - 2025-09-12

This release revolutionizes remote development with Codex integration and Daemon Mode, enabling instant AI assistance from anywhere. Start coding sessions with a single tap while maintaining complete control over your development environment.

- Introduced Codex support for advanced AI-powered code completion and generation capabilities.
- Implemented Daemon Mode as the new default, enabling instant remote session initiation without manual CLI startup.
- Added one-click session launch from mobile devices, automatically connecting to your development machine.
- Added ability to connect anthropic and gpt accounts to account

## Version 3 - 2025-08-29

This update introduces seamless GitHub integration, bringing your developer identity directly into Happy while maintaining our commitment to privacy and security.

- Added GitHub account connection through secure OAuth authentication flow
- Integrated profile synchronization displaying your GitHub avatar, name, and bio
- Implemented encrypted token storage on our backend for additional security protection
- Enhanced settings interface with personalized profile display when connected
- Added one-tap GitHub disconnect functionality with confirmation protection
- Improved account management with clear connection status indicators

## Version 2 - 2025-06-26

This update focuses on seamless device connectivity, visual refinements, and intelligent voice interactions for an enhanced user experience.

- Added QR code authentication for instant and secure device linking across platforms
- Introduced comprehensive dark theme with automatic system preference detection
- Improved voice assistant performance with faster response times and reduced latency
- Added visual indicators for modified files directly in the session list
- Implemented preferred language selection for voice assistant supporting 15+ languages

## Version 1 - 2025-05-12

Welcome to Happy - your secure, encrypted mobile companion for Claude Code. This inaugural release establishes the foundation for private, powerful AI interactions on the go.

- Implemented end-to-end encrypted session management ensuring complete privacy
- Integrated intelligent voice assistant with natural conversation capabilities
- Added experimental file manager with syntax highlighting and tree navigation
- Built seamless real-time synchronization across all your devices
- Established native support for iOS, Android, and responsive web interfaces
