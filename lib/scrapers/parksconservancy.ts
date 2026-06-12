import axios from "axios";
import * as cheerio from "cheerio";
import { BaseScraper } from "./base";
import type { ScrapedEvent } from "./base";
import { sfDateFromLocal } from "@/lib/sfDate";

const EVENTS_URL = "https://www.parksconservancy.org/events";
const BASE_URL = "https://www.parksconservancy.org";

// The Drupal event view is paginated one day per page, oldest-first: the
// unparametered page (and ?page=0) shows only *today's* events — most already
// past by the time the nightly scrape runs — while ?page=1, 2, … walk forward
// into upcoming days. We follow the pager to collect upcoming events instead of
// just today's. Bounded so a misbehaving pager can't loop forever.
const MAX_PAGES = 20;

const MONTHS: Record<string, number> = {
  Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6,
  Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12,
};

/**
 * Parse the conservancy date line, e.g.:
 *   "Wed, Jun 10, 2026, 8:00am - 12:00pm"
 *   "Sat, Jun 13, 2026, All Day"
 */
function parseConservancyDate(
  text: string
): { startDate: Date; allDay: boolean } | null {
  const dm = text.match(/([A-Za-z]{3})\s+(\d{1,2}),\s+(\d{4})/);
  if (!dm) return null;
  const month = MONTHS[dm[1]];
  if (!month) return null;
  const day = parseInt(dm[2], 10);
  const year = parseInt(dm[3], 10);

  const tm = text.match(/(\d{1,2}):(\d{2})\s*(am|pm)/i);
  if (!tm) {
    // No start time (e.g. "All Day") — anchor at SF noon and flag all-day.
    const startDate = sfDateFromLocal(year, month, day, 12, 0);
    return isNaN(startDate.getTime()) ? null : { startDate, allDay: true };
  }

  let hours = parseInt(tm[1], 10);
  const minutes = parseInt(tm[2], 10);
  if (tm[3].toLowerCase() === "pm" && hours !== 12) hours += 12;
  if (tm[3].toLowerCase() === "am" && hours === 12) hours = 0;

  const startDate = sfDateFromLocal(year, month, day, hours, minutes);
  return isNaN(startDate.getTime()) ? null : { startDate, allDay: false };
}

/**
 * Golden Gate National Parks Conservancy — parksconservancy.org
 *
 * Nonprofit partner of the Golden Gate National Recreation Area. Runs outdoor
 * programming across SF's national parklands — Alcatraz, Lands End, Crissy
 * Field, the Presidio, Muir Woods — including volunteer restoration days,
 * guided hikes, and nature walks. The events page is a server-rendered Drupal
 * view with one `.node-event` row per listing.
 */
export class ParksConservancyScraper extends BaseScraper {
  readonly sourceSlug = "parksconservancy";

  async scrape(): Promise<ScrapedEvent[]> {
    const events: ScrapedEvent[] = [];
    const seen = new Set<string>();
    // Drop events that already ended yesterday or earlier — page 0 is "today"
    // and often holds events whose time has passed by scrape time.
    const oneDayAgo = Date.now() - 86_400_000;

    for (let page = 0; page < MAX_PAGES; page++) {
      let html: string;
      try {
        const { data } = await axios.get<string>(`${EVENTS_URL}?page=${page}`, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          },
          timeout: 20_000,
        });
        html = data;
      } catch (err: any) {
        console.error(`[parksconservancy] fetch failed (page ${page}):`, err.message);
        break;
      }

      const $ = cheerio.load(html);
      const rows = $(".node-event");
      // No more listings — we've walked past the end of the calendar.
      if (rows.length === 0) break;

      rows.each((_i, el) => {
        const $el = $(el);

        const $titleLink = $el.find(".teaser-body a.h4").first();
        const title = $titleLink.text().trim();
        if (!title) return;

        const href = $titleLink.attr("href") ?? "";
        const sourceUrl = href
          ? href.startsWith("http")
            ? href
            : `${BASE_URL}${href}`
          : EVENTS_URL;

        const dateText = $el.find(".teaser-body .date").first().text().replace(/\s+/g, " ").trim();
        const parsed = parseConservancyDate(dateText);
        if (!parsed) return;

        // Skip events already in the past.
        if (parsed.startDate.getTime() < oneDayAgo) return;

        // The same event can repeat across pages — dedupe on url + day.
        const key = `${sourceUrl}|${parsed.startDate.toDateString()}`;
        if (seen.has(key)) return;
        seen.add(key);

        const description = $el.find(".teaser-body .body").first().text().trim() || undefined;

        // Park name (e.g. "Alcatraz", "Lands End") makes a better venue than the
        // generic site name.
        const parkName = $el.find(".teaser-body .parks li a").first().text().trim();

        const imgSrc = $el.find(".card_img img").first().attr("src");
        const imageUrl = imgSrc
          ? imgSrc.startsWith("http")
            ? imgSrc
            : `${BASE_URL}${imgSrc}`
          : undefined;

        events.push({
          title,
          description,
          startDate: parsed.startDate,
          allDay: parsed.allDay,
          venueName: parkName || "Golden Gate National Parks",
          sourceUrl,
          imageUrl,
          isFree: false,
        });
      });
    }

    console.log(`[parksconservancy] scraped ${events.length} upcoming events`);
    return events;
  }
}
