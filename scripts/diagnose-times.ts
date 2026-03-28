/**
 * Diagnostic: inspect scrapedAt vs startDate for affected sources
 * to identify when the server timezone changed.
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local", override: true });

import { prisma } from "../lib/prisma";

async function main() {
  // Look at a sample of events from each affected source
  // sorted by scrapedAt to find the timezone-change boundary
  const sources = ["bandsintown", "foopee", "19hz", "funcheap", "sflive", "songkick"];

  for (const slug of sources) {
    const events = await prisma.event.findMany({
      where: {
        source: { slug },
        startDate: { gte: new Date("2026-03-01T00:00:00Z") },
      },
      select: {
        title: true,
        startDate: true,
        scrapedAt: true,
      },
      orderBy: { scrapedAt: "asc" },
      take: 5,
    });

    if (events.length === 0) continue;
    console.log(`\n=== ${slug} (${events.length} shown) ===`);
    for (const e of events) {
      const utcH = e.startDate.getUTCHours();
      const utcM = String(e.startDate.getUTCMinutes()).padStart(2, "0");
      console.log(
        `  scrapedAt=${e.scrapedAt.toISOString().slice(0, 16)}  startUTC=${utcH}:${utcM}  "${e.title.slice(0, 50)}"`
      );
    }
  }

  await prisma.$disconnect();
}

main().catch((err) => { console.error(err); process.exit(1); });
