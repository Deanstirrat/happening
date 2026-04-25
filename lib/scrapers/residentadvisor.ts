import { BaseScraper } from "./base";
import type { ScrapedEvent } from "./base";
import { sfDateFromLocal } from "@/lib/sfDate";

/**
 * Resident Advisor SF — ra.co/events/us/sanfrancisco
 *
 * Uses RA's public GraphQL API. No auth required for public listings.
 * SF/Oakland area ID = 218.
 */

const RA_GRAPHQL = "https://ra.co/graphql";
const SF_AREA_ID = 218; // San Francisco/Oakland
const PAGE_SIZE = 50;
const MAX_PAGES = 5;

// Bounding box for the greater SF Bay Area
const BAY_AREA_BOUNDS = {
  latMin: 36.9,
  latMax: 38.9,
  lngMin: -123.2,
  lngMax: -121.5,
};

const EVENT_LISTINGS_QUERY = `
  query GetEventListings($filters: FilterInputDtoInput, $pageSize: Int, $page: Int) {
    eventListings(filters: $filters, pageSize: $pageSize, page: $page) {
      totalResults
      data {
        id
        listingDate
        event {
          id
          title
          date
          startTime
          endTime
          contentUrl
          cost
          content
          images { filename }
          venue {
            name
            address
            location { latitude longitude }
          }
          artists { name }
        }
      }
    }
  }
`;

export class ResidentAdvisorScraper extends BaseScraper {
  readonly sourceSlug = "residentadvisor";

  async scrape(): Promise<ScrapedEvent[]> {
    const events: ScrapedEvent[] = [];

    const today = new Date();
    const future = new Date();
    future.setDate(future.getDate() + 30);
    const dateGte = today.toISOString().slice(0, 10);
    const dateLte = future.toISOString().slice(0, 10);

    let totalResults = 0;

    for (let page = 1; page <= MAX_PAGES; page++) {
      let json: any;
      try {
        const res = await fetch(RA_GRAPHQL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0 (compatible; happening-sf/1.0)",
            Referer: "https://ra.co/",
            Origin: "https://ra.co",
          },
          body: JSON.stringify({
            query: EVENT_LISTINGS_QUERY,
            variables: {
              filters: {
                areas: { eq: SF_AREA_ID },
                listingDate: { gte: dateGte, lte: dateLte },
              },
              pageSize: PAGE_SIZE,
              page,
            },
          }),
        });

        if (!res.ok) {
          console.error(`[residentadvisor] HTTP ${res.status}`);
          break;
        }
        json = await res.json();
      } catch (err: any) {
        console.error("[residentadvisor] Fetch error:", err.message);
        break;
      }

      if (json?.errors) {
        console.error("[residentadvisor] GraphQL errors:", json.errors.map((e: any) => e.message).join("; "));
        break;
      }

      const listings: any[] = json?.data?.eventListings?.data ?? [];
      if (page === 1) totalResults = json?.data?.eventListings?.totalResults ?? 0;

      for (const listing of listings) {
        const ev = listing?.event;
        if (!ev?.title) continue;

        const startDate = parseRaDate(ev.startTime ?? ev.date);
        if (!startDate) continue;

        const endDate = ev.endTime ? parseRaDate(ev.endTime) ?? undefined : undefined;

        // filename is already a full URL on RA
        const imageUrl = ev.images?.[0]?.filename ?? undefined;

        const artists: string[] = (ev.artists ?? [])
          .map((a: { name: string }) => a.name)
          .filter(Boolean);

        const costStr: string | undefined = ev.cost || undefined;

        const rawContent: string | undefined = ev.content || undefined;
        const description = rawContent
          ? rawContent
              .replace(/<[^>]+>/g, " ")
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 1000) || undefined
          : undefined;

        const lat: number | undefined = ev.venue?.location?.latitude ?? undefined;
        const lng: number | undefined = ev.venue?.location?.longitude ?? undefined;

        // Drop events whose venue falls outside the Bay Area — RA's area filter is leaky
        if (
          lat !== undefined &&
          lng !== undefined &&
          (lat < BAY_AREA_BOUNDS.latMin ||
            lat > BAY_AREA_BOUNDS.latMax ||
            lng < BAY_AREA_BOUNDS.lngMin ||
            lng > BAY_AREA_BOUNDS.lngMax)
        ) {
          console.warn(`[residentadvisor] skipping out-of-area event "${ev.title}" (${lat}, ${lng})`);
          continue;
        }

        events.push({
          externalId: String(ev.id),
          title: ev.title,
          description,
          startDate,
          endDate,
          venueName: ev.venue?.name,
          venueAddress: ev.venue?.address || undefined,
          latitude: lat,
          longitude: lng,
          price: costStr,
          isFree: !costStr || costStr.toLowerCase().includes("free"),
          imageUrl,
          sourceUrl: ev.contentUrl
            ? `https://ra.co${ev.contentUrl}`
            : "https://ra.co/events/us/sanfrancisco",
          tags: ["electronic", "club", ...artists.slice(0, 3)],
          performers: artists,
        });
      }

      const fetched = (page - 1) * PAGE_SIZE + listings.length;
      if (listings.length === 0 || fetched >= totalResults) break;
    }

    return events;
  }
}

function parseRaDate(dateStr: string): Date | null {
  if (!dateStr) return null;
  // If the string includes a timezone indicator, parse it as-is (UTC-anchored)
  if (/Z$|[+-]\d{2}:?\d{2}$/.test(dateStr)) {
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? null : d;
  }
  // No timezone info — assume SF local time
  const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (!m) return null;
  return sfDateFromLocal(+m[1], +m[2], +m[3], +m[4], +m[5]);
}
