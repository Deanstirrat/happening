import axios from "axios";
import { BaseScraper } from "./base";
import type { ScrapedEvent } from "./base";

/**
 * SF Live — sflive.art
 *
 * Uses the WordPress REST API with the Vibemap plugin's custom post type.
 * Events are at /wp-json/wp/v2/vibemap_event with standard WP pagination via
 * the X-WP-TotalPages response header.
 *
 * Custom fields live under item.meta (WP REST API nested meta).
 *
 * The WP plugin stores individual occurrence posts for recurring events, each
 * with its own dated slug and vibemap_event_start_date. We simply read the
 * stored start date and filter to the upcoming 60-day window — no RRULE
 * expansion needed.
 *
 * Lat/lng are provided directly by the API — we pass them through to skip
 * Nominatim geocoding.
 */
export class SfliveScraper extends BaseScraper {
  readonly sourceSlug = "sflive";
  private readonly BASE_URL = "https://sflive.art";
  private readonly PER_PAGE = 100;
  private readonly WINDOW_DAYS = 60;

  async scrape(): Promise<ScrapedEvent[]> {
    const now = new Date();
    const windowEnd = new Date();
    windowEnd.setDate(windowEnd.getDate() + this.WINDOW_DAYS);

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
          const event = this.parseItem(item, now, windowEnd);
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

  private parseItem(
    item: any,
    now: Date,
    windowEnd: Date
  ): ScrapedEvent | null {
    // Title is HTML-encoded; strip tags
    const title = (item.title?.rendered ?? "")
      .replace(/<[^>]+>/g, "")
      .trim();
    if (!title) return null;

    // Custom fields live under item.meta (WP REST API nested meta)
    const m = item.meta ?? {};

    const startRaw: string = m.vibemap_event_start_date ?? "";
    if (!startRaw) return null;
    const startDate = new Date(startRaw.replace(" ", "T"));
    if (isNaN(startDate.getTime())) return null;

    // Only include events within the upcoming window
    if (startDate < now || startDate > windowEnd) return null;

    const endRaw: string = m.vibemap_event_end_date ?? "";
    const endDate =
      endRaw ? new Date(endRaw.replace(" ", "T")) : undefined;

    const venueName: string | undefined =
      m.vibemap_event_venue_name || undefined;
    const venueAddress: string | undefined =
      m.vibemap_event_venue_address || undefined;

    // Use coordinates from the API directly to skip Nominatim geocoding
    const latRaw = m.vibemap_event_venue_latitude;
    const lngRaw = m.vibemap_event_venue_longitude;
    const latitude =
      latRaw != null && latRaw !== "" && latRaw !== 0
        ? parseFloat(String(latRaw))
        : undefined;
    const longitude =
      lngRaw != null && lngRaw !== "" && lngRaw !== 0
        ? parseFloat(String(lngRaw))
        : undefined;

    const priceRaw: string = m.vibemap_event_price ?? "";
    const price = priceRaw || undefined;
    const isFree = this.parseFree(price);

    // vibemap_event_images is stored as a JSON-encoded string or empty string
    const imagesRaw = m.vibemap_event_images;
    let imageUrl: string | undefined;
    try {
      const parsed =
        typeof imagesRaw === "string" && imagesRaw
          ? JSON.parse(imagesRaw)
          : imagesRaw;
      if (Array.isArray(parsed) && parsed[0]) {
        imageUrl =
          typeof parsed[0] === "string" ? parsed[0] : parsed[0]?.url;
      }
    } catch {
      // malformed JSON — no image
    }

    const sourceUrl: string = m.vibemap_event_url || item.link || this.BASE_URL;

    return {
      title,
      startDate,
      endDate: endDate && !isNaN(endDate.getTime()) ? endDate : undefined,
      venueName,
      venueAddress,
      latitude: latitude && !isNaN(latitude) ? latitude : undefined,
      longitude: longitude && !isNaN(longitude) ? longitude : undefined,
      price,
      isFree,
      imageUrl,
      sourceUrl,
      tags: ["sf", "arts", "curated"],
    };
  }
}
