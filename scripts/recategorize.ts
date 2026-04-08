import dotenv from "dotenv";
dotenv.config({ path: ".env.local", override: true });

import { prisma } from "../lib/prisma";
import { categorizeEvent } from "../lib/categorize";
import type { ScrapedEvent } from "../lib/types";

async function main() {
  // Pass 1: deterministic trivia/bingo backfill — no AI needed
  const triviaEvents = await prisma.event.findMany({
    where: {
      category: { in: ["COMMUNITY", "NIGHTLIFE", "OTHER"] },
      OR: [
        { title: { contains: "trivia", mode: "insensitive" } },
        { title: { contains: "bingo", mode: "insensitive" } },
        { tags: { has: "trivia" } },
        { tags: { has: "bingo" } },
      ],
    },
    select: { id: true, title: true, category: true },
  });

  if (triviaEvents.length > 0) {
    console.log(`Backfilling ${triviaEvents.length} trivia/bingo events → TRIVIA_BINGO...`);
    await prisma.event.updateMany({
      where: { id: { in: triviaEvents.map((e) => e.id) } },
      data: { category: "TRIVIA_BINGO", categorized: true },
    });
    console.log(`Done — ${triviaEvents.length} events recategorized.`);
  } else {
    console.log("No trivia/bingo events found to backfill.");
  }

  // Pass 2: AI recategorization for likely-miscategorized events
  // 1. All OTHER events
  // 2. MUSIC_ROCK_PUNK events from foopee — foopee tags every event with "punk, rock, diy"
  //    regardless of genre, causing the AI to over-assign MUSIC_ROCK_PUNK
  // 3. COMMUNITY and TECH events — may now qualify for TALKS_LECTURES (added 2026-03-30)
  const events = await prisma.event.findMany({
    where: {
      OR: [
        { category: "OTHER" },
        { category: "COMMUNITY" },
        { category: "TECH" },
        {
          category: "MUSIC_ROCK_PUNK",
          source: { slug: "foopee" },
        },
      ],
    },
    select: {
      id: true,
      title: true,
      description: true,
      venueName: true,
      tags: true,
      startDate: true,
      sourceUrl: true,
      category: true,
    },
  });

  console.log(`Re-categorizing ${events.length} events...`);

  // 50 req/min limit → 1 request per 1.3s to stay safely under
  const DELAY_MS = 1300;
  let updated = 0;

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    const category = await categorizeEvent(event as ScrapedEvent);
    if (category !== event.category) {
      await prisma.event.update({
        where: { id: event.id },
        data: { category, categorized: true },
      });
      updated++;
    }
    process.stdout.write(
      `\r  ${i + 1}/${events.length} processed, ${updated} updated`
    );
    if (i + 1 < events.length) {
      await new Promise((r) => setTimeout(r, DELAY_MS));
    }
  }

  console.log(`\nDone — ${updated} events recategorized.`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
