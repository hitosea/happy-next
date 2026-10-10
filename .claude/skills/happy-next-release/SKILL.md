---
name: happy-next-release
description: Cuts a happy-next release — audits changes, recommends which of CLI, GitHub Release, Docker and iOS App Store to publish, confirms one release plan, then runs it end to end. Command-only — invoked via /happy-next-release.
---

# Happy Next 发布流程

## 总则

流程分四段：**自动检查 → 确认发布计划 → 执行 → 失败处理**。

- 根据审计结果推荐发布线组合，写进发布计划。
- 用户在调用时用自然语言说明了要发什么（如"只发 Docker"、"这次不发 CLI"、"把 v2.15.1 提交到 App Store"），按用户的意思确定发布线，其余流程相同；意思不明确时在发布计划里写出你的理解。
- **只确认一次**：发布计划。用户确认（或修改后确认）即授权执行计划内的全部操作，包括推送 main、合并 PR、npm 发布、创建 tag、GitHub Release、Docker 和 iOS 提审。确认后直接执行，直到完成或遇到停止条件。
- 计划外的操作（计划外的改动、覆盖、重建、删除）需单独确认。

四条发布线：

| 线 | 产物 | 版本 | workflow |
|---|---|---|---|
| CLI | npm `happy-next-cli` | `packages/happy-cli/package.json` 独立版本，由 workflow 提交 | `cli-publish.yml` |
| Release | Android APK/AAB、iOS IPA、macOS Universal、Windows x64/ARM64、`latest.json` | `vX.Y.Z` tag | `release.yml` |
| Docker | `kuaifan/happy-{server,app,voice,docs,web}` | 同一 `vX.Y.Z` tag | `docker-publish.yml` |
| iOS | App Store Connect 上传 | 同一 `vX.Y.Z` tag，提交 Release 里那份 IPA | `ios-submit.yml` |

- Release、Docker、iOS 同一次发布共用同一个不可变 tag 和 commit。
- iOS 只提交 Release 已发布的 IPA，必须在 Release 验证通过之后。
- 推送 tag 不会发布任何东西；每条线都要显式触发 workflow。

## 每条线的基准

每条线以自己上一次成功发布的版本为基准审计改动：

```bash
# CLI：最近一个 CLI 版本提交
BASE_CLI=$(git log --format=%h --grep='^release: happy-next-cli' -1)

# Release：最近一个正式 GitHub Release 的 tag
BASE_APP=$(gh release list --limit 50 --exclude-drafts --exclude-pre-releases \
  --json tagName -q '.[].tagName' | grep '^v[0-9]' | sort -V | tail -1)

# Docker：最近一次成功的 Docker workflow（run-name 为 "Docker vX.Y.Z"）
BASE_DOCKER=$(gh run list --workflow=docker-publish.yml --status success --limit 50 \
  --json displayTitle -q '.[].displayTitle' | sed -n 's/^Docker //p' | sort -V | tail -1)

# iOS：最近一次成功的提审（run-name 为 "iOS App Store vX.Y.Z"）
BASE_IOS=$(gh run list --workflow=ios-submit.yml --status success --limit 50 \
  --json displayTitle -q '.[].displayTitle' | sed -n 's/^iOS App Store //p' | sort -V | tail -1)

# 全局最高的 v tag
TOP_TAG=$(git tag --sort=-version:refname | grep '^v[0-9]' | head -1)
```

- 任一基准取不到时**停止**并报告。
- 新 tag 基于 `TOP_TAG` 递增（App 版本号因此可能跳号）。
- 在计划里列出每条线的基准。

---

# 一、自动检查与准备（不询问用户）

## 1. git 前置检查

```bash
git status --short --branch
git branch --show-current
git fetch origin --tags
```

- 工作区有未提交改动：**停止**，报告改动，让用户处理。不得 stash、覆盖或丢弃。
- 不在 `main`：**停止**。
- 本地落后远端：`git pull --ff-only origin main`；无法 fast-forward 则**停止**。
- 本地领先远端：列出未推送提交（`git log origin/main..HEAD --oneline`），写进计划，执行时普通推送。

## 2. 审计改动，推荐发布线

```bash
git log "${BASE_CLI}..HEAD" --oneline --no-merges -- packages/happy-cli packages/happy-wire
git log "${BASE_APP}..HEAD" --oneline --no-merges -- packages/happy-app packages/happy-wire
git log "${BASE_DOCKER}..HEAD" --oneline --no-merges -- \
  packages/happy-server packages/happy-app packages/happy-wire \
  packages/happy-voice packages/happy-docs packages/happy-web \
  Dockerfile.server Dockerfile.webapp docker-compose.yml entrypoint.sh
```

