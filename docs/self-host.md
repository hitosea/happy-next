# Self-hosting (Docker Compose)

[🇨🇳 中文](self-host.zh-CN.md)

This guide explains how to self-host Happy Next with the root `docker-compose.yml`.

Included services:

- `happy-app`: Web app, default port `3030`
- `happy-server`: API + WebSocket, default port `3031`
- `happy-voice`: voice gateway, default port `3040`
- `postgres`, `redis`, `minio`

## Quickstart

1. Create your environment file:

```bash
cp .env.example .env
```

2. Edit `.env`.

Minimum local values:

```env
HANDY_MASTER_SECRET=change-to-a-random-secret
POSTGRES_PASSWORD=change-to-a-random-secret
S3_SECRET_KEY=change-to-a-random-secret
VOICE_AUTH_SECRET=change-to-a-random-secret
```

To enable voice, also configure Volcengine:

```env
VOLC_RTC_APP_ID=
VOLC_RTC_APP_KEY=
VOLC_ACCESS_KEY_ID=
VOLC_SECRET_ACCESS_KEY=
VOLC_TTS_APP_ID=
VOLC_TTS_TOKEN=
ARK_API_KEY=
```

3. Start the stack:

```bash
docker-compose up -d
```

`happy-server` runs database migrations (`prisma migrate deploy`, a no-op when up to date) on every start, and the first start also creates the MinIO bucket. Upgrades only need a new image and a restart; set `SKIP_DB_MIGRATIONS=true` to manage migrations manually.

4. Open:

- Web: `http://localhost:3030`
- API: `http://localhost:3031`
- Voice: `http://localhost:3040`
- MinIO: `http://localhost:3050`

## URL configuration

The web app starts with:

```env
EXPO_PUBLIC_HAPPY_SERVER_URL=http://localhost:3031
```

Then it calls `/v1/app-config` on the API to discover server-provided URLs:

```env
PUBLIC_API_BASE_URL=
PUBLIC_VOICE_BASE_URL=http://localhost:3040
```

Notes:

- If `PUBLIC_API_BASE_URL` is blank, the client keeps using the entry API URL.
- If `PUBLIC_VOICE_BASE_URL` is blank, voice is not auto-enabled.
- `APP_URL` is the public web app URL, used by some redirect/connect flows.
- `S3_PUBLIC_URL` must be reachable by browsers/mobile clients.

## Model catalog

The app and CLI get their model list, pricing and Codex version from `/v1/model-catalog`, so new models appear without upgrading them. The server refreshes that catalog every 10 minutes from:

```env
MODEL_CATALOG_URL=
```

- Blank uses `modelCatalog.json` on the happy-next `main` branch (GitHub raw).
- If the server cannot reach GitHub, point it at a mirror of that file.
- `off` keeps the catalog bundled with the server version.
- A failed or invalid fetch keeps the last good catalog.

## Remote/public deployment

Do not use `localhost` when accessing from another machine. Use public domains:

```env
APP_URL=https://app.example.com
EXPO_PUBLIC_HAPPY_SERVER_URL=https://api.example.com
PUBLIC_API_BASE_URL=https://api.example.com
PUBLIC_VOICE_BASE_URL=https://voice.example.com
S3_PUBLIC_URL=https://s3.example.com/happy-server
GITHUB_REDIRECT_URL=https://api.example.com/v1/connect/github/callback
```

Make sure these services are reachable:

- Web: `3030`
- API: `3031`
- Voice: `3040`
- MinIO/S3: `3050`

## Voice

The frontend no longer supports custom voice URL/key settings.

Current flow:

1. The frontend asks the API for a short-lived voice token.
2. The frontend calls `happy-voice` with that token.
3. `happy-server` and `happy-voice` validate it with the shared `VOICE_AUTH_SECRET`.

So:

```env
VOICE_AUTH_SECRET=must-match-between-happy-server-and-happy-voice
```

Docker Compose passes the same value to both services.

## GitHub login/connect

Leave these blank if you do not use GitHub features.

If enabled, configure:

```env
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GITHUB_REDIRECT_URL=https://api.example.com/v1/connect/github/callback
```

Create an **OAuth App**, not a GitHub App, under GitHub Settings > Developer settings > OAuth Apps.
Set Homepage URL to your Happy web URL and Authorization callback URL to `GITHUB_REDIRECT_URL` above.
Use that OAuth App's Client ID and client secret, restart the API service, then connect GitHub in Happy.
Existing GitHub App connections must authorize again; account/profile data does not need to be deleted.
Enable **Expire user access tokens** when registering the OAuth App. Access and refresh tokens are
stored encrypted; Happy refreshes access tokens shortly before expiry and retries once after a 401.
Expired/revoked refresh credentials require authorization again. Non-expiring OAuth tokens also work.

The integration requests `read:user,user:email,read:org,repo`. Private repository access uses the broad
`repo` scope, and organizations may require OAuth App approval. Codespaces access is not requested.
OAuth credentials are encrypted on the server; starting an AI session from an issue/PR also passes
the token to the selected execution environment. Only use trusted machines for these sessions.
This token is refreshed before handoff when near expiry, but an already running AI process's environment
is not updated automatically; long-running sessions may need to be restarted with fresh credentials.

`GITHUB_APP_ID` and `GITHUB_PRIVATE_KEY` are no longer used. Optional repository webhooks can be
configured separately at `/v1/connect/github/webhook` with `GITHUB_WEBHOOK_SECRET`; OAuth does not install them.
Existing database refresh-token fields/migrations are reused. Reauthorization replaces refresh metadata;
connecting a non-expiring token clears the previous refresh token and expiry.

## Common commands

Check status:

```bash
docker-compose ps
```

Logs:

```bash
docker-compose logs -f happy-server
docker-compose logs -f happy-voice
```

Run migrations manually (already applied on start; useful for troubleshooting):

```bash
docker-compose exec happy-server yarn --cwd packages/happy-server prisma migrate deploy
```

Stop:

```bash
docker-compose down
```

## Troubleshooting

Check API discovery:

```bash
curl http://localhost:3031/v1/app-config
```

Check voice gateway:

```bash
curl http://localhost:3040/healthz
```

If the browser reports CORS, first check:

- the actual API URL used by the frontend
- whether your proxy forwards `OPTIONS`
- whether the request actually returned `502/500/redirect`
- whether the request includes credentials/cookies
