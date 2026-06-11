# happening

An SF events discovery platform: scrapes events from around the city, dedupes and
curates them, and surfaces a daily featured set. Built with [Next.js](https://nextjs.org)
(App Router) and Prisma on Postgres.

## Getting Started

Install dependencies and run the dev server:

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see the app.

You'll need a `.env` with at least `DATABASE_URL` (Postgres). Other features need
their own keys — e.g. `ANTHROPIC_API_KEY` (curation/merge), `RESEND_API_KEY` +
`RESEND_FROM_EMAIL` (email), `CRON_SECRET` (cron-triggered admin endpoints).

Apply the schema to your database with `npx prisma migrate dev`.

## Deployment (Railway)

**Production runs on [Railway](https://railway.app) — it is the canonical deploy
target.** The repo is not deployed on Vercel; any Vercel deployments are vestigial
and can be ignored or disconnected.

Each Railway service is configured by a `railway*.toml` file at the repo root:

- **`railway.toml`** — the web service. Builds `Dockerfile.web`, runs
  `prisma migrate deploy` then the Next.js standalone server (`scripts/start.sh`),
  and health-checks `/api/health`.
- **`railway.scrape.toml`** — nightly event scraper (`npm run scrape`).
- **`railway.auto-feature.toml`** — daily curation: picks featured events and
  enriches them (`npm run auto-feature && npm run enrich-featured`).
- **`railway.merge-dups.toml`** — nightly duplicate merging (`npm run merge-dups`).
- **`railway.archive-past.toml`** — archives stale past events
  (`npm run archive-past-events`).
- **`railway.health-alert.toml`** — emails an alert if the scrape looks unhealthy
  (`npm run health-alert`).
- **`railway.backfill-*.toml`** — one-off backfills; run once, then remove.

The background services build from `Dockerfile.scrape`. Cron services have no
long-running process — their schedules are set per-service in the Railway
dashboard under **Settings → Cron Schedule** (see the comments in each `.toml`).

The admin curation endpoints (`/api/admin/curation/auto-feature`,
`/api/admin/curation/reflect`) also accept a scheduled `GET` with
`Authorization: Bearer $CRON_SECRET`, but the canonical daily jobs run as the
Railway cron services above. `reflect` (weekly curation self-review) currently
has no scheduled service — trigger it from the admin UI, or add a Railway cron
service if you want it automated.
