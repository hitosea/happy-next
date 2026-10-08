#!/bin/sh
set -e

# Apply pending database migrations on every start (no-op when up to date).
# Set SKIP_DB_MIGRATIONS=true to manage migrations manually.
if [ "${SKIP_DB_MIGRATIONS:-false}" != "true" ]; then
  echo "[entrypoint] Running prisma migrate deploy"
  yarn --cwd packages/happy-server prisma migrate deploy
fi

exec yarn --cwd packages/happy-server start
