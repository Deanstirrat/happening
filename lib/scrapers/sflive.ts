import axios from "axios";
import { RRule, rrulestr } from "rrule";
import { BaseScraper } from "./base";
import type { ScrapedEvent } from "./base";

/**
 * SF Live — sflive.art
 *
 * Uses the WordPress REST API with the Vibemap plugin's custom post type.
 * Events are at /wp-json/wp/v2/vibemap_event with standard WP pagination via
 * the X-WP-TotalPages response header.
 *
 * Many events are recurring (RRULE). The stored vibemap_event_start_date can be
 * far in the future (the series anchor), so we expand RRULE patterns to generate
 * occurrences within the next 60 days from today.
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
          events.push(...this.parseItem(item));
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

  private parseItem(item: any): ScrapedEvent[] {
    // Title is HTML-encoded; strip tags
    const title = (item.title?.rendered ?? "")
      .replace(/<[^>]+>/g, "")
      .trim();
    if (!title) return [];

    // Custom fields live under item.meta (WP REST API nested meta)
    const m = item.meta ?? {};

    const startRaw: string = m.vibemap_event_start_date ?? "";
    if (!startRaw) return [];
    const storedStart = new Date(startRaw.replace(" ", "T"));
    if (isNaN(storedStart.getTime())) return [];

    const endRaw: string = m.vibemap_event_end_date ?? "";
    const storedEnd =
      endRaw ? new Date(endRaw.replace(" ", "T")) : undefined;
    const duration =
      storedEnd && !isNaN(storedEnd.getTime())
        ? storedEnd.getTime() - storedStart.getTime()
        : undefined;

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

    // vibemap_event_images can be a string (empty) or array
    const imagesRaw = m.vibemap_event_images;
    const imageUrl: string | undefined =
      Array.isArray(imagesRaw) && imagesRaw[0]?.url
        ? imagesRaw[0].url
        : undefined;

    const sourceUrl: string = m.vibemap_event_url || item.link || this.BASE_URL;

    const base = {
      title,
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

    const rruleRaw: string = m.vibemap_event_recurrence ?? "";

    if (rruleRaw) {
      return this.expandRecurring(item.id, storedStart, duration, rruleRaw, base);
    }

    // Non-recurring: only include if within the window
    const now = new Date();
    const windowEnd = new Date();
    windowEnd.setDate(windowEnd.getDate() + this.WINDOW_DAYS);

    if (storedStart < now || storedStart > windowEnd) return [];

    const endDate =
      duration !== undefined
        ? new Date(storedStart.getTime() + duration)
        : undefined;

    return [{ ...base, startDate: storedStart, endDate }];
  }

  /**
   * Expand a recurring event into individual occurrences within [today, today+WINDOW_DAYS].
   *
   * Handles two formats:
   *  - RRULE:FREQ=... — standard iCalendar rule (most common)
   *  - RDATE:datetime\nRDATE:... — explicit list of occurrence timestamps
   *
   * For RRULE: we anchor to yesterday at the event's stored time so the rule generates
   * upcoming occurrences regardless of when the series was originally set up.
   * COUNT is dropped because it may have been exhausted against the old dtstart.
   */
  private expandRecurring(
    itemId: number,
    storedStart: Date,
    duration: number | undefined,
    rruleRaw: string,
    base: Omit<ScrapedEvent, "startDate" | "endDate" | "externalId">
  ): ScrapedEvent[] {
    const now = new Date();
    const windowEnd = new Date();
    windowEnd.setDate(windowEnd.getDate() + this.WINDOW_DAYS);

    const makeOccurrence = (occ: Date): ScrapedEvent => ({
      ...base,
      externalId: `${itemId}_${occ.toISOString().slice(0, 10)}`,
      startDate: occ,
      endDate: duration !== undefined ? new Date(occ.getTime() + duration) : undefined,
    });

    try {
      // Build a DTSTART anchored to yesterday at the event's stored time.
      // This ensures the rule generates upcoming occurrences regardless of
      // when the series was originally set up.
      const anchor = new Date();
      anchor.setDate(anchor.getDate() - 1);
      anchor.setHours(storedStart.getHours(), storedStart.getMinutes(), 0, 0);

      // Format anchor as compact UTC string for DTSTART
      const pad = (n: number) => String(n).padStart(2, "0");
      const dtstart =
        `${anchor.getUTCFullYear()}${pad(anchor.getUTCMonth() + 1)}${pad(anchor.getUTCDate())}` +
        `T${pad(anchor.getUTCHours())}${pad(anchor.getUTCMinutes())}00Z`;

      // Remove COUNT so it isn't exhausted against the old dtstart
      const sanitized = rruleRaw.replace(/;?COUNT=\d+/gi, "");

      // rrulestr handles RRULE, RDATE, and combined strings
      const ruleSet = rrulestr(`DTSTART:${dtstart}\n${sanitized}`, {
        forceset: true,
      });

      return (ruleSet as any).between(now, windowEnd, true).map(makeOccurrence);
    } catch (err: any) {
      console.warn(`[sflive] Failed to expand recurrence for event ${itemId}:`, err.message);
      return [];
    }
  }
}
