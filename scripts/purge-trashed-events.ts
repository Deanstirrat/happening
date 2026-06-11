import { config } from "dotenv";
config({ path: ".env.local", override: true });
import { prisma } from "@/lib/prisma";

/**
 * Periodic purge of soft-deleted events (issue #103).
 *
 * Admin "delete" no longer removes an event — it sets status → TRASHED and stamps
 * deletedAt, so a mis-click is recoverable from the trash UI. This job hard-deletes
 * the rows that have sat in the trash longer than PURGE_AFTER_DAYS, keeping the
 * window for recovery generous while not letting trash accumulate forever.
 *
 * Intended to run on a Railway cron (see railway.purge-trashed.toml), same pattern
 * as the scrape / archive-past / merge-dups jobs.
 *
 * Usage:
 *   npm run purge-trashed              # purge
 *   npm run purge-trashed -- --dry     # report only, never write
 *
 * Env:
 *   PURGE_AFTER_DAYS   days in trash before a row is hard-deleted (default 30).
 */
async function main() {
  const dryRun = process.argv.includes("--dry");
  const days = Number(process.env.PURGE_AFTER_DAYS ?? 30);
  if (!Number.isFinite(days) || days < 1) {
    throw new Error(`PURGE_AFTER_DAYS must be a positive number, got ${process.env.PURGE_AFTER_DAYS}`);
  }

  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const stale = await prisma.event.findMany({
    where: { status: "TRASHED", deletedAt: { lt: cutoff } },
    select: { id: true, title: true, deletedAt: true },
  });

  console.log(
    `${dryRun ? "[dry run] " : ""}${stale.length} trashed event(s) older than ${days}d to purge`
  );
  for (const e of stale) {
    console.log(`  ${dryRun ? "would purge" : "purging"} "${e.title}" (trashed ${e.deletedAt?.toISOString() ?? "?"})`);
  }

  if (!dryRun && stale.length > 0) {
    const { count } = await prisma.event.deleteMany({
      where: { id: { in: stale.map((e) => e.id) } },
    });
    console.log(`Purged ${count} event(s).`);
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("Fatal error:", err);
  await prisma.$disconnect();
  process.exit(1);
});
