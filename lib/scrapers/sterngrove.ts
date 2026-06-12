import axios from "axios";
import * as cheerio from "cheerio";
import { BaseScraper } from "./base";
import type { ScrapedEvent } from "./base";
import { sfDateFromLocal } from "@/lib/sfDate";

// The lineup page carries the festival year in its slug; bump this each season.
const LINEUP_URL = "https://www.sterngrove.org/lineup2026";

// Free concerts, always 2 PM at Sigmund Stern Grove. Nominatim can't resolve the
// grove by name, so supply coordinates directly (fixed-venue pattern).
const VENUE_NAME = "Sigmund Stern Grove";
const VENUE_ADDRESS = "19th Ave & Sloat Blvd, San Francisco, CA 94132";
const VENUE_LAT = 37.7347;
const VENUE_LNG = -122.4755;
const CONCERT_HOUR = 14; // 2 PM gates/showtime

const MONTH_MAP: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

/** Parse "Sunday, June 14" (weekday + month + day, no year). */
function parseLineupDate(text: string): { month: number; day: number } | null {
  const m = text.match(
    /(?:Sun|Mon|Tues?|Wed(?:nes)?|Thur?s?|Fri|Satur)[a-z]*,?\s+([A-Za-z]+)\s+(\d{1,2})/i
  );
  if (!m) return null;
  const month = MONTH_MAP[m[1].toLowerCase()];
  if (!month) return null;
  return { month, day: parseInt(m[2], 10) };
}

/**
 * Stern Grove Festival — sterngrove.org
 *
 * Free Sunday-afternoon summer concert series in the Sunset. The lineup page is
 * a hand-built Squarespace layout: each concert is a `.sqs-html-content` block
 * with an `<h3>` date ("Sunday, June 14"), an `<h2>` headliner and a `<p>`
 * support-act line. Concerts start at 2 PM; the page omits times and the year.
 */
export class SternGroveScraper extends BaseScraper {
  readonly sourceSlug = "sterngrove";

  async scrape(): Promise<ScrapedEvent[]> {
    let html: string;
    try {
      const { data } = await axios.get<string>(LINEUP_URL, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml",
        },
        timeout: 20_000,
      });
      html = data;
    } catch (err: any) {
      console.error("[sterngrove] fetch failed:", err.message);
      return [];
    }

    const $ = cheerio.load(html);
    const events: ScrapedEvent[] = [];
    const seen = new Set<string>();

    $(".sqs-html-content").each((_i, el) => {
      const $block = $(el);
      const $h3 = $block.find("h3").first();
      const $h2 = $block.find("h2").first();
      if ($h3.length === 0 || $h2.length === 0) return;

      const parsed = parseLineupDate($h3.text());
      const headliner = $h2.text().replace(/\s+/g, " ").trim();
      if (!parsed || !headliner) return;

      const startDate = sfDateFromLocal(
        this.resolveYear(parsed.month, parsed.day),
        parsed.month,
        parsed.day,
        CONCERT_HOUR,
        0
      );
      if (isNaN(startDate.getTime())) return;

      // One concert per date — dedupe repeated blocks (mobile/desktop variants).
      const key = `${startDate.getTime()}|${headliner.toLowerCase()}`;
      if (seen.has(key)) return;
      seen.add(key);

      const support = $block.find("p").first().text().replace(/\s+/g, " ").trim();

      events.push({
        title: headliner,
        description: support || undefined,
        startDate,
        venueName: VENUE_NAME,
        venueAddress: VENUE_ADDRESS,
        latitude: VENUE_LAT,
        longitude: VENUE_LNG,
        sourceUrl: LINEUP_URL,
        isFree: true,
        price: "Free",
        tags: ["music", "concert", "free", "stern-grove", "outdoor"],
      });
    });

    console.log(`[sterngrove] scraped ${events.length} upcoming concerts`);
    return events;
  }
}
