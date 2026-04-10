import axios from "axios";
import * as cheerio from "cheerio";
import { BaseScraper } from "./base";
import type { ScrapedEvent } from "./base";
import { sfDateFromLocal } from "@/lib/sfDate";

/**
 * Assemble Puzzlery — assemblepuzzlery.com/pages/events
 *
 * Shopify Dawn theme. Events are listed as h2 titles with a div sibling
 * containing the date and time concatenated in a single text node, e.g.:
 *   "Wednesday April 156-9pm"  →  date: April 15, time: 6pm
 *
 * Standard day-boundary regex fails because the day number (15) is immediately
 * followed by the time hour (6) with no separator. We extract the day using
 * the valid day-range pattern (1-31), then parse the time from the remainder.
 */

const EVENTS_URL = "https://assemblepuzzlery.com/pages/events";

const MONTH_MAP: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

/**
 * Parse date + time from a concatenated string like "Wednesday April 156-9pm".
 *
 * Day extraction uses the range 1-31:
 *   30-31  →  3[01]
 *   10-29  →  [12]\d
 *   1-9    →  \d  (single digit, lowest priority to avoid ambiguity)
 *
 * After matching the day, the remainder is parsed for the start time.
 */
function parseDateAndTime(
  text: string,
  resolveYear: (m: number, d: number) => number
): { startDate: Date } | null {
  const m = text.match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(3[01]|[12]\d|\d)/i
  );
  if (!m) return null;

  const month = MONTH_MAP[m[1].toLowerCase()];
  if (!month) return null;
  const day = parseInt(m[2]);

  // Text after the matched day contains the time (e.g. "6-9pm")
  const afterDay = text.slice((m.index ?? 0) + m[0].length);
  const timePart = afterDay.match(/^(\d{1,2})(?::(\d{2}))?(?:-[\d:]+)?\s*(am|pm)/i);

  let hour = 18; // default 6pm
  let minute = 0;
  if (timePart) {
    hour = parseInt(timePart[1]);
    minute = timePart[2] ? parseInt(timePart[2]) : 0;
    const ampm = timePart[3].toLowerCase();
    if (ampm === "pm" && hour < 12) hour += 12;
    if (ampm === "am" && hour === 12) hour = 0;
  }

  const year = resolveYear(month, day);
  return { startDate: sfDateFromLocal(year, month, day, hour, minute) };
}

// "Puzzle Night @Gilman Brewing" → "Gilman Brewing"
function extractVenue(title: string): string | undefined {
  const m = title.match(/@(.+)$/);
  return m ? m[1].trim() : undefined;
}

export class AssemblePuzzleryScraper extends BaseScraper {
  readonly sourceSlug = "assemblepuzzlery";

  async scrape(): Promise<ScrapedEvent[]> {
    let html: string;
    try {
      const { data } = await axios.get<string>(EVENTS_URL, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml",
        },
        timeout: 15_000,
      });
      html = data;
    } catch (err: any) {
      console.error(`[assemblepuzzlery] failed to fetch events page:`, err.message);
      return [];
    }

    const $ = cheerio.load(html);
    const events: ScrapedEvent[] = [];
    const nowMs = Date.now();

    $("h2").each((_, el) => {
      const $h2 = $(el);
      const title = $h2.text().trim();
      if (!title) return;

      // Skip month headings like "April 2026"
      if (/^\w+ \d{4}$/.test(title)) return;

      // The date+time live in the next div sibling as a single concatenated text node
      const dateTimeText = $h2.next("div, p").text().trim();
      if (!dateTimeText) return;

      const parsed = parseDateAndTime(dateTimeText, this.resolveYear.bind(this));
      if (!parsed) {
        console.warn(`[assemblepuzzlery] could not parse date from: "${dateTimeText}" for "${title}"`);
        return;
      }

      if (parsed.startDate.getTime() < nowMs - 86_400_000) return;

      events.push({
        title,
        startDate: parsed.startDate,
        sourceUrl: EVENTS_URL,
        venueName: extractVenue(title) ?? "Assemble Puzzlery",
        tags: ["puzzles", "games", "community"],
      });
    });

    console.log(`[assemblepuzzlery] scraped ${events.length} upcoming events`);
    return events;
  }
}
