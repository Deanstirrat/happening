import axios from "axios";
import * as cheerio from "cheerio";
import { BaseScraper } from "./base";
import type { ScrapedEvent } from "./base";
import { sfDateFromLocal } from "@/lib/sfDate";

const EVENTS_URL = "https://www.ferrybuildingmarketplace.com/events/";
const VENUE_NAME = "Ferry Building Marketplace";
const VENUE_ADDRESS = "1 Ferry Building, San Francisco, CA 94111";
// Single fixed venue. The "Marketplace" venue name + the unusual "1 Ferry
// Building" address don't geocode reliably, so supply coordinates directly to
// keep events from being held ungeocoded (status PENDING).
const VENUE_LAT = 37.795549;
const VENUE_LNG = -122.393475;

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#8217;/g, "'")
    .replace(/&#8211;/g, "–")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Parse the EventON local-time string "2026-6-10T15:00+0:00". The trailing
 * offset is unreliable (the plugin emits +0:00 while the time is actually SF
 * local), so we read only the wall-clock components and treat them as SF time.
 */
function parseEventOnDate(value: string): Date | null {
  const m = value.match(/(\d{4})-(\d{1,2})-(\d{1,2})T(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const date = sfDateFromLocal(
    Number(m[1]),
    Number(m[2]),
    Number(m[3]),
    Number(m[4]),
    Number(m[5])
  );
  return isNaN(date.getTime()) ? null : date;
}

interface FerryLd {
  name?: string;
  url?: string;
  startDate?: string;
  endDate?: string;
  image?: string;
  description?: string;
}

/**
 * Ferry Building Marketplace — ferrybuildingmarketplace.com
 *
 * Iconic SF food hall on the Embarcadero (farmers market, food vendors,
 * tastings, classes, and community events). The events page is powered by the
 * EventON plugin, which embeds one JSON-LD `Event` block per listing with
 * name, url, start/end dates, image, and an HTML description.
 */
export class FerryBuildingScraper extends BaseScraper {
  readonly sourceSlug = "ferrybuilding";

  async scrape(): Promise<ScrapedEvent[]> {
    let html: string;
    try {
      const { data } = await axios.get<string>(EVENTS_URL, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        },
        timeout: 20_000,
      });
      html = data;
    } catch (err: any) {
      console.error("[ferrybuilding] fetch failed:", err.message);
      return [];
    }

    const $ = cheerio.load(html);
    const events: ScrapedEvent[] = [];
    const seen = new Set<string>();

    $('script[type="application/ld+json"]').each((_i, el) => {
      const raw = $(el).contents().text().trim();
      if (!raw.includes('"Event"')) return;

      let ld: FerryLd;
      try {
        ld = JSON.parse(raw);
      } catch {
        return;
      }

      const title = ld.name?.trim();
      if (!title || !ld.startDate || !ld.url) return;

      const startDate = parseEventOnDate(ld.startDate);
      if (!startDate) return;

      // EventON repeats each recurring instance with the same canonical URL plus
      // a per-instance ?…/var/ri-N suffix. Dedupe on url + day to avoid stacking
      // identical listings while still keeping distinct dates.
      const key = `${ld.url.split("/var/")[0]}|${startDate.toDateString()}`;
      if (seen.has(key)) return;
      seen.add(key);

      const endDate = ld.endDate ? parseEventOnDate(ld.endDate) ?? undefined : undefined;
      const description = ld.description ? stripHtml(ld.description) || undefined : undefined;

      events.push({
        title,
        description,
        startDate,
        endDate,
        venueName: VENUE_NAME,
        venueAddress: VENUE_ADDRESS,
        latitude: VENUE_LAT,
        longitude: VENUE_LNG,
        sourceUrl: ld.url,
        imageUrl: ld.image || undefined,
        isFree: false,
      });
    });

    console.log(`[ferrybuilding] scraped ${events.length} upcoming events`);
    return events;
  }
}
