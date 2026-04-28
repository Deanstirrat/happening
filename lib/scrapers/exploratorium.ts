import axios from "axios";
import * as cheerio from "cheerio";
import { BaseScraper } from "./base";
import type { ScrapedEvent } from "./base";
import { sfDateFromLocal } from "@/lib/sfDate";

/**
 * Exploratorium — exploratorium.edu/visit/calendar
 *
 * Drupal 11 site with server-rendered event cards. All upcoming events are
 * present in the initial HTML as <a class="card card--experience"> elements.
 * No AJAX or pagination — simple one-page scrape.
 *
 * Date formats in <time datetime="...">:
 *   - Date-only "2026-04-21": all-day event, normalized to noon SF
 *   - ISO with offset "2026-04-29T11:00:00-07:00": timed event
 * Recurring events have multiple time pairs; we use pair [0]/[1] (next occurrence).
 * All-day range events (exhibition-style) are kept as long as endDate is still upcoming.
 */

const BASE_URL = "https://www.exploratorium.edu";
const CALENDAR_URL = `${BASE_URL}/visit/calendar`;

function parseExploDate(datetimeStr: string): Date {
  if (datetimeStr.includes("T")) {
    return new Date(datetimeStr);
  }
  const [y, m, d] = datetimeStr.split("-").map(Number);
  return sfDateFromLocal(y, m, d, 12, 0);
}

export class ExploratoriumScraper extends BaseScraper {
  readonly sourceSlug = "exploratorium";

  async scrape(): Promise<ScrapedEvent[]> {
    let html: string;
    try {
      const { data } = await axios.get<string>(CALENDAR_URL, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml",
        },
        timeout: 15_000,
      });
      html = data;
    } catch (err: any) {
      console.error(`[exploratorium] fetch failed:`, err.message);
      return [];
    }

    const $ = cheerio.load(html);
    const events: ScrapedEvent[] = [];
    const nowMs = Date.now();
    const seen = new Set<string>();

    $("a.card--experience").each((_, el) => {
      const $el = $(el);
      const href = $el.attr("href") ?? "";
      if (!href || seen.has(href)) return;
      seen.add(href);

      const sourceUrl = `${BASE_URL}${href}`;
      const title = $el.find(".card-title").text().trim();
      if (!title) return;

      // Collect all <time datetime="..."> values in document order.
      // Recurring events list multiple occurrences; pair [0]/[1] is the next one.
      const times: string[] = [];
      $el.find("time[datetime]").each((_, t) => {
        const dt = $(t).attr("datetime") ?? "";
        if (dt) times.push(dt);
      });
      if (times.length === 0) return;

      const startDate = parseExploDate(times[0]);
      if (isNaN(startDate.getTime())) return;

      const endDate = times[1] ? parseExploDate(times[1]) : undefined;
      const isAllDay = !times[0].includes("T");

      // For all-day range events (exhibitions), keep if endDate is still upcoming
      if (isAllDay) {
        const relevantDate =
          endDate && !isNaN(endDate.getTime()) ? endDate : startDate;
        if (relevantDate.getTime() < nowMs - 86_400_000) return;
      } else {
        if (startDate.getTime() < nowMs - 86_400_000) return;
      }

      const imgSrc = $el.find("img.lazy-load-image").first().attr("src") ?? "";
      const imageUrl = imgSrc ? `${BASE_URL}${imgSrc}` : undefined;

      const description =
        $el
          .find(".field--name-field-short-description-rte")
          .first()
          .text()
          .trim() || undefined;

      events.push({
        title,
        description,
        startDate,
        endDate: endDate && !isNaN(endDate.getTime()) ? endDate : undefined,
        allDay: isAllDay || undefined,
        sourceUrl,
        imageUrl,
        venueName: "Exploratorium",
        venueAddress: "Pier 15, San Francisco, CA 94111",
        tags: ["science", "museum", "exploratorium", "family"],
      });
    });

    console.log(`[exploratorium] scraped ${events.length} events`);
    return events;
  }
}
