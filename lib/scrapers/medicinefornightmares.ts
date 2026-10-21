import axios from "axios";
import { BaseScraper } from "./base";
import type { ScrapedEvent } from "./base";

/**
 * Medicine for Nightmares Bookstore & Gallery — medicinefornightmares.com
 *
 * The site runs on Squarespace, which exposes a JSON view of its events page:
 *   GET /events?format=json
 *
 * The response splits events into two already-sorted arrays, `upcoming` and
 * `past`; we only want `upcoming`. Each item includes:
 *   - startDate / endDate: Unix milliseconds
 *   - title: event title
 *   - fullUrl: relative URL path (e.g. /events/slug)
 *   - assetUrl: hero image URL
 *   - location: address string (venue is always 3036 24th St, SF)
 *
 * NOTE: Squarespace used to return a flat `items` array and honor an `offset`
 * pagination param; it now returns `upcoming`/`past` and responds to `offset`
 * with an empty calendar view, so we fetch the page once with no offset.
 */
export class MedicineForNightmaresScraper extends BaseScraper {
  readonly sourceSlug = "medicine-for-nightmares";
  private readonly BASE_URL = "https://medicinefornightmares.com";
  private readonly MAX_EVENTS = 200;

  async scrape(): Promise<ScrapedEvent[]> {
    let upcoming: any[];
    try {
      const { data } = await axios.get(`${this.BASE_URL}/events?format=json`, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          Accept: "application/json",
        },
        timeout: 15_000,
      });
      upcoming = data?.upcoming ?? [];
    } catch (err: any) {
      console.error(`[medicine-for-nightmares] fetch error:`, err.message);
      return [];
    }

    const oneYearOut = Date.now() + 365 * 86_400_000;

    const events: ScrapedEvent[] = upcoming
      .filter((item) => typeof item.startDate === "number" && item.startDate <= oneYearOut)
      .slice(0, this.MAX_EVENTS)
      .map((item) => ({
        externalId: String(item.id),
        title: item.title,
        startDate: new Date(item.startDate),
        endDate: item.endDate ? new Date(item.endDate) : undefined,
        sourceUrl: `${this.BASE_URL}${item.fullUrl}`,
        imageUrl: item.assetUrl || undefined,
        venueName: "Medicine for Nightmares",
        venueAddress: "3036 24th St, San Francisco, CA 94110",
        tags: ["bookstore", "literary", "medicine-for-nightmares"],
      }));

    console.log(`[medicine-for-nightmares] scraped ${events.length} upcoming events`);
    return events;
  }
}
