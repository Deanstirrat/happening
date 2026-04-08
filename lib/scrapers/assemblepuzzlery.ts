import axios from "axios";
import * as cheerio from "cheerio";
import { BaseScraper } from "./base";
import type { ScrapedEvent } from "./base";
import { sfDateFromLocal } from "@/lib/sfDate";

/**
 * Assemble Puzzlery — assemblepuzzlery.com/pages/events
 *
 * Shopify Dawn theme with an unstructured rich-text events page.
 * Events are listed under month headings (h1) with each event as:
 *   <h2>Event Title @Venue Name</h2>
 *   <p>Wednesday April 8</p>
 *   <p>6-9pm</p>
 *
 * Events are hosted at external venues (Gilman Brewing, Mad Oak, etc.).
 * We extract the venue name from the "@Venue" suffix in the title.
 *
 * All events share the same list URL (no individual event pages).
 */

const EVENTS_URL = "https://assemblepuzzlery.com/pages/events";

const MONTH_MAP: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

// "Wednesday April 8" or "April 8" → { month, day }
function parseDateText(text: string): { month: number; day: number } | null {
  const m = text.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})\b/i);
  if (!m) return null;
  const month = MONTH_MAP[m[1].toLowerCase()];
  if (!month) return null;
  return { month, day: parseInt(m[2]) };
}

// "6-9pm" or "7pm" or "6:30-9pm" → start hour and minute
function parseTimeText(text: string): { hour: number; minute: number } | null {
  // Match the first time (start time), possibly with a range like "6-9pm" or "6:30-9pm"
  const m = text.match(/(\d{1,2})(?::(\d{2}))?(?:-\d{1,2}(?::\d{2})?)?\s*(am|pm)/i);
  if (!m) return null;
  let hour = parseInt(m[1]);
  const minute = m[2] ? parseInt(m[2]) : 0;
  const ampm = m[3].toLowerCase();
  if (ampm === "pm" && hour < 12) hour += 12;
  if (ampm === "am" && hour === 12) hour = 0;
  return { hour, minute };
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

    // Each event is an h2 followed by p siblings for date and time
    $("h2").each((_, el) => {
      const $h2 = $(el);
      const title = $h2.text().trim();
      if (!title) return;

      // Skip month headings like "April 2026"
      if (/^\w+ \d{4}$/.test(title)) return;

      // Date and time are in a div sibling. Sometimes they're in separate divs,
      // sometimes in one div separated by <br>. Split on <br> first.
      const $next1 = $h2.next("div, p");
      const rawHtml = ($next1.html() ?? "");
      const brParts = rawHtml.split(/<br\s*\/?>/i);
      const dateText = brParts[0].replace(/<[^>]+>/g, "").trim();
      const timeText = brParts.length > 1
        ? brParts[1].replace(/<[^>]+>/g, "").trim()
        : $next1.next("div, p").text().trim();

      if (!dateText) return;

      const dateParsed = parseDateText(dateText);
      if (!dateParsed) {
        console.warn(`[assemblepuzzlery] could not parse date from: "${dateText}" for "${title}"`);
        return;
      }

      const timeParsed = parseTimeText(timeText);
      const hour = timeParsed?.hour ?? 18; // default 6pm
      const minute = timeParsed?.minute ?? 0;

      const year = this.resolveYear(dateParsed.month, dateParsed.day);
      const startDate = sfDateFromLocal(year, dateParsed.month, dateParsed.day, hour, minute);
      if (startDate.getTime() < nowMs - 86_400_000) return;

      const venueName = extractVenue(title) ?? "Assemble Puzzlery";

      events.push({
        title,
        startDate,
        sourceUrl: EVENTS_URL,
        venueName,
        tags: ["puzzles", "games", "community"],
      });
    });

    console.log(`[assemblepuzzlery] scraped ${events.length} upcoming events`);
    return events;
  }
}
