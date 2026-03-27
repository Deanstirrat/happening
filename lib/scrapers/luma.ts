import axios from "axios";
import * as cheerio from "cheerio";
import { BaseScraper } from "./base";
import type { ScrapedEvent } from "./base";

/**
 * Luma SF — lu.ma/sf
 *
 * Strategy:
 * 1. Fetch lu.ma/sf and extract featured_event_api_ids from __NEXT_DATA__
 * 2. Fetch each event individually via api.lu.ma/event/get?event_api_id=...
 *
 * Luma's discover page loads event lists client-side, so only the featured
 * curated SF events (~9) are available via SSR without auth.
 */
export class LumaScraper extends BaseScraper {
  readonly sourceSlug = "luma";

  async scrape(): Promise<ScrapedEvent[]> {
    // Step 1: Fetch the SF discover page and extract featured event IDs
    let featuredIds: string[] = [];
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
        featuredIds = place?.featured_event_api_ids ?? [];
      }
    } catch (err: any) {
      console.error("[luma] Error fetching sf page:", err.message);
      return [];
    }

    if (featuredIds.length === 0) {
      console.warn("[luma] No featured event IDs found on lu.ma/sf");
      return [];
    }

    // Step 2: Fetch each event individually
    const events: ScrapedEvent[] = [];

    for (const eventId of featuredIds) {
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

        const price = data.ticket_info?.is_free === false && data.ticket_info?.price
          ? `$${data.ticket_info.price}`
          : "Free";
        const isFree = !data.ticket_info?.price || data.ticket_info?.is_free !== false;

        const sourceUrl = ev.url
          ? `https://lu.ma/${ev.url}`
          : `https://lu.ma/${eventId}`;

        const rawDesc: string | undefined = ev.description ?? ev.description_short ?? undefined;
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
