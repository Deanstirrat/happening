import dotenv from "dotenv";
dotenv.config({ path: ".env.local", override: true });

import { prisma } from "@/lib/prisma";
import { isOutOfAreaVenue } from "@/lib/ingestFilters";

/**
 * One-time cleanup for issue #157: archive the existing backlog of out-of-area,
 * name-only venues that the foopee/bandsintown/19hz/folkyeah scrapers leaked in
 * as PUBLISHED-but-locationless events ("Mountain Winery, Saratoga", "Hopmonk
 * Tavern, Novato", …). Going forward the ingest filter (isOutOfAreaVenue, wired
 * into the scrape runner) keeps them out at the source.
 *
 * Archiving (not deleting) hides them from the live site but keeps the row, and
 * the runner's dedupeHash short-circuit means a re-scrape won't re-publish them.
 * Reversible from the admin UI.
 *
 * Run with `--dry-run` to preview without writing.
 */
const SOURCES = ["foopee", "bandsintown", "19hz", "folkyeah"];

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  console.log(`Scanning ${SOURCES.join(", ")} for out-of-area venues... (${dryRun ? "DRY RUN" : "LIVE"})`);

  const events = await prisma.event.findMany({
    where: {
      status: "PUBLISHED",
      source: { slug: { in: SOURCES } },
    },
    select: {
      id: true,
      title: true,
      venueName: true,
      venueAddress: true,
      source: { select: { slug: true } },
    },
  });

  // Check both the name and any locality string (folkyeah carries the city in
  // venueAddress), mirroring the ingest filter in lib/scrapers/runner.ts.
  const outOfArea = events.filter(
    (e) => isOutOfAreaVenue(e.venueName) || isOutOfAreaVenue(e.venueAddress)
  );
  console.log(`Found ${outOfArea.length} out-of-area events out of ${events.length} from these sources\n`);

  for (const e of outOfArea) {
    console.log(`  [${dryRun ? "DRY" : "ARCHIVE"}] [${e.source.slug}] ${e.venueName ?? e.venueAddress} — "${e.title}"`);
  }

  if (!dryRun && outOfArea.length > 0) {
    const result = await prisma.event.updateMany({
      where: { id: { in: outOfArea.map((e) => e.id) } },
      data: { status: "ARCHIVED" },
    });
    console.log(`\nArchived ${result.count} events.`);
  } else if (dryRun) {
    console.log("\nDry run — no changes made. Re-run without --dry-run to apply.");
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
