import axios from "axios";
import * as cheerio from "cheerio";
import { BaseScraper } from "./base";
import type { ScrapedEvent } from "./base";

/**
 * Luma SF — lu.ma/sf + sub-calendars
 *
 * Strategy:
 * 1. Fetch lu.ma/sf and extract featured_event_api_ids from __NEXT_DATA__
 * 2. For each sub-calendar slug, extract the calendar API ID from __NEXT_DATA__
 *    then paginate through all upcoming events via api.lu.ma/calendar/get-items
 * 3. Fetch each event individually via api.lu.ma/event/get?event_api_id=...
 */

// Community calendars to scrape in addition to lu.ma/sf
const CALENDAR_SLUGS = [
  "Big-Brain-SF",
  "sf-crypto",
  "sftech",
  "sf-climate-week",
  "tiat",
  "sf-builders-collective",
  "frontiertower",
];

export class LumaScraper extends BaseScraper {
  readonly sourceSlug = "luma";

  async scrape(): Promise<ScrapedEvent[]> {
    const allEventIds = new Set<string>();

    // Step 1: Featured events from lu.ma/sf
    await this.collectFeaturedIds(allEventIds);

    // Step 2: Events from sub-calendars
    for (const slug of CALENDAR_SLUGS) {
      await this.collectCalendarIds(slug, allEventIds);
    }

    if (allEventIds.size === 0) {
      console.warn("[luma] No event IDs found");
      return [];
    }

    // Step 3: Fetch each event individually
    return this.fetchEvents(Array.from(allEventIds));
  }

  private async collectFeaturedIds(ids: Set<string>): Promise<void> {
    try {
      const { data: html } = await axios.get("https://lu.ma/sf", {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; happening-sf/1.0)",
          Accept: "text/html",
        },
        timeout: 20000,
      });

      const $ = cheerio.load(html);
      const nextDataEl = $("script#__NEXT_DATA__").text().trim();
      if (nextDataEl) {
        const nextData = JSON.parse(nextDataEl);
        const place = nextData?.props?.pageProps?.initialData?.data?.place;
        const featuredIds: string[] = place?.featured_event_api_ids ?? [];
        featuredIds.forEach((id) => ids.add(id));
        console.log(`[luma] lu.ma/sf: found ${featuredIds.length} featured events`);
      }
    } catch (err: any) {
      console.error("[luma] Error fetching lu.ma/sf:", err.message);
    }
  }

  private async collectCalendarIds(slug: string, ids: Set<string>): Promise<void> {
    try {
      // Fetch the calendar page to get its API ID
      const { data: html } = await axios.get(`https://lu.ma/${slug}`, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; happening-sf/1.0)",
          Accept: "text/html",
        },
        timeout: 20000,
      });

      const $ = cheerio.load(html);
      const nextDataEl = $("script#__NEXT_DATA__").text().trim();
      if (!nextDataEl) {
        console.warn(`[luma] ${slug}: no __NEXT_DATA__ found`);
        return;
      }

      const nextData = JSON.parse(nextDataEl);
      const pageProps = nextData?.props?.pageProps?.initialData?.data;

      // Extract calendar API ID — may be under .calendar or .community
      const calendarApiId: string | undefined =
        pageProps?.calendar?.api_id ??
        pageProps?.community?.calendar_api_id ??
        pageProps?.host?.calendar_api_id;

      if (!calendarApiId) {
        // Try to pull any inline event entries directly
        const entries: any[] = pageProps?.entries ?? pageProps?.events ?? [];
        for (const entry of entries) {
          const eventId = entry?.event?.api_id ?? entry?.api_id;
          if (eventId) ids.add(eventId);
        }
        if (entries.length > 0) {
          console.log(`[luma] ${slug}: no calendar ID, extracted ${entries.length} inline events`);
        } else {
          console.warn(`[luma] ${slug}: could not find calendar API ID`);
        }
        return;
      }

      // Paginate through upcoming calendar events
      let cursor: string | undefined;
      let page = 0;
      const MAX_PAGES = 10;

      do {
        const url = new URL("https://api.lu.ma/calendar/get-items");
        url.searchParams.set("calendar_api_id", calendarApiId);
        url.searchParams.set("period", "future");
        url.searchParams.set("pagination_limit", "50");
        if (cursor) url.searchParams.set("pagination_cursor", cursor);

        const res = await fetch(url.toString(), {
          headers: { "User-Agent": "Mozilla/5.0 (compatible; happening-sf/1.0)" },
        });

        if (!res.ok) {
          console.warn(`[luma] ${slug}: calendar/get-items returned ${res.status}`);
          break;
        }

        const json = await res.json();
        const entries: any[] = json?.entries ?? [];

        for (const entry of entries) {
          const eventId = entry?.event?.api_id ?? entry?.api_id;
          if (eventId) ids.add(eventId);
        }

        cursor = json?.next_cursor ?? undefined;
        page++;

        if (entries.length === 0) break;
      } while (cursor && page < MAX_PAGES);

      console.log(`[luma] ${slug} (${calendarApiId}): collected ${ids.size} total IDs so far`);
    } catch (err: any) {
      console.error(`[luma] Error fetching calendar ${slug}:`, err.message);
    }
  }

  private async fetchEvents(eventIds: string[]): Promise<ScrapedEvent[]> {
    const events: ScrapedEvent[] = [];

    for (const eventId of eventIds) {
      try {
        const res = await fetch(
          `https://api.lu.ma/event/get?event_api_id=${eventId}`,
          { headers: { "User-Agent": "Mozilla/5.0 (compatible; happening-sf/1.0)" } }
        );
        if (!res.ok) continue;

        const data = await res.json();
        const ev = data?.event;
        if (!ev?.name) continue;

        const startDate = ev.start_at ? new Date(ev.start_at) : null;
        if (!startDate || isNaN(startDate.getTime())) continue;

        const endDate = ev.end_at ? new Date(ev.end_at) : undefined;

        const geo = ev.geo_address_info ?? {};
        const coord = ev.coordinate ?? {};

        const ticketPrice = data.ticket_info?.price;
        const priceAmount =
          typeof ticketPrice === "number"
            ? ticketPrice
            : typeof ticketPrice === "object" && ticketPrice !== null
            ? (ticketPrice.decimal ?? ticketPrice.usd_cents / 100 ?? null)
            : null;
        const isFree =
          data.ticket_info?.is_free !== false || priceAmount === null || priceAmount === 0;
        const price =
          !isFree && priceAmount !== null ? `$${priceAmount}` : "Free";

        const sourceUrl = ev.url
          ? `https://lu.ma/${ev.url}`
          : `https://lu.ma/e/${eventId}`;

        const rawDesc: string | undefined =
          ev.description ?? ev.description_short ?? undefined;
        const description = rawDesc
          ? rawDesc
              .replace(/<[^>]+>/g, " ")
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 1000) || undefined
          : undefined;

        events.push({
          externalId: ev.api_id ?? eventId,
          title: ev.name,
          description,
          startDate,
          endDate,
          venueName: geo.short_address ?? geo.city ?? undefined,
          venueAddress: geo.full_address ?? undefined,
          latitude: coord.latitude ?? undefined,
          longitude: coord.longitude ?? undefined,
          price,
          isFree,
          imageUrl: ev.cover_url ?? undefined,
          sourceUrl,
          tags: ["tech", "community"],
        });
      } catch (err: any) {
        console.error(`[luma] Error fetching event ${eventId}:`, err.message);
      }
    }

    return events;
  }
}
