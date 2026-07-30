<div align="center"><img src="/.github/logotype-dark.png" width="400" title="Happy Next" alt="Happy Next"/></div>

<h1 align="center">
  Claude Code、Codex 和 Gemini 的移动端和 Web 客户端
</h1>

<h4 align="center">
随时随地使用 Claude Code、Codex 或 Gemini，端到端加密。
</h4>

<div align="center">

[🖥️ **Web 应用**](https://app.happy-next.com/) • [📱 **TestFlight**](https://testflight.apple.com/join/XyjvbhXe) • [📦 **APK 下载**](https://github.com/hitosea/happy-next/releases/latest) • [📚 **文档**](docs/README.md) • [🇬🇧 **English**](README.md)

</div>

<img width="5178" height="2364" alt="Happy Next Overview" src="/.github/header-cn.png" />

<h3 align="center">
第一步：下载应用
</h3>

<div align="center">
<a href="https://testflight.apple.com/join/XyjvbhXe"><img src="/.github/badge-testflight.svg" height="39" alt="Download on TestFlight" /></a>
&nbsp;&nbsp;
<a href="https://github.com/hitosea/happy-next/releases/latest"><img src="/.github/badge-github-apk.svg" height="39" alt="Download on GitHub" /></a>
</div>

<h3 align="center">
第二步：在你的电脑上安装 CLI
</h3>

```bash
npm i -g happy-next-cli
```

<h3 align="center">
第三步：用 `happy` 代替 `claude`、`codex` 或 `gemini`
</h3>

```bash
# 原来用: claude
# 现在用: happy

happy

# 原来用: codex
# 现在用: happy codex

happy codex

# 原来用: gemini
# 现在用: happy gemini

happy gemini
```

运行 `happy` 会打印一个二维码用于设备配对。

- 用第一步下载的应用扫描二维码（或在浏览器中打开 [app.happy-next.com](https://app.happy-next.com/)）。
- 前提：安装你想要控制的供应商 CLI（`claude`、`codex` 和/或 `gemini`）。

<div align="center"><img src="/.github/mascot.png" width="200" title="Happy Next" alt="Happy Next"/></div>

## 🔥 为什么选择 Happy Next？

- 🎛️ **Claude、Codex 和 Gemini 的远程控制** — 三个 Agent 均为一等公民
- 🤖 **编排器** — 定义多 Agent 任务 DAG、自动调度执行，并查看关联的运行历史
- ⚡ **即时设备切换** — 一键夺回控制权
- 🔔 **推送通知** — 随时知道你的 Agent 需要关注
- 🔐 **端到端加密 + 可自托管** — 默认加密，一条命令 Docker 部署
- 🎙️ **语音助手** — 火山引擎（豆包）实时网关，流式语音、iOS 原生语音通话、可选音色 / 语速
- 🧰 **多仓库工作区** — 基于工作树的多仓库工作流，支持分支选择和 PR 创建
- 📁 **代码浏览器和 Git 管理** — 从手机浏览文件、查看 diff、暂存/提交/丢弃
- 📋 **DooTask 集成** — 任务管理，实时聊天，一键 AI 会话
- 📨 **待发消息队列** — CLI 繁忙时消息排队，就绪后自动分发
- 📱 **原生移动体验** — iOS / Android 平台原生底栏与 header，iPad 窗口化模式适配
- 🖥️ **桌面客户端** — 原生体验的 macOS 和 Windows 客户端，支持托盘、通知、快捷键和签名自动更新

## 工作原理

在电脑上运行 `happy` 代替 `claude`，`happy codex` 代替 `codex`，或 `happy gemini` 代替 `gemini`，通过我们的包装器启动你的 AI。当你想从手机上控制编码 Agent 时，它会以远程模式重启会话。要切换回电脑，只需按键盘上的任意键。

## Happy Next 新特性

Happy Next 是原版 Happy 的重大演进，以下是亮点：

### 桌面客户端（macOS + Windows）
- 提供 macOS 12+ Universal、Windows x64 和 Windows ARM64 直接下载版本
- 登录状态自适应窗口尺寸与原生状态恢复、macOS 无边框标题栏、集成式 Windows 标题栏、优化的全屏/标题栏交互、多显示器边界保护，以及带原生启动 Logo 的主题无闪烁启动
- 托盘常驻、关闭到托盘、单实例激活、可可靠恢复应用并打开对应会话的纯文本系统通知，以及统一的程序坞/任务栏未读提示
- 原生应用菜单、搜索与导航快捷键、可选开机启动和全局显示/隐藏快捷键
- 签名更新包在后台静默下载，由用户点击更新按钮后安装并重启
- 桌面诊断、轮转本地日志、WebKit 存储维护、上传失败恢复、麦克风/摄像头支持、原生上下文菜单、可靠且主题隔离的 HTML 预览窗口、兼容 CSP 的代码编辑、系统浏览器外链和受限原生权限

### 编排器（Orchestrator）
- 定义任务依赖图（DAG），支持按任务指定模型和工作目录
- 跨 Claude、Codex 和 Gemini 自动调度执行
- 实时状态徽章、活动计数（含排队任务，而不仅是运行中的任务）和状态颜色进度条
- 清晰的任务执行历史、更顺畅的运行导航，以及从编排器消息直达对应运行的链接
- 通过会话恢复跟进已完成任务
- MCP 工具集成，自动填充工作目录
- Happy CLI 启动时自动安装编排器 skill 和 `/orchestrator` 斜杠命令——直接在 CLI 里把任务并行或按依赖分发给 Claude / Codex / Gemini agent
- 内置 `/preview-html` 斜杠命令——在 CLI 里生成自包含 HTML 文档并直接在 app 内预览

### 待发消息队列
- CLI 繁忙时消息在服务端排队，就绪后自动分发
- 队列面板 UI，支持图片数量徽章和立即发送
- 排队消息可在发送前编辑，也可暂停或保存为草稿而不分发
- 重连同步和并发分发安全，分发时机经过调优，避免 CLI 繁忙时丢失排队消息

### 多 Agent 支持（Claude Code + Codex + Gemini）
- 三个 Agent 均为一等公民，支持会话恢复、复制/分叉和历史记录
- 多 Agent 历史页面，按供应商分标签页，支持设备和 Agent 类型筛选
- 按 Agent 选择模型、费用追踪和上下文窗口显示
- Codex 支持 ACP 和 App-Server（JSON-RPC）两种后端，Codex v0.145.0 支持 fast mode
- AI 后端配置文件，内置 DeepSeek、Z.AI、OpenAI、Azure 和 Google AI 预设
- 新增 Claude Opus 4.8 支持，过滤 4.x 模型的空 thinking 块以保证渲染干净
- 模型目录新增 Claude Fable 5（含 1M 上下文变体），提供 low / medium / high / xhigh / max 五档推理强度
- 新增 Claude Opus 5 和 Claude Sonnet 5，支持 1M 上下文、当前推理强度预设、快速模式能力识别和更新后的费用追踪
- 精简模型选择器：Claude 1M 上下文变体收进单个开关（模型从 12 个减到 7 个），宽屏下推理强度并排显示，Claude 默认 High 强度
- 新增 GPT-5.5 Codex 支持，提供 low/medium/high/xhigh 四档推理强度
- 刷新 Gemini 模型目录，加入 Gemini 3.6 Flash 和 Gemini 3.5 Flash-Lite，并保留 Gemini 3.1 Pro 与 Gemini 3.5 Flash

### 语音助手（Happy Voice）
- 语音网关认证改用短效 token，安全性提升
- 火山引擎（豆包）实时网关，统一驱动语音识别、LLM 与语音合成，替代此前的 LiveKit / ElevenLabs 方案
- iOS 原生通话内语音，支持流式语音合成；连接态基于房间状态变化收敛，通话中麦克风受保护
- 可选音色与语速；多语言回复默认使用 seed-tts-2.0 音色
- 语音合成前更智能的 LLM 文本清洗——简单短文本跳过清洗以降低延迟，通话内播报本地化
- 语音助手配置经端到端加密的用户设置跨设备同步
- 麦克风静音、语音消息发送确认、"思考中"指示器
- 上下文感知语音：应用状态自动注入到语音 LLM
- 在消息底部一键朗读任意 AI 回复——真流式合成边生成边播放,配合全局朗读队列与可拖拽悬浮播放器,可排队多条消息并在任意界面控制播放;v2 清洗提示词带 digest 模式,长消息会被凝练以获得更顺畅的朗读
- 语音管理会话——通过专用语音工具启动、切换、向会话发送消息，会话设置收敛为单一 mode 参数，标题更清晰，会话选择器取消按钮带自动关闭倒计时

### 多仓库工作树工作区
- 从应用中创建、切换和归档多仓库工作区
- 按仓库选择分支、设置和脚本
- 跨仓库聚合 git 状态
- 自动生成工作区 `CLAUDE.md` / `AGENTS.md`（含 `@import` 引用）
- 工作树合并和 PR 创建，支持目标分支选择
- AI 驱动的 PR 代码审查，结果发布为 GitHub 评论

### 代码浏览器和 Git 管理
- 完整的文件浏览器，支持搜索、Monaco 编辑器查看/编辑
- 提交历史，支持分支选择器（本地 + 远程）
- Git 变更页面：暂存、取消暂存、提交、丢弃
- 按文件差异统计（+N/-N），支持 Claude、Codex 和 Gemini
- 图片预览，支持分享
- 提交列表标记上游分支 tip 所在的 commit
- 可直接从导航栏复制当前浏览器面包屑路径
- 批量 Git 操作执行期间显示加载反馈
- 从 git 状态打开文件页时自动聚焦相关变更文件

### 会话共享
- 直接邀请好友或通过公开链接分享会话
- 端到端加密：直接分享使用 NaCl Box，公开链接使用 token 派生密钥
- 实时同步消息、git 状态和语音聊天
- 按访问级别（查看/编辑/管理）控制权限
- 会话列表"全部/共享给我/我分享的"过滤标签和共享指示器
- 公开分享网页查看器，无需安装应用即可访问，消息分页加载，长共享会话打开更快

### OpenClaw 网关
- 通过中继隧道或直连 WebSocket 连接外部 AI 机器
- Ed25519 密钥交换进行机器配对
- 聊天界面，支持实时流式传输和会话管理
- 丰富内容块渲染：支持外部 AI 的 thinking、tool use 和 image 内容块

### DooTask 集成
- 任务列表，支持过滤、搜索、分页和状态工作流
- 任务详情，支持 HTML 渲染、负责人、文件、子任务
- 实时 WebSocket 聊天（Slack 风格布局、表情回应、语音回放、图片/视频）
- 从任一任务一键启动 AI 会话（MCP 服务透传）
- 在应用内直接创建任务和项目，跨平台日期选择器
- 全局化 WebSocket 连接，实时任务更新，持久化服务端连接
- DooTask 最近会话合并进收件箱，持久化缓存 + 后台静默刷新
- DooTask 关联会话显示头像，chat header 按对话类型自适应

### 自托管
- 一条命令 `docker-compose up`（Web + API + Voice + Postgres + Redis + MinIO）
- 桌面端设置页新增自定义服务器快捷按钮，方便快速配置服务器
- 支持 API 和语音配置端点的服务发现
- 未配置自定义/自托管服务器时，会在官方默认 API 配置端点间竞速，选择最快可用入口
- 独立源架构（无路径反向代理）
- `.env.example` 包含完整配置参考
- Docker 构建的运行时环境变量注入
- 零成本 nginx `/healthz` 端点，用于负载均衡器/在线检测探针

### 同步和可靠性
- v3 消息 API，基于 seq 的同步、批量写入和游标分页
- WebSocket 不可用时的 HTTP 发件箱可靠投递
- 服务端确认消息发送，支持重试和消息接收追踪
- 修复游标跳过、发件箱竞争、消息重复/丢失
- 聊天 reducer 不再合成乱序的 completed-permission 消息
- 弱网下消息发送加固；发送进行中时抑制草稿恢复
- 会话加载可靠性：消息抓取超时提升到 60s，从永久加载失败中自动恢复，刷新指示器在整个重试循环里保持显示，超大消息载荷的 base64 编码改为分块以避免栈溢出
- 本地持久化消息缓存让重新打开会话时更快显示已有历史
- 会话草稿重写为单一数据源 — 草稿消失/重现的情况减少

### 聊天和会话体验
- 图片附件和剪贴板粘贴（Web），草稿支持图片；上传最大尺寸提升到 1568px 并跳过冗余压缩，保留代码截图和 UI 截图的文字清晰度
- 新会话标题以第一条用户消息播种（AI 摘要生成后再接管），不再使用目录名兜底
- 即使 Agent 没有 assistant 消息（如未知斜杠命令），CLI 的 result 文本也会呈现到手机端，不再出现空白回复
- 斜杠命令自动补全显示每个命令的来源 scope（仓库 / 用户 / 插件 / 系统）与类型；会话能力独立于 metadata 存储并实时同步，命令与技能列表始终保持最新
- `/duplicate` 命令从任意消息分叉会话，包括直接从 AI 回复分叉，并更可靠地解析对应的用户消息目标
- 发送后立即显示乐观的"Processing…"状态，消息列表重载时显示"refreshing"指示器
- 消息分页、未读蓝点指示器、紧凑列表视图
- 对话缩略图导航面板——点击可快速跳转到长对话的任意位置，从离线消息缓存填充，消息未加载完或离线时也能看到导航概览
- 优化 minimap 覆层位置，让长对话导航更顺手
- Web 对话列表重写为模型驱动的虚拟化列表——跳转到某条消息时即时居中（已在目标处则给出轻微抖动反馈），历史随滚动按需加载；滚动经过稳定化处理,手势中不再跳动、滚动到底部精确落到真实底部,并用代理滚动条替换被扭曲的原生滚动条以呈现诚实的滚动位置
- 上下文用量提示框——在上下文指示器上展示 token 用量明细
- Web 侧边栏可调宽度——拖拽边缘调整侧边栏宽度
- 新建会话时自动选择最佳可用机器
- 按机器分会话标签页（会话按其运行所在的机器分组），每个标签页带稳定的状态圆点——该机器上有会话需要授权时显示橙色，并反映实时 thinking 状态，而聚合的「全部」标签页不显示圆点；会话预览展开/折叠、元数据缓存
- 可折叠项目文件夹将相关会话分组，并在本地保留文件夹状态
- 存在共享会话时仍显示机器标签页，「我分享的」列表会在分享状态变化后刷新
- 最近会话历史分页，加快首屏加载
- 会话重命名并锁定（防止 AI 自动更新）、历史搜索
- 会话详情提供常用会话任务的快捷操作
- 选项点击发送 / 长按填充、滚动到底部按钮
- "始终显示上下文大小"默认开启，无需进入会话详情即可看到用量
- 逐条消息 action bar：复制、从此处分叉（带进度转圈）、朗读、以及完整时间戳（Web 悬浮 / 原生点按显示）
- Web 桌面端：消息悬浮显示复制按钮、右键 option 复用移动端长按行为
- 移动端文本选择：选择页改用浏览器原生长按 + 静态语法高亮（Lezer），Android 首次长按即可选中
- 下拉刷新、内嵌分隔线、Agent tool 展示（机器人图标）
- 工具输入/输出格式化为 key-value 对（替代原始 JSON）
- 未识别的工具调用以通用的 'other' 块渲染（带动态标题和图标），不再显示空占位
- Agent event 消息会用 strip-ansi 过滤子 CLI stderr 中的 ANSI 转义码，子进程启动横幅的颜色序列不再以 `[90m…[0m` 形式泄露到聊天里
- `preview_html` 工具支持全页面 HTML 预览，受支持的工具消息可直接打开预览，并支持冒号分隔 MCP 工具命名
- Codex 会话运行时保留并显示进行中的计划步骤
- CLI 会话中途热升级
- 路径选择器支持目录自动补全，通过远程机器列表实现（Web + 移动端）
- Session header 在 iOS / Android / Web 端统一为左对齐标题，header 右侧新增"新建会话"按钮，会话详情页加上 header 标题
- 会话与机器页面的返回按钮和 header 操作保持一致对齐
- 超长用户消息（>20k 字符）折叠为带"展开更多"按钮的预览；Web 端消息内文本选择修复
- 已安装的 Codex skills 会出现在斜杠命令自动补全中；短屏空状态和 Web 首条消息布局更加可靠

### CLI
- `happy update` 自更新、`happy --version` 显示所有 Agent 版本
- 守护进程开机自启动（`happy daemon enable/disable`）、重启命令
- 统一 Codex 和 Gemini 系统提示注入
- 消息接收追踪，兼容旧版本
- 应用端切换的权限模式现在会同步转发到运行中的 Claude 子进程（不再要等到下一条消息生效）
- Stop/ESC 中断现在会让 Claude 与 Codex 后端保持 warm 状态，下一条消息立即续上，不再每次中断都冷启动；Gemini 的中断反馈也对齐 Claude/Codex，发送 `[Request interrupted by user]` 标记
- 切换模型或开关 plan 模式时，在已 warm 的 Claude 子进程上原地热切换，不再冷重启，改动会话中途立即生效
- 会话从 remote 切回 local 时清理终端 stdin，残留的 raw-mode 输入不再泄漏到终端
- 正确解析多行 skill metadata，并稳定发现已启用的 Codex plugin skills

### Bug 修复和稳定性
- 255+ Bug 修复：消息发送可靠性、会话生命周期、Markdown 渲染、导航、语音、DooTask、共享
- 安全：Shell 命令注入修复、计划模式权限处理
- 性能：移动端载荷精简、延迟加载 diff、渲染优化、打开会话增量追赶

### UI 和打磨
- 原生平台感的移动体验：iOS / Android 首页、聊天、收件箱采用平台原生底栏与原生 header
- 底栏顺序调整为收件箱优先，标签"Terminal"改名"Session"，并替换 brutalist 占位符为正式导航图标
- iOS 打磨：返回按钮统一 chevron-only、header 头像几何/裁剪修正、原生 header 标题居中、集中式状态栏控制器，以及键盘显示时稳定的操作菜单
- iOS 26 适配：scroll-edge 渐隐抑制、键盘下全屏半透明聊天叠层、prompt modal 呈现
- iPad / Mac 窗口化打磨：侧栏 header 为窗口控件预留空间，修复 session header resize、top tab insets、列表分割线渲染、窗口键盘遮挡
- Web：底栏 bundling 修复、session header 导航修复、路径补全焦点处理
- 刷新 Happy Next Logo、favicon、启动图、通知资源以及移动端/桌面端图标
- 系统自适应主题更新可可靠应用到 app 和桌面登录窗口
- iOS 扫描器摄像头权限说明会直接进入系统权限请求，并移除未使用的运动权限
- 全应用暗色模式修复
- i18n 改进（简体中文/繁体中文、CJK 输入处理）
- Markdown 渲染：表格、内联代码、嵌套代码块、可点击文件路径
- 键盘处理、加载状态、导航稳定性、图标字体预加载

完整变更日志：[docs/changes-from-happy.zh-CN.md](docs/changes-from-happy.zh-CN.md)

## 项目组件

- **[Happy App](packages/happy-app)** — Web UI + 移动客户端（Expo）
- **[Happy CLI](packages/happy-cli)** — Claude Code、Codex 和 Gemini 的命令行界面
- **[Happy Server](packages/happy-server)** — 加密同步后端服务器
- **[Happy Voice](packages/happy-voice)** — 语音网关（基于火山引擎/豆包）
- **[Happy Wire](packages/happy-wire)** — 共享线路类型和 Schema

## 自托管（Docker Compose）

完整的自托管部署指南请参阅 **[自托管文档](docs/self-host.zh-CN.md)**。

## 兼容性说明

Happy Next 在品牌重塑中有意更改了客户端 KDF 标签。请将其视为**全新一代**：不要期望旧客户端创建的加密数据能被 Happy Next 读取（反之亦然）。

## 关于我们

我们开发 Happy Next，是因为我们想在任何地方（Web/移动端）监控编码 Agent，同时不放弃控制权、隐私或自托管的选择。

## 文档和贡献

- **[文档](docs/README.md)** — 了解 Happy Next 的工作原理（协议、部署、自托管、架构）
- **[CONTRIBUTING.md](CONTRIBUTING.md)** — 开发环境搭建和贡献指南
- **[SECURITY.md](SECURITY.md)** — 安全漏洞报告政策
- **[SUPPORT.md](SUPPORT.md)** — 支持与故障排查

## 许可证

MIT 许可证 — 详见 [LICENSE](LICENSE)。
