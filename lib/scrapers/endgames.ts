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
 * `div.date_head` ("Friday, Jun 12") per date, each followed by a `<table>` per
 * show containing `td.show_time` ("7pm"), `td.show_pic img` (poster) and
 * `td.show_desc` (an `a.show_title` linking to the show's Eventbrite page, a
 * `<b><i>@ Venue - Address</i></b>` line, and the blurb). Each show becomes one
 * event; the Eventbrite ticket URL is the sourceUrl for dedup.
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

    // The date headers and the per-show tables are siblings rendered in document
    // order, so walk them together and carry the most recent date forward.
    let current: { year: number; month: number; day: number } | null = null;

    $("div.date_head, table").each((_i, el) => {
      const $el = $(el);

      if ($el.hasClass("date_head")) {
        const parsed = parseDateHead($el.text());
        current = parsed
          ? { year: this.resolveYear(parsed.month, parsed.day), ...parsed }
          : null;
        return;
      }

      // Only the show tables carry a show_time cell; skip layout tables.
      const $time = $el.find("td.show_time").first();
      if ($time.length === 0 || !current) return;

      const parsedTime = parseShowtime($time.text());
      if (!parsedTime) return;

      const $titleLink = $el.find("td.show_desc a.show_title").first();
      const title = $titleLink.text().trim();
      if (!title) return;

      const href = $titleLink.attr("href");
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
        .find("td.show_desc i")
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

      const $img = $el.find("td.show_pic img").first();
      const imageUrl = $img.attr("src") || undefined;

      // Strip the title link, the "Ticket Link" anchor and the venue line to
      // leave the blurb.
      const $desc = $el.find("td.show_desc").first().clone();
      $desc.find("a, b").remove();
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
