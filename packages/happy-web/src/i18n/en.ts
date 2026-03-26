export default {
  meta: {
    title: 'Happy Next — Mobile & Web Client for Claude Code, Codex & Gemini',
    description: 'Control AI coding agents from your phone. Free, open source, end-to-end encrypted.',
  },
  nav: {
    docs: 'Docs',
    github: 'GitHub',
    app: 'App',
  },
  hero: {
    title: 'Control AI Coding Agents\nFrom Anywhere',
    subtitle: 'Mobile and web client for Claude Code, Codex & Gemini.\nEnd-to-end encrypted. Open source. Self-hostable.',
    cta: 'Get Started',
    ctaSecondary: 'View on GitHub',
  },
  howItWorks: {
    title: 'Get Started in 3 Steps',
    step1: {
      title: 'Install CLI',
      description: 'Install the CLI on your development machine.',
      code: 'npm i -g happy-next-cli',
    },
    step2: {
      title: 'Start a Session',
      description: 'Run happy to start a Claude Code session.',
      code: 'happy',
    },
    step3: {
      title: 'Connect Your Phone',
      description: 'Scan the QR code with the Happy app to pair.',
      code: '',
    },
  },
  features: {
    title: 'Everything You Need',
    subtitle: 'A complete toolkit for managing AI coding agents remotely.',
    items: [
      {
        title: 'Multi-Agent Control',
        description: 'Claude Code, Codex, and Gemini as first-class agents — session resume, model selection, and cost tracking.',
      },
      {
        title: 'Orchestrator',
        description: 'Define multi-agent task DAGs with per-task model and working directory. Auto-schedule execution.',
      },
      {
        title: 'Voice Assistant',
        description: 'LiveKit-based voice gateway with pluggable STT/LLM/TTS. Talk to your AI instead of typing.',
      },
      {
        title: 'Code Browser',
        description: 'Browse files, view diffs, stage, commit, and discard changes — all from your phone.',
      },
      {
        title: 'E2E Encryption',
        description: 'Your code and conversations are encrypted before leaving your device. We cannot read them.',
      },
      {
        title: 'Self-Hostable',
        description: 'One-command Docker deployment. Your data, your server, your rules.',
      },
      {
        title: 'Session Sharing',
        description: 'Share sessions via direct invite or public link with real-time sync and access control.',
      },
      {
        title: 'Push Notifications',
        description: 'Know when your agent needs attention. Approve permissions from your phone instantly.',
      },
    ],
  },
  multiAgent: {
    title: 'Three Agents. One App.',
    subtitle: 'Happy Next treats Claude Code, Codex, and Gemini as equal first-class agents.',
    claude: { name: 'Claude Code', description: 'Anthropic\'s coding agent with deep reasoning.' },
    codex: { name: 'Codex', description: 'OpenAI\'s CLI agent for code generation.' },
    gemini: { name: 'Gemini CLI', description: 'Google\'s AI agent for the terminal.' },
  },
  download: {
    title: 'Get the App',
    subtitle: 'Available on every platform. Control your AI agents from anywhere.',
    web: { name: 'Web App', description: 'Open in your browser, no install needed.', cta: 'Open Web App' },
    ios: { name: 'iOS', description: 'Download via TestFlight (beta).', cta: 'Join TestFlight' },
    android: { name: 'Android', description: 'Download the latest APK from GitHub.', cta: 'Download APK' },
  },
  selfHost: {
    title: 'Self-Host in One Command',
    subtitle: 'Deploy the entire stack with Docker Compose. Web app, API, voice gateway, database — all included.',
    code: 'docker-compose up -d',
  },
  openSource: {
    title: 'Free & Open Source',
    subtitle: 'MIT licensed. Built in the open. Contributions welcome.',
    cta: 'Star on GitHub',
  },
  footer: {
    product: 'Product',
    resources: 'Resources',
    links: {
      docs: 'Documentation',
      app: 'Web App',
      testflight: 'TestFlight',
      android: 'Android APK',
      github: 'GitHub',
      contributing: 'Contributing',
      security: 'Security',
      support: 'Support',
    },
    copyright: '© 2025-2026 Happy Next Contributors. MIT License.',
  },
} as const;
