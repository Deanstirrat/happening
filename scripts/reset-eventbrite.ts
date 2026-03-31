/**
 * Deletes all Eventbrite events so they can be re-scraped with fixed
 * time parsing and price enrichment.
 *
 * Run: npx tsx scripts/reset-eventbrite.ts
 * Then trigger a re-scrape for the eventbrite source.
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local", override: true });

import { prisma } from "../lib/prisma";

async function main() {
  const source = await prisma.source.findUnique({
    where: { slug: "eventbrite" },
  });
  if (!source) {
    console.log("Eventbrite source not found — nothing to do");
    await prisma.$disconnect();
    return;
  }

  const { count } = await prisma.event.deleteMany({
    where: { sourceId: source.id },
  });

  console.log(`Deleted ${count} Eventbrite events`);
  console.log("Now trigger a re-scrape for the eventbrite source.");
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
