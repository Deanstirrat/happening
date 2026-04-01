import axios from "axios";
import * as cheerio from "cheerio";
import { BaseScraper } from "./base";
import type { ScrapedEvent } from "./base";
import { sfDateFromLocal } from "@/lib/sfDate";

/**
 * SF Public Library — sfpl.org/events
 *
 * Events are rendered as Drupal Views rows (.views-row). Each card contains:
 *   - div.event-date   — "Weekday, M/D/YYYY, H:MM - H:MM" (no AM/PM indicator)
 *   - h3 a             — title + detail URL with path /events/YYYY/MM/DD/slug
 *   - div.event-tags a — audience + topic filter links
 *   - a[href^=/locations/] — branch library name
 *   - img              — thumbnail from Drupal managed files
 *
 * Date is extracted reliably from the detail URL path (YYYY/MM/DD).
 * Time is parsed from the event-date text. Since SFPL omits AM/PM, a heuristic
 * is applied: start hours 1–7 are treated as PM (library events are almost never
 * before 8 AM). End hour is bumped to PM if it would otherwise precede the start.
 *
 * Pagination uses Drupal Views' zero-indexed ?page=N parameter.
 */
export class SfplScraper extends BaseScraper {
  readonly sourceSlug = "sfpl";
  private readonly BASE_URL = "https://sfpl.org/events";
  private readonly MAX_PAGES = parseInt(process.env.MAX_PAGES_SFPL ?? "40");

  async scrape(): Promise<ScrapedEvent[]> {
    const events: ScrapedEvent[] = [];
    const now = Date.now();

    for (let page = 0; page < this.MAX_PAGES; page++) {
      const url = page === 0 ? this.BASE_URL : `${this.BASE_URL}?page=${page}`;
      let html: string;
      try {
        const { data } = await axios.get(url, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            Accept: "text/html,application/xhtml+xml",
          },
          timeout: 20000,
        });
        html = data;
      } catch (err: any) {
        console.error(`[sfpl] Fetch error (page ${page}):`, err.message);
        break;
      }

      const $ = cheerio.load(html);
      const rows = $(".views-row");
      if (rows.length === 0) break;

      rows.each((_i, el) => {
        const $el = $(el);

        // Title and detail URL
        const titleEl = $el.find("h2.event__title a, h3 a").first();
        const rawTitle = titleEl.find("span").first().text().trim() || titleEl.text().trim();
        // Normalize "Storytime: For X" → "Storytime: for X" so variants pool correctly
        const title = rawTitle.replace(/^(Storytime:\s*)For\b/, "$1for");
        const relPath = titleEl.attr("href");
        if (!title || !relPath) return;
        const sourceUrl = `https://sfpl.org${relPath}`;

        // Date from URL path: /events/YYYY/MM/DD/slug
        const dateMatch = relPath.match(/\/events\/(\d{4})\/(\d{2})\/(\d{2})\//);
        if (!dateMatch) return;
        const year = parseInt(dateMatch[1]);
        const month = parseInt(dateMatch[2]);
        const day = parseInt(dateMatch[3]);

        // Time from event__date text: "Weekday, M/D/YYYY, H:MM - H:MM"
        const dateText = $el.find(".event__date, .event-date").text().trim();
        let startDate: Date;
        let endDate: Date | undefined;

        const timeMatch = dateText.match(/,\s*(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/);
        if (timeMatch) {
          let sh = parseInt(timeMatch[1]);
          const sm = parseInt(timeMatch[2]);
          let eh = parseInt(timeMatch[3]);
          const em = parseInt(timeMatch[4]);

          // Hours 1–7 are almost certainly PM for library events
          if (sh >= 1 && sh <= 7) sh += 12;
          // If end hour would fall before start, bump it to PM
          if (eh < sh && eh !== 12) eh += 12;

          startDate = sfDateFromLocal(year, month, day, sh, sm);
          endDate = sfDateFromLocal(year, month, day, eh, em);
        } else {
          // No time in string — treat as all-day, anchor to 9 AM
          startDate = sfDateFromLocal(year, month, day, 9, 0);
        }

        // Skip events more than a day in the past
        if (startDate.getTime() < now - 86400000) return;

        // Image (Drupal managed file path)
        // Prefer the largest srcset entry; fall back to src.
        // Strip Drupal image style + ?itok= token to get the full-res original:
        // /sites/default/files/styles/STYLE/public/path?itok=X → /sites/default/files/path
        const imgEl = $el.find("img").first();
        const srcset = imgEl.attr("srcset");
        let rawSrc: string | undefined;
        if (srcset) {
          // Pick the entry with the largest declared width (e.g. "1440w")
          const entries = srcset.split(",").map((s) => s.trim()).filter(Boolean);
          let bestW = 0;
          for (const entry of entries) {
            const [url, w] = entry.split(/\s+/);
            const width = parseInt(w ?? "0");
            if (width > bestW) { bestW = width; rawSrc = url; }
          }
        }
        rawSrc ??= imgEl.attr("src");
        const resolvedSrc = rawSrc
          ?.replace(/\/sites\/default\/files\/styles\/[^/]+\/public\//, "/sites/default/files/")
          ?.replace(/\?itok=[^&]+/, "");
        const imageUrl =
          resolvedSrc && resolvedSrc.startsWith("/sites/default/files/")
            ? `https://sfpl.org${resolvedSrc}`
            : resolvedSrc?.startsWith("http")
              ? resolvedSrc
              : undefined;

        // Branch location
        let venueName: string | undefined;
        $el.find("a").each((_j, a) => {
          const href = $(a).attr("href") ?? "";
          if (href.startsWith("/locations/")) {
            venueName = $(a).text().trim();
          }
        });

        // Tags from audience/topic filter links
        const tags: string[] = ["library", "sfpl"];
        $el.find(".event-tags a, .event__tags a").each((_j, a) => {
          const tag = $(a).text().trim();
          if (tag) tags.push(tag.toLowerCase());
        });

        events.push({
          title,
          startDate,
          endDate,
          sourceUrl,
          imageUrl,
          venueName: venueName ?? "San Francisco Public Library",
          venueAddress: venueName
            ? `${venueName} Branch, San Francisco, CA`
            : "San Francisco, CA",
          tags,
        });
      });

      console.log(`[sfpl] Page ${page}: ${rows.length} rows (${events.length} total)`);
    }

    return events;
  }
}
