import dotenv from "dotenv";
dotenv.config({ path: ".env.local", override: true });

import { createHash, randomUUID } from "crypto";
import { prisma } from "../lib/prisma";
import { computeDedupeHash } from "../lib/dedupeHash";

const LOW_QUALITY_DOMAINS = ["foopee.com", "19hz.info"];

function score(e: { imageUrl: string | null; description: string | null; sourceUrl: string }) {
  return (
    (e.imageUrl ? 2 : 0) +
    (e.description ? 2 : 0) +
    (LOW_QUALITY_DOMAINS.some((d) => e.sourceUrl.includes(d)) ? 0 : 1)
  );
}

async function main() {
  const events = await prisma.event.findMany({
    select: { id: true, title: true, startDate: true, venueName: true, imageUrl: true, description: true, sourceUrl: true, dedupeHash: true },
  });

  console.log(`Found ${events.length} total events`);

  // Group events by new SF-date-based hash
  const groups = new Map<string, typeof events>();
  for (const event of events) {
    const newHash = computeDedupeHash(event.startDate, event.title, event.venueName);
    const group = groups.get(newHash) ?? [];
    group.push(event);
    groups.set(newHash, group);
  }

  const collisionGroups = [...groups.entries()].filter(([, g]) => g.length > 1);
  const singleGroups = [...groups.entries()].filter(([, g]) => g.length === 1);

  let rehashed = 0;
  let merged = 0;
  let archived = 0;

  // Pass 1: Handle collisions first.
  // Archive losers and give them a unique placeholder hash to free the constraint,
  // then update the winner to the correct new hash.
  for (const [newHash, group] of collisionGroups) {
    const winner = [...group].sort((a, b) => score(b) - score(a))[0];
    const losers = group.filter((e) => e.id !== winner.id);

    for (const loser of losers) {
      await prisma.event.update({
        where: { id: loser.id },
        data: {
          status: "ARCHIVED",
          // Use a unique placeholder so the constraint slot is freed
          dedupeHash: `archived::${randomUUID()}`,
        },
      });
      archived++;
    }

    await prisma.event.update({ where: { id: winner.id }, data: { dedupeHash: newHash } });
    merged++;

    const sources = group.map((e) => e.sourceUrl.split("/")[2]).join(" + ");
    console.log(`  Merged: "${winner.title}" (${sources})`);
  }

  // Pass 2: Update single-event groups now that collision slots are freed.
  // A single event's new SF-date hash may collide with another event's still-old
  // UTC-date hash — catch P2002 and resolve on the fly.
  for (const [newHash, [event]] of singleGroups) {
    if (event.dedupeHash === newHash) continue;
    try {
      await prisma.event.update({ where: { id: event.id }, data: { dedupeHash: newHash } });
      rehashed++;
    } catch (err: any) {
      if (err.code === "P2002") {
        // Another event already holds this hash — resolve as a late collision.
        const conflict = await prisma.event.findUnique({ where: { dedupeHash: newHash } });
        if (conflict) {
          const archiveTarget = score(event) >= score(conflict) ? conflict : event;
          const winner = archiveTarget.id === event.id ? conflict : event;
          await prisma.event.update({
            where: { id: archiveTarget.id },
            data: { status: "ARCHIVED", dedupeHash: `archived::${randomUUID()}` },
          });
          if (winner.id === event.id) {
            await prisma.event.update({ where: { id: event.id }, data: { dedupeHash: newHash } });
          }
          const sources = [event, conflict].map((e) => e.sourceUrl.split("/")[2]).join(" + ");
          console.log(`  Late collision: "${winner.title}" (${sources})`);
          archived++;
          merged++;
        }
      } else {
        throw err;
      }
    }
  }

  console.log(`\nDone:`);
  console.log(`  ${rehashed} events re-hashed`);
  console.log(`  ${merged} collision groups resolved`);
  console.log(`  ${archived} duplicates archived`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
