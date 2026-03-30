import axios from "axios";
import * as cheerio from "cheerio";
import { BaseScraper } from "./base";
import type { ScrapedEvent } from "./base";
import { sfDateFromLocal } from "@/lib/sfDate";

/**
 * Noe Valley Town Square — noevalleytownsquare.com/events
 *
 * GoDaddy Website Builder site. Events are rendered as gallery cards using
 * data-ux="GridCell" containers. Each card's text block (data-ux="Text"
 * with data-aid matching "GALLERY_CAPTION") contains:
 *   p[0]: date(s) — e.g. "Sundays, March 29 and April 12, 19 & 26"
 *   p[1]: time    — e.g. "11:00 AM - noon"
 *   p[2]: title   — e.g. "Free Sunday Morning Yoga"
 *   p[3]: description
 *
 * A single card may span multiple dates. We expand each date into its own event.
 * There are no individual event detail pages — all events share the listing URL.
 *
 * Strategy:
 *   1. Fetch the events page
 *   2. For each GridCell, extract the caption text block
 *   3. Parse all dates from the first paragraph
 *   4. Emit one ScrapedEvent per upcoming date
 */

const EVENTS_URL = "https://noevalleytownsquare.com/events";

const MONTH_MAP: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

/**
 * Extract all month+day pairs from a date string like:
 *   "Sundays, March 29 and April 12, 19 & 26"
 *   "Saturday, April 5"
 *   "April 12"
 *
 * Strategy: tokenize on whitespace/commas/ampersands, track current month,
 * pick up day numbers following month names or under the same month.
 */
function parseDates(text: string): Array<{ month: number; day: number }> {
  const results: Array<{ month: number; day: number }> = [];
  // Tokenize, stripping punctuation except digits/letters
  const tokens = text
    .split(/[\s,&]+/)
    .map((t) => t.replace(/[^a-zA-Z0-9]/g, "").toLowerCase())
    .filter(Boolean);

  let currentMonth = 0;
  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];
    const monthNum = MONTH_MAP[token];
    if (monthNum) {
      currentMonth = monthNum;
      // Next token should be the day
      const nextToken = tokens[i + 1];
      if (nextToken) {
        const day = parseInt(nextToken, 10);
        if (!isNaN(day) && day >= 1 && day <= 31 && String(day) === nextToken) {
          results.push({ month: currentMonth, day });
          i += 2;
          continue;
        }
      }
    } else if (currentMonth > 0) {
      // Bare number under the current month (e.g. "19" and "26" in "April 12, 19 & 26")
      const day = parseInt(token, 10);
      if (!isNaN(day) && day >= 1 && day <= 31 && String(day) === token) {
        results.push({ month: currentMonth, day });
      }
    }
    i++;
  }
  return results;
}

// "11:00 AM - noon" or "2:00 PM" → { hour, minute }
function parseStartTime(text: string): { hour: number; minute: number } | null {
  const m = text.match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)/i);
  if (!m) return null;
  let hour = parseInt(m[1]);
  const minute = m[2] ? parseInt(m[2]) : 0;
  const ampm = m[3].toUpperCase();
  if (ampm === "PM" && hour < 12) hour += 12;
  if (ampm === "AM" && hour === 12) hour = 0;
  return { hour, minute };
}

export class NoeValleyTownSquareScraper extends BaseScraper {
  readonly sourceSlug = "noe-valley-town-square";

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
      console.error(`[noe-valley-town-square] failed to fetch events page:`, err.message);
      return [];
    }

    const $ = cheerio.load(html);
    const events: ScrapedEvent[] = [];
    const nowMs = Date.now();

    $('[data-ux="GridCell"]').each((_, el) => {
      const $el = $(el);

      // Caption text block
      const $caption = $el.find('[data-ux="Text"][data-aid*="GALLERY_CAPTION"]').first();
      if (!$caption.length) return;

      const paragraphs = $caption.find("p");
      if (paragraphs.length < 3) return;

      const dateText = $(paragraphs[0]).text().trim();
      const timeText = $(paragraphs[1]).text().trim();
      const title = $(paragraphs[2]).text().trim();
      const descText = paragraphs.length > 3 ? $(paragraphs[3]).text().trim() : undefined;

      if (!title || !dateText) return;

      const timeParsed = parseStartTime(timeText);
      const hour = timeParsed?.hour ?? 12;
      const minute = timeParsed?.minute ?? 0;

      const datePairs = parseDates(dateText);
      if (datePairs.length === 0) {
        console.warn(`[noe-valley-town-square] could not parse date from: "${dateText}"`);
        return;
      }

      // Image
      const imgSrc = $el.find('img[data-ux="Image"]').first().attr("src");

      for (const { month, day } of datePairs) {
        const year = this.resolveYear(month, day);
        const startDate = sfDateFromLocal(year, month, day, hour, minute);
        if (startDate.getTime() < nowMs - 86_400_000) continue;

        events.push({
          title,
          startDate,
          sourceUrl: EVENTS_URL,
          imageUrl: imgSrc,
          description: descText || undefined,
          venueName: "Noe Valley Town Square",
          venueAddress: "3861 24th St, San Francisco, CA 94114",
          tags: ["outdoor", "community", "noe-valley"],
        });
      }
    });

    console.log(`[noe-valley-town-square] scraped ${events.length} upcoming events`);
    return events;
  }
}
