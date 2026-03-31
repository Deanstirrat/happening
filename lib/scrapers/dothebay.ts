import axios from "axios";
import * as cheerio from "cheerio";
import { BaseScraper } from "./base";
import type { ScrapedEvent } from "./base";

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
 */
export class DothebayScraper extends BaseScraper {
  readonly sourceSlug = "dothebay";
  private readonly MAX_PAGES = parseInt(process.env.MAX_PAGES_DOTHEBAY ?? "5");
  private readonly BASE_URL = "https://dothebay.com";
  private readonly EVENTS_URL = "https://dothebay.com/events";

  async scrape(): Promise<ScrapedEvent[]> {
    const events: ScrapedEvent[] = [];

    for (let page = 1; page <= this.MAX_PAGES; page++) {
      const url = page === 1 ? this.EVENTS_URL : `${this.EVENTS_URL}?page=${page}`;

      try {
        const { data: html } = await axios.get(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; happening-sf/1.0)",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          },
          timeout: 15000,
        });

        const $ = cheerio.load(html);
        const pageEvents = this.parsePage($);

        if (pageEvents.length === 0) break;
        events.push(...pageEvents);
      } catch (err: any) {
        if (err.response?.status === 404) break;
        console.error(`[dothebay] Error on page ${page}:`, err.message);
        break;
      }
    }

    return events;
  }

  private parsePage($: ReturnType<typeof cheerio.load>): ScrapedEvent[] {
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
        : this.EVENTS_URL;

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
      const tags = catMatch?.[1] ? [catMatch[1]] : [];

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
