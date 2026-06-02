import axios from "axios";
import * as cheerio from "cheerio";
import { BaseScraper } from "./base";
import type { ScrapedEvent } from "./base";

const BASE_URL = "https://sfdesignweek.org";
const EVENTS_URL = "https://sfdesignweek.org/events/";

/**
 * SF Design Week — sfdesignweek.org/events/
 *
 * SF Design Week is an annual design festival (typically June) organized by
 * AIGA San Francisco. The events page lists individual events from venues
 * across the city. The site uses WordPress with The Events Calendar plugin,
 * so we target Tribe Events markup and fall back to generic article selectors.
 */
export class SfDesignWeekScraper extends BaseScraper {
  readonly sourceSlug = "sfdesignweek";

  async scrape(): Promise<ScrapedEvent[]> {
    const events: ScrapedEvent[] = [];
    let page = 1;
    const MAX_PAGES = 10;

    while (page <= MAX_PAGES) {
      const url = page === 1 ? EVENTS_URL : `${EVENTS_URL}page/${page}/`;
      try {
        const { data: html } = await axios.get(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; happening-sf/1.0)",
            Accept: "text/html,application/xhtml+xml",
          },
          timeout: 15000,
        });
        const $ = cheerio.load(html);
        const pageEvents = this.parsePage($);
        if (pageEvents.length === 0) break;
        events.push(...pageEvents);
        // If fewer results than expected, we're on the last page
        if (pageEvents.length < 5) break;
        page++;
      } catch (err: any) {
        if (err.response?.status === 404) break;
        console.error(`[sfdesignweek] Error on page ${page}:`, err.message);
        break;
      }
    }

    console.log(`[sfdesignweek] Found ${events.length} events`);
    return events;
  }

  private parsePage($: ReturnType<typeof cheerio.load>): ScrapedEvent[] {
    const events: ScrapedEvent[] = [];

    // Strategy 1: The Events Calendar / Tribe Events (most common WP event plugin)
    const tribeEvents = $(".tribe-events-calendar-list__event, .tribe-event, article[class*='tribe']");
    if (tribeEvents.length > 0) {
      tribeEvents.each((_i, el) => {
        const event = this.parseTribeEvent($, el);
        if (event) events.push(event);
      });
      return events;
    }

    // Strategy 2: Schema.org microdata (used by many event sites)
    const schemaEvents = $('[itemtype*="schema.org/Event"], [itemtype*="schema.org/event"]');
    if (schemaEvents.length > 0) {
      schemaEvents.each((_i, el) => {
        const event = this.parseSchemaEvent($, el);
        if (event) events.push(event);
      });
      return events;
    }

    // Strategy 3: Generic article/card selectors
    $("article").each((_i, el) => {
      const event = this.parseGenericEvent($, el);
      if (event) events.push(event);
    });

    return events;
  }

  private parseTribeEvent(
    $: ReturnType<typeof cheerio.load>,
    el: cheerio.Element
  ): ScrapedEvent | null {
    const $el = $(el);

    // Title
    const titleEl = $el.find(
      ".tribe-event-url, .tribe-events-list-event-title a, .tribe-events-calendar-list__event-title a, h2 a, h3 a"
    ).first();
    const title = titleEl.text().trim();
    if (!title) return null;

    const href = titleEl.attr("href") ?? $el.find("a").first().attr("href");
    const sourceUrl = href ? (href.startsWith("http") ? href : `${BASE_URL}${href}`) : EVENTS_URL;

    // Date — Tribe encodes dates in abbr[title] or datetime attributes
    const dateStr =
      $el.find("abbr[title]").first().attr("title") ??
      $el.find("time[datetime]").first().attr("datetime") ??
      $el.find(".tribe-events-schedule time").attr("datetime") ??
      $el.find(".tribe-event-date-start").text().trim();

    if (!dateStr) return null;
    const startDate = new Date(dateStr);
    if (isNaN(startDate.getTime())) return null;
    if (startDate.getTime() < Date.now() - 86_400_000) return null;

    const venueName =
      $el.find(".tribe-venue-name, .tribe-venue, [class*='venue'] .tribe-venue-location-name").text().trim() ||
      undefined;
    const venueAddress =
      $el.find(".tribe-address, .tribe-venue-location").text().replace(/\s+/g, " ").trim() ||
      undefined;

    const imageUrl =
      $el.find("img").first().attr("src") ??
      $el.find("[style*='background-image']").attr("style")?.match(/url\(['"]?([^'")\s]+)['"]?\)/)?.[1] ??
      undefined;

    return {
      title,
      startDate,
      venueName,
      venueAddress,
      imageUrl,
      sourceUrl,
      tags: ["design", "sfdesignweek"],
    };
  }

  private parseSchemaEvent(
    $: ReturnType<typeof cheerio.load>,
    el: cheerio.Element
  ): ScrapedEvent | null {
    const $el = $(el);

    const title = $el.find('[itemprop="name"]').first().text().trim();
    if (!title) return null;

    const startDateStr = $el.find('[itemprop="startDate"]').attr("content") ?? $el.find('[itemprop="startDate"]').attr("datetime");
    if (!startDateStr) return null;
    const startDate = new Date(startDateStr);
    if (isNaN(startDate.getTime())) return null;
    if (startDate.getTime() < Date.now() - 86_400_000) return null;

    const href =
      $el.find('[itemprop="url"]').attr("href") ??
      $el.find('[itemprop="url"]').attr("content") ??
      $el.find("a").first().attr("href");
    const sourceUrl = href ? (href.startsWith("http") ? href : `${BASE_URL}${href}`) : EVENTS_URL;

    const venueName =
      $el.find('[itemprop="location"] [itemprop="name"]').text().trim() || undefined;
    const venueAddress =
      $el.find('[itemprop="address"]').text().replace(/\s+/g, " ").trim() || undefined;

    const imageUrl = $el.find('[itemprop="image"]').attr("src") ?? $el.find("img").first().attr("src") ?? undefined;

    return {
      title,
      startDate,
      venueName,
      venueAddress,
      imageUrl,
      sourceUrl,
      tags: ["design", "sfdesignweek"],
    };
  }

  private parseGenericEvent(
    $: ReturnType<typeof cheerio.load>,
    el: cheerio.Element
  ): ScrapedEvent | null {
    const $el = $(el);

    const titleEl = $el.find("h2 a, h3 a, h1 a, .event-title a, .entry-title a").first();
    const title = titleEl.text().trim() || $el.find("h2, h3").first().text().trim();
    if (!title) return null;

    const href = titleEl.attr("href") ?? $el.find("a").first().attr("href");
    const sourceUrl = href ? (href.startsWith("http") ? href : `${BASE_URL}${href}`) : EVENTS_URL;

    // Look for date in time[datetime], meta[property], or text containing date patterns
    const datetimeAttr = $el.find("time[datetime]").first().attr("datetime");
    if (!datetimeAttr) return null;
    const startDate = new Date(datetimeAttr);
    if (isNaN(startDate.getTime())) return null;
    if (startDate.getTime() < Date.now() - 86_400_000) return null;

    const imageUrl = $el.find("img").first().attr("src") ?? undefined;

    return {
      title,
      startDate,
      imageUrl,
      sourceUrl,
      tags: ["design", "sfdesignweek"],
    };
  }
}
