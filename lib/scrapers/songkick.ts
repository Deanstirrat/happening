import { BaseScraper } from "./base";
import type { ScrapedEvent } from "./base";
import { sfDateFromLocal } from "@/lib/sfDate";

/**
 * Songkick — api.songkick.com
 *
 * Uses Songkick's public REST API (free tier).
 * Metro area 26330 = San Francisco Bay Area.
 * Requires SONGKICK_API_KEY env var (register free at developer.songkick.com).
 */

const METRO_AREA_ID = 26330; // San Francisco Bay Area
const PER_PAGE = 50;
const MAX_PAGES = 10;

export class SongkickScraper extends BaseScraper {
  readonly sourceSlug = "songkick";

  async scrape(): Promise<ScrapedEvent[]> {
    const apiKey = process.env.SONGKICK_API_KEY;
    if (!apiKey) {
      console.warn("[songkick] SONGKICK_API_KEY not set — skipping");
      return [];
    }

    const events: ScrapedEvent[] = [];

    for (let page = 1; page <= MAX_PAGES; page++) {
      const url = `https://api.songkick.com/api/3.0/metro_areas/${METRO_AREA_ID}/calendar.json?apikey=${apiKey}&page=${page}&per_page=${PER_PAGE}`;

      let json: any;
      try {
        const res = await fetch(url, {
          headers: { "User-Agent": "happening-sf/1.0" },
        });
        if (!res.ok) {
          console.error(`[songkick] HTTP ${res.status}`);
          break;
        }
        json = await res.json();
      } catch (err: any) {
        console.error("[songkick] Fetch error:", err.message);
        break;
      }

      const results = json?.resultsPage;
      const items: any[] = results?.results?.event ?? [];

      for (const item of items) {
        if (item.status === "cancelled") continue;

        const startDate = parseSongkickDate(item.start);
        if (!startDate) continue;

        const endDate = item.end ? parseSongkickDate(item.end) ?? undefined : undefined;

        const venue = item.venue;
        const artists: string[] = (item.performance ?? [])
          .map((p: any) => p.artist?.displayName)
          .filter(Boolean);

        const title = item.displayName ?? artists.join(", ") ?? "Untitled";

        events.push({
          externalId: String(item.id),
          title,
          startDate,
          endDate,
          venueName: venue?.displayName,
          venueAddress: venue?.displayName,
          latitude: venue?.lat ?? undefined,
          longitude: venue?.lng ?? undefined,
          price: undefined, // Songkick doesn't expose ticket prices
          isFree: false,
          sourceUrl: item.uri ?? `https://www.songkick.com/metro_areas/${METRO_AREA_ID}`,
          tags: ["concert", "live music", ...artists.slice(0, 2)],
        });
      }

      const totalEntries = results?.totalEntries ?? 0;
      const fetched = (page - 1) * PER_PAGE + items.length;
      if (items.length === 0 || fetched >= totalEntries) break;
    }

    return events;
  }
}

function parseSongkickDate(start: any): Date | null {
  if (!start) return null;
  // Songkick's datetime is in venue local time but incorrectly labeled +0000.
  // Strip the offset and treat as SF local time.
  const rawStr: string | undefined = start.datetime
    ? (start.datetime as string).replace(/[+-]\d{4}$/, "").replace(/Z$/, "")
    : start.date
    ? start.time
      ? `${start.date}T${start.time}`
      : `${start.date}T20:00:00`
    : undefined;
  if (!rawStr) return null;
  const m = rawStr.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  return sfDateFromLocal(+m[1], +m[2], +m[3], +m[4], +m[5]);
}
