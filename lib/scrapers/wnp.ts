import * as cheerio from "cheerio";
import { BaseScraper } from "./base";
import type { ScrapedEvent } from "./base";
import { sfDateFromLocal } from "@/lib/sfDate";
import { fetchRenderedHtml } from "./browserFetch";

const EVENTS_URL = "https://wnpsf.org/";

const MONTH_MAP: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

/** Parse "Saturday, June 13 at 02:30 pm" (no year) into date components. */
function parseCardDate(text: string): { month: number; day: number; hours: number; minutes: number } | null {
  const m = text.match(
    /([A-Za-z]+)\s+(\d{1,2})(?:\s+at\s+(\d{1,2}):(\d{2})\s*(am|pm))?/i
  );
  if (!m) return null;
  const month = MONTH_MAP[m[1].toLowerCase()];
  if (!month) return null;
  const day = parseInt(m[2], 10);
  let hours = 12;
  let minutes = 0;
  if (m[3] && m[5]) {
    hours = parseInt(m[3], 10);
    minutes = parseInt(m[4] ?? "0", 10);
    const period = m[5].toLowerCase();
    if (period === "pm" && hours !== 12) hours += 12;
    if (period === "am" && hours === 12) hours = 0;
  }
  return { month, day, hours, minutes };
}

/**
 * Western Neighborhoods Project — wnpsf.org
 *
 * Nonprofit history society for SF's west side. Its homepage renders an
 * `#our-events` section of `li[data-item="card-event"]` cards, each with a
 * `<header>` (h2 title, h4 "Weekday, Month DD at HH:MM am/pm"), an `<article>`
 * (blurb paragraph + a venue/address paragraph) and a `<footer>` link to the
 * ticket page (Eventbrite, or a partner cinema's site). Venues vary — history
 * walks, film screenings — so coordinates are left to the ingest geocoder.
 *
 * The host sits behind a bot filter that resets the connection on plain HTTP
 * clients (axios gets an HTTP/2 stream reset / empty reply even with a browser
 * UA), so we render the page in a headless browser and parse the resulting HTML.
 */
export class WnpScraper extends BaseScraper {
  readonly sourceSlug = "wnp";

  async scrape(): Promise<ScrapedEvent[]> {
    const html = await fetchRenderedHtml(EVENTS_URL, {
      waitSelector: '#our-events li[data-item="card-event"]',
    });
    if (!html) {
      console.error("[wnp] fetch failed");
      return [];
    }

    const $ = cheerio.load(html);
    const events: ScrapedEvent[] = [];

    $('#our-events li[data-item="card-event"]').each((_i, el) => {
      const $card = $(el);

      const title = $card.find("header h2").first().text().trim();
      if (!title) return;

      const parsed = parseCardDate($card.find("header h4").first().text());
      if (!parsed) return;
      const startDate = sfDateFromLocal(
        this.resolveYear(parsed.month, parsed.day),
        parsed.month,
        parsed.day,
        parsed.hours,
        parsed.minutes
      );
      if (isNaN(startDate.getTime())) return;

      const $paras = $card.find("article p");
      const description = $paras.first().text().replace(/\s+/g, " ").trim() || undefined;

      // The trailing paragraph carries the venue name (first line) and street
      // address (remaining lines) separated by <br>.
      let venueName: string | undefined;
      let venueAddress: string | undefined;
      const venueHtml = $paras.length > 1 ? ($paras.last().html() ?? "") : "";
      if (venueHtml) {
        const lines = venueHtml
          .split(/<br\s*\/?>/i)
          .map((s) => cheerio.load(s).root().text().replace(/\s+/g, " ").trim())
          .filter(Boolean);
        venueName = lines[0] || undefined;
        const addr = lines.slice(1).join(", ").replace(/,\s*,/g, ",").trim();
        if (addr && !/to be announced/i.test(addr)) venueAddress = addr;
        else if (venueName) venueAddress = `${venueName}, San Francisco, CA`;
      }

      const href = $card.find("footer a[href]").first().attr("href");
      const sourceUrl = href || EVENTS_URL;

      const imageUrl = $card.find("figure img").first().attr("src") || undefined;

      events.push({
        title,
        description,
        startDate,
        venueName,
        venueAddress,
        sourceUrl,
        imageUrl,
        tags: ["history", "western-neighborhoods"],
      });
    });

    console.log(`[wnp] scraped ${events.length} upcoming events`);
    return events;
  }
}
