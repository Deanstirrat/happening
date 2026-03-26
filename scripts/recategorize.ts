import dotenv from "dotenv";
dotenv.config({ path: ".env.local", override: true });

import { prisma } from "../lib/prisma";
import { categorizeEvent } from "../lib/categorize";
import type { ScrapedEvent } from "../lib/types";

async function main() {
  // Target events that are likely miscategorized:
  // 1. All OTHER events
  // 2. MUSIC_ROCK_PUNK events from foopee — foopee tags every event with "punk, rock, diy"
  //    regardless of genre, causing the AI to over-assign MUSIC_ROCK_PUNK
  const events = await prisma.event.findMany({
    where: {
      OR: [
        { category: "OTHER" },
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
      source: { select: { slug: true } },
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