用 `--name-only` 看具体文件后按规则推荐：

| 改动 | 推荐 |
|---|---|
| `happy-cli` 有实际改动 | CLI |
| `happy-app` 有用户可感知改动 | Release + iOS + Docker（`happy-app` 镜像是 App 的 Web 版） |
| 只有 `happy-server` / `happy-voice` / `happy-docs` / `happy-web` / `Dockerfile*` / `docker-compose.yml` / `entrypoint.sh` | 仅 Docker |
| `happy-wire` 实际改动（不含 `modelCatalog.json`） | 按使用方：CLI 用到则含 CLI，server/app 用到则含 Docker/Release |
| 只有 `modelCatalog.json` | 不发布（合并到 main 即远程生效） |
| 都没有 | 建议不发布，**停止** |

只改测试、注释、开发脚本、内部文档不算用户可感知改动。

## 3. Codex CLI 版本

```bash
npm view @openai/codex version
node -p "require('./packages/happy-wire/src/modelCatalog.json').codexCli.version"
```

有新稳定版时写进计划，默认**不升级**，并说明：合并后会远程下发给所有 CLI，新启动的 Codex 会话都使用新版本（已有会话按其记录的版本恢复），需确认兼容性。`codexCli` 只在计划确认升级时修改。

## 4. 模型目录

模型和定价在 `packages/happy-wire/src/modelCatalog.json`，合并到 `main` 后由服务端远程下发给 App 和 CLI。

1. 列出改动该文件的未合并 PR（含每日自动同步的 PR），读其说明，写进计划并建议是否合并：

   ```bash
   gh pr list --state open --json number,title,files \
     --jq '.[] | select(any(.files[]; .path == "packages/happy-wire/src/modelCatalog.json")) | "#\(.number) \(.title)"'
   ```

2. 从各厂商官方渠道获取最新模型信息，与目录（含上述 PR 的改动）对比，例如：
   - Anthropic：Claude 模型概览页和定价页、发布公告
   - OpenAI：模型文档页和定价页；Codex 可用模型以 Codex CLI 发布说明为准
   - Google：Gemini API 模型页和定价页、Gemini CLI 发布说明
3. 按目录现有字段补齐新模型（标签、描述、价格、cache 读写价、fast 价格、effort、上下文窗口），并按目录惯例调整被取代的旧模型。
4. 每项新增、修改、下线都附官方来源链接；来源不明确或互相冲突的不改，在计划里列为"待定"。

此阶段只出改动草稿，不改文件。

## 5. Secrets

只检查名称，不读取值：

```bash
gh secret list --app actions | cut -f1
```

| 线 | 必需 |
|---|---|
| CLI | `NPM_TOKEN` |
| Release | `EXPO_TOKEN`、`TAURI_SIGNING_PRIVATE_KEY`、`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`、`APPLE_CERTIFICATE_BASE64`、`APPLE_CERTIFICATE_PASSWORD`、`APPLE_KEYCHAIN_PASSWORD`、`APPLE_SIGNING_IDENTITY` |
| Docker | `DOCKERHUB_USERNAME`、`DOCKERHUB_TOKEN` |
| iOS | `ASC_API_KEY_ID`、`ASC_API_KEY_P8_BASE64`、`ASC_ISSUER_ID` |

缺任何一个都**停止**。不得让用户在聊天中粘贴私钥、证书或密码。

## 6. 版本号

**CLI**（含 CLI 时）：

```bash
node -e "
const v = require('./packages/happy-cli/package.json').version.split('.').map(Number);
console.log('当前: ' + v.join('.'));
console.log('patch: ' + v[0] + '.' + v[1] + '.' + (v[2] + 1));
console.log('minor: ' + v[0] + '.' + (v[1] + 1) + '.0');
console.log('major: ' + (v[0] + 1) + '.0.0');
"
```

**tag**（含 Release / Docker 时）：基于 `TOP_TAG` 递增。

规则：`fix/chore/docs` → patch，`feat` → minor，`BREAKING CHANGE` 或 `!:` → major，按对应线审计范围内的提交判断。

确认 tag 和 Release 都不存在（已用过的版本改用更高版本）：

```bash
git ls-remote --tags origin "refs/tags/{tag}"
gh release view "{tag}" 2>/dev/null || true
```

只发 iOS 时不新建 tag，目标 tag 必须已有 Release 且含 IPA。

## 7. changelog 和产品文档草稿（含 Release 时）

涉及文件：

