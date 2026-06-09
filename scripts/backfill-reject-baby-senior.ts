import dotenv from "dotenv";
dotenv.config({ path: ".env.local", override: true });

import { prisma } from "@/lib/prisma";
import { isBabyOrSeniorLibraryEvent } from "@/lib/scrapers/runner";

/**
 * Rejects existing library events aimed at babies/toddlers or seniors —
 * off-vibe recurring programming (storytime, lapsit, senior tech help, etc.).
 *
 * Mirrors backfill-reject-virtual.ts: uses the same isBabyOrSeniorLibraryEvent
 * predicate the scraper applies, so the backfill and the scrape-time skip stay
 * in lockstep. Matches are set to REJECTED (reversible), not deleted.
 *
 * Run: npx tsx scripts/backfill-reject-baby-senior.ts [--dry-run]
 */
async function main() {
  const dryRun = process.argv.includes("--dry-run");
  console.log(`Scanning for baby/senior library events... (${dryRun ? "DRY RUN" : "LIVE"})`);

  // Fetch all published events with the fields the predicate needs.
  const events = await prisma.event.findMany({
    where: { status: "PUBLISHED" },
    select: { id: true, title: true, venueName: true, sourceUrl: true, tags: true },
  });

  const matches = events.filter((e) =>
    isBabyOrSeniorLibraryEvent({ ...e, venueName: e.venueName ?? undefined }),
  );
  console.log(`Found ${matches.length} baby/senior library events out of ${events.length} published`);

  for (const e of matches) {
    console.log(`  [${dryRun ? "DRY" : "REJECT"}] "${e.title}" (venueName: ${e.venueName ?? "none"})`);
  }

  if (!dryRun && matches.length > 0) {
    const result = await prisma.event.updateMany({
      where: { id: { in: matches.map((e) => e.id) } },
      data: { status: "REJECTED" },
    });
    console.log(`\nRejected ${result.count} events.`);
  } else if (dryRun) {
    console.log("\nDry run — no changes made. Re-run without --dry-run to apply.");
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
