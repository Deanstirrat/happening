#!/bin/sh
# Resolve any failed migrations before deploying (no-op if none are failed)
npx prisma migrate resolve --rolled-back 20260412000000_add_all_day_to_events 2>/dev/null || true
npx prisma migrate deploy
node .next/standalone/server.js
