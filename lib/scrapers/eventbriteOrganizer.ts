import axios from "axios";
import { BaseScraper } from "./base";
import type { ScrapedEvent } from "./base";
import { sfDayKey } from "@/lib/sfDate";
import { parseEbSeparateDateTime, parseEbLocal, isLikelyBayArea } from "./eventbrite";

/**
 * Base scraper for a single Eventbrite *organizer* (an `/o/<slug>-<id>/` page),
 * used by venue/promoter sources that run all their events through one Eventbrite
 * organizer account.
 *
 * The public organizer page is a client-rendered Next.js app, but it hydrates
 * from a clean, unauthenticated JSON endpoint we can hit directly:
 *
 *   GET /organizer-profile/api/organizers/{id}/events-from-date/
 *       ?from_date=YYYY-MM-DD&page=N&page_size=50&order_by=start_asc&include_started=true
 *   → { events: [...], page, page_size, has_more }
 *
 * Each event carries separate `start_date`/`start_time` (local) fields, a
 * `primary_venue` with a full address + coordinates, an `image.url`, and
 * `ticket_availability` pricing — enough to build a complete ScrapedEvent
 * without a headless browser.
 *
 * Subclasses set `sourceSlug` and `organizerId`.
 */
export abstract class EventbriteOrganizerScraper extends BaseScraper {
  /** The numeric id from the organizer's `/o/<slug>-<id>/` URL. */
  protected abstract readonly organizerId: string;

  private readonly PAGE_SIZE = 50;
  private readonly MAX_PAGES = 10;
  /**
   * Only ingest events starting within this horizon. Recurring series on
   * Eventbrite are often booked out a year or two (e.g. a weekly comedy show with
   * 200 future instances); without a horizon one organizer would flood the feed.
   * A quarter keeps the listing current and bounded.
   */
  private readonly HORIZON_DAYS = 90;

  async scrape(): Promise<ScrapedEvent[]> {
    const fromDate = sfDayKey(new Date()); // today, SF local, "YYYY-MM-DD"
    const horizonMs = Date.now() + this.HORIZON_DAYS * 86_400_000;
    const events: ScrapedEvent[] = [];
    const seen = new Set<string>();

    for (let page = 1; page <= this.MAX_PAGES; page++) {
      const url =
        `https://www.eventbrite.com/organizer-profile/api/organizers/${this.organizerId}/events-from-date/` +
        `?from_date=${fromDate}&page=${page}&page_size=${this.PAGE_SIZE}&order_by=start_asc&include_started=true`;

      let data: any;
      try {
        const res = await axios.get(url, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            Accept: "application/json",
          },
          timeout: 20_000,
        });
        data = res.data;
      } catch (err: any) {
        console.error(`[${this.sourceSlug}] fetch error (page ${page}):`, err.message);
        break;
      }

      const batch: any[] = Array.isArray(data?.events) ? data.events : [];
      if (batch.length === 0) break;

      // Events come back start-ascending, so the first one past the horizon means
      // every remaining event (this page and later) is too far out — stop.
      let reachedHorizon = false;
      for (const item of batch) {
        const event = this.parseEvent(item);
        if (!event) continue;
        if (event.startDate.getTime() > horizonMs) {
          reachedHorizon = true;
          break;
        }
        const key = event.externalId || event.sourceUrl;
        if (seen.has(key)) continue;
        seen.add(key);
        events.push(event);
      }

      if (reachedHorizon || !data?.has_more) break;
    }

    console.log(`[${this.sourceSlug}] scraped ${events.length} upcoming events`);
    return events;
  }

  private parseEvent(item: any): ScrapedEvent | null {
    if (item?.is_online_event === true || item?.is_cancelled === true) return null;

    const title: string = item?.name;
    if (!title) return null;

    // Separate local date + time fields ("2026-10-19", "19:15:00").
    const startDate =
      item?.start_date && item?.start_time
        ? parseEbSeparateDateTime(item.start_date, item.start_time)
        : item?.start_date
          ? parseEbLocal(item.start_date)
          : null;
    if (!startDate || isNaN(startDate.getTime())) return null;

    let endDate: Date | undefined;
    if (item?.end_date && item?.end_time) {
      endDate = parseEbSeparateDateTime(item.end_date, item.end_time) ?? undefined;
    } else if (item?.end_date) {
      endDate = parseEbLocal(item.end_date) ?? undefined;
    }

    const venue = item?.primary_venue;
    const addr = venue?.address;
    const venueName: string | undefined = venue?.name ?? undefined;
    const venueAddress: string | undefined = addr?.localized_address_display ?? undefined;

    // These organizers are SF-based, but occasional out-of-area (e.g. NYC) shows
    // slip into the same account — drop anything that isn't clearly Bay Area.
    if (venueAddress && !isLikelyBayArea(venueAddress)) return null;

    const lat = addr?.latitude;
    const lng = addr?.longitude;

    const minPrice = item?.ticket_availability?.minimum_ticket_price;
    const isFree: boolean =
      item?.ticket_availability?.is_free === true || minPrice?.value === 0;
    const price: string | undefined = isFree
      ? "Free"
      : minPrice?.major_value
        ? `$${minPrice.major_value}`
        : undefined;

    const sourceUrl: string =
      item?.url ??
      (item?.id ? `https://www.eventbrite.com/e/${item.id}` : "https://www.eventbrite.com/");

    return {
      externalId: String(item?.eventbrite_event_id ?? item?.id ?? ""),
      title,
      description: (item?.summary ?? "").slice(0, 1000) || undefined,
      startDate,
      endDate: endDate && !isNaN(endDate.getTime()) ? endDate : undefined,
      venueName,
      venueAddress,
      latitude: lat ? parseFloat(String(lat)) : undefined,
      longitude: lng ? parseFloat(String(lng)) : undefined,
      price,
      isFree,
      imageUrl: item?.image?.url ?? undefined,
      sourceUrl,
      tags: ["eventbrite"],
    };
  }
}
