#!/bin/sh
set -e
# Run migrations only when DATABASE_URL is available (skipped at build time / misconfigured services)
if [ -n "$DATABASE_URL" ]; then
  npx prisma migrate resolve --rolled-back 20260412000000_add_all_day_to_events 2>/dev/null || true
  npx prisma migrate deploy
else
  echo "Warning: DATABASE_URL not set — skipping migrations"
fi
node .next/standalone/server.js
