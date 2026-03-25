import axios from "axios";
import * as cheerio from "cheerio";
import { BaseScraper } from "./base";
import type { ScrapedEvent } from "./base";

/**
 * Partiful SF — partiful.com/explore/sf
 *
 * Extracts events from __NEXT_DATA__ JSON embedded in the explore page.
 * Events come from pageProps.feedItems[] and pageProps.sections[].items[],
 * deduplicated by event ID.
 *
 * Event shape: { id, title, description, startDate, endDate, locationInfo, image }
 * Source URL: https://partiful.com/e/{id}
 */

/** Safely extract an image URL from whatever shape Partiful returns for the image field */
function extractImageUrl(image: unknown): string | undefined {
  if (!image) return undefined;
  if (typeof image === "string") return image || undefined;
  if (typeof image === "object") {
    const obj = image as Record<string, unknown>;
    const candidate = obj.url ?? obj.src ?? obj.uri ?? obj.path;
    if (typeof candidate === "string") return candidate || undefined;
  }
  return undefined;
}

export class PartifulScraper extends BaseScraper {
  readonly sourceSlug = "partiful";

  async scrape(): Promise<ScrapedEvent[]> {
    let html: string;
    try {
      const { data } = await axios.get("https://partiful.com/explore/sf", {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; happening-sf/1.0)",
          Accept: "text/html",
        },
        timeout: 20000,
      });
      html = data;
    } catch (err: any) {
      console.error("[partiful] Fetch error:", err.message);
      return [];
    }

    const $ = cheerio.load(html);
    const nextDataEl = $("script#__NEXT_DATA__").text().trim();
    if (!nextDataEl) {
      console.warn("[partiful] No __NEXT_DATA__ found");
      return [];
    }

    let nextData: any;
    try {
      nextData = JSON.parse(nextDataEl);
    } catch {
      console.error("[partiful] Failed to parse __NEXT_DATA__");
      return [];
    }

    const pp = nextData?.props?.pageProps ?? {};

    // Collect all event items from feedItems + all section items, deduplicated by ID
    const itemsById = new Map<string, any>();

    for (const item of pp.feedItems ?? []) {
      if (item?.type === "event" && item?.event?.id) {
        itemsById.set(item.event.id, item.event);
      }
    }

    for (const section of pp.sections ?? []) {
      for (const item of section?.items ?? []) {
        if (item?.type === "event" && item?.event?.id) {
          itemsById.set(item.event.id, item.event);
        }
      }
    }

    if (itemsById.size === 0) {
      console.warn("[partiful] No events found in __NEXT_DATA__");
      return [];
    }

    const events: ScrapedEvent[] = [];

    for (const ev of itemsById.values()) {
      if (!ev.title || ev.status !== "PUBLISHED") continue;

      const startDate = ev.startDate ? new Date(ev.startDate) : null;
      if (!startDate || isNaN(startDate.getTime())) continue;

      const endDate = ev.endDate ? new Date(ev.endDate) : undefined;

      const maps = ev.locationInfo?.mapsInfo;
      const venueName = maps?.name ?? undefined;
      const venueAddress = maps?.addressLines?.join(", ") ?? undefined;

      // Extract lat/lng from Apple Maps URL: sll=37.77,-122.41
      let latitude: number | undefined;
      let longitude: number | undefined;
      if (maps?.appleMapsUrl) {
        const sllMatch = maps.appleMapsUrl.match(/sll=([-\d.]+),([-\d.]+)/);
        if (sllMatch) {
          latitude = parseFloat(sllMatch[1]);
          longitude = parseFloat(sllMatch[2]);
        }
      }

      // Price: not a structured field — check description for "Free" hint
      const descLower = (ev.description ?? "").toLowerCase();
      const isFree = descLower.includes("free") && !descLower.includes("not free");
      const price = isFree ? "Free" : undefined;

      events.push({
        externalId: ev.id,
        title: ev.title,
        description: ev.description?.slice(0, 1000),
        startDate,
        endDate,
        venueName,
        venueAddress,
        latitude,
        longitude,
        price,
        isFree,
        imageUrl: extractImageUrl(ev.image),
        sourceUrl: `https://partiful.com/e/${ev.id}`,
        tags: ["social", "community"],
      });
    }

    return events;
  }
}
