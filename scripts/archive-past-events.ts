import { config } from "dotenv";
config({ path: ".env.local", override: true });
import { prisma } from "@/lib/prisma";

/**
 * Auto-archive past events (issue #88).
 *
 * Past events are otherwise only removed when someone manually runs a cleanup
 * script, so stale rows accumulate, pollute search, and slow queries. This job
 * soft-archives (status → ARCHIVED, never deletes) every PUBLISHED event whose
 * effective end is more than ARCHIVE_AFTER_DAYS (~30) in the past, so nothing is
 * lost and it's reversible from the admin UI. The existing dedupeHash
 * short-circuit means a re-scrape won't re-publish them.
 *
 * "Effective end" is `endDate ?? startDate`: multi-day events stay live until
 * their last day, and single-moment events fall off ~30 days after they start.
 *
 * Intended to run on a Railway cron (see railway.archive-past.toml), same
 * pattern as the scrape / health-alert / merge-dups jobs.
 *
 * Usage:
 *   npm run archive-past-events              # archive
 *   npm run archive-past-events -- --dry     # report only, never write
 *
 * Env:
 *   ARCHIVE_AFTER_DAYS   days past the effective end before archiving (default 30).
 */
async function main() {
  const dryRun = process.argv.includes("--dry");
  const days = Number(process.env.ARCHIVE_AFTER_DAYS ?? 30);
  if (!Number.isFinite(days) || days < 1) {
    throw new Error(`ARCHIVE_AFTER_DAYS must be a positive number, got ${process.env.ARCHIVE_AFTER_DAYS}`);
  }

  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  // Effective end is endDate when present, else startDate. A single OR over the
  // two cases avoids COALESCE: rows with an endDate are judged by it; rows
  // without fall back to startDate.
  const stale = await prisma.event.findMany({
    where: {
      status: "PUBLISHED",
      OR: [
        { endDate: { not: null, lt: cutoff } },
        { endDate: null, startDate: { lt: cutoff } },
      ],
    },
    select: { id: true, title: true, startDate: true, endDate: true },
    orderBy: { startDate: "asc" },
  });

  console.log(
    `${dryRun ? "[DRY RUN] " : ""}Archiving PUBLISHED events ended before ${cutoff.toISOString()} ` +
      `(${days} days ago).`
  );
  console.log(`Found ${stale.length} stale event(s).`);
  for (const e of stale) {
    const end = (e.endDate ?? e.startDate).toISOString().slice(0, 10);
    console.log(`  ${end}  ${e.title.slice(0, 60)}`);
  }

  if (!dryRun && stale.length) {
    const res = await prisma.event.updateMany({
      where: { id: { in: stale.map((e) => e.id) } },
      data: { status: "ARCHIVED" },
    });
    console.log(`→ archived ${res.count}`);
  }

  console.log(`Done.${dryRun ? " (dry run — no writes)" : ""}`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
