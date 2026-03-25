import axios from "axios";
import * as cheerio from "cheerio";
import { BaseScraper } from "./base";
import type { ScrapedEvent } from "./base";

/**
 * Timeout San Francisco — timeout.com/san-francisco
 *
 * Scrapes the public HTML listing page. Timeout is editorial (weekly picks),
 * so expect lower volume but high-quality curated events.
 */
export class TimeoutScraper extends BaseScraper {
  readonly sourceSlug = "timeout";
  private readonly MAX_PAGES = parseInt(process.env.MAX_PAGES_TIMEOUT ?? "3");

  async scrape(): Promise<ScrapedEvent[]> {
    const events: ScrapedEvent[] = [];

    for (let page = 1; page <= this.MAX_PAGES; page++) {
      try {
        const url =
          page === 1
            ? "https://www.timeout.com/san-francisco/things-to-do"
            : `https://www.timeout.com/san-francisco/things-to-do?pageNumber=${page}`;

        const { data: html } = await axios.get(url, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
            Accept: "text/html,application/xhtml+xml",
          },
          timeout: 20000,
        });

        const $ = cheerio.load(html);
        const pageEvents = this.parsePage($);
        if (pageEvents.length === 0) break;
        events.push(...pageEvents);
      } catch (err: any) {
        console.error(`[timeout] Error on page ${page}:`, err.message);
        break;
      }
    }

    return events;
  }

  private parsePage($: ReturnType<typeof cheerio.load>): ScrapedEvent[] {
    const events: ScrapedEvent[] = [];

    // Timeout uses article cards with data-testid or class-based selectors
    const cardSelectors = [
      '[data-testid="tile"]',
      ".tile",
      "article",
      '[class*="card"]',
      '[class*="Card"]',
    ];

    let cards = $([]);
    for (const sel of cardSelectors) {
      const found = $(sel);
      if (found.length > 0) {
        cards = found;
        break;
      }
    }

    cards.each((_i, el) => {
      const $el = $(el);

      // Title
      const titleEl = $el
        .find("h2, h3, h4, [class*='title'], [class*='Title']")
        .first();
      const title = titleEl.text().trim();
      if (!title || title.length < 3) return;

      // Source URL
      const linkEl = $el.find("a[href]").first();
      const href = linkEl.attr("href") ?? "";
      const sourceUrl = href.startsWith("http")
        ? href
        : `https://www.timeout.com${href}`;

      if (!href) return;

      // Date: look for time element
      const timeEl = $el.find("time").first();
      const dateStr =
        timeEl.attr("datetime") ?? timeEl.text().trim();
      const startDate = dateStr ? new Date(dateStr) : null;
      if (!startDate || isNaN(startDate.getTime())) {
        // Use tomorrow as fallback for editorial "this week" content
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(19, 0, 0, 0);
        // Only include if we have a URL (real article)
        if (!href) return;
        events.push({
          title,
          startDate: tomorrow,
          sourceUrl,
          imageUrl: $el.find("img").first().attr("src") ?? undefined,
          tags: ["sf", "curated"],
        });
        return;
      }

      const imgSrc = $el.find("img").first().attr("src");

      events.push({
        title,
        startDate,
        imageUrl: imgSrc || undefined,
        sourceUrl,
        tags: ["sf", "curated"],
      });
    });

    return events;
  }
}
