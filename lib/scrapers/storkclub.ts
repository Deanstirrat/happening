import axios from "axios";
import * as cheerio from "cheerio";
import { BaseScraper } from "./base";
import type { ScrapedEvent } from "./base";
import { sfDateFromLocal } from "@/lib/sfDate";

/**
 * Thee Stork Club — theestorkclub.com/calendar/
 *
 * As of mid-2026 the calendar is a SeeTickets embedded widget.
 * Event cards use .seetickets-list-event-container; dates are "Mon Jun 1" (no year).
 */

const CALENDAR_URL = "https://theestorkclub.com/calendar/";

const MONTH_MAP: Record<string, number> = {
  Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6,
  Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12,
};

function parseStorkDate(
  dateStr: string,
  timeStr: string,
  resolveYear: (m: number, d: number) => number
): Date | null {
  // dateStr: "Mon Jun 1" or "Thu Jun 4"
  const dateMatch = dateStr.match(/([A-Z][a-z]{2})\s+(\d{1,2})$/);
  if (!dateMatch) return null;
  const month = MONTH_MAP[dateMatch[1]];
  const day = parseInt(dateMatch[2]);
  if (!month || !day) return null;

  // timeStr: "8:00PM" or "9:00PM"
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

    $(".seetickets-list-event-container").each((_i, el) => {
      const $el = $(el);

      const titleAnchor = $el.find(".event-info-block .title a").first();
      const title = titleAnchor.text().trim();
      if (!title) return;

      const sourceUrl = titleAnchor.attr("href") ?? CALENDAR_URL;

      // Date: "Mon Jun 1", time: "8:00PM" (in .see-showtime span)
      const dateStr = $el.find(".event-info-block .date").first().text().trim();
      const rawTime = $el.find(".see-showtime").first().text().trim();
      const startDate = parseStorkDate(dateStr, rawTime, this.resolveYear.bind(this));
      if (!startDate || startDate.getTime() < nowMs - 86_400_000) return;

      // Price: "$12.00-$15.00" or "$0.00"
      const rawPrice = $el.find(".price").first().text().trim();
      const price = rawPrice && rawPrice !== "$0.00" ? rawPrice : undefined;
      const isFree = rawPrice === "$0.00" ? true : undefined;

      const imageUrl = $el.find("img").first().attr("src") || undefined;

      events.push({
        title,
        startDate,
        sourceUrl,
        imageUrl,
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
