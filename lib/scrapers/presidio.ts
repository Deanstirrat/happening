import axios from "axios";
import * as cheerio from "cheerio";
import { BaseScraper } from "./base";
import type { ScrapedEvent } from "./base";
import { sfDateFromLocal } from "@/lib/sfDate";

const SHOWS_URL = "https://www.presidiotheatre.org/shows";
const BASE_URL = "https://www.presidiotheatre.org";

const VENUE_NAME = "Presidio Theatre";
const VENUE_ADDRESS = "99 Moraga Ave, San Francisco, CA 94129";
// Single fixed venue. Supply coordinates directly so every performance is
// placed at ingest rather than held ungeocoded (status PENDING) and never
// published — Nominatim resolves this address, but hard-coding matches the
// fixed-venue pattern and keeps the venue in the Presidio (not a mismatch).
const VENUE_LAT = 37.798894;
const VENUE_LNG = -122.460537;

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const DETAIL_CONCURRENCY = 6;

// A single performance from the show's JSON-LD `offers` array.
interface LdOffer {
  availabilityStarts?: string;
  price?: string;
}

// The subset of schema.org TheaterEvent we consume from each detail page.
interface LdEvent {
  "@type"?: string | string[];
  name?: string;
  url?: string;
  image?: string;
  offers?: LdOffer | LdOffer[];
}

/** Parse a JSON-LD datetime like "2026-07-09 19:30:00" into SF-local parts. */
function parseLdDateTime(
  value: string
): { year: number; month: number; day: number; hours: number; minutes: number } | null {
  const m = value.match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return null;
  return {
    year: parseInt(m[1], 10),
    month: parseInt(m[2], 10),
    day: parseInt(m[3], 10),
    hours: parseInt(m[4], 10),
    minutes: parseInt(m[5], 10),
  };
}

async function fetchPage(url: string): Promise<string | null> {
  try {
    const { data } = await axios.get<string>(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
      },
      timeout: 20_000,
    });
    return data;
  } catch (err: any) {
    console.error(`[presidio] failed to fetch ${url}:`, err.message);
    return null;
  }
}

/**
 * Presidio Theatre — presidiotheatre.org/shows
 *
 * Restored WPA-era theater in the Presidio hosting theater, dance, film, music,
 * comedy and speaker events. The /shows page server-renders a card per show
 * linking to /show-details/<slug>; the listing itself carries no dates, so each
 * detail page is fetched for its `application/ld+json` TheaterEvent block. That
 * block holds the canonical URL, header image and an `offers` array — one offer
 * per performance (datetime + price). Each performance day becomes an event
 * (same-day showtimes collapse in the runner's day-scoped dedup).
 */
export class PresidioTheatreScraper extends BaseScraper {
  readonly sourceSlug = "presidio";

  async scrape(): Promise<ScrapedEvent[]> {
    const listingHtml = await fetchPage(SHOWS_URL);
    if (!listingHtml) return [];

    // Collect unique show-detail URLs from the listing cards.
    const $ = cheerio.load(listingHtml);
    const detailUrls = new Set<string>();
    $('a[href*="/show-details/"]').each((_i, el) => {
      const href = $(el).attr("href");
      if (!href) return;
      const url = href.startsWith("http") ? href : `${BASE_URL}${href}`;
      detailUrls.add(url.split("?")[0]);
    });

    const events: ScrapedEvent[] = [];
    const nowMs = Date.now();
    const urls = [...detailUrls];

    for (let i = 0; i < urls.length; i += DETAIL_CONCURRENCY) {
      const batch = urls.slice(i, i + DETAIL_CONCURRENCY);
      const results = await Promise.all(
        batch.map((url) => this.scrapeShow(url, nowMs))
      );
      for (const showEvents of results) events.push(...showEvents);
    }

    console.log(`[presidio] scraped ${events.length} upcoming performances`);
    return events;
  }

  /** Fetch one detail page and expand its JSON-LD offers into events. */
  private async scrapeShow(url: string, nowMs: number): Promise<ScrapedEvent[]> {
    const html = await fetchPage(url);
    if (!html) return [];

    const $ = cheerio.load(html);
    const raw = $('script[type="application/ld+json"]').first().text().trim();
    if (!raw) return [];

    let ld: LdEvent;
    try {
      ld = JSON.parse(raw);
    } catch {
      console.error(`[presidio] bad JSON-LD on ${url}`);
      return [];
    }

    const title = ld.name?.trim();
    if (!title) return [];

    const sourceUrl = ld.url?.trim() || url;
    const imageUrl = ld.image?.trim() || undefined;

    // og:description is a clean, entity-decoded blurb; drop the occasional
    // "Preview - <Month> <day>" performance-label prefix the site prepends.
    const description =
      $('meta[property="og:description"]')
        .attr("content")
        ?.replace(/^Preview\s*[-–]\s*[A-Z][a-z]+\s+\d{1,2}\s*/, "")
        .trim() || undefined;

    const offers = Array.isArray(ld.offers)
      ? ld.offers
      : ld.offers
        ? [ld.offers]
        : [];

    const events: ScrapedEvent[] = [];
    const seenDays = new Set<string>();

    for (const offer of offers) {
      if (!offer.availabilityStarts) continue;
      const parts = parseLdDateTime(offer.availabilityStarts);
      if (!parts) continue;

      // One event per performance day; same-day showtimes would collapse in the
      // runner's day-scoped dedup anyway, so keep the first offer of each day.
      const dayKey = `${parts.year}-${parts.month}-${parts.day}`;
      if (seenDays.has(dayKey)) continue;
      seenDays.add(dayKey);

      const startDate = sfDateFromLocal(
        parts.year,
        parts.month,
        parts.day,
        parts.hours,
        parts.minutes
      );
      if (isNaN(startDate.getTime())) continue;
      if (startDate.getTime() < nowMs - 86_400_000) continue;

      const price = offer.price?.trim() || undefined;

      events.push({
        title,
        description,
        startDate,
        venueName: VENUE_NAME,
        venueAddress: VENUE_ADDRESS,
        latitude: VENUE_LAT,
        longitude: VENUE_LNG,
        sourceUrl,
        imageUrl,
        price,
        isFree: this.parseFree(price),
        tags: ["theater", "arts", "presidio"],
      });
    }

    return events;
  }
}
