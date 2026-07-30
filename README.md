<div align="center"><img src="/.github/logotype-dark.png" width="400" title="Happy Next" alt="Happy Next"/></div>

<h1 align="center">
  Mobile and Web Client for Claude Code, Codex & Gemini
</h1>

<h4 align="center">
Use Claude Code, Codex, or Gemini from anywhere with end-to-end encryption.
</h4>

<div align="center">
  
[🖥️ **Web App**](https://app.happy-next.com/) • [📱 **TestFlight**](https://testflight.apple.com/join/XyjvbhXe) • [📦 **APK Download**](https://github.com/hitosea/happy-next/releases/latest) • [📚 **Documentation**](docs/README.md) • [🇨🇳 **中文**](README.zh-CN.md)

</div>

<img width="5178" height="2364" alt="Happy Next Overview" src="/.github/header.png" />

<h3 align="center">
Step 1: Download App
</h3>

<div align="center">
<a href="https://testflight.apple.com/join/XyjvbhXe"><img src="/.github/badge-testflight.svg" height="39" alt="Download on TestFlight" /></a>
&nbsp;&nbsp;
<a href="https://github.com/hitosea/happy-next/releases/latest"><img src="/.github/badge-github-apk.svg" height="39" alt="Get it on GitHub" /></a>
</div>

<h3 align="center">
Step 2: Install CLI on your computer
</h3>

```bash
npm i -g happy-next-cli
```

<h3 align="center">
Step 3: Start using `happy` instead of `claude`, `codex`, or `gemini`
</h3>

```bash
# Instead of: claude
# Use: happy

happy

# Instead of: codex
# Use: happy codex

happy codex

# Instead of: gemini
# Use: happy gemini

happy gemini
```

Running `happy` prints a QR code for device pairing.

- Scan the QR code with the app you downloaded in Step 1 (or open [app.happy-next.com](https://app.happy-next.com/) in a browser).
- Prerequisite: install the vendor CLI(s) you want to control (`claude`, `codex`, and/or `gemini`).

<div align="center"><img src="/.github/mascot.png" width="200" title="Happy Next" alt="Happy Next"/></div>

## 🔥 Why Happy Next?

- 🎛️ **Remote control for Claude, Codex & Gemini** - All three agents as first-class citizens
- 🤖 **Orchestrator** - Define multi-agent task DAGs, auto-schedule execution, and inspect linked run history
- ⚡ **Instant device handoff** - Take back control with a single keypress
- 🔔 **Push notifications** - Know when your agent needs attention
- 🔐 **E2EE + self-host option** - Encrypted by default, one-command Docker deployment
- 🎙️ **Voice assistant** - Volcano (Doubao) real-time gateway with streaming speech, native iOS voice calls, and selectable voice timbre / speech rate
- 🧰 **Multi-repo workspaces** - Worktree-based multi-repo flows with branch selection and PR creation
- 📁 **Code browser & git management** - Browse files, view diffs, stage/commit/discard from your phone
- 📋 **DooTask integration** - Task management with real-time chat and one-click AI sessions
- 📨 **Pending message queue** - Messages queued and auto-dispatched when CLI is ready
- 📱 **Native mobile UX** - Platform-native bottom tabs and headers on iOS / Android, iPad windowed-mode polish
- 🖥️ **Desktop apps** - Native-feeling macOS and Windows clients with tray residency, notifications, shortcuts, and signed updates

## How does it work?

On your computer, run `happy` instead of `claude`, `happy codex` instead of `codex`, or `happy gemini` instead of `gemini` to start your AI through our wrapper. When you want to control your coding agent from your phone, it restarts the session in remote mode. To switch back to your computer, just press any key on your keyboard.

## What’s new in Happy Next

Happy Next is a major evolution of the original Happy. Here are the highlights:

### Desktop Apps (macOS + Windows)
- Direct-download clients for macOS 12+ Universal, Windows x64, and Windows ARM64
- Native window sizing and restoration, frameless macOS title-bar integration, an integrated Windows title bar, refined fullscreen/title-bar interactions, multi-monitor bounds protection, and theme-correct startup with a native startup logo
- Tray residency, close-to-tray behavior, single-instance activation, clean plain-text native notifications that reliably restore the app and open the corresponding session, and unified Dock/taskbar unread indicators
- Native application menus, search and navigation shortcuts, optional launch at sign-in, and a global show/hide shortcut
- Signed automatic updates download quietly in the background and wait for the user to install and restart
- Desktop diagnostics, rotating local logs, WebKit storage maintenance, upload retry recovery, microphone/camera support, native context menus, reliable theme-isolated HTML preview windows, CSP-compatible code editing, system-browser external links, and restricted native capabilities

### Orchestrator
- Define task dependency graphs (DAGs) with per-task model and working directory
- Auto-schedule execution across Claude, Codex, and Gemini agents
- Real-time status badges, an activity count that includes queued (not just running) tasks, and status-colored progress bars
- Clear task execution history, streamlined run navigation, and direct links from Orchestrator messages to their runs
- Follow up on completed tasks via session resume
- MCP tool integration with auto-filled working directory
- Happy CLI auto-installs the orchestrator skill and `/orchestrator` slash commands on startup — fan a task out to parallel or dependency-ordered Claude / Codex / Gemini agents straight from the CLI
- Built-in `/preview-html` slash command — generate a self-contained HTML document from the CLI and preview it directly in the app

### Pending Message Queue
- Messages sent while the CLI is busy are queued server-side and auto-dispatched
- Queue panel UI with image count badges and send-now option
- Edit a queued message before it sends, or pause it / save it as a draft instead of dispatching
- Reconnect sync and concurrent dispatch safety, with dispatch timing tuned to avoid dropping a queued message on a busy CLI

### Multi-Agent (Claude Code + Codex + Gemini)
- All three agents are first-class citizens with session resume, duplicate/fork, and history
- Multi-agent history page with per-provider tabs, device and agent filter dropdowns
- Per-agent model selection, cost tracking, and context window display
- ACP and App-Server (JSON-RPC) backends for Codex, Codex v0.145.0 with fast mode
- AI backend profiles with presets for DeepSeek, Z.AI, OpenAI, Azure, and Google AI
- Claude Opus 4.8 support with empty thinking block filtering for clean 4.x rendering
- Claude Fable 5 (with 1M-context variant) in the Claude model catalog, with low / medium / high / xhigh / max reasoning effort presets
- Claude Opus 5 and Claude Sonnet 5 with 1M context, current reasoning-effort presets, fast-mode capability detection, and updated cost tracking
- Streamlined model picker: Claude 1M-context variants collapse into a single toggle (7 models instead of 12), reasoning-effort presets show side by side on wide screens, and Claude defaults to High effort
- GPT-5.5 support for Codex with low/medium/high/xhigh reasoning levels
- Gemini 3.6 Flash and Gemini 3.5 Flash-Lite join the refreshed Gemini catalog alongside Gemini 3.1 Pro and Gemini 3.5 Flash

### Voice Assistant (Happy Voice)
- Voice gateway auth now uses short-lived tokens for improved security
- Volcano (火山引擎 / Doubao) real-time gateway powering speech-to-text, LLM, and text-to-speech, replacing the earlier LiveKit / ElevenLabs stack
- Native in-call voice on iOS with streaming text-to-speech, connection state gated on room-state changes, and the microphone guarded during a call
- Selectable voice timbre and speech rate; multilingual replies default to the seed-tts-2.0 voice
- Smarter LLM text cleaning before speech — trivial short text skips cleaning to cut latency, with localized in-call announcements
- Voice assistant configuration syncs across devices via end-to-end-encrypted user settings
- Microphone mute, voice message send confirmation, "thinking" indicator
- Context-aware voice: app state is injected into the voice LLM automatically
- Read any AI reply aloud with a one-tap voice button in the message footer — true streaming text-to-speech starts playback as audio is synthesized, backed by a global read-aloud queue and a draggable floating player so you can line up messages and control playback from anywhere; a v2 text-cleanup prompt with a digest mode condenses long messages for smoother narration
- Manage sessions by voice — start, switch, and message a session through dedicated voice tools with a single session-settings mode parameter, clearer titles, and an auto-close countdown on the session-picker cancel button

### Multi-Repo Worktree Workspaces
- Create, switch, and archive multi-repo workspaces from the app
- Per-repo branch selection, settings, and scripts
- Aggregated git status across repos
- Auto-generate workspace `CLAUDE.md` / `AGENTS.md` with `@import` refs
- Worktree merge and PR creation with target branch selection
- AI-powered PR code review with results posted as GitHub comments

### Code Browser & Git Management
- Full file browser with search, Monaco editor viewing/editing
- Commit history with branch selector (local + remote)
- Git changes page: stage, unstage, commit, discard
- Per-file diff stats (+N/-N) for Claude, Codex, and Gemini
- Image preview with sharing support
- Commits list tags the commit at the upstream branch tip
- Copy the current browser breadcrumb path directly from the navigation bar
- Loading feedback for bulk git actions while the operation runs
- Opening Files from git status focuses the relevant changed files

### Session Sharing
- Share sessions with friends via direct invite or public link
- End-to-end encrypted: NaCl Box (direct) and token-derived keys (public links)
- Real-time sync of messages, git status, and voice chat across shared users
- Access control with view, edit, and admin permission levels
- "All / Shared with me / Shared by me" filter tabs and share indicator in session list
- Public share web viewer for link-based access, with paginated message loading so long shared conversations open faster

### OpenClaw Gateway
- Connect to external AI machines via relay tunnel or direct WebSocket
- Machine pairing with Ed25519 key exchange
- Chat interface with real-time streaming and session management
- Rich content block rendering: thinking, tool use, and image blocks from external AI

### DooTask Integration
- Task list with filters, search, pagination, and status workflows
- Task detail with HTML rendering, assignees, files, sub-tasks
- Real-time WebSocket chat (Slack-style layout, emoji reactions, voice playback, images/video)
- One-click AI session launch from any task (MCP server passthrough)
- Create tasks and projects directly from the app with cross-platform date picker
- Globalized WebSocket connection with real-time task updates and persistent server-side connection
- DooTask recents merged into the main inbox with persistent cache and silent background refresh
- Session avatars on DooTask-related sessions, chat header adapts to dialog type

### Self-Hosting
- One-command `docker-compose up` (Web + API + Voice + Postgres + Redis + MinIO)
- Custom server shortcut button in desktop settings for quick server configuration
- Service discovery for API and voice config endpoints
- Default API endpoint racing chooses the fastest official config endpoint when no custom/self-host server is configured
- Separate origins architecture (no path reverse proxy)
- `.env.example` with full configuration reference
- Runtime env var injection for Docker builds
- Zero-cost nginx `/healthz` endpoint for load-balancer / uptime probes

### Sync & Reliability
- v3 messages API with seq-based sync, batch writes, and cursor pagination
- HTTP outbox for reliable delivery when WebSocket is unavailable
- Server-confirmed message sending with retry and message receipt tracking
- Fixes for cursor skip, outbox race, message duplication/loss
- Chat reducer no longer synthesizes out-of-order completed-permission messages
- Message send hardened for flaky networks; draft restore is suppressed while a send is in flight
- Session loading reliability: 60s message-fetch timeout, recovery from permanent load failure, refresh indicator across the entire retry loop, and chunked base64 encoding to avoid stack overflow on very large payloads
- Persistent local message cache shows existing conversation history faster when reopening sessions
- Session draft rewritten as a single source of truth — fewer cases of drafts vanishing or reappearing

### Chat & Session UX
- Image attachment and clipboard paste (web), image support in drafts, high-quality pass-through up to 1568px preserving text sharpness in code/UI screenshots
- Session titles seeded from the first user message for new sessions (until an AI summary takes over)
- Slash command results surface even when the agent emits no assistant message (e.g. unknown commands no longer blank out)
- Slash-command autocomplete shows each command's source scope (repo / user / plugin / system) and kind; session capabilities are stored separately from metadata and sync live so command and skill lists stay fresh
- `/duplicate` command to fork a session from any message, including directly from an AI reply, with more reliable user-message target resolution
- Sending shows an optimistic "Processing…" status immediately, plus a "refreshing" indicator while the message list reloads
- Message pagination, unread blue dot indicator, compact list view
- Conversation minimap panel — tap to jump to any part of a long conversation at a glance, populated from the offline message cache so the overview is available even before messages finish loading or while offline
- Minimap overlay placement is polished for smoother long-conversation navigation
- Web conversation list rebuilt as a model-driven virtualized list — jumping to a message centers instantly (with a subtle shake when you're already there) and history loads on demand as you scroll; scrolling is stabilized so gestures don't jump, scroll-to-bottom lands on the true bottom, and a proxy scrollbar replaces the distorted native one for an honest scroll position
- Context usage tooltip on the context indicator showing token-count breakdown details
- Resizable sidebar on web — drag the edge to adjust width
- New session defaults now pick the best available machine automatically
- Per-machine session tabs (sessions grouped by the machine they run on), each tab showing a stable status dot — orange when a session on that machine needs permission, reflecting the live thinking state — while the aggregate 'all' tab stays dot-free; session preview expand/collapse, metadata caching
- Collapsible project folders group related sessions, with folder state retained locally
- Machine tabs remain visible when shared sessions are present, and the Shared by me list refreshes after sharing changes
- Recent session history pagination for faster initial load
- Session rename with lock (prevent AI auto-update), search in history
- Session-info quick actions for common session tasks
- Options click-to-send / long-press-to-fill, scroll-to-bottom button
- "Always show context size" defaults to on so usage is visible without opening session details
- Per-message action bar with copy, fork-from-here (with progress spinner), read-aloud, and full timestamp on web hover / native tap
- Web desktop: hover-to-show copy button on chat messages and right-click on options reusing the mobile long-press behavior
- Mobile text selection: in-app selection page uses browser-native long-press with static syntax highlighting (Lezer) for reliable first-tap selection on Android
- Pull-to-refresh, inset dividers, Agent tool display with robot icon
- Tool input/output formatted as key-value pairs instead of raw JSON
- Unrecognized tool calls render as a generic 'other' block with a dynamic title and icon, instead of an empty placeholder
- Agent event messages strip ANSI escape codes from child-CLI stderr so subprocess banner color sequences no longer leak into the chat as raw `[90m…[0m`
- `preview_html` tool for full-page HTML preview, with supported tool messages opening previews directly, plus colon-separated MCP tool naming
- Codex in-progress plan steps remain visible while a session is running
- CLI hot-upgrade support mid-session
- Path picker with directory autocomplete via remote machine listing (web + mobile)
- Session header unified across iOS / Android / web with left-aligned title, new-session button on the header right, and a header title in the session info screen
- Consistent back-button and header-action alignment across session and machine screens
- Long user messages (>20k characters) collapse to a preview with a Show More toggle; text selection inside messages on web is fixed
- Installed Codex skills appear in slash-command autocomplete; short-screen empty states and initial web-message layout are more reliable

### CLI
- `happy update` self-upgrade, `happy --version` with all agent versions
- Daemon auto-start on boot (`happy daemon enable/disable`), restart command
- Unified system prompt injection for Codex and Gemini
- Message receipt tracking with legacy compatibility
- Permission-mode switches from the app forward synchronously to the running Claude subprocess (no longer wait until the next message)
- Stop/ESC interrupts now keep the Claude and Codex backends warm so the next message resumes instantly instead of cold-restarting; Gemini's interrupt feedback now matches Claude/Codex with a `[Request interrupted by user]` marker
- Switching model or toggling plan mode hot-swaps on the already-warm Claude subprocess instead of cold-restarting, so changes apply instantly mid-session
- Switching a session from remote back to local cleans up terminal stdin so leftover raw-mode input no longer leaks into the terminal
- Multiline skill metadata parses correctly, and enabled Codex plugin skills are discovered consistently

### Bug Fixes & Stability
- 255+ bug fixes: message sending reliability, session lifecycle, Markdown rendering, navigation, voice, DooTask, sharing
- Security: shell command injection fix, plan mode permission handling
- Performance: payload trimming for mobile, lazy-load diffs, rendering optimization, incremental session catch-up on open

### UI & Polish
- Native platform-feel mobile UX: iOS / Android use the platform-native bottom tab bar and native header on home, chat, and inbox screens
- Inbox-first bottom tab order, "Session" tab label, dedicated navigation icons (no more brutalist placeholders)
- iOS polish: chevron-only back button, header avatar geometry/clipping fixes, centered native header title, centralized status bar controller, and stable action menus while the keyboard is visible
- iOS 26 fixes: scroll-edge fade suppression, full-screen translucent chat overlay with keyboard, prompt modal presentation
- iPad / Mac windowed-mode polish: sidebar header reserves space for window controls, fixed session header resize, top-tab insets, list divider rendering, and windowed keyboard overlap
- Web: bottom tab bundling fix, session header navigation fix, path autocomplete focus handling
- Refreshed Happy Next logos, favicons, splash screens, notification assets, and mobile/desktop icons
- Adaptive system-theme updates now apply reliably across app and desktop authentication windows
- iOS scanner camera-permission flow proceeds directly from its explanation to the system request, with the unused motion permission removed
- Dark mode fixes throughout the app
- i18n improvements (Chinese Simplified/Traditional, CJK input handling)
- Markdown rendering: tables, inline code, nested fences, clickable file paths
- Keyboard handling, loading states, navigation stability, icon font preloading

Full changelog: [docs/changes-from-happy.md](docs/changes-from-happy.md)

## 📦 Project Components

- **[Happy App](packages/happy-app)** - Web UI + mobile client (Expo)
- **[Happy CLI](packages/happy-cli)** - Command-line interface for Claude Code, Codex, and Gemini
- **[Happy Server](packages/happy-server)** - Backend server for encrypted sync
- **[Happy Voice](packages/happy-voice)** - Voice gateway (Volcengine/Doubao-based)
- **[Happy Wire](packages/happy-wire)** - Shared wire types and schemas

## Self-host (Docker Compose)

See the **[Self-Hosting Guide](docs/self-host.md)** for complete setup instructions.

## Compatibility note

Happy Next intentionally changed client KDF labels as part of the rebrand. Treat this as a **new generation**: do not expect encrypted data created by older clients to be readable by Happy Next (and vice versa).

## 🏠 Who We Are

We build Happy Next because we want to supervise coding agents from anywhere (web/mobile) without giving up control, privacy, or the option to self-host.

## 📚 Documentation & Contributing

- **[Documentation](docs/README.md)** - Learn how Happy Next works (protocol, deployment, self-host, architecture)
- **[CONTRIBUTING.md](CONTRIBUTING.md)** - Development setup and contributing guidelines
- **[SECURITY.md](SECURITY.md)** - Security vulnerability reporting policy
- **[SUPPORT.md](SUPPORT.md)** - Support and troubleshooting

## License

MIT License - see [LICENSE](LICENSE) for details.
