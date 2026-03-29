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
import { BandsintownScraper } from "./bandsintown";
import { KqedScraper } from "./kqed";
import { DothebayScraper } from "./dothebay";
import { RedditSFEventsScraper } from "./reddit";
import { BadslavaTriviaScraper } from "./badslava";
import { SfplScraper } from "./sfpl";
import { SfrecparkScraper } from "./sfrecpark";
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
  bandsintown: new BandsintownScraper(),
  kqed: new KqedScraper(),
  dothebay: new DothebayScraper(),
  "reddit-sfevents": new RedditSFEventsScraper(),
  badslava: new BadslavaTriviaScraper(),
  sfpl: new SfplScraper(),
  sfrecpark: new SfrecparkScraper(),
  // meetup: paid API only — skipped for now
};

const IMAGE_BACKFILL_CONCURRENCY = 5;
const DESCRIPTION_MAX_LENGTH = 500;

function extractOgDescription(html: string): string | undefined {
  const match =
    html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i) ??
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/i) ??
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ??
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);
  if (!match?.[1]) return undefined;
  let desc = match[1]
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
  if (!desc) return undefined;
  if (desc.length > DESCRIPTION_MAX_LENGTH) {
    desc = desc.slice(0, DESCRIPTION_MAX_LENGTH).replace(/\s+\S*$/, "") + "…";
  }
  return desc;
}

