import { config } from "dotenv";
config({ path: ".env.local", override: true });
import { prisma } from "@/lib/prisma";
import { isPlaceholderVenue, isServiceAreaTBA } from "@/lib/venues";

/**
 * Archive the backlog of out-of-area "location TBA" submissions.
 *
 * The location-TBA feature (lib/scrapers/runner.ts) publishes placeholder-venue
 * events we can confirm are local ("TBA (San Francisco)", "TBA (Oakland)", "SF")
 * as off-map location-TBA events, while holding the rest PENDING. publish-tba-
 * events.ts flips the local ones to PUBLISHED. The complement — placeholder
 * venues we CANNOT place inside the service area ("Bay Area", "San Jose", bare
 * "TBA", "TBA (Sacramento)") — just sit in the submissions queue forever; they
 * have no map point and no confirmed local city. This archives them.
 *
 * Mirrors the runner's holdPending condition exactly:
 *   isPlaceholderVenue(v) && !isServiceAreaTBA(v)
 *
 * Archiving (not deleting) hides them from the submissions tab but keeps the
 * row, and the runner's dedupeHash short-circuit means a re-scrape won't
 * re-publish them. Reversible from the admin UI.
 *
 * Run with `--dry` to preview without writing.
 */
async function main() {
  const dryRun = process.argv.includes("--dry");
  const now = new Date();

  const pending = await prisma.event.findMany({
    where: { status: "PENDING", startDate: { gte: now } },
    select: { id: true, title: true, venueName: true, startDate: true, source: { select: { slug: true } } },
    orderBy: { startDate: "asc" },
  });

  const toArchive = pending.filter(
    (e) => isPlaceholderVenue(e.venueName) && !isServiceAreaTBA(e.venueName)
  );

  const byVenue = toArchive.reduce<Record<string, number>>((m, e) => {
    const v = (e.venueName ?? "?").trim();
    m[v] = (m[v] ?? 0) + 1;
    return m;
  }, {});

  console.log(
    `${dryRun ? "[DRY RUN] " : ""}Archiving ${toArchive.length} / ${pending.length} future PENDING events as out-of-area location-TBA`
  );
  console.log(`  by placeholder venue: ${JSON.stringify(byVenue)}`);
  for (const e of toArchive.slice(0, 25)) {
    console.log(`  ${e.startDate.toISOString().slice(0, 10)} [${e.source?.slug}] ${e.venueName} — ${e.title.slice(0, 50)}`);
  }
  if (toArchive.length > 25) console.log(`  …and ${toArchive.length - 25} more`);

  if (!dryRun && toArchive.length) {
    const res = await prisma.event.updateMany({
      where: { id: { in: toArchive.map((e) => e.id) } },
      data: { status: "ARCHIVED" },
    });
    console.log(`\n  → archived ${res.count}`);
  }

  console.log(`\nDone.${dryRun ? " (dry run — no writes)" : ""}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
