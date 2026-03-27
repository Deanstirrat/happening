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
  private readonly BASE_URL = "https://sf.funcheap.com/events/san-francisco";

  async scrape(): Promise<ScrapedEvent[]> {
    const events: ScrapedEvent[] = [];

    for (let page = 1; page <= this.MAX_PAGES; page++) {
      const url =
        page === 1
          ? `${this.BASE_URL}/`
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

      const dateTimeEl = $el.find(".date-time").first();

      if (dateTimeEl.length) {
        // ── CARD LAYOUT (featured / Top Picks section) ──────────────────────
        // .date-time div present with .fc-event-start-time span inside it.
        const startTimeStr = dateTimeEl.find(".fc-event-start-time").first().text().trim();
        if (!startTimeStr) return;

        const rawDateTimeText = dateTimeEl.clone().find(".fc-event-end-time, .fc-event-start-time, .cost, a.tt, span.cost").remove().end().text();
        const dashMatch = rawDateTimeText.match(/^(.+?)\s*[–-]/);
        if (!dashMatch) return;
        const datePart = dashMatch[1].replace(/^[A-Za-z]+,\s*/, "").trim();

        const year = new Date().getFullYear();
        const startDate = new Date(`${datePart} ${year} ${startTimeStr}`);
        if (isNaN(startDate.getTime())) return;

        let endDate: Date | undefined;
        const endTimeEl = dateTimeEl.find(".fc-event-end-time").first();
        if (endTimeEl.length) {
          const endTimeRaw = endTimeEl.clone().find("span").remove().end().text().trim();
          if (endTimeRaw) {
            const d = new Date(`${datePart} ${year} ${endTimeRaw}`);
            if (!isNaN(d.getTime())) endDate = d;
          }
        }

        const ttEl = dateTimeEl.find("a.tt").first();
        const priceText = ttEl.clone().find(".tooltip").remove().end().text().trim().split("\n")[0].trim();
        const isFree = this.parseFree(priceText) || priceText.toLowerCase().startsWith("free");

        const venueSpan = dateTimeEl.find("span:not([class])").last();
        const venueName = venueSpan.text().trim() || undefined;

        events.push({
          title,
          startDate,
          endDate,
          venueName,
          price: priceText || undefined,
          isFree,
          sourceUrl,
          tags: ["free", "cheap", "sf"],
        });
      } else {
        // ── TABLE LAYOUT (main calendar listing) ────────────────────────────
        // <tr class="hentry"> with three <td>s: time | title | price.
        // Date comes from the nearest preceding <tr> with a <td colspan>.
        const timeStr = $el.find("td").first().text().trim();
        if (!timeStr) return;

        // Walk back through previous siblings to find the date header row
        // which has a single <td colspan="3">Friday, March 27, 2026</td>.
        let prevRow = $el.prev("tr");
        let dateHeaderText = "";
        while (prevRow.length) {
          const td = prevRow.find("td[colspan]");
          if (td.length) {
            dateHeaderText = td.first().text().trim();
            break;
          }
          prevRow = prevRow.prev("tr");
        }
        if (!dateHeaderText) return;

        // Strip leading day-of-week ("Friday, ") → "March 27, 2026"
        const datePart = dateHeaderText.replace(/^[A-Za-z]+,\s*/, "").trim();
        const startDate = new Date(`${datePart} ${timeStr}`);
        if (isNaN(startDate.getTime())) return;

        const ttEl = $el.find("a.tt").first();
        const priceText = ttEl.clone().find(".tooltip").remove().end().text().trim().split("\n")[0].trim();
        const isFree = this.parseFree(priceText) || priceText.toLowerCase().startsWith("free");

        events.push({
          title,
          startDate,
          price: priceText || undefined,
          isFree,
          sourceUrl,
          tags: ["free", "cheap", "sf"],
        });
      }
    });

    return events;
  }
}