async function fetchMetaFromSourceUrl(url: string): Promise<{ imageUrl?: string; description?: string }> {
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

    const description = extractOgDescription(html);

    // OG image meta tag (try both attribute orderings)
    const match =
      html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ??
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    let ogImage = match?.[1];

    if (!ogImage) {
      // Funcheap detail pages often lack og:image; the featured image is in a
      // <noscript> tag (SPAI pattern). Strip the SPAI proxy and WordPress resize
      // suffix to get the full-res original.
      if (url.includes("funcheap.com")) {
        const noscriptMatches = [...html.matchAll(/<noscript[^>]*>([\s\S]*?)<\/noscript>/gi)];
        for (const m of noscriptMatches) {
          const imgMatch = m[1].match(/src=["']([^"']+)["']/i);
          if (!imgMatch?.[1]) continue;
          const src = imgMatch[1];
          if (!src.includes("wp-content/uploads")) continue;
          let imgUrl = src;
          const spaiMatch = imgUrl.match(/cdn\.shortpixel\.ai\/spai\/[^/]+\/(.+)/);
          if (spaiMatch) imgUrl = `https://${spaiMatch[1]}`;
          imgUrl = imgUrl.replace(/-\d+x\d+(\.[a-z]+)$/i, "$1");
          return { imageUrl: imgUrl, description };
        }
      }
      return { description };
    }

    // Unescape HTML entities
    ogImage = ogImage.replace(/&amp;/g, "&");

    // If it's a Next.js image proxy (/_next/image?url=...) extract the real URL
    const nextImageMatch = ogImage.match(/[?&]url=([^&]+)/);
    if (nextImageMatch) {
      let inner = decodeURIComponent(nextImageMatch[1]);
      // img.evbuc.com uses path-based proxying: https://img.evbuc.com/<encoded-cdn-url>
      if (inner.includes("img.evbuc.com/")) {
        const pathPart = inner.replace(/^https?:\/\/img\.evbuc\.com\//, "");
        return { imageUrl: decodeURIComponent(pathPart).split("?")[0], description };
      }
      return { imageUrl: inner.split("?")[0], description };
    }

    return { imageUrl: ogImage, description };
  } catch {
    return {};
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
  const sourceId = source.id;
  if (!source.enabled) {
    console.log(`[${slug}] Skipping disabled source`);
    return { scraped: 0, inserted: 0 };
  }

  console.log(`[${slug}] Scraping...`);
  const events = await scraper.scrape();
  console.log(`[${slug}] Got ${events.length} events`);

  // Backfill images and descriptions for events the scraper didn't provide them for
  const needsMeta = events.filter((e) => !e.imageUrl || !e.description);
  if (needsMeta.length > 0) {
    console.log(`[${slug}] Backfilling meta for ${needsMeta.length} events...`);
    for (let i = 0; i < needsMeta.length; i += IMAGE_BACKFILL_CONCURRENCY) {
      const batch = needsMeta.slice(i, i + IMAGE_BACKFILL_CONCURRENCY);
      await Promise.all(
        batch.map(async (event) => {
          const { imageUrl, description } = await fetchMetaFromSourceUrl(event.sourceUrl);
          if (imageUrl && !event.imageUrl) event.imageUrl = imageUrl;
          if (description && !event.description) event.description = description;
        })
      );
    }
  }

  let inserted = 0;

  for (const event of events) {
    const dedupeHash = scraper.computeDedupeHash(event);

    // Skip if already exists, but enrich with better data if available
    const LOW_QUALITY_DOMAINS = ["foopee.com", "19hz.info"];

    async function enrichExisting(
      existingId: string,
      existingSourceUrl: string,
      existingImageUrl: string | null,
      existingDescription: string | null = null,
    ) {
      const enrichments: Record<string, unknown> = {};
      if (!existingImageUrl && event.imageUrl) {
        enrichments.imageUrl = event.imageUrl;
      }
      if (!existingDescription && event.description) {
        enrichments.description = event.description;
      }
      const existingIsLowQuality = LOW_QUALITY_DOMAINS.some((d) => existingSourceUrl.includes(d));
      const incomingIsHighQuality = !LOW_QUALITY_DOMAINS.some((d) => event.sourceUrl.includes(d));
      if (existingIsLowQuality && incomingIsHighQuality) {
        enrichments.sourceUrl = event.sourceUrl;
        enrichments.sourceId = sourceId;
      }
      if (Object.keys(enrichments).length > 0) {
        await prisma.event.update({ where: { id: existingId }, data: enrichments });
      }
    }

    const exactMatch = await prisma.event.findUnique({ where: { dedupeHash } });
    if (exactMatch) {
      await enrichExisting(exactMatch.id, exactMatch.sourceUrl, exactMatch.imageUrl, exactMatch.description);
      continue;
    }

    // Day-scoped duplicate checks: fuzzy title match + venue-as-title match.
    // Fetch dayEvents whenever either check might apply.
    const incomingTokens = tokenize(event.title);
    const needsDayCheck = incomingTokens.size >= MIN_TOKENS || Boolean(event.venueName);

    if (needsDayCheck) {
      const dayStart = new Date(event.startDate);
      dayStart.setUTCHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart);
      dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

      const dayEvents = await prisma.event.findMany({
        where: { startDate: { gte: dayStart, lt: dayEnd } },
        select: { id: true, title: true, sourceUrl: true, imageUrl: true, venueName: true, description: true },
      });

      // Fuzzy title match
      if (incomingTokens.size >= MIN_TOKENS) {
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
          await enrichExisting(fuzzyMatch.id, fuzzyMatch.sourceUrl, fuzzyMatch.imageUrl, fuzzyMatch.description);
          continue;
        }
      }

      // Venue-as-title dedup: catches cases where a scraper uses the venue name as
      // the event title (e.g. Bandsintown listing "Phonobar" at Phonobar venue).
      if (event.venueName) {
        const normalizeStr = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
        const incomingTitleNorm = normalizeStr(event.title);
        const incomingVenueNorm = normalizeStr(event.venueName);

        if (incomingTitleNorm === incomingVenueNorm) {
          // Case 1: incoming is a venue-as-title placeholder — find the real event at the same venue
          const venueMatch = dayEvents.find(
            (e) => e.venueName && normalizeStr(e.venueName) === incomingVenueNorm
          );
          if (venueMatch) {
            console.log(`[${slug}] Venue-as-title duplicate: "${event.title}" skipped, existing: "${venueMatch.title}"`);
            await enrichExisting(venueMatch.id, venueMatch.sourceUrl, venueMatch.imageUrl, venueMatch.description);
            continue;
          }
        } else {
          // Case 2: incoming has a real title — check if a venue-as-title placeholder already exists at the same venue
          const placeholderMatch = dayEvents.find((e) => {
            if (!e.venueName) return false;
            const existingTitleNorm = normalizeStr(e.title);
            const existingVenueNorm = normalizeStr(e.venueName);
            return existingTitleNorm === existingVenueNorm && existingVenueNorm === incomingVenueNorm;
          });
          if (placeholderMatch) {
            console.log(`[${slug}] Replacing venue-as-title placeholder "${placeholderMatch.title}" → "${event.title}"`);
            await prisma.event.update({
              where: { id: placeholderMatch.id },
              data: {
                title: event.title,
                dedupeHash: scraper.computeDedupeHash(event),
                sourceUrl: event.sourceUrl,
                sourceId: sourceId,
                ...(event.imageUrl && !placeholderMatch.imageUrl ? { imageUrl: event.imageUrl } : {}),
              },
            });
            continue;
          }
        }
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
