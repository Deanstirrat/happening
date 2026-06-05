import axios from "axios";
import * as cheerio from "cheerio";
import { BaseScraper } from "./base";
import type { ScrapedEvent } from "./base";
import { sfDateFromLocal } from "@/lib/sfDate";

function parseTimeText(timeText: string): { hour: number; minute: number } | undefined {
  const m = timeText.trim().match(/(\d+):(\d+)\s*(AM|PM)/i);
  if (!m) return undefined;
  let hour = parseInt(m[1]);
  const minute = parseInt(m[2]);
  const ampm = m[3].toUpperCase();
  if (ampm === "PM" && hour !== 12) hour += 12;
  if (ampm === "AM" && hour === 12) hour = 0;
  return { hour, minute };
}

function parseDatetime(isoDate: string, timeText: string): Date | undefined {
  const [year, month, day] = isoDate.split("-").map(Number);
  if (!year || !month || !day) return undefined;
  const time = parseTimeText(timeText);
  if (!time) return undefined;
  return sfDateFromLocal(year, month, day, time.hour, time.minute);
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

      // Dates — Squarespace now renders date in `datetime` attr and time as text
      // Pattern A (show with two dates): .event-date[datetime] + .event-time-localized
      // Pattern B (class with start/end): .event-date[datetime] + .event-time-localized-start + .event-time-localized-end
      const startDateEl = $el.find("time.event-date[datetime]").first();
      const startIso = startDateEl.attr("datetime") ?? "";

      const startTimeText =
        $el.find("time.event-time-localized-start").first().text().trim() ||
        $el.find("time.event-time-localized").first().text().trim();

      const startDate = startIso && startTimeText ? parseDatetime(startIso, startTimeText) : undefined;
      if (!startDate) {
        console.warn(`[churchofclown] Could not parse date for "${title}" — iso="${startIso}" time="${startTimeText}"`);
        return;
      }

      // Skip events more than a day in the past
      if (startDate.getTime() < now - 86400000) return;

      // End date: explicit end-time element, or second .event-date for multi-day
      let endDate: Date | undefined;
      const endTimeText = $el.find("time.event-time-localized-end").first().text().trim();
      if (endTimeText) {
        endDate = parseDatetime(startIso, endTimeText);
      } else {
        const dateEls = $el.find("time.event-date[datetime]");
        if (dateEls.length >= 2) {
          const endIso = dateEls.eq(1).attr("datetime") ?? "";
          const endTText = $el.find("time.event-time-localized").eq(1).text().trim();
          if (endIso && endTText) endDate = parseDatetime(endIso, endTText);
        }
      }

      // Image
      const imgEl = $el.find("img").first();
      const imageUrl =
        imgEl.attr("src") || imgEl.attr("data-src") || undefined;

      // Description
      const description = $el.find(".eventlist-excerpt p, .eventlist-description p").first().text().trim() || undefined;

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
