import axios from "axios";
import { BaseScraper } from "./base";
import type { ScrapedEvent } from "./base";

/**
 * SF Live — sflive.art
 *
 * Uses the WordPress REST API with the Vibemap plugin's custom post type.
 * Events are at /wp-json/wp/v2/vibemap_event with standard WP pagination via
 * the X-WP-TotalPages response header.
 */
export class SfliveScraper extends BaseScraper {
  readonly sourceSlug = "sflive";
  private readonly BASE_URL = "https://sflive.art";
  private readonly PER_PAGE = 100;

  async scrape(): Promise<ScrapedEvent[]> {
    const events: ScrapedEvent[] = [];
    let page = 1;
    let totalPages = 1;

    do {
      try {
        const response = await axios.get(
          `${this.BASE_URL}/wp-json/wp/v2/vibemap_event`,
          {
            params: { per_page: this.PER_PAGE, page },
            headers: {
              "User-Agent": "Mozilla/5.0 (compatible; happening-sf/1.0)",
            },
            timeout: 15000,
          }
        );

        if (page === 1) {
          totalPages = parseInt(
            response.headers["x-wp-totalpages"] ?? "1",
            10
          );
        }

        const items: any[] = response.data;
        for (const item of items) {
          const event = this.parseItem(item);
          if (event) events.push(event);
        }
      } catch (err: any) {
        if (err.response?.status === 400) break; // WP returns 400 past last page
        console.error(`[sflive] Error on page ${page}:`, err.message);
        break;
      }

      page++;
    } while (page <= totalPages);

    return events;
  }

  private parseItem(item: any): ScrapedEvent | null {
    // Title is HTML-encoded; strip tags
    const title = (item.title?.rendered ?? "")
      .replace(/<[^>]+>/g, "")
      .trim();
    if (!title) return null;

    const startRaw: string = item.vibemap_event_start_date ?? "";
    if (!startRaw) return null;
    const startDate = new Date(startRaw.replace(" ", "T"));
    if (isNaN(startDate.getTime())) return null;

    const endRaw: string = item.vibemap_event_end_date ?? "";
    const endDate =
      endRaw ? new Date(endRaw.replace(" ", "T")) : undefined;

    const venueName: string | undefined =
      item.vibemap_event_venue_name || undefined;
    const venueAddress: string | undefined =
      item.vibemap_event_venue_address || undefined;

    const priceRaw: string = item.vibemap_event_price ?? "";
    const price = priceRaw || undefined;
    const isFree = this.parseFree(price);

    const sourceUrl: string = item.link ?? this.BASE_URL;

    return {
      title,
      startDate,
      endDate: endDate && !isNaN(endDate.getTime()) ? endDate : undefined,
      venueName,
      venueAddress,
      price,
      isFree,
      sourceUrl,
      tags: ["sf", "arts", "curated"],
    };
  }
}
