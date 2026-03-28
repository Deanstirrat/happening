/**
 * Deletes all events from the 7 scrapers that had timezone bugs, so they can
 * be re-scraped cleanly with the fixed scraper code.
 *
 * Safe to run: preserves community, luma, partiful, posh, eventbrite, kqed events.
 *
 * Run: npx tsx scripts/reset-scraped-events.ts
 * Then trigger a re-scrape for each affected source.
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local", override: true });

import { prisma } from "../lib/prisma";

const AFFECTED_SLUGS = [
  "19hz",
  "bandsintown",
  "eventbrite",
  "foopee",
  "funcheap",
  "posh",
  "residentadvisor",
  "sflive",
  "songkick",
];

async function main() {
  for (const slug of AFFECTED_SLUGS) {
    const source = await prisma.source.findUnique({ where: { slug } });
    if (!source) {
      console.log(`[${slug}] Source not found — skipping`);
      continue;
    }

    const { count } = await prisma.event.deleteMany({
      where: { sourceId: source.id },
    });

    console.log(`[${slug}] Deleted ${count} events`);
  }

  await prisma.$disconnect();
  console.log("\nDone. Now trigger a re-scrape for all affected sources.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
