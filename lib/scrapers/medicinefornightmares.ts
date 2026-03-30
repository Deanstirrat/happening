import axios from "axios";
import { BaseScraper } from "./base";
import type { ScrapedEvent } from "./base";

/**
 * Medicine for Nightmares Bookstore & Gallery — medicinefornightmares.com
 *
 * The site runs on Squarespace, which exposes a JSON API for event pages:
 *   GET /events?format=json&offset=N
 *
 * Each item includes:
 *   - startDate / endDate: Unix milliseconds
 *   - title: event title
 *   - fullUrl: relative URL path (e.g. /events/slug)
 *   - assetUrl: hero image URL
 *   - location: address string (venue is always 3036 24th St, SF)
 *
 * Events are returned in chronological order (upcoming first). Pagination
 * continues until items are in the past or the list is exhausted.
 */
export class MedicineForNightmaresScraper extends BaseScraper {
  readonly sourceSlug = "medicine-for-nightmares";
  private readonly BASE_URL = "https://medicinefornightmares.com";
  private readonly MAX_EVENTS = 200;

  async scrape(): Promise<ScrapedEvent[]> {
    const events: ScrapedEvent[] = [];
    const now = Date.now();
    const oneDayAgo = now - 86_400_000;
    const oneYearOut = now + 365 * 86_400_000;

    let offset = 0;

    while (events.length < this.MAX_EVENTS) {
      let items: any[];
      try {
        const { data } = await axios.get(
          `${this.BASE_URL}/events?format=json&offset=${offset}`,
          {
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
              Accept: "application/json",
            },
            timeout: 15_000,
          }
        );
        items = data?.items ?? [];
      } catch (err: any) {
        console.error(`[medicine-for-nightmares] fetch error (offset ${offset}):`, err.message);
        break;
      }

      if (items.length === 0) break;

      let allPast = true;
      for (const item of items) {
        const start: number = item.startDate;
        if (start >= oneDayAgo && start <= oneYearOut) {
          allPast = false;
          const tags = ["bookstore", "literary", "medicine-for-nightmares"];
          events.push({
            externalId: String(item.id),
            title: item.title,
            startDate: new Date(start),
            endDate: item.endDate ? new Date(item.endDate) : undefined,
            sourceUrl: `${this.BASE_URL}${item.fullUrl}`,
            imageUrl: item.assetUrl || undefined,
            venueName: "Medicine for Nightmares",
            venueAddress: "3036 24th St, San Francisco, CA 94110",
            tags,
          });
        } else if (start > oneYearOut) {
          // Far future — skip but don't stop pagination
          allPast = false;
        }
      }

      if (allPast) break;
      offset += items.length;
    }

    console.log(`[medicine-for-nightmares] scraped ${events.length} upcoming events`);
    return events;
  }
}
