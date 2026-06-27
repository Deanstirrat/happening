import axios from "axios";
import * as cheerio from "cheerio";
import { BaseScraper } from "./base";
import type { ScrapedEvent } from "./base";
import { sfDayKey, sfDayStart } from "@/lib/sfDate";

/**
 * DoTheBay — dothebay.com
 *
 * Events are rendered as server-side HTML with Schema.org microdata.
 * Each event card is [itemprop="event"] with:
 *   - meta[itemprop="startDate|endDate"]  — ISO 8601 with timezone offset
 *   - [itemprop="name"]                   — event title
 *   - data-permalink                      — relative event URL
 *   - .ds-venue-name [itemprop="name"]    — venue name
 *   - meta[itemprop="streetAddress|addressLocality|addressRegion|postalCode"]
 *   - meta[itemprop="latitude|longitude"] — coordinates
 *   - .ds-cover-image style               — background-image URL
 *   - .ds-listing-banners li              — "Free" or "Sold Out" badges
 *   - class ds-event-category-{slug}      — category hint
 *
 * Listing strategy: the default `/events` (and `/events?page=N`) listing no
 * longer surfaces future-dated events — every page tops out at "today" and pads
 * with past events going back years, so the old page-walk only ever ingested
 * same-day events that were stale within 24h (the source read as "dark"). The
 * date-path view `/events/YYYY/MM/DD` still returns each day's upcoming events,
 * so we walk forward day-by-day and keep only future-dated cards. The day views
 * overlap (each pads with nearby/recurring events), so we dedupe by permalink.
 */
export class DothebayScraper extends BaseScraper {
  readonly sourceSlug: string = "dothebay";
  protected readonly BASE_URL: string = "https://dothebay.com";
  /** Extra tags applied to every event (subclasses add their brand tag). */
  protected readonly extraTags: string[] = [];
  /** How many days ahead to walk. The daily cron only needs the near horizon. */
  protected readonly daysAhead: number = parseInt(process.env.MAX_DAYS_DOTHEBAY ?? "30");
  /**
   * Stop early once this many consecutive future days return no new events —
   * the calendar has run dry, so there's no point walking the full window.
   */
  protected readonly stopAfterEmptyDays = 5;

  private get eventsUrl(): string {
    return `${this.BASE_URL}/events`;
  }

  async scrape(): Promise<ScrapedEvent[]> {
    const events: ScrapedEvent[] = [];
    const seen = new Set<string>();
    const cutoffMs = sfDayStart(sfDayKey(new Date())).getTime();

    // Anchor calendar arithmetic to today's SF date, then step whole days via a
    // UTC reference so DST never skips or repeats a day in the path strings.
    const [y, m, d] = sfDayKey(new Date()).split("-").map(Number);
    let emptyStreak = 0;

    for (let offset = 0; offset <= this.daysAhead; offset++) {
      const day = new Date(Date.UTC(y, m - 1, d + offset));
      const yyyy = day.getUTCFullYear();
      const mm = String(day.getUTCMonth() + 1).padStart(2, "0");
      const dd = String(day.getUTCDate()).padStart(2, "0");
      const url = `${this.eventsUrl}/${yyyy}/${mm}/${dd}`;

      let html: string;
      try {
        const res = await axios.get<string>(url, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
          },
          timeout: 15000,
        });
        html = res.data;
      } catch (err: any) {
        if (err.response?.status === 404) break;
        console.error(`[${this.sourceSlug}] Error on ${url}:`, err.message);
        // A transient day failure shouldn't abort the whole walk.
        continue;
      }

      const $ = cheerio.load(html);
      let newThisDay = 0;
      for (const event of this.parsePage($)) {
        // The date-path view pads each day with past/nearby events — keep only
        // genuinely upcoming cards (today-SF or later).
        if (event.startDate.getTime() < cutoffMs) continue;
        const key = event.sourceUrl || `${event.title}|${event.startDate.toISOString()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        events.push(event);
        newThisDay++;
      }

      emptyStreak = newThisDay === 0 ? emptyStreak + 1 : 0;
      if (emptyStreak >= this.stopAfterEmptyDays) break;
    }

    console.log(`[${this.sourceSlug}] scraped ${events.length} upcoming events`);
    return events;
  }

  protected parsePage($: ReturnType<typeof cheerio.load>): ScrapedEvent[] {
    const events: ScrapedEvent[] = [];

    $('[itemprop="event"]').each((_i, el) => {
      const $el = $(el);

      // Title
      const title = $el.find('[itemprop="name"]').first().text().trim();
      if (!title) return;

      // Source URL — prefer data-permalink, fall back to [itemprop="url"] href
      const permalink =
        $el.attr("data-permalink") ??
        $el.find('[itemprop="url"]').attr("href");
      const sourceUrl = permalink
        ? permalink.startsWith("http")
          ? permalink
          : `${this.BASE_URL}${permalink}`
        : this.eventsUrl;

      // Start date (ISO 8601 with offset, e.g. "2026-03-28T20:00:00-07:00")
      const startDateStr = $el.find('meta[itemprop="startDate"]').attr("content");
      if (!startDateStr) return;
      const startDate = new Date(startDateStr);
      if (isNaN(startDate.getTime())) return;

      // End date
      let endDate: Date | undefined;
      const endDateStr = $el.find('meta[itemprop="endDate"]').attr("content");
      if (endDateStr) {
        const d = new Date(endDateStr);
        if (!isNaN(d.getTime())) endDate = d;
      }

      // Venue
      const venueName =
        $el.find('.ds-venue-name [itemprop="name"]').first().text().trim() ||
        undefined;

      // Address fields
      const street = $el.find('meta[itemprop="streetAddress"]').attr("content");
      const locality = $el.find('meta[itemprop="addressLocality"]').attr("content");
      const region = $el.find('meta[itemprop="addressRegion"]').attr("content");
      const postal = $el.find('meta[itemprop="postalCode"]').attr("content");
      const venueAddress = street || locality
        ? [street, locality, region, postal].filter(Boolean).join(", ")
        : undefined;

      // Coordinates
      const latStr = $el.find('meta[itemprop="latitude"]').attr("content");
      const lngStr = $el.find('meta[itemprop="longitude"]').attr("content");
      const latitude = latStr ? parseFloat(latStr) : undefined;
      const longitude = lngStr ? parseFloat(lngStr) : undefined;

      // Image from background-image inline style
      let imageUrl: string | undefined;
      const coverStyle = $el.find(".ds-cover-image").attr("style") ?? "";
      const imgMatch = coverStyle.match(/url\(['"]?([^'")\s]+)['"]?\)/);
      if (imgMatch?.[1]) imageUrl = imgMatch[1];

      // Free badge
      const bannerText = $el.find(".ds-listing-banners li").text().toLowerCase();
      const isFree = bannerText.includes("free");

      // Category hint from class name (e.g. ds-event-category-music)
      const classAttr = $el.attr("class") ?? "";
      const catMatch = classAttr.match(/ds-event-category-([a-z0-9-]+)/);
      const tags = [...this.extraTags, ...(catMatch?.[1] ? [catMatch[1]] : [])];

      events.push({
        title,
        startDate,
        endDate,
        venueName,
        venueAddress,
        latitude: latitude != null && !isNaN(latitude) ? latitude : undefined,
        longitude: longitude != null && !isNaN(longitude) ? longitude : undefined,
        imageUrl,
        isFree,
        sourceUrl,
        tags,
      });
    });

    return events;
  }
}
