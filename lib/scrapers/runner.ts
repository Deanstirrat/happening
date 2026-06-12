import { prisma } from "@/lib/prisma";
import { geocodeEvent } from "@/lib/geocode";
import { resolveVenueId } from "@/lib/venueLink";
import { categorizeEvent } from "@/lib/categorize";
import { BaseScraper } from "./base";
import { tokenize, isFuzzyMatch, areLikelyDifferentEvents, isVenueFuzzyMatch, MIN_TOKENS } from "@/lib/fuzzy";
import { tagRecurringEvents } from "@/lib/recurring";
import { sfDayKey, sfDayStart } from "@/lib/sfDate";
import { isTooFarFromSf } from "@/lib/geo";
import { decodeHtmlEntities } from "@/lib/decodeEntities";
import { isPlaceholderVenue } from "@/lib/venues";
import { SCRAPE_RUN_HISTORY } from "./health";
import { isVirtualEvent, isBabyOrSeniorLibraryEvent, isCanceledEvent, isOutOfAreaVenue } from "@/lib/ingestFilters";

// Name-only music sources that scrape the whole Bay Area. Their out-of-area
// venues carry no street address (just "Venue, City"), so they never geocode and
// the coordinate distance filter can't drop them — apply the venue-city deny-list
// (isOutOfAreaVenue) at ingest instead. Scoped to these sources because their
// venue strings reliably carry the city as a token; broader sources provide real
// addresses that the distance filter already handles (issue #157).
const OUT_OF_AREA_VENUE_FILTER_SOURCES = new Set(["foopee", "bandsintown", "19hz", "folkyeah"]);

// Source URLs that point to list pages rather than individual events — skip sourceUrl dedup for these
const GENERIC_SOURCE_URL_PATTERNS = [
  "foopee.com/punk/the-list/",
  "19hz.info/eventlisting_BayArea.php",
  "badslava.com/san-francisco-trivia-nights.php",
  "noevalleytownsquare.com/events",
  "assemblepuzzlery.com/pages/events",
];
const isSpecificSourceUrl = (url: string) =>
  !GENERIC_SOURCE_URL_PATTERNS.some((p) => url.includes(p));

