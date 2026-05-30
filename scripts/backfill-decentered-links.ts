/**
 * Backfill sourceUrl for Decentered events that still point to the broken
 * events.decentered.org/events/{id} internal URLs.
 *
 * Fetches the live RSS feed using the updated DecenteredScraper (which now
 * extracts external website links from the description HTML), then patches
 * any DB event whose sourceUrl still contains "events.decentered.org".
 *
 * Run with:
 *   npx tsx scripts/backfill-decentered-links.ts
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env", override: true });
dotenv.config({ path: ".env.local", override: true });

import { prisma } from "../lib/prisma";
import { DecenteredScraper } from "../lib/scrapers/decentered";

async function main() {
  const scraper = new DecenteredScraper();

  console.log("Fetching Decentered RSS feed...");
  const scraped = await scraper.scrape();
  console.log(`Got ${scraped.length} events from feed`);

  // Build a map from externalId → sourceUrl for events that have a real external URL
  const externalUrlByExternalId = new Map<string, string>();
  for (const event of scraped) {
    if (
      event.externalId &&
      event.sourceUrl &&
      !event.sourceUrl.includes("events.decentered.org")
    ) {
      externalUrlByExternalId.set(event.externalId, event.sourceUrl);
    }
  }

  console.log(
    `Found ${externalUrlByExternalId.size} events with external website URLs`
  );

  if (externalUrlByExternalId.size === 0) {
    console.log("Nothing to update — RSS feed may not contain website links.");
    await prisma.$disconnect();
    return;
  }

  // Find Decentered events in the DB still pointing at the broken internal URL
  const stale = await prisma.event.findMany({
    where: {
      source: { slug: "decentered" },
      sourceUrl: { contains: "events.decentered.org" },
      externalId: { in: Array.from(externalUrlByExternalId.keys()) },
    },
    select: { id: true, title: true, externalId: true, sourceUrl: true },
  });

  console.log(`Found ${stale.length} stale DB events to patch`);

  let updated = 0;
  for (const event of stale) {
    const newUrl = externalUrlByExternalId.get(event.externalId!);
    if (!newUrl) continue;
    await prisma.event.update({
      where: { id: event.id },
      data: { sourceUrl: newUrl },
    });
    console.log(`  ✓ "${event.title}"\n    ${event.sourceUrl}\n    → ${newUrl}`);
    updated++;
  }

  console.log(`\nDone — ${updated} events updated`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
