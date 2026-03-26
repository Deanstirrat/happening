import dotenv from "dotenv";
dotenv.config({ path: ".env.local", override: true });

import { createHash } from "crypto";
import { prisma } from "../lib/prisma";

const LOW_QUALITY_DOMAINS = ["foopee.com", "19hz.info"];

function computeNewHash(startDate: Date, title: string): string {
  const dateStr = startDate.toISOString().slice(0, 10);
  const normalizedTitle = title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return createHash("sha256").update(`${dateStr}::${normalizedTitle}`).digest("hex");
}

async function main() {
  const events = await prisma.event.findMany({
    select: { id: true, title: true, startDate: true, imageUrl: true, sourceUrl: true, dedupeHash: true },
  });

  console.log(`Found ${events.length} total events`);

  // Group events by their new source-agnostic hash
  const groups = new Map<string, typeof events>();
  for (const event of events) {
    const newHash = computeNewHash(event.startDate, event.title);
    const group = groups.get(newHash) ?? [];
    group.push(event);
    groups.set(newHash, group);
  }

  let rehashed = 0;
  let merged = 0;
  let deleted = 0;

  for (const [newHash, group] of groups) {
    if (group.length === 1) {
      // No collision — just update the hash
      const event = group[0];
      if (event.dedupeHash !== newHash) {
        await prisma.event.update({ where: { id: event.id }, data: { dedupeHash: newHash } });
        rehashed++;
      }
    } else {
      // Collision — pick the best record to keep
      // Prefer: has imageUrl > non-low-quality sourceUrl > first scraped
      const winner = group.sort((a, b) => {
        const aHasImage = a.imageUrl ? 1 : 0;
        const bHasImage = b.imageUrl ? 1 : 0;
        if (bHasImage !== aHasImage) return bHasImage - aHasImage;

        const aHighQuality = LOW_QUALITY_DOMAINS.some((d) => a.sourceUrl.includes(d)) ? 0 : 1;
        const bHighQuality = LOW_QUALITY_DOMAINS.some((d) => b.sourceUrl.includes(d)) ? 0 : 1;
        return bHighQuality - aHighQuality;
      })[0];

      const losers = group.filter((e) => e.id !== winner.id);

      // Delete duplicates
      await prisma.event.deleteMany({ where: { id: { in: losers.map((e) => e.id) } } });
      deleted += losers.length;

      // Update winner's hash
      await prisma.event.update({ where: { id: winner.id }, data: { dedupeHash: newHash } });
      merged++;

      const titles = group.map((e) => `[${e.sourceUrl.split("/")[2]}]`).join(" + ");
      console.log(`  Merged: "${winner.title}" (${titles}) → kept ${winner.imageUrl ? "with image" : "no image"}`);
    }
  }

  console.log(`\nDone:`);
  console.log(`  ${rehashed} events re-hashed (no collision)`);
  console.log(`  ${merged} collision groups resolved`);
  console.log(`  ${deleted} duplicate records deleted`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