1. `packages/happy-app/CHANGELOG.md`
2. `packages/happy-app/sources/changelog/changelog.json`（由脚本生成）
3. `README.md`
4. `README.zh-CN.md`
5. `docs/changes-from-happy.md`
6. `docs/changes-from-happy.zh-CN.md`

规则：

- 审计范围是 `BASE_APP..HEAD`。
- 日志版本：patch 版本合并进当前最高日志版本（日期改为今天，摘要改为新版本号，写明 "also includes … introduced in vX.Y.Z"，参照 Version 24）；minor/major 新建下一个日志版本。
- `CHANGELOG.md` 按版本记录；其余四个 md 是完整功能总览，不加版本标题，新功能并入相应分组，删去已移除的功能。
- 中英文结构与含义一致；不写只对开发者有意义的实现细节。
- 草稿只放在计划里，此阶段不写文件。

只发 Docker 不写 changelog。

---

# 二、确认发布计划

一次性展示，每项附依据：

- 发布线组合及理由，每条线的基准
- 推送本地未推送的提交（如有）
- 合并哪些 PR
- 模型目录改动（新增 / 修改 / 下线，附来源）和"待定"项
- Codex 是否升级（默认否）
- CLI 版本、tag
- 日志版本，changelog 和总览文档草稿
- Docker `publish_latest`：目标是最高正式版本时 `true`，重建旧版本或补历史镜像时 `false`
- 将执行的 workflow 命令

告知用户：确认即授权执行计划内全部外部发布操作，包括 iOS 提审。用户修改涉及重新审计时，重新展示计划。

---

# 三、执行

每步结束检查结果；遇到停止条件立即停下汇报，不继续后续步骤。

## 1. 同步代码

```bash
git push origin main            # 有未推送提交时
gh pr merge {PR} --squash       # 计划内的 PR
git pull --ff-only origin main
```

## 2. 模型目录和 Codex（有改动时）

按计划修改 `modelCatalog.json`，然后：

```bash
cd packages/happy-wire && yarn build && yarn test
cd ../happy-cli && yarn typecheck
```

通过后只提交该文件并推送（如 `chore(models): …`）。失败则**停止**。

## 3. changelog 和文档（含 Release 时）

按计划写入文件，然后：

```bash
cd packages/happy-app
npx tsx sources/scripts/parseChangelog.ts
yarn typecheck
yarn test --run
```

通过后只提交这六个文件：

```bash
git add \
  packages/happy-app/CHANGELOG.md \
  packages/happy-app/sources/changelog/changelog.json \
  README.md README.zh-CN.md \
  docs/changes-from-happy.md \
  docs/changes-from-happy.zh-CN.md
git commit -m "docs: changelog for {tag}"
git push origin main
```

## 4. CLI（含 CLI 时）

```bash
gh workflow run cli-publish.yml -f version={CLI版本} -f dry-run=false
```

从命令输出的 run URL 取 run ID，后台监听。成功后：

```bash
git pull --ff-only origin main
node -p "require('./packages/happy-cli/package.json').version"
```

CLI 在创建 tag 之前完成，使 tag 包含 CLI 版本提交。

## 5. 创建 tag（含 Release / Docker 时）

```bash
git tag {tag}
git push origin {tag}
```

tag 指向已推送的最新 `main` commit。

## 6. 触发 Release 和 Docker（并行）

```bash
gh workflow run release.yml \
  -f release_tag={tag} \
  -f confirmation=PUBLISH-RELEASE

gh workflow run docker-publish.yml \
  -f release_tag={tag} \
  -f publish_latest={true|false} \
  -f confirmation=PUBLISH-DOCKER
```

后台监听每个 run。结束后用 `gh run view {id} --json conclusion,jobs` 核对结论和每个任务，以此判断成败。

## 7. 验证 Docker

```bash
for img in happy-server happy-app happy-voice happy-docs happy-web; do
  curl -s "https://hub.docker.com/v2/repositories/kuaifan/$img/tags?page_size=4&ordering=last_updated"
done
```

- 存在版本标签（镜像标签不带 `v`，如 `2.15.1`）；
- `publish_latest=true` 时 `latest` 与版本标签 digest 相同；
- 架构为 `amd64` 和 `arm64`。

## 8. 验证 Release

```bash
gh release view {tag} --json tagName,assets,url
```

除 `latest.json` 外，所有附件以 `happy-next-{tag}-` 开头：

