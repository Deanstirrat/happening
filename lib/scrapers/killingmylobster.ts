import axios from "axios";
import * as cheerio from "cheerio";
import { BaseScraper } from "./base";
import type { ScrapedEvent } from "./base";
import { sfDateFromLocal } from "@/lib/sfDate";

/**
 * Killing My Lobster — killingmylobster.com/shows-events
 *
 * KML is a long-running SF sketch-comedy company. Unlike Church of Clown (a fixed
 * venue), KML *tours* its own shows across rotating SF rooms — Z Below, Eclectic
 * Box, Elixir Saloon, etc. — plus runs classes and student showcases, so each
 * listing carries its own venue. None of these reliably surface through the
 * ticketed comedy feeds or SF Station, making KML's own page the only line in.
 *
 * It's a Squarespace Events page (same markup family as `churchofclown`): a single
 * server-rendered HTML response splits into `.eventlist--upcoming` and
 * `.eventlist--past`, so a CHEERIO pass suffices and no pagination is needed.
 * Per `.eventlist-event`:
 *   - .eventlist-title a                      — title + relative event URL
 *   - time.event-date[datetime="YYYY-MM-DD"]  — date (no time)
 *   - time.event-time-localized-start / -end  — "8:00 PM" text
 *   - .eventlist-meta-address                 — bare venue-name text node, then a
 *       "(map)" link whose ?q= holds the full street address
 *   - img[data-src]                           — listing thumbnail
 *
 * Addresses are complete SF street addresses, so the runner geocodes cleanly — we
 * don't invent coordinates here. We parse every card and drop anything in the past.
 */
export class KillingMyLobsterScraper extends BaseScraper {
  readonly sourceSlug = "killingmylobster";
  private readonly BASE_URL = "https://www.killingmylobster.com";
  private readonly EVENTS_URL = "https://www.killingmylobster.com/shows-events";

  async scrape(): Promise<ScrapedEvent[]> {
    const events: ScrapedEvent[] = [];
    const now = Date.now();

    let html: string;
    try {
      const { data } = await axios.get<string>(this.EVENTS_URL, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        responseType: "text",
        timeout: 20_000,
      });
      html = data;
    } catch (err: any) {
      console.error(`[killingmylobster] Fetch error:`, err.message);
      return events;
    }

    const $ = cheerio.load(html);
    const cards = $(".eventlist-event");
    console.log(`[killingmylobster] Found ${cards.length} event cards`);

    cards.each((_i, el) => {
      const $el = $(el);

      const titleEl = $el.find(".eventlist-title a").first();
      const title = titleEl.text().trim();
      const href = titleEl.attr("href");
      if (!title || !href) return;
      const sourceUrl = href.startsWith("http") ? href : `${this.BASE_URL}${href}`;
      // The trailing path segment is a stable per-event id.
      const externalId = href.split(/[?#]/)[0].split("/").filter(Boolean).pop();

      const startIso = $el.find("time.event-date[datetime]").first().attr("datetime") ?? "";
      const startTimeText = $el.find("time.event-time-localized-start").first().text().trim();
      // Showtimes are evening events; if a listing omits the time, default to 8 PM
      // rather than leaving a midnight placeholder.
      const startDate = this.buildDate(startIso, startTimeText, 20, 0);
      if (!startDate) {
        console.warn(`[killingmylobster] Could not parse date for "${title}" — iso="${startIso}" time="${startTimeText}"`);
        return;
      }

      // Skip events more than a day in the past (the page lists 30+ past shows).
      if (startDate.getTime() < now - 86_400_000) return;

      const endTimeText = $el.find("time.event-time-localized-end").first().text().trim();
      const endDate = (endTimeText ? this.buildDate(startIso, endTimeText) : undefined) ?? undefined;

      // Venue: the address <li> holds a bare venue-name text node followed by a
      // "(map)" anchor whose ?q= carries the full street address.
      const $addr = $el.find(".eventlist-meta-address").first();
      const venueName = $addr.clone().children().remove().end().text().trim() || undefined;
      const mapHref = $addr.find("a.eventlist-meta-address-maplink").attr("href") ?? "";
      const q = mapHref.split(/\?q=/)[1];
      const venueAddress = q
        ? decodeURIComponent(q).replace(/,?\s*United States\s*$/i, "").trim() || undefined
        : undefined;

      const imgEl = $el.find("img").first();
      const imageUrl = (imgEl.attr("data-src") || imgEl.attr("src") || undefined)?.split("?")[0];

      const description =
        $el.find(".eventlist-excerpt p, .eventlist-description p").first().text().trim() || undefined;

      events.push({
        externalId,
        title,
        startDate,
        endDate,
        description,
        venueName,
        venueAddress,
        imageUrl,
        sourceUrl,
        category: "COMEDY",
        tags: ["comedy", "sketch"],
      });
    });

    console.log(`[killingmylobster] ${events.length} upcoming events`);
    return events;
  }

  /** Combine "YYYY-MM-DD" with a "8:00 PM" time string into an SF-local Date. */
  private buildDate(
    isoDate: string,
    timeText: string,
    fallbackHour?: number,
    fallbackMinute?: number
  ): Date | null {
    const [y, m, d] = isoDate.split("-").map(Number);
    if (!y || !m || !d) return null;
    const hm = this.parseTime(timeText);
    if (!hm) {
      if (fallbackHour == null) return null;
      return sfDateFromLocal(y, m, d, fallbackHour, fallbackMinute ?? 0);
    }
    return sfDateFromLocal(y, m, d, hm.hour, hm.minute);
  }

  private parseTime(raw: string): { hour: number; minute: number } | null {
    const m = raw.trim().match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    if (!m) return null;
    let hour = parseInt(m[1], 10);
    const minute = parseInt(m[2], 10);
    const ampm = m[3].toUpperCase();
    if (ampm === "PM" && hour !== 12) hour += 12;
    if (ampm === "AM" && hour === 12) hour = 0;
    return { hour, minute };
  }
}
