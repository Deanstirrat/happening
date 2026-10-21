import axios from "axios";
import * as cheerio from "cheerio";
import { BaseScraper } from "./base";
import type { ScrapedEvent } from "./base";
import { sfDateFromLocal } from "@/lib/sfDate";

const SHOWS_URL = "https://endgamesimprov.com/shows/";

// Endgames' home stage. Its current address is a real street ("2965 Mission
// St"), so Nominatim resolves it — but we supply coordinates directly anyway to
// match the fixed-venue pattern and keep showtimes off the PENDING queue.
const HOME_VENUE_NAME = "ETC Prime";
const HOME_VENUE_ADDRESS = "2965 Mission St, San Francisco, CA 94110";
const HOME_VENUE_LAT = 37.7494;
const HOME_VENUE_LNG = -122.4186;

const MONTH_MAP: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** Parse a "Friday, Jun 12" date header (no year) into month/day. */
function parseDateHead(text: string): { month: number; day: number } | null {
  const m = text.match(/([A-Za-z]{3})[a-z]*\s+(\d{1,2})/);
  if (!m) return null;
  const month = MONTH_MAP[m[1].toLowerCase().slice(0, 3)];
  if (!month) return null;
  return { month, day: parseInt(m[2], 10) };
}

/** Parse a "7pm" / "10:15pm" cell into 24h components. */
function parseShowtime(text: string): { hours: number; minutes: number } | null {
  const m = text.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
  if (!m) return null;
  let hours = parseInt(m[1], 10);
  const minutes = m[2] ? parseInt(m[2], 10) : 0;
  const period = m[3].toLowerCase();
  if (period === "pm" && hours !== 12) hours += 12;
  if (period === "am" && hours === 12) hours = 0;
  return { hours, minutes };
}

/**
 * Endgames Improv — endgamesimprov.com/shows/
 *
 * SF improv comedy theater. Its WordPress shows page server-renders one
 * `div.ssn-date-head` ("Friday, Jun 12") per date, each followed by one
 * `div.ssn-row` per show containing:
 *   - `div.ssn-time` ("8" + "PM" spans, or "7:30" + "PM")
 *   - `img.ssn-pic` (poster)
 *   - `div.ssn-desc` with the show title as either `a.ssn-title` (linking to the
 *     show's Eventbrite page) or a bare `span.ssn-title`, a
 *     `div.ssn-venue > b > i` "@ Venue - Address" line, the blurb, and an
 *     optional `a.ssn-title.ssn-ticket-link` "Ticket Link".
 * Each show becomes one event; the Eventbrite ticket URL is the sourceUrl for
 * dedup.
 *
 * (The page was previously a `<table>`-per-show layout with `td.show_time` /
 * `a.show_title`; it was redesigned to the flexbox `ssn-*` markup above.)
 */
export class EndgamesScraper extends BaseScraper {
  readonly sourceSlug = "endgames";

  async scrape(): Promise<ScrapedEvent[]> {
    let html: string;
    try {
      const { data } = await axios.get<string>(SHOWS_URL, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml",
        },
        timeout: 20_000,
      });
      html = data;
    } catch (err: any) {
      console.error("[endgames] fetch failed:", err.message);
      return [];
    }

    const $ = cheerio.load(html);
    const events: ScrapedEvent[] = [];

    // The date headers and the per-show rows are siblings rendered in document
    // order, so walk them together and carry the most recent date forward.
    let current: { year: number; month: number; day: number } | null = null;

    $("div.ssn-date-head, div.ssn-row").each((_i, el) => {
      const $el = $(el);

      if ($el.hasClass("ssn-date-head")) {
        const parsed = parseDateHead($el.text());
        current = parsed
          ? { year: this.resolveYear(parsed.month, parsed.day), ...parsed }
          : null;
        return;
      }

      if (!current) return;

      // "8" + "PM" → "8PM"; "7:30" + "PM" → "7:30PM".
      const parsedTime = parseShowtime($el.find(".ssn-time").first().text());
      if (!parsedTime) return;

      // Title is the first .ssn-title that isn't the "Ticket Link" anchor; it may
      // be an <a> (links to Eventbrite) or a bare <span> (e.g. free grad shows).
      const $title = $el
        .find(".ssn-desc .ssn-title")
        .filter((_j, t) => !$(t).hasClass("ssn-ticket-link"))
        .first();
      const title = $title.text().trim();
      if (!title) return;

      // Prefer the title's own link; fall back to the "Ticket Link" anchor.
      const href =
        $title.attr("href") ??
        $el.find(".ssn-desc a.ssn-ticket-link").first().attr("href");
      const sourceUrl = href
        ? href.startsWith("http")
          ? href
          : `https://endgamesimprov.com${href}`
        : SHOWS_URL;

      const startDate = sfDateFromLocal(
        current.year,
        current.month,
        current.day,
        parsedTime.hours,
        parsedTime.minutes
      );
      if (isNaN(startDate.getTime())) return;

      // "@ ETC Prime - 2965 Mission St" → name / address.
      const venueLine = $el
        .find(".ssn-venue i")
        .first()
        .text()
        .replace(/^\s*@\s*/, "")
        .trim();
      let venueName = HOME_VENUE_NAME;
      let venueAddress: string | undefined = HOME_VENUE_ADDRESS;
      let latitude: number | undefined = HOME_VENUE_LAT;
      let longitude: number | undefined = HOME_VENUE_LNG;
      if (venueLine && !/2965\s+mission/i.test(venueLine)) {
        // A pop-up at some other space — split "Name - Address" and let the
        // ingest geocoder resolve the street address.
        const dash = venueLine.indexOf(" - ");
        venueName = dash > 0 ? venueLine.slice(0, dash).trim() : venueLine;
        venueAddress =
          dash > 0 ? `${venueLine.slice(dash + 3).trim()}, San Francisco, CA` : undefined;
        latitude = undefined;
        longitude = undefined;
      }

      const imageUrl = $el.find("img.ssn-pic").first().attr("src") || undefined;

      // Strip the title/ticket anchors and the venue line to leave the blurb.
      const $desc = $el.find(".ssn-desc").first().clone();
      $desc.find("a, .ssn-title, .ssn-venue").remove();
      const description = $desc.text().replace(/\s+/g, " ").trim() || undefined;

      events.push({
        title,
        description,
        startDate,
        venueName,
        venueAddress,
        latitude,
        longitude,
        sourceUrl,
        imageUrl,
        category: "COMEDY",
        tags: ["comedy", "improv"],
        isFree: false,
      });
    });

    console.log(`[endgames] scraped ${events.length} upcoming shows`);
    return events;
  }
}
