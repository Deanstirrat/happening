import axios from "axios";
import * as cheerio from "cheerio";
import { BaseScraper } from "./base";
import type { ScrapedEvent } from "./base";
import { sfDateFromLocal } from "@/lib/sfDate";

const MONTHS: Record<string, number> = {
  January: 1, February: 2, March: 3, April: 4, May: 5, June: 6,
  July: 7, August: 8, September: 9, October: 10, November: 11, December: 12,
};

function parseDateText(text: string): Date | undefined {
  const m = text.match(/(\w+)\s+(\d+),\s+(\d{4})\s+(\d+):(\d+)\s+(AM|PM)/i);
  if (!m) return undefined;
  const month = MONTHS[m[1]];
  if (!month) return undefined;
  const day = parseInt(m[2]);
  const year = parseInt(m[3]);
  let hour = parseInt(m[4]);
  const minute = parseInt(m[5]);
  const ampm = m[6].toUpperCase();
  if (ampm === "PM" && hour !== 12) hour += 12;
  if (ampm === "AM" && hour === 12) hour = 0;
  return sfDateFromLocal(year, month, day, hour, minute);
}

export class ChurchOfClownScraper extends BaseScraper {
  readonly sourceSlug = "churchofclown";
  private readonly BASE_URL = "https://www.churchofclown.org/events";
  private readonly VENUE_NAME = "Church of Clown";
  private readonly VENUE_ADDRESS = "2400 Bayshore Blvd, San Francisco, CA 94134";

  async scrape(): Promise<ScrapedEvent[]> {
    const events: ScrapedEvent[] = [];
    const now = Date.now();

    let html: string;
    try {
      const { data } = await axios.get(this.BASE_URL, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml",
        },
        timeout: 20000,
      });
      html = data;
    } catch (err: any) {
      console.error(`[churchofclown] Fetch error:`, err.message);
      return events;
    }

    const $ = cheerio.load(html);

    // Squarespace event list items
    const cards = $(".eventlist-event, .eventlist-item");
    console.log(`[churchofclown] Found ${cards.length} event cards`);

    cards.each((_i, el) => {
      const $el = $(el);

      // Title and detail URL
      const titleEl = $el.find(".eventlist-title a, h1 a, h2 a").first();
      const title = titleEl.text().trim();
      const href = titleEl.attr("href");
      if (!title || !href) return;
      const sourceUrl = href.startsWith("http")
        ? href
        : `https://www.churchofclown.org${href}`;

      // Dates — Squarespace renders start/end as separate time elements
      const timeEls = $el.find(".event-time-12hr, time, .eventlist-meta-date");
      const startText = timeEls.first().text().trim();
      const endText = timeEls.length > 1 ? timeEls.eq(1).text().trim() : "";

      const startDate = parseDateText(startText);
      if (!startDate) {
        console.warn(`[churchofclown] Could not parse date: "${startText}" — ${title}`);
        return;
      }

      // Skip events more than a day in the past
      if (startDate.getTime() < now - 86400000) return;

      const endDate = endText ? parseDateText(endText) : undefined;

      // Image
      const imgEl = $el.find("img").first();
      const imageUrl =
        imgEl.attr("src") || imgEl.attr("data-src") || undefined;

      // Description
      const description = $el.find(".eventlist-description p").first().text().trim() || undefined;

      events.push({
        title,
        startDate,
        endDate,
        sourceUrl,
        imageUrl,
        description,
        venueName: this.VENUE_NAME,
        venueAddress: this.VENUE_ADDRESS,
        tags: ["performance", "comedy", "theater"],
      });
    });

    console.log(`[churchofclown] ${events.length} upcoming events`);
    return events;
  }
}