// True when an event has no reliable start time. Either it's flagged allDay, or
// its time is exactly the noon-SF placeholder that several scrapers assign when a
// source provides only a date (see lib/createEvent.ts, instagram.ts). Such a time
// is meaningless for matching, so dedup must not treat it as a real start time.
// The noon-sentinel check also covers events stored before allDay was set.
const isTimeUnknown = (startDate: Date, allDay: boolean): boolean => {
  if (allDay) return true;
  const noonSf = sfDayStart(sfDayKey(startDate)).getTime() + 12 * 60 * 60 * 1000;
  return startDate.getTime() === noonSf;
};

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
import { SfSpcaScraper } from "./sfspca";
import { FortMasonScraper } from "./fortmason";
import { AssemblePuzzleryScraper } from "./assemblepuzzlery";
import { UcTheatreScraper } from "./uctheatre";
import { GreatStarTheaterScraper } from "./greatstartheater";
import { UsfcaScraper } from "./usfca";
import { TixrScraper } from "./tixr";
import { CityBoxOfficeScraper } from "./cityboxoffice";
import { CivicKitchenScraper } from "./civickitchen";
import { ChurchOfClownScraper } from "./churchofclown";
import { ExploratoriumScraper } from "./exploratorium";
import { BrokeAssStuartScraper } from "./brokeassstuart";
import { StorkClubScraper } from "./storkclub";
import { SpotlightComedyScraper } from "./spotlightcomedy";
import { BestMedicineComedyScraper } from "./bestmedicinecomedy";
// BorderlandsBooksScraper omitted — disabled, event program on hold
import { GreenAppleBooksScraper } from "./greenapplebooks";
import { DiceScraper } from "./dice";
import { SfDesignWeekScraper } from "./sfdesignweek";
import { FolkYeahScraper } from "./folkyeah";
import { RoxieScraper } from "./roxie";
import { AlamoSfScraper } from "./alamosf";
import { FerryBuildingScraper } from "./ferrybuilding";
import { ParksConservancyScraper } from "./parksconservancy";
import { MinnesotaStreetScraper } from "./minnesotastreet";
import { JamBaseScraper } from "./jambase";
import { DnaLoungeScraper } from "./dnalounge";
import { ComedyCalendarScraper } from "./comedycalendar";
export const SCRAPERS: Record<string, BaseScraper> = {
  // ── High-quality aggregators first — populate events with rich data so
  //    low-quality sources (foopee, 19hz) only fill gaps ──────────────────
  dice: new DiceScraper(),
  "19hz": new NineteenHzScraper(),
  funcheap: new FuncheapScraper(),
  residentadvisor: new ResidentAdvisorScraper(),
  luma: new LumaScraper(),
  partiful: new PartifulScraper(),
  sflive: new SfliveScraper(),
  posh: new PoshScraper(),
  eventbrite: new EventbriteScraper(),
  bandsintown: new BandsintownScraper(),
  jambase: new JamBaseScraper(),
  kqed: new KqedScraper(),
  dothebay: new DothebayScraper(),
  // reddit-sfevents: disabled — Reddit now requires OAuth for JSON API (403 without auth)
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
  sfdesignweek: new SfDesignWeekScraper(),
  foopee: new FoopeeScraper(),
  // meetup: paid API only — skipped for now
  sfspca: new SfSpcaScraper(),
  fortmason: new FortMasonScraper(),
  assemblepuzzlery: new AssemblePuzzleryScraper(),
  uctheatre: new UcTheatreScraper(),
  greatstartheater: new GreatStarTheaterScraper(),
  usfca: new UsfcaScraper(),
  // tixr: disabled — DataDome bot protection blocks automated access, causing timeouts
  cityboxoffice: new CityBoxOfficeScraper(),
  civickitchen: new CivicKitchenScraper(),
  churchofclown: new ChurchOfClownScraper(),
  exploratorium: new ExploratoriumScraper(),
  brokeassstuart: new BrokeAssStuartScraper(),
  storkclub: new StorkClubScraper(),
  dnalounge: new DnaLoungeScraper(),
  // borderlandsbooks: disabled — event program is currently on hold per their website
  greenapplebooks: new GreenAppleBooksScraper(),
  spotlightcomedy: new SpotlightComedyScraper(),
  bestmedicinecomedy: new BestMedicineComedyScraper(),
  comedycalendar: new ComedyCalendarScraper(),
  folkyeah: new FolkYeahScraper(),
  // ── Thin-category venue sources (film, food & drink, galleries, outdoor) ──
  roxie: new RoxieScraper(),
  alamosf: new AlamoSfScraper(),
  ferrybuilding: new FerryBuildingScraper(),
  parksconservancy: new ParksConservancyScraper(),
  minnesotastreet: new MinnesotaStreetScraper(),
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
  let desc = decodeHtmlEntities(match[1]);
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

// Persist a scrape outcome, then prune older rows so each source keeps at most
// SCRAPE_RUN_HISTORY runs. Best-effort: logging must never break a scrape, so a
// failure here is swallowed after being surfaced to the server console.
async function recordScrapeRun(
  sourceId: string,
  run: { ok: boolean; scraped?: number; inserted?: number; error?: string }
) {
  try {
    await prisma.scrapeRun.create({
      data: {
        sourceId,
        ok: run.ok,
        scraped: run.scraped ?? 0,
        inserted: run.inserted ?? 0,
        error: run.error ?? null,
      },
    });
    const stale = await prisma.scrapeRun.findMany({
      where: { sourceId },
      orderBy: { createdAt: "desc" },
      skip: SCRAPE_RUN_HISTORY,
      select: { id: true },
    });
    if (stale.length > 0) {
      await prisma.scrapeRun.deleteMany({
        where: { id: { in: stale.map((r) => r.id) } },
      });
    }
  } catch (err) {
    console.error(`[${sourceId}] Failed to record scrape run`, err);
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

  // Record the outcome (success or failure) as a ScrapeRun so the admin panel
  // can surface *why* a source went dark instead of needing shell access (#101).
  try {
    const result = await scrapeSource(slug, source.id, scraper);
    await recordScrapeRun(source.id, { ok: true, ...result });
    return result;
  } catch (err) {
    await recordScrapeRun(source.id, {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

async function scrapeSource(
  slug: string,
  sourceId: string,
  scraper: BaseScraper
): Promise<{ scraped: number; inserted: number }> {
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
    allDay: boolean;
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
      select: { id: true, title: true, sourceUrl: true, imageUrl: true, venueName: true, description: true, startDate: true, allDay: true },
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

    // Skip virtual/online-only events
    if (isVirtualEvent(event)) {
      console.log(`[${slug}] Virtual (skipped): "${event.title}"`);
      continue;
    }

    // Skip library programming aimed at babies/toddlers or seniors
    if (isBabyOrSeniorLibraryEvent(event)) {
      console.log(`[${slug}] Library baby/senior (skipped): "${event.title}"`);
      continue;
    }

    // Skip events the source has marked cancelled/postponed
    if (isCanceledEvent(event)) {
      console.log(`[${slug}] Canceled (skipped): "${event.title}"`);
      continue;
    }

    // Skip clearly out-of-area venues from the name-only music sources, which
    // arrive without a street address and so escape the coordinate distance filter
    if (OUT_OF_AREA_VENUE_FILTER_SOURCES.has(slug) && isOutOfAreaVenue(event.venueName)) {
      console.log(`[${slug}] Out-of-area venue (skipped): "${event.title}" @ ${event.venueName}`);
      continue;
    }

    // Skip if already exists, but enrich with better data if available
    const LOW_QUALITY_DOMAINS = ["foopee.com", "19hz.info"];

    // The existing-row fields enrichExisting reads. A full Event row, a DayEvent
    // cache entry, and the urlMatch select all satisfy this shape.
    type ExistingRow = {
      id: string;
      sourceUrl: string;
      imageUrl: string | null;
      description: string | null;
      title: string;
      venueName: string | null;
      startDate: Date;
      allDay: boolean;
    };

    async function enrichExisting(existing: ExistingRow) {
      const enrichments: Record<string, unknown> = {};
      if (!existing.imageUrl && event.imageUrl) {
        enrichments.imageUrl = event.imageUrl;
      }
      if (!existing.description && event.description) {
        enrichments.description = event.description;
      }
      // Refresh the external popularity signal (e.g. RA "interested" count).
      // Only sources that provide it set event.externalInterest, so this never
      // clobbers an existing signal with 0 from a source that doesn't track it.
      if (event.externalInterest != null && event.externalInterest > 0) {
        enrichments.externalInterest = event.externalInterest;
      }
      const existingIsLowQuality = LOW_QUALITY_DOMAINS.some((d) => existing.sourceUrl.includes(d));
      const incomingIsHighQuality = !LOW_QUALITY_DOMAINS.some((d) => event.sourceUrl.includes(d));
      if (existingIsLowQuality && incomingIsHighQuality) {
        enrichments.sourceUrl = event.sourceUrl;
        enrichments.sourceId = sourceId;
      }

      // Promote a date-only placeholder to a real start time. Date-only sources
      // (e.g. JamBase) store events at the noon-SF placeholder with allDay=true;
      // when a later source matches the same event with an actual showtime,
      // upgrade startDate and clear allDay so the real time wins. Only ever in
      // this direction — a placeholder incoming never overwrites a real time.
      //
      // The dedupe hash keys on SF *day*, not time (see computeDedupeHash), and
      // every matcher that reaches here constrains the existing row to the
      // incoming event's SF day, so the promotion stays within the same day and
      // leaves the hash unchanged — there's no recompute and no unique-constraint
      // collision to guard against.
      const promoteTime =
        isTimeUnknown(existing.startDate, existing.allDay) &&
        !isTimeUnknown(event.startDate, event.allDay ?? false);
      if (promoteTime) {
        enrichments.startDate = event.startDate;
        enrichments.allDay = false;
      }

      if (Object.keys(enrichments).length === 0) return;
      await prisma.event.update({ where: { id: existing.id }, data: enrichments });

      if (promoteTime) {
        // Keep the in-run day cache consistent so later events in this batch
        // compare against the promoted time, not the stale placeholder.
        const cached = dayEventsCache.get(sfDayKey(existing.startDate))?.find((e) => e.id === existing.id);
        if (cached) {
          cached.startDate = event.startDate;
          cached.allDay = false;
        }
      }
    }

    const exactMatch = await prisma.event.findUnique({ where: { dedupeHash } });
    if (exactMatch) {
      await enrichExisting(exactMatch);
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
        select: { id: true, sourceUrl: true, imageUrl: true, description: true, title: true, venueName: true, startDate: true, allDay: true },
      });
      if (urlMatch) {
        console.log(`[${slug}] Source URL duplicate: "${event.title}" (${event.sourceUrl})`);
        await enrichExisting(urlMatch);
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
          await enrichExisting(fuzzyMatch);
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
        // When a source has no real start time it gets a placeholder (noon SF),
        // which is 9+ hours off any real time and would block this match. If
        // either side's time is unknown, drop the time window and lean on the
        // venue + title containment guards alone.
        const incomingTimeUnknown = isTimeUnknown(event.startDate, event.allDay ?? false);
        const sameTimeVenueMatch = dayEvents.find((e) => {
          if (!e.venueName || isGenericVenue(e.venueName)) return false;
          const timeUnknown = incomingTimeUnknown || isTimeUnknown(e.startDate, e.allDay);
          if (!timeUnknown && Math.abs(e.startDate.getTime() - incomingTime) > TIME_WINDOW_MS) return false;
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
          await enrichExisting(sameTimeVenueMatch);
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
            await enrichExisting(venuePartialMatch);
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
            await enrichExisting(venueMatch);
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
    const geo = await geocodeEvent(event, slug);

    // Skip events outside the SF service area (too far to be worth listing).
    // Only filters when coordinates confidently place the event out of range —
    // missing/placeholder coords are kept (see isTooFarFromSf). Dropping at
    // ingest retires the scripts/cleanup-far-events archive sweep for new events.
    if (isTooFarFromSf(geo.latitude, geo.longitude)) {
      console.log(`[${slug}] Out of area (skipped): "${event.title}"`);
      continue;
    }

    // Scraped events always publish — we don't human-gate ingest. geocodeEvent
    // already tries scraper-provided coords, the static known-venue table
    // (lib/venues.ts), and Nominatim; if all three fail the event still goes
    // live (it just won't appear on the map or match a neighborhood filter
    // until coords are filled in). It's flagged via geocoded=false; the admin
    // "Ungeocoded" tab surfaces these so reliable venue mappings can be added to
    // lib/venues.ts, then `npm run backfill-geocode` fills the existing rows in.
    const geocodeFailed = geo.latitude == null || geo.longitude == null;
    if (geocodeFailed) {
      console.log(`[${slug}] Ungeocoded — publishing, flagged for backfill: "${event.title}"`);
    }

    // Non-venue placeholders (19hz "TBA (San Francisco)", funcheap bare-city
    // strings) have no real location. Hold them PENDING rather than publish them
    // locationless — they surface in the admin submissions tab, not on the site.
    const isPlaceholder = isPlaceholderVenue(event.venueName);
    if (isPlaceholder) {
      console.log(`[${slug}] Placeholder venue — holding PENDING: "${event.title}" (${event.venueName})`);
    }

    // Link to the normalized Venue table when the venue is known. Same matching
    // as geocodeEvent (pass slug so SFPL branch labels resolve for sfpl only).
    const venueId = await resolveVenueId(event.venueName, slug);

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
          allDay: event.allDay ?? false,
          venueName: event.venueName,
          venueAddress: event.venueAddress,
          venueId,
          neighborhood: geo.neighborhood,
          latitude: geo.latitude,
          longitude: geo.longitude,
          category,
          price: event.price,
          isFree: event.isFree ?? scraper.parseFree(event.price),
          imageUrl: event.imageUrl,
          sourceUrl: event.sourceUrl,
          tags: event.tags ?? [],
          performers: event.performers ?? [],
          externalInterest: event.externalInterest ?? 0,
          geocoded: geo.latitude != null,
          status: isPlaceholder ? "PENDING" : "PUBLISHED",
          categorized: true,
          sourceId,
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
          allDay: event.allDay ?? false,
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
