import { prisma } from "@/lib/prisma";
import { geocodeEvent } from "@/lib/geocode";
import { categorizeEvent } from "@/lib/categorize";
import type { ScrapedEvent } from "@/lib/types";
import { BaseScraper } from "./base";

// Import all scrapers
import { FoopeeScraper } from "./foopee";
import { NineteenHzScraper } from "./19hz";
import { FuncheapScraper } from "./funcheap";
import { ResidentAdvisorScraper } from "./residentadvisor";
import { LumaScraper } from "./luma";
import { PartifulScraper } from "./partiful";
import { SfliveScraper } from "./sflive";
import { PoshScraper } from "./posh";
export const SCRAPERS: Record<string, BaseScraper> = {
  foopee: new FoopeeScraper(),
  "19hz": new NineteenHzScraper(),
  funcheap: new FuncheapScraper(),
  residentadvisor: new ResidentAdvisorScraper(),
  luma: new LumaScraper(),
  partiful: new PartifulScraper(),
  sflive: new SfliveScraper(),
  posh: new PoshScraper(),
  // meetup: paid API only — skipped for now
};

export async function runScraper(
  slug: string
): Promise<{ scraped: number; inserted: number }> {
  const scraper = SCRAPERS[slug];
  if (!scraper) throw new Error(`Unknown scraper: ${slug}`);

  // Get source record
  const source = await prisma.source.findUnique({ where: { slug } });
  if (!source) throw new Error(`Source not found in DB: ${slug}`);
  if (!source.enabled) {
    console.log(`[${slug}] Skipping disabled source`);
    return { scraped: 0, inserted: 0 };
  }

  console.log(`[${slug}] Scraping...`);
  const events = await scraper.scrape();
  console.log(`[${slug}] Got ${events.length} events`);

  let inserted = 0;

  for (const event of events) {
    const dedupeHash = scraper.computeDedupeHash(event);

    // Skip if already exists
    const exists = await prisma.event.findUnique({ where: { dedupeHash } });
    if (exists) continue;

    // Geocode
    const geo = await geocodeEvent(event);

    // Categorize
    const category = await categorizeEvent(event);

    // Upsert
    try {
      await prisma.event.create({
        data: {
          dedupeHash,
          externalId: event.externalId,
          title: event.title,
          description: event.description,
          startDate: event.startDate,
          endDate: event.endDate,
          venueName: event.venueName,
          venueAddress: event.venueAddress,
          neighborhood: geo.neighborhood,
          latitude: geo.latitude,
          longitude: geo.longitude,
          category,
          price: event.price,
          isFree: event.isFree ?? scraper.parseFree(event.price),
          imageUrl: event.imageUrl,
          sourceUrl: event.sourceUrl,
          tags: event.tags ?? [],
          geocoded: geo.latitude != null,
          categorized: true,
          sourceId: source.id,
        },
      });
      inserted++;
    } catch (err: any) {
      // Unique constraint violation — another process inserted it concurrently
      if (err.code !== "P2002") {
        console.error(`[${slug}] Error inserting event "${event.title}":`, err.message);
      }
    }
  }

  // Update lastScrapedAt
  await prisma.source.update({
    where: { slug },
    data: { lastScrapedAt: new Date() },
  });

  console.log(`[${slug}] Done — ${inserted}/${events.length} new events inserted`);
  return { scraped: events.length, inserted };
}
