import { prisma } from "@/lib/prisma";
import { geocodeEvent } from "@/lib/geocode";
import { categorizeEvent } from "@/lib/categorize";
import type { ScrapedEvent } from "@/lib/types";
import { BaseScraper } from "./base";
import { tokenize, isFuzzyMatch, areLikelyDifferentEvents, MIN_TOKENS } from "@/lib/fuzzy";

// Import all scrapers
import { FoopeeScraper } from "./foopee";
import { NineteenHzScraper } from "./19hz";
import { FuncheapScraper } from "./funcheap";
import { ResidentAdvisorScraper } from "./residentadvisor";
import { LumaScraper } from "./luma";
import { PartifulScraper } from "./partiful";
import { SfliveScraper } from "./sflive";
import { PoshScraper } from "./posh";
import { EventbriteScraper } from "./eventbrite";
export const SCRAPERS: Record<string, BaseScraper> = {
  foopee: new FoopeeScraper(),
  "19hz": new NineteenHzScraper(),
  funcheap: new FuncheapScraper(),
  residentadvisor: new ResidentAdvisorScraper(),
  luma: new LumaScraper(),
  partiful: new PartifulScraper(),
  sflive: new SfliveScraper(),
  posh: new PoshScraper(),
  eventbrite: new EventbriteScraper(),
  // meetup: paid API only — skipped for now
};

const IMAGE_BACKFILL_CONCURRENCY = 5;

async function fetchImageFromSourceUrl(url: string): Promise<string | undefined> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(10000),
    });
    const html = await res.text();

    // OG image meta tag (try both attribute orderings)
    const match =
      html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ??
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    let ogImage = match?.[1];
    if (!ogImage) return undefined;

    // Unescape HTML entities
    ogImage = ogImage.replace(/&amp;/g, "&");

    // If it's a Next.js image proxy (/_next/image?url=...) extract the real URL
    const nextImageMatch = ogImage.match(/[?&]url=([^&]+)/);
    if (nextImageMatch) {
      let inner = decodeURIComponent(nextImageMatch[1]);
      // img.evbuc.com uses path-based proxying: https://img.evbuc.com/<encoded-cdn-url>
      if (inner.includes("img.evbuc.com/")) {
        const pathPart = inner.replace(/^https?:\/\/img\.evbuc\.com\//, "");
        return decodeURIComponent(pathPart).split("?")[0];
      }
      return inner.split("?")[0];
    }

    return ogImage;
  } catch {
    return undefined;
  }
}

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

  // Backfill images for events the scraper didn't provide one for
  const missingImage = events.filter((e) => !e.imageUrl);
  if (missingImage.length > 0) {
    console.log(`[${slug}] Backfilling images for ${missingImage.length} events...`);
    for (let i = 0; i < missingImage.length; i += IMAGE_BACKFILL_CONCURRENCY) {
      const batch = missingImage.slice(i, i + IMAGE_BACKFILL_CONCURRENCY);
      await Promise.all(
        batch.map(async (event) => {
          const imageUrl = await fetchImageFromSourceUrl(event.sourceUrl);
          if (imageUrl) event.imageUrl = imageUrl;
        })
      );
    }
  }

  let inserted = 0;

  for (const event of events) {
    const dedupeHash = scraper.computeDedupeHash(event);

    // Skip if already exists, but enrich with better data if available
    const LOW_QUALITY_DOMAINS = ["foopee.com", "19hz.info"];

    async function enrichExisting(existingId: string, existingSourceUrl: string, existingImageUrl: string | null) {
      const enrichments: Record<string, unknown> = {};
      if (!existingImageUrl && event.imageUrl) {
        enrichments.imageUrl = event.imageUrl;
      }
      const existingIsLowQuality = LOW_QUALITY_DOMAINS.some((d) => existingSourceUrl.includes(d));
      const incomingIsHighQuality = !LOW_QUALITY_DOMAINS.some((d) => event.sourceUrl.includes(d));
      if (existingIsLowQuality && incomingIsHighQuality) {
        enrichments.sourceUrl = event.sourceUrl;
        enrichments.sourceId = source.id;
      }
      if (Object.keys(enrichments).length > 0) {
        await prisma.event.update({ where: { id: existingId }, data: enrichments });
      }
    }

    const exactMatch = await prisma.event.findUnique({ where: { dedupeHash } });
    if (exactMatch) {
      await enrichExisting(exactMatch.id, exactMatch.sourceUrl, exactMatch.imageUrl);
      continue;
    }

    // Fuzzy match: check events on the same calendar day
    const incomingTokens = tokenize(event.title);
    if (incomingTokens.size >= MIN_TOKENS) {
      const dayStart = new Date(event.startDate);
      dayStart.setUTCHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart);
      dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

      const dayEvents = await prisma.event.findMany({
        where: { startDate: { gte: dayStart, lt: dayEnd } },
        select: { id: true, title: true, sourceUrl: true, imageUrl: true },
      });

      const fuzzyMatch = dayEvents.find((e) => {
        const existingTokens = tokenize(e.title);
        return (
          existingTokens.size >= MIN_TOKENS &&
          isFuzzyMatch(incomingTokens, existingTokens) &&
          !areLikelyDifferentEvents(incomingTokens, existingTokens)
        );
      });

      if (fuzzyMatch) {
        console.log(`[${slug}] Fuzzy duplicate: "${event.title}" ≈ "${fuzzyMatch.title}"`);
        await enrichExisting(fuzzyMatch.id, fuzzyMatch.sourceUrl, fuzzyMatch.imageUrl);
        continue;
      }
    }

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
