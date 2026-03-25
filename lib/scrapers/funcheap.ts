import axios from "axios";
import * as cheerio from "cheerio";
import { BaseScraper } from "./base";
import type { ScrapedEvent } from "./base";

/**
 * Funcheap SF — sf.funcheap.com
 *
 * Events are in div.hentry containers. Each has:
 *   - span.title.entry-title a  — title + URL
 *   - div.date-time[data-event-date]  — ISO datetime in data attribute ("YYYY-MM-DD HH:MM")
 *   - span.cost  — price label; venue follows as last <span> in the date-time div
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

      // Date: data-event-date="YYYY-MM-DD HH:MM" on the .date-time div
      const dateTimeEl = $el.find(".date-time").first();
      const dateAttr = dateTimeEl.attr("data-event-date");
      if (!dateAttr) return;
      const startDate = new Date(dateAttr.replace(" ", "T"));
      if (isNaN(startDate.getTime())) return;

      const endAttr = dateTimeEl.attr("data-event-date-end");
      const endDate = endAttr ? new Date(endAttr.replace(" ", "T")) : undefined;

      // Price: text node after <span class="cost"> and before <a class="tt">
      // The .tt anchor wraps the actual price text
      const priceText = dateTimeEl.find("a.tt").first().text().trim().split("\n")[0].trim();
      const isFree =
        this.parseFree(priceText) ||
        priceText.toLowerCase().includes("free");
      const price = priceText || undefined;

      // Venue: last <span> in the .date-time div (no class)
      const venueSpan = dateTimeEl.find("span").last();
      const venueName = venueSpan.text().trim() || undefined;

      // Image
      const imgSrc =
        $el.find("img").first().attr("src") ??
        $el.find("img").first().attr("data-src");

      events.push({
        title,
        startDate,
        endDate: endDate && !isNaN(endDate.getTime()) ? endDate : undefined,
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
