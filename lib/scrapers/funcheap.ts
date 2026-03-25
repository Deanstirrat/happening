import axios from "axios";
import * as cheerio from "cheerio";
import { BaseScraper } from "./base";
import type { ScrapedEvent } from "./base";

/**
 * Funcheap SF — sf.funcheap.com
 *
 * Events are in .hentry containers. Each has:
 *   - span.title.entry-title a    — title + URL
 *   - .date-time                  — date/time as text with embedded spans:
 *       "Wednesday, March 25 – <span class=fc-event-start-time>4:30 pm</span>
 *        <span class=fc-event-end-time>...<span>Ends at </span>10:00 pm</span>"
 *   - a.tt                        — price text (tooltip inside; first line is price)
 *   - last <span> in .date-time   — venue name
 */
export class FuncheapScraper extends BaseScraper {
  readonly sourceSlug = "funcheap";
  private readonly MAX_PAGES = parseInt(process.env.MAX_PAGES_FUNCHEAP ?? "8");
  private readonly BASE_URL = "https://sf.funcheap.com";

  async scrape(): Promise<ScrapedEvent[]> {
    const events: ScrapedEvent[] = [];

    for (let page = 1; page <= this.MAX_PAGES; page++) {
      const url =
        page === 1
          ? this.BASE_URL
          : `${this.BASE_URL}/page/${page}/`;

      try {
        const { data: html } = await axios.get(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; happening-sf/1.0)",
          },
          timeout: 15000,
        });

        const $ = cheerio.load(html);
        const pageEvents = this.parsePage($);

        if (pageEvents.length === 0) break;
        events.push(...pageEvents);
      } catch (err: any) {
        if (err.response?.status === 404) break;
        console.error(`[funcheap] Error on page ${page}:`, err.message);
        break;
      }
    }

    return events;
  }

  private parsePage($: ReturnType<typeof cheerio.load>): ScrapedEvent[] {
    const events: ScrapedEvent[] = [];

    $(".hentry").each((_i, el) => {
      const $el = $(el);

      // Title + URL
      const titleEl = $el.find("span.title.entry-title a, span.title2.entry-title a").first();
      const title = titleEl.text().trim();
      if (!title) return;
      const sourceUrl = titleEl.attr("href") ?? this.BASE_URL;

      // Date: text before "–" in .date-time (e.g. "Wednesday, March 25")
      // Start time: .fc-event-start-time span text
      // End time: .fc-event-end-time text (last text node, after "Ends at ")
      const dateTimeEl = $el.find(".date-time").first();
      if (!dateTimeEl.length) return;

      const startTimeStr = dateTimeEl.find(".fc-event-start-time").first().text().trim();
      if (!startTimeStr) return;

      // Extract the date part from the raw text before the "–" separator
      const rawDateTimeText = dateTimeEl.clone().find(".fc-event-end-time, .fc-event-start-time, .cost, a.tt, span.cost").remove().end().text();
      const dashMatch = rawDateTimeText.match(/^(.+?)\s*[–-]/);
      if (!dashMatch) return;
      const datePart = dashMatch[1].replace(/^[A-Za-z]+,\s*/, "").trim(); // strip day-of-week

      const year = new Date().getFullYear();
      const startDate = new Date(`${datePart} ${year} ${startTimeStr}`);
      if (isNaN(startDate.getTime())) return;

      // End time: last text node in .fc-event-end-time (after stripping "Ends at" spans)
      let endDate: Date | undefined;
      const endTimeEl = dateTimeEl.find(".fc-event-end-time").first();
      if (endTimeEl.length) {
        const endTimeRaw = endTimeEl.clone().find("span").remove().end().text().trim();
        if (endTimeRaw) {
          const d = new Date(`${datePart} ${year} ${endTimeRaw}`);
          if (!isNaN(d.getTime())) endDate = d;
        }
      }

      // Price: first line of a.tt text (tooltip div is inside it; take text before the tooltip)
      const ttEl = dateTimeEl.find("a.tt").first();
      const priceText = ttEl.clone().find(".tooltip").remove().end().text().trim().split("\n")[0].trim();
      const isFree = this.parseFree(priceText) || priceText.toLowerCase().startsWith("free");
      const price = priceText || undefined;

      // Venue: last plain <span> in .date-time (no class)
      const venueSpan = dateTimeEl.find("span:not([class])").last();
      const venueName = venueSpan.text().trim() || undefined;

      // Image: prefer noscript src (real URL) over lazy-loaded data URI
      const noscriptImg = $el.find("noscript img").first();
      const regularImg = $el.find("img").first();
      const imgSrc =
        noscriptImg.attr("src") ??
        regularImg.attr("src") ??
        regularImg.attr("data-src");

      events.push({
        title,
        startDate,
        endDate,
        venueName,
        price,
        isFree,
        imageUrl: imgSrc || undefined,
        sourceUrl,
        tags: ["free", "cheap", "sf"],
      });
    });

    return events;
  }
}
