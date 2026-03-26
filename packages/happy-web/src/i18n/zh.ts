export default {
  meta: {
    title: 'Happy Next — Claude Code、Codex 和 Gemini 的移动端与网页客户端',
    description: '用手机控制 AI 编程助手，免费、开源、端到端加密。',
  },
  nav: {
    docs: '文档',
    github: 'GitHub',
    app: '应用',
  },
  hero: {
    title: '随时随地控制\nAI 编程助手',
    subtitle: 'Claude Code、Codex 和 Gemini 的移动端与网页客户端。\n端到端加密，开源，支持私有化部署。',
    cta: '快速开始',
    ctaSecondary: '查看源码',
  },
  howItWorks: {
    title: '三步开始使用',
    step1: {
      title: '安装 CLI',
      description: '在开发机上安装命令行工具。',
      code: 'npm i -g happy-next-cli',
    },
    step2: {
      title: '启动会话',
      description: '运行 happy 启动 Claude Code 会话。',
      code: 'happy',
    },
    step3: {
      title: '连接手机',
      description: '用 Happy 应用扫描二维码即可配对。',
      code: '',
    },
  },
  features: {
    title: '一站式工具箱',
    subtitle: '远程管理 AI 编程助手所需的一切。',
    items: [
      {
        title: '多 Agent 控制',
        description: 'Claude Code、Codex 和 Gemini 三大 Agent 一等公民 — 会话恢复、模型选择、费用追踪。',
      },
      {
        title: '编排器',
        description: '定义多 Agent 任务 DAG，支持按任务指定模型和工作目录，自动调度执行。',
      },
      {
        title: '语音助手',
        description: '基于 LiveKit 的语音网关，支持可插拔的 STT/LLM/TTS，用语音和 AI 对话。',
      },
      {
        title: '代码浏览器',
        description: '在手机上浏览文件、查看差异、暂存、提交、撤销更改。',
      },
      {
        title: '端到端加密',
        description: '代码和对话在离开设备前即被加密，我们无法读取。',
      },
      {
        title: '支持私有化部署',
        description: '一行 Docker 命令即可部署，数据完全由你掌控。',
      },
      {
        title: '会话共享',
        description: '通过邀请或公开链接共享会话，实时同步，权限可控。',
      },
      {
        title: '推送通知',
        description: 'Agent 需要你的关注时即时提醒，在手机上快速审批权限。',
      },
    ],
  },
  multiAgent: {
    title: '三大 Agent，一个应用',
    subtitle: 'Happy Next 将 Claude Code、Codex 和 Gemini 视为同等的一等公民。',
    claude: { name: 'Claude Code', description: 'Anthropic 深度推理编程助手。' },
    codex: { name: 'Codex', description: 'OpenAI 命令行代码生成助手。' },
    gemini: { name: 'Gemini CLI', description: 'Google AI 终端助手。' },
  },
  download: {
    title: '获取应用',
    subtitle: '全平台支持，随时随地控制你的 AI 编程助手。',
    web: { name: 'Web 应用', description: '在浏览器中直接打开，无需安装。', cta: '打开 Web 应用' },
    ios: { name: 'iOS', description: '通过 TestFlight 下载测试版。', cta: '加入 TestFlight' },
    android: { name: 'Android', description: '从 GitHub 下载最新 APK。', cta: '下载 APK' },
  },
  selfHost: {
    title: '一行命令，私有化部署',
    subtitle: '用 Docker Compose 部署完整技术栈：Web 应用、API、语音网关、数据库 — 全部包含。',
    code: 'docker-compose up -d',
  },
  openSource: {
    title: '免费且开源',
    subtitle: 'MIT 协议，公开构建，欢迎贡献。',
    cta: '去 GitHub 点 Star',
  },
  footer: {
    product: '产品',
    resources: '资源',
    links: {
      docs: '文档',
      app: 'Web 应用',
      testflight: 'TestFlight',
      android: 'Android APK',
      github: 'GitHub',
      contributing: '参与贡献',
      security: '安全',
      support: '支持',
    },
    copyright: '© 2025-2026 Happy Next Contributors. MIT License.',
  },
} as const;
