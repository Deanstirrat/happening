import { prisma } from "@/lib/prisma";
import { geocodeEvent } from "@/lib/geocode";
import { categorizeEvent } from "@/lib/categorize";
import type { ScrapedEvent } from "@/lib/types";
import { BaseScraper } from "./base";
import { tokenize, isFuzzyMatch, areLikelyDifferentEvents, isVenueFuzzyMatch, MIN_TOKENS } from "@/lib/fuzzy";
import { tagRecurringEvents } from "@/lib/recurring";
import { sfDayKey, sfDayStart } from "@/lib/sfDate";

// Source URLs that point to list pages rather than individual events — skip sourceUrl dedup for these
const GENERIC_SOURCE_URL_PATTERNS = [
  "foopee.com/punk/the-list/",
  "19hz.info/eventlisting_BayArea.php",
  "badslava.com/san-francisco-trivia-nights.php",
  "noevalleytownsquare.com/events",
];
const isSpecificSourceUrl = (url: string) =>
  !GENERIC_SOURCE_URL_PATTERNS.some((p) => url.includes(p));

const GENERIC_VENUE_NAMES = new Set([
  "locationprovidedafterbooking",
  "locationtobeprovided",
  "onlineevent",
  "virtualevent",
  "tba",
  "tbd",
]);
const isGenericVenue = (s: string) =>
  GENERIC_VENUE_NAMES.has(s.toLowerCase().replace(/[^a-z0-9]/g, ""));

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
import { InstagramScraper } from "./instagram";
import { DecenteredScraper } from "./decentered";
import { MedicineForNightmaresScraper } from "./medicinefornightmares";
import { OmnivoreBooksScraper } from "./omnivorebooks";
import { NoeValleyTownSquareScraper } from "./noevalleytownsquare";
import { CityLightsScraper } from "./citylights";
import { SFJazzScraper } from "./sfjazz";
export const SCRAPERS: Record<string, BaseScraper> = {
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
  // sfrecpark: disabled — low-quality events
  instagram: new InstagramScraper(),
  decentered: new DecenteredScraper(),
  "medicine-for-nightmares": new MedicineForNightmaresScraper(),
  omnivorebooks: new OmnivoreBooksScraper(),
  "noe-valley-town-square": new NoeValleyTownSquareScraper(),
  citylights: new CityLightsScraper(),
  sfjazz: new SFJazzScraper(),
  foopee: new FoopeeScraper(),
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

  type DayEvent = {
    id: string;
    title: string;
    sourceUrl: string;
    imageUrl: string | null;
    venueName: string | null;
    description: string | null;
    startDate: Date;
  };

  // Pre-build per-SF-day cache to avoid O(n²) DB queries in the dedup loop.
  const dayEventsCache = new Map<string, DayEvent[]>();
  for (const event of events) {
    const incomingTokens = tokenize(event.title);
    const needsDayCheck = incomingTokens.size >= MIN_TOKENS || Boolean(event.venueName);
    if (!needsDayCheck) continue;
    const key = sfDayKey(event.startDate);
    if (dayEventsCache.has(key)) continue;
    const dayStart = sfDayStart(key);
    const dayEnd = new Date(dayStart.getTime() + 86400000);
    const rows = await prisma.event.findMany({
      where: { startDate: { gte: dayStart, lt: dayEnd } },
      select: { id: true, title: true, sourceUrl: true, imageUrl: true, venueName: true, description: true, startDate: true },
    });
    dayEventsCache.set(key, rows);
  }

  // Load blocklist once for this run
  const blocklist = await prisma.eventBlocklist.findMany({
    select: { dedupeHash: true, sourceUrl: true, title: true },
  });
  const blockedHashes = new Set(blocklist.map((b) => b.dedupeHash).filter(Boolean) as string[]);
  const blockedUrls = new Set(blocklist.map((b) => b.sourceUrl).filter(Boolean) as string[]);
  const blockedTitles = new Set(blocklist.map((b) => b.title.toLowerCase().trim()));

  let inserted = 0;

  for (const event of events) {
    const dedupeHash = scraper.computeDedupeHash(event);

    // Skip blocklisted events (by hash, URL, or title)
    if (blockedHashes.has(dedupeHash) || blockedUrls.has(event.sourceUrl) || blockedTitles.has(event.title.toLowerCase().trim())) {
      console.log(`[${slug}] Blocked: "${event.title}"`);
      continue;
    }

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

    // Source URL dedup: two events on the same SF day sharing a specific (non-list-page) URL
    // are the same event, even if their titles differ (e.g. one source has the wrong year).
    // Same-day constraint prevents merging different occurrences of recurring events.
    if (isSpecificSourceUrl(event.sourceUrl)) {
      const sfDay = sfDayKey(event.startDate);
      const sfDayStartDate = sfDayStart(sfDay);
      const sfDayEndDate = new Date(sfDayStartDate.getTime() + 86400000);
      const urlMatch = await prisma.event.findFirst({
        where: {
          sourceUrl: event.sourceUrl,
          startDate: { gte: sfDayStartDate, lt: sfDayEndDate },
        },
        select: { id: true, sourceUrl: true, imageUrl: true, description: true },
      });
      if (urlMatch) {
        console.log(`[${slug}] Source URL duplicate: "${event.title}" (${event.sourceUrl})`);
        await enrichExisting(urlMatch.id, urlMatch.sourceUrl, urlMatch.imageUrl, urlMatch.description);
        continue;
      }
    }

    // Day-scoped duplicate checks: fuzzy title match + venue-as-title match.
    // Fetch dayEvents whenever either check might apply.
    const incomingTokens = tokenize(event.title);
    const needsDayCheck = incomingTokens.size >= MIN_TOKENS || Boolean(event.venueName);

    if (needsDayCheck) {
      // Use SF-local day boundaries so evening events (stored as next UTC day) are
      // compared against the correct SF calendar day's events.
      const dayStart = sfDayStart(sfDayKey(event.startDate));
      const dayEnd = new Date(dayStart.getTime() + 86400000);

      const dayEvents = dayEventsCache.get(sfDayKey(event.startDate)) ?? [];

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

      // Same-time + fuzzy-venue + title containment: catches cases where different sources
      // describe the same event with different title prefixes/suffixes (e.g. a promoter name
      // prepended: "Curiosity Guild: Fool's Errand" vs "Fool's Errand") at the same venue.
      // Uses start time + venue as primary signals; title containment as a light guard.
      // This fires even when incomingTokens.size < MIN_TOKENS (short titles like "Fool's Errand").
      if (event.venueName && !isGenericVenue(event.venueName)) {
        const incomingTime = event.startDate.getTime();
        const TIME_WINDOW_MS = 15 * 60 * 1000; // ±15 minutes
        const sameTimeVenueMatch = dayEvents.find((e) => {
          if (!e.venueName || isGenericVenue(e.venueName)) return false;
          if (Math.abs(e.startDate.getTime() - incomingTime) > TIME_WINDOW_MS) return false;
          if (!isVenueFuzzyMatch(event.venueName!, e.venueName)) return false;
          const existingTokens = tokenize(e.title);
          const minSize = Math.min(incomingTokens.size, existingTokens.size);
          if (minSize === 0) return false;
          let shared = 0;
          for (const t of incomingTokens) {
            if (existingTokens.has(t)) shared++;
          }
          return shared / minSize >= 0.5 && !areLikelyDifferentEvents(incomingTokens, existingTokens);
        });
        if (sameTimeVenueMatch) {
          console.log(`[${slug}] Same-time+venue duplicate: "${event.title}" ≈ "${sameTimeVenueMatch.title}" at ${event.venueName}`);
          await enrichExisting(sameTimeVenueMatch.id, sameTimeVenueMatch.sourceUrl, sameTimeVenueMatch.imageUrl, sameTimeVenueMatch.description);
          continue;
        }
      }

      // Venue + partial-title match: same venue on the same SF day with ≥2 shared tokens.
      // Catches cases where titles diverge (e.g. one source adds an opening act) but the
      // event is clearly the same based on venue + key artist/name tokens.
      if (event.venueName && !isGenericVenue(event.venueName) && incomingTokens.size >= 2) {
        const normalizeVenue = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
        const incomingVenueNorm = normalizeVenue(event.venueName);
        const incomingTitleNorm = normalizeVenue(event.title);
        // Only when incoming has a real title (not a venue-as-title placeholder)
        if (incomingTitleNorm !== incomingVenueNorm) {
          const venuePartialMatch = dayEvents.find((e) => {
            if (!e.venueName) return false;
            if (normalizeVenue(e.venueName) !== incomingVenueNorm) return false;
            const existingTokens = tokenize(e.title);
            let shared = 0;
            for (const t of incomingTokens) {
              if (existingTokens.has(t)) shared++;
            }
            return shared >= 2 && !areLikelyDifferentEvents(incomingTokens, existingTokens);
          });
          if (venuePartialMatch) {
            console.log(`[${slug}] Venue+title duplicate: "${event.title}" ≈ "${venuePartialMatch.title}" at ${event.venueName}`);
            await enrichExisting(venuePartialMatch.id, venuePartialMatch.sourceUrl, venuePartialMatch.imageUrl, venuePartialMatch.description);
            continue;
          }
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

    // Categorize — use pre-assigned category if the scraper provided one
    const category = event.category
      ? (event.category as import("@prisma/client").EventCategory)
      : await categorizeEvent(event);

    // Upsert
    try {
      const created = await prisma.event.create({
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
      const newDayKey = sfDayKey(event.startDate);
      const cacheEntry = dayEventsCache.get(newDayKey);
      if (cacheEntry) {
        cacheEntry.push({
          id: created.id,
          title: event.title,
          sourceUrl: event.sourceUrl,
          imageUrl: event.imageUrl ?? null,
          venueName: event.venueName ?? null,
          description: event.description ?? null,
          startDate: event.startDate,
        });
      }
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

  // Tag recurring events based on titles seen in this batch
  const recurringTagged = await tagRecurringEvents(events.map((e) => e.title));
  if (recurringTagged > 0) {
    console.log(`[${slug}] Tagged ${recurringTagged} events as recurring`);
  }

  console.log(`[${slug}] Done — ${inserted}/${events.length} new events inserted`);
  return { scraped: events.length, inserted };
}
