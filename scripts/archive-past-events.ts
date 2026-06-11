#!/usr/bin/env tsx
/**
 * Auto-archive long-past events.
 *
 * Without this, PUBLISHED events only leave the live site when someone manually
 * runs a cleanup script, so stale rows pile up, pollute search, and drag on the
 * homepage query. This soft-archives (status → ARCHIVED, never deletes) any
 * PUBLISHED event whose effective end is more than ARCHIVE_AFTER_DAYS in the
 * past, so nothing is lost and an admin can restore from the UI if needed.
 *
 * "Effective end" is endDate when present, else startDate — a single-day event
 * has no endDate, so we fall back to when it started.
 *
 * Intended to run on a Railway cron (see railway.archive-past.toml), same
 * pattern as the scrape / health-alert / merge-dups jobs.
 *
 * Usage:
 *   npm run archive-past            # archive matching events
 *   npm run archive-past -- --dry   # report only, never write
 *
 * Env:
 *   DATABASE_URL                required.
 *   ARCHIVE_AFTER_DAYS          optional, default 30. Grace period before a
 *                               past event is archived.
 */
import { config } from "dotenv";
config({ path: ".env.local", override: true });
import { prisma } from "@/lib/prisma";

const DEFAULT_AFTER_DAYS = 30;

async function main() {
  const dryRun = process.argv.includes("--dry");
  const afterDays = Number(process.env.ARCHIVE_AFTER_DAYS) || DEFAULT_AFTER_DAYS;

  const cutoff = new Date(Date.now() - afterDays * 24 * 60 * 60 * 1000);

  // A published event is "long past" when its end is before the cutoff. Prefer
  // endDate; for single-day events (endDate null) fall back to startDate.
  const where = {
    status: "PUBLISHED" as const,
    OR: [
      { endDate: { lt: cutoff } },
      { endDate: null, startDate: { lt: cutoff } },
    ],
  };

  const stale = await prisma.event.findMany({
    where,
    select: { id: true, title: true, startDate: true, endDate: true },
    orderBy: { startDate: "asc" },
  });

  console.log(
    `${dryRun ? "[DRY RUN] " : ""}Archiving PUBLISHED events ended before ` +
      `${cutoff.toISOString().slice(0, 10)} (>${afterDays}d past): ${stale.length} match.`
  );

  for (const e of stale) {
    const ended = (e.endDate ?? e.startDate).toISOString().slice(0, 10);
    console.log(`  ${ended}  ${e.title.slice(0, 70)}`);
  }

  if (!dryRun && stale.length) {
    const res = await prisma.event.updateMany({
      where,
      data: { status: "ARCHIVED" },
    });
    console.log(`  → archived ${res.count}`);
  }

  console.log(`Done.${dryRun ? " (dry run — no writes)" : ""}`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
