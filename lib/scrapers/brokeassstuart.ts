import axios from "axios";
import * as cheerio from "cheerio";
import { BaseScraper } from "./base";
import type { ScrapedEvent } from "./base";

/**
 * Broke Ass Stuart DoTheBay — brokeassstuart.dothebay.com
 *
 * Curated SF/Bay Area calendar powered by the DoTheBay platform.
 * HTML structure is identical to dothebay.com: Schema.org microdata on
 * [itemprop="event"] cards. Requires a full browser User-Agent — the subdomain
 * returns 403 for simple bots.
 */
export class BrokeAssStuartScraper extends BaseScraper {
  readonly sourceSlug = "brokeassstuart";
  private readonly MAX_PAGES = parseInt(process.env.MAX_PAGES_BROKEASSSTUART ?? "5");
  private readonly BASE_URL = "https://brokeassstuart.dothebay.com";
  private readonly EVENTS_URL = "https://brokeassstuart.dothebay.com/events";

  async scrape(): Promise<ScrapedEvent[]> {
    const events: ScrapedEvent[] = [];

    for (let page = 1; page <= this.MAX_PAGES; page++) {
      const url = page === 1 ? this.EVENTS_URL : `${this.EVENTS_URL}?page=${page}`;

      try {
        const { data: html } = await axios.get(url, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
          },
          timeout: 15000,
        });

        const $ = cheerio.load(html);
        const pageEvents = this.parsePage($);

        if (pageEvents.length === 0) break;
        events.push(...pageEvents);
      } catch (err: any) {
        if (err.response?.status === 404) break;
        console.error(`[brokeassstuart] Error on page ${page}:`, err.message);
        break;
      }
    }

    console.log(`[brokeassstuart] scraped ${events.length} upcoming events`);
    return events;
  }

  private parsePage($: ReturnType<typeof cheerio.load>): ScrapedEvent[] {
    const events: ScrapedEvent[] = [];

    $('[itemprop="event"]').each((_i, el) => {
      const $el = $(el);

      const title = $el.find('[itemprop="name"]').first().text().trim();
      if (!title) return;

      const permalink =
        $el.attr("data-permalink") ??
        $el.find('[itemprop="url"]').attr("href");
      const sourceUrl = permalink
        ? permalink.startsWith("http")
          ? permalink
          : `${this.BASE_URL}${permalink}`
        : this.EVENTS_URL;

      const startDateStr = $el.find('meta[itemprop="startDate"]').attr("content");
      if (!startDateStr) return;
      const startDate = new Date(startDateStr);
      if (isNaN(startDate.getTime())) return;

      let endDate: Date | undefined;
      const endDateStr = $el.find('meta[itemprop="endDate"]').attr("content");
      if (endDateStr) {
        const d = new Date(endDateStr);
        if (!isNaN(d.getTime())) endDate = d;
      }

      const venueName =
        $el.find('.ds-venue-name [itemprop="name"]').first().text().trim() || undefined;

      const street = $el.find('meta[itemprop="streetAddress"]').attr("content");
      const locality = $el.find('meta[itemprop="addressLocality"]').attr("content");
      const region = $el.find('meta[itemprop="addressRegion"]').attr("content");
      const postal = $el.find('meta[itemprop="postalCode"]').attr("content");
      const venueAddress =
        street || locality
          ? [street, locality, region, postal].filter(Boolean).join(", ")
          : undefined;

      const latStr = $el.find('meta[itemprop="latitude"]').attr("content");
      const lngStr = $el.find('meta[itemprop="longitude"]').attr("content");
      const latitude = latStr ? parseFloat(latStr) : undefined;
      const longitude = lngStr ? parseFloat(lngStr) : undefined;

      let imageUrl: string | undefined;
      const coverStyle = $el.find(".ds-cover-image").attr("style") ?? "";
      const imgMatch = coverStyle.match(/url\(['"]?([^'")\s]+)['"]?\)/);
      if (imgMatch?.[1]) imageUrl = imgMatch[1];

      const bannerText = $el.find(".ds-listing-banners li").text().toLowerCase();
      const isFree = bannerText.includes("free");

      const classAttr = $el.attr("class") ?? "";
      const catMatch = classAttr.match(/ds-event-category-([a-z0-9-]+)/);
      const tags = ["broke-ass-stuart", ...(catMatch?.[1] ? [catMatch[1]] : [])];

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
