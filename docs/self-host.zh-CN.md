# 自托管（Docker Compose）

[🇬🇧 English](self-host.md)

本指南说明如何使用根目录的 `docker-compose.yml` 私有化部署 Happy Next。

包含服务：

- `happy-app`：Web 应用，默认端口 `3030`
- `happy-server`：API + WebSocket，默认端口 `3031`
- `happy-voice`：语音网关，默认端口 `3040`
- `postgres`、`redis`、`minio`

## 快速开始

1. 创建环境文件：

```bash
cp .env.example .env
```

2. 编辑 `.env`。

本地跑通最少需要设置：

```env
HANDY_MASTER_SECRET=请改成随机值
POSTGRES_PASSWORD=请改成随机值
S3_SECRET_KEY=请改成随机值
VOICE_AUTH_SECRET=请改成随机值
```

如果要使用语音功能，还需要填写火山引擎相关配置：

```env
VOLC_RTC_APP_ID=
VOLC_RTC_APP_KEY=
VOLC_ACCESS_KEY_ID=
VOLC_SECRET_ACCESS_KEY=
VOLC_TTS_APP_ID=
VOLC_TTS_TOKEN=
ARK_API_KEY=
```

3. 启动：

```bash
docker-compose up -d
```

`happy-server` 每次启动都会自动执行数据库迁移（`prisma migrate deploy`，无新迁移时直接跳过），首次启动还会自动创建 MinIO bucket。升级时只需拉取新镜像并重启，无需手动迁移；如需手动管理迁移，可设置 `SKIP_DB_MIGRATIONS=true`。

4. 打开：

- Web：`http://localhost:3030`
- API：`http://localhost:3031`
- Voice：`http://localhost:3040`
- MinIO：`http://localhost:3050`

## 地址配置逻辑

前端启动时使用：

```env
EXPO_PUBLIC_HAPPY_SERVER_URL=http://localhost:3031
```

然后前端会请求 API 的 `/v1/app-config`，获取服务端返回的真实地址：

```env
PUBLIC_API_BASE_URL=
PUBLIC_VOICE_BASE_URL=http://localhost:3040
```

说明：

- `PUBLIC_API_BASE_URL` 留空时，前端继续使用入口 API 地址。
- `PUBLIC_VOICE_BASE_URL` 留空时，语音功能不会自动启用。
- `APP_URL` 是 Web 应用地址，用于部分回跳/连接流程。
- `S3_PUBLIC_URL` 必须是浏览器/移动端能访问的资源地址。

## 模型目录

App 和 CLI 通过 `/v1/model-catalog` 获取模型列表、定价和 Codex 版本，新增模型无需升级客户端。服务端每 10 分钟从以下地址刷新该目录：

```env
MODEL_CATALOG_URL=
```

- 留空时使用 happy-next `main` 分支上的 `modelCatalog.json`（GitHub raw）。
- 服务器无法访问 GitHub 时，可指向该文件的镜像地址。
- 设为 `off` 则使用服务端版本自带的目录。
- 拉取失败或内容校验不通过时，继续使用上一份有效目录。

## 远程/公网部署

如果不是本机访问，不要使用 `localhost`。需要改成你的公网域名：

```env
APP_URL=https://app.example.com
EXPO_PUBLIC_HAPPY_SERVER_URL=https://api.example.com
PUBLIC_API_BASE_URL=https://api.example.com
PUBLIC_VOICE_BASE_URL=https://voice.example.com
S3_PUBLIC_URL=https://s3.example.com/happy-server
GITHUB_REDIRECT_URL=https://api.example.com/v1/connect/github/callback
```

同时确保这些端口或域名能访问：

- Web：`3030`
- API：`3031`
- Voice：`3040`
- MinIO/S3：`3050`

## 语音说明

语音不再支持前端自定义语音地址和 key。

现在的链路是：

1. 前端请求 API 获取临时语音 token。
2. 前端用临时 token 请求 `happy-voice`。
3. `happy-server` 和 `happy-voice` 通过同一个 `VOICE_AUTH_SECRET` 校验。

所以：

```env
VOICE_AUTH_SECRET=必须在 happy-server 和 happy-voice 中一致
```

Docker Compose 已经自动把同一个环境变量传给两个服务。

## GitHub 登录/连接

如果不使用 GitHub 功能，可以留空。

如果使用，需要配置：

```env
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GITHUB_REDIRECT_URL=https://api.example.com/v1/connect/github/callback
```

在 GitHub Settings > Developer settings > OAuth Apps 中创建 **OAuth App**，不是 GitHub App。
Homepage URL 填 Happy 网页地址，Authorization callback URL 填上面的 `GITHUB_REDIRECT_URL`。
配置该 OAuth App 的 Client ID 和 Client Secret，重启 API 服务，再在 Happy 中连接 GitHub。
已有 GitHub App 连接需要重新授权，不需要删除 Happy 账号或资料。注册 OAuth App 时可以保留勾选 **Expire user access tokens**。
Access Token 和 Refresh Token 均加密保存；到期前自动刷新，API 返回 401 时刷新后重试一次。Refresh Token 失效或撤销后才需要重新授权，也兼容未开启过期的 OAuth Token。

当前申请 `read:user,user:email,read:org,repo` 权限。私有仓库使用较宽的 `repo` scope，组织可能要求管理员批准 OAuth App；不再申请 Codespaces 权限。
Token 在服务端加密保存；从 Issue/PR 启动 AI 会话时，也会传入所选执行环境，因此只应选择可信机器。
传入前会刷新即将到期的 Token，但已运行 AI 进程的环境变量不会自动更新；长时间运行的会话可能需要重新启动以获取新凭证。

不再使用 `GITHUB_APP_ID` 和 `GITHUB_PRIVATE_KEY`。如需仓库 webhook，可单独配置 `/v1/connect/github/webhook` 和 `GITHUB_WEBHOOK_SECRET`；OAuth 授权不会自动安装 webhook。
复用已有数据库刷新字段和迁移。重新连接会替换刷新信息；连接未开启过期的 Token 时，清空上一次的 Refresh Token 和到期时间。

## 常用命令

查看状态：

```bash
docker-compose ps
```

查看日志：

```bash
docker-compose logs -f happy-server
docker-compose logs -f happy-voice
```

手动执行数据库迁移（启动时已自动执行，仅用于排查）：

```bash
docker-compose exec happy-server yarn --cwd packages/happy-server prisma migrate deploy
```

停止：

```bash
docker-compose down
```

## 故障排查

验证 API 配置：

```bash
curl http://localhost:3031/v1/app-config
```

验证语音网关：

```bash
curl http://localhost:3040/healthz
```

如果浏览器提示跨域，优先检查：

- 前端实际请求的 API 地址是否正确
- 代理是否转发了 `OPTIONS`
- 请求是否返回了 `502/500/重定向`
- 是否带了 credentials/cookie
