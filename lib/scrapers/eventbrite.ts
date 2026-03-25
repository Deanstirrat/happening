import { BaseScraper } from "./base";
import type { ScrapedEvent } from "./base";

/**
 * Eventbrite REST API
 * Requires EVENTBRITE_API_KEY env var.
 * Fetches SF events within 30km for the next 30 days.
 */
export class EventbriteScraper extends BaseScraper {
  readonly sourceSlug = "eventbrite";

  async scrape(): Promise<ScrapedEvent[]> {
    const apiKey = process.env.EVENTBRITE_API_KEY;
    if (!apiKey) {
      console.warn("[eventbrite] EVENTBRITE_API_KEY not set — skipping");
      return [];
    }

    const events: ScrapedEvent[] = [];
    let page = 1;
    const MAX_PAGES = 10;

    const now = new Date();
    const future = new Date();
    future.setDate(future.getDate() + 30);

    const baseParams = new URLSearchParams({
      "location.address": "San Francisco, CA",
      "location.within": "30km",
      "start_date.range_start": now.toISOString(),
      "start_date.range_end": future.toISOString(),
      expand: "venue,category,ticket_availability",
      page_size: "100",
      token: apiKey,
    });

    while (page <= MAX_PAGES) {
      const params = new URLSearchParams(baseParams.toString());
      params.set("page", String(page));

      const url = `https://www.eventbriteapi.com/v3/events/search/?${params}`;

      const res = await fetch(url);
      if (!res.ok) {
        console.error(`[eventbrite] API error ${res.status}`);
        break;
      }

      const data = await res.json();
      const items = data.events ?? [];

      for (const item of items) {
        const venue = item.venue;
        const startDate = new Date(item.start?.utc ?? item.start?.local);
        if (isNaN(startDate.getTime())) continue;

        const endDate = item.end?.utc
          ? new Date(item.end.utc)
          : undefined;

        const price = item.ticket_availability?.is_free
          ? "Free"
          : item.ticket_availability?.minimum_ticket_price?.display ?? undefined;

        events.push({
          externalId: item.id,
          title: item.name?.text ?? item.name?.html ?? "Untitled",
          description: item.description?.text?.slice(0, 1000),
          startDate,
          endDate,
          venueName: venue?.name,
          venueAddress: venue?.address?.localized_address_display,
          latitude: venue?.latitude ? parseFloat(venue.latitude) : undefined,
          longitude: venue?.longitude ? parseFloat(venue.longitude) : undefined,
          price,
          isFree: item.ticket_availability?.is_free ?? false,
          imageUrl: item.logo?.url,
          sourceUrl: item.url,
          tags: [item.category?.name?.toLowerCase() ?? "event"].filter(Boolean),
        });
      }

      if (!data.pagination?.has_more_items || items.length === 0) break;
      page++;
    }

    return events;
  }
}