```text
happy-next-vX.Y.Z-android.apk
happy-next-vX.Y.Z-android.aab
happy-next-vX.Y.Z-ios.ipa
happy-next-vX.Y.Z-macos-universal.dmg
happy-next-vX.Y.Z-macos-universal.zip
happy-next-vX.Y.Z-macos-universal.app.tar.gz
happy-next-vX.Y.Z-macos-universal.app.tar.gz.sig
happy-next-vX.Y.Z-windows-x64-setup.exe
happy-next-vX.Y.Z-windows-x64-setup.exe.sig
happy-next-vX.Y.Z-windows-x64.msi
happy-next-vX.Y.Z-windows-x64.msi.sig
happy-next-vX.Y.Z-windows-arm64-setup.exe
happy-next-vX.Y.Z-windows-arm64-setup.exe.sig
happy-next-vX.Y.Z-windows-arm64.msi
happy-next-vX.Y.Z-windows-arm64.msi.sig
happy-next-vX.Y.Z-desktop-metadata.json
happy-next-vX.Y.Z-sha256sums.txt
latest.json
```

下载 `latest.json`（放在新建的空目录中）并检查：

- version 等于 tag；
- 四个平台键齐全；
- URL 中没有空格或 `%20`；
- 每个 URL 返回 HTTP 200；
- 签名非空。

## 9. iOS 提审（含 iOS 时）

Release 验证通过且含 `happy-next-{tag}-ios.ipa` 后触发：

```bash
gh workflow run ios-submit.yml \
  -f release_tag={tag} \
  -f confirmation=SUBMIT-IOS
```

workflow 下载 Release 中的 IPA，用 App Store Connect API Key 通过 `xcrun altool` 上传。成功只代表上传完成；构建处理、送审和审核状态在 App Store Connect 中另行处理。

## 10. 汇总报告

逐条列出 npm、GitHub Release、Docker Hub、App Store Connect 的结果和链接，以及重试情况。没有真机测试的平台标记 **未验证**。

---

# 四、workflow 失败处理

先看失败日志判断原因：

```bash
gh run view {id} --log-failed | tail -200
```

- **网络问题**（拉依赖或资源包失败、超时、`ETIMEDOUT`、`ECONNRESET`、`Could not resolve host`、`Read timed out`、HTTP 5xx、registry/CDN 不可达等）：`gh run rerun {id} --failed`，同一个 run **最多重试 3 次**；仍失败则**停止**。
- **偶发超时**（个别测试 `Test timed out`，同一测试本地通过，且其他平台任务跑同一套测试也通过）：`gh run rerun {id} --failed`，同一个 run **最多重试 3 次**；仍失败则**停止**，并在汇总里建议修复该测试。
- **其他原因**（编译、类型、测试、签名、证书、校验、权限、配额）：**停止**，报告原因和修复建议。

重跑边界：

| workflow | 可重跑 | 不可重跑（停止报告） |
|---|---|---|
| `release.yml` | 各平台 build 任务失败 | `create-release` 失败 |
| `docker-publish.yml` | 任意任务失败 | — |
| `cli-publish.yml` | 日志确认尚未执行 `npm publish` | 已执行 `npm publish` |
| `ios-submit.yml` | 日志确认 IPA 尚未上传成功 | 已上传或状态不明 |

---

# 停止条件

工作区不干净、分支分叉、基准取不到、无可发布改动、缺 Secret、tag 或 Release 已存在、本地校验失败、workflow 失败且不可重试或重试用尽、Release 或 Docker 验证不通过、缺 IPA。

停止时说明已完成和未完成的步骤，以及恢复时从哪一步继续。修复后改用更高版本号。

---

# 首次完整桌面升级验收

首次正式验证或 updater 发生变化时，发布两个真实的新版本做升级测试：

1. 发布较低版本 A 的完整 Release。
2. 从 GitHub 下载并安装 A。
3. 确认客户端显示版本 A。
4. 发布较高版本 B 的完整 Release。
5. 等待后台下载，检查未登录和已登录布局中的更新按钮。
6. 点击更新并确认重启到 B。
7. 检查登录状态、本地数据、通知、图片、麦克风和摄像头。
8. Apple Silicon、Intel、Windows x64、Windows ARM64 分别记录；没有真机就标记 **未验证**。

失败时用新的更高版本修复。

# 禁止事项

- 不提交或输出证书、Token、密码、私钥。
- 不使用 `--clobber` 覆盖 Release 附件；不向历史 Release 追加文件。
- 不移动、删除或强推正式 tag；不重用已用过的版本号。
- 不强推 `main`，不 stash 或丢弃用户改动。
- 不把 CI 成功等同于真机验证成功。
- 不在 iOS 线重新构建 IPA；Release 未验证通过不提交 iOS。
- 不手动修改 `app.config.js` 的默认版本。
- 不手动修改 CLI package version。
- 不执行发布计划以外的外部操作。
