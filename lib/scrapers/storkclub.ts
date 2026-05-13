import axios from "axios";
import * as cheerio from "cheerio";
import { BaseScraper } from "./base";
import type { ScrapedEvent } from "./base";
import { sfDateFromLocal } from "@/lib/sfDate";

/**
 * Thee Stork Club — theestorkclub.com/calendar/
 *
 * Static HTML calendar. Each event card has:
 *   .event-date  — "Friday May 10" (no year)
 *   .event-time  — "Show at 8:00PM"
 *   .event-info  — "21+, $20 | Punk Rock"
 *   h3 a         — title + ticket link
 *   img          — event poster (SeeTickets CDN)
 */

const CALENDAR_URL = "https://theestorkclub.com/calendar/";

const MONTH_MAP: Record<string, number> = {
  January: 1, February: 2, March: 3, April: 4, May: 5, June: 6,
  July: 7, August: 8, September: 9, October: 10, November: 11, December: 12,
};

function parseStorkDate(
  dateStr: string,
  timeStr: string,
  resolveYear: (m: number, d: number) => number
): Date | null {
  // dateStr: "Friday May 10" or "Saturday June 7"
  const dateMatch = dateStr.match(/([A-Z][a-z]+)\s+(\d{1,2})$/);
  if (!dateMatch) return null;
  const month = MONTH_MAP[dateMatch[1]];
  const day = parseInt(dateMatch[2]);
  if (!month || !day) return null;

  // timeStr: "Show at 8:00PM" or "Show at 7:30PM Doors at 6:30PM"
  const timeMatch = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  let hour = 20;
  let minute = 0;
  if (timeMatch) {
    hour = parseInt(timeMatch[1]);
    minute = parseInt(timeMatch[2]);
    if (timeMatch[3].toUpperCase() === "PM" && hour !== 12) hour += 12;
    if (timeMatch[3].toUpperCase() === "AM" && hour === 12) hour = 0;
  }

  const year = resolveYear(month, day);
  return sfDateFromLocal(year, month, day, hour, minute);
}

export class StorkClubScraper extends BaseScraper {
  readonly sourceSlug = "storkclub";

  async scrape(): Promise<ScrapedEvent[]> {
    let html: string;
    try {
      const { data } = await axios.get<string>(CALENDAR_URL, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml",
        },
        timeout: 15_000,
      });
      html = data;
    } catch (err: any) {
      console.error("[storkclub] failed to fetch calendar:", err.message);
      return [];
    }

    const $ = cheerio.load(html);
    const events: ScrapedEvent[] = [];
    const nowMs = Date.now();

    $(".event-item").each((_i, el) => {
      const $el = $(el);

      const titleAnchor = $el.find("h3 a").first();
      const title = titleAnchor.text().trim();
      if (!title) return;

      const sourceUrl = titleAnchor.attr("href") ?? CALENDAR_URL;

      const dateStr = $el.find(".event-date").first().text().trim();
      const timeStr = $el.find(".event-time").first().text().trim();
      const startDate = parseStorkDate(dateStr, timeStr, this.resolveYear.bind(this));
      if (!startDate || startDate.getTime() < nowMs - 86_400_000) return;

      const infoText = $el.find(".event-info").first().text().trim();
      // e.g. "21+, $20 | Punk Rock" or "All ages, Free | Rock"
      const priceMatch = infoText.match(/\$(\d+(?:\.\d{2})?(?:\s*[-–]\s*\$?\d+(?:\.\d{2})?)?)/);
      const price = priceMatch ? `$${priceMatch[1]}` : undefined;
      const isFree = !priceMatch && /free/i.test(infoText) ? true : undefined;

      const imageUrl = $el.find("img").first().attr("src") || undefined;

      events.push({
        title,
        startDate,
        sourceUrl,
        imageUrl: imageUrl || undefined,
        price,
        isFree,
        venueName: "Thee Stork Club",
        venueAddress: "2330 Telegraph Ave, Oakland, CA 94612",
        tags: ["music", "live", "stork-club"],
      });
    });

    console.log(`[storkclub] scraped ${events.length} upcoming events`);
    return events;
  }
}
