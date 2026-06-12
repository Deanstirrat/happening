import dotenv from "dotenv";
dotenv.config({ path: ".env.local", override: true });

import { prisma } from "@/lib/prisma";
import { isPlaceholderVenue } from "@/lib/venues";

/**
 * Retroactively hold published events that sit at non-venue placeholders (#158).
 *
 * Before the ingest guard landed (lib/scrapers/runner.ts), 19hz's "TBA (San
 * Francisco)" placeholders and funcheap's bare-city strings published
 * locationless, and the sfpl scraper listed "Bookmobiles / MOS" (mobile service,
 * no fixed location). This sweep moves those existing rows to PENDING so they
 * drop out of every public query while staying visible in the admin submissions
 * tab. Future ingests are already handled at the source.
 *
 * Run with `--dry-run` to preview without writing.
 */
async function main() {
  const dryRun = process.argv.includes("--dry-run");
  console.log(`Scanning for placeholder-venue events... (${dryRun ? "DRY RUN" : "LIVE"})`);

  const events = await prisma.event.findMany({
    where: { status: "PUBLISHED", venueName: { not: null } },
    select: { id: true, title: true, venueName: true },
  });

  const isBookmobile = (v: string) => /^bookmobiles\b/i.test(v.trim());
  const held = events.filter(
    (e) => e.venueName && (isPlaceholderVenue(e.venueName) || isBookmobile(e.venueName))
  );

  console.log(`Found ${held.length} placeholder events out of ${events.length} published`);
  for (const e of held) {
    console.log(`  [${dryRun ? "DRY" : "HOLD"}] "${e.title}" (venueName: ${e.venueName})`);
  }

  if (!dryRun && held.length > 0) {
    const result = await prisma.event.updateMany({
      where: { id: { in: held.map((e) => e.id) } },
      data: { status: "PENDING" },
    });
    console.log(`\nHeld ${result.count} events as PENDING.`);
  } else if (dryRun) {
    console.log("\nDry run — no changes made. Re-run without --dry-run to apply.");
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
