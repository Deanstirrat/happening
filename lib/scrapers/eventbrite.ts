import axios from "axios";
import * as cheerio from "cheerio";
import { BaseScraper } from "./base";
import type { ScrapedEvent } from "./base";

/**
 * Eventbrite SF — eventbrite.com/d/ca--san-francisco/events/
 *
 * Eventbrite removed public API search in 2023. We instead scrape their
 * SF discovery page, extracting event data from the JSON blob Eventbrite
 * embeds in the page for React hydration (window.__SERVER_DATA__).
 * Falls back to JSON-LD <script> blocks if the hydration key changes.
 *
 * Pagination: ?page=N up to MAX_PAGES.
 */
export class EventbriteScraper extends BaseScraper {
  readonly sourceSlug = "eventbrite";
  private readonly MAX_PAGES = 5;
  private readonly BASE_URL =
    "https://www.eventbrite.com/d/ca--san-francisco/events/";

  async scrape(): Promise<ScrapedEvent[]> {
    const events: ScrapedEvent[] = [];

    for (let page = 1; page <= this.MAX_PAGES; page++) {
      const url = `${this.BASE_URL}?page=${page}`;
      let html: string;
      try {
        const { data } = await axios.get(url, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            Accept: "text/html,application/xhtml+xml",
          },
          timeout: 20000,
        });
        html = data;
      } catch (err: any) {
        console.error(`[eventbrite] Fetch error on page ${page}:`, err.message);
        break;
      }

      const $ = cheerio.load(html);
      const pageEvents = this.extractEvents($, html);

      if (pageEvents.length === 0) {
        console.log(`[eventbrite] No events on page ${page} — stopping`);
        break;
      }

      events.push(...pageEvents);
    }

    return events;
  }

  private extractEvents(
    $: cheerio.CheerioAPI,
    html: string
  ): ScrapedEvent[] {
    // --- Strategy 1: window.__SERVER_DATA__ hydration blob ---
    const match = html.match(
      /window\.__SERVER_DATA__\s*=\s*(\{[\s\S]*?\});\s*(?:window\.|<\/script>)/
    );
    if (match) {
      try {
        const data = JSON.parse(match[1]);
        const results = this.extractFromServerData(data);
        if (results.length > 0) return results;
      } catch {
        // fall through
      }
    }

    // --- Strategy 2: JSON-LD blocks ---
    const results = this.extractFromJsonLd($);
    if (results.length > 0) return results;

    // --- Debug: log script snippets to help diagnose future structure changes ---
    console.warn("[eventbrite] Could not extract events — logging script stubs:");
    $("script").each((i, el) => {
      const text = $(el).text().trim();
      if (text.length > 50) {
        console.warn(`  script[${i}]: ${text.slice(0, 120)}…`);
      }
    });

    return [];
  }

  private extractFromServerData(data: any): ScrapedEvent[] {
    // Eventbrite nests search results under various keys depending on page version
    const results: any[] =
      data?.search_data?.events?.results ??
      data?.events?.results ??
      data?.components?.search_results?.events ??
      [];

    return results.flatMap((item: any) => {
      const event = this.parseServerEvent(item);
      return event ? [event] : [];
    });
  }

  private parseServerEvent(item: any): ScrapedEvent | null {
    const title: string = item?.name ?? item?.title;
    if (!title) return null;

    const startRaw = item?.start_date ?? item?.start?.local ?? item?.start?.utc;
    if (!startRaw) return null;
    const startDate = new Date(startRaw);
    if (isNaN(startDate.getTime())) return null;

    const endRaw = item?.end_date ?? item?.end?.local ?? item?.end?.utc;
    const endDate = endRaw ? new Date(endRaw) : undefined;

    const venue = item?.primary_venue ?? item?.venue;
    const venueName: string | undefined = venue?.name ?? undefined;
    const venueAddress: string | undefined =
      venue?.address?.localized_address_display ??
      ([
        venue?.address?.address_1,
        venue?.address?.city,
        venue?.address?.region,
      ]
        .filter(Boolean)
        .join(", ") || undefined);

    const lat = venue?.latitude ?? venue?.address?.latitude;
    const lng = venue?.longitude ?? venue?.address?.longitude;

    const isFree: boolean =
      item?.is_free ?? item?.ticket_availability?.is_free ?? false;
    const price: string | undefined = isFree
      ? "Free"
      : item?.ticket_availability?.minimum_ticket_price?.display ??
        item?.min_price?.display ??
        undefined;

    const imageUrl: string | undefined =
      item?.image?.url ??
      item?.logo?.url ??
      item?.image_url ??
      undefined;

    const sourceUrl: string =
      item?.url ??
      item?.eventbrite_url ??
      `https://www.eventbrite.com/e/${item?.id}`;

    return {
      externalId: String(item?.id ?? ""),
      title,
      description: (item?.summary ?? item?.description?.text ?? "").slice(
        0,
        1000
      ) || undefined,
      startDate,
      endDate: endDate && !isNaN(endDate.getTime()) ? endDate : undefined,
      venueName,
      venueAddress,
      latitude: lat ? parseFloat(String(lat)) : undefined,
      longitude: lng ? parseFloat(String(lng)) : undefined,
      price,
      isFree,
      imageUrl,
      sourceUrl,
      tags: ["eventbrite"],
    };
  }

  private extractFromJsonLd($: cheerio.CheerioAPI): ScrapedEvent[] {
    const events: ScrapedEvent[] = [];

    $('script[type="application/ld+json"]').each((_, el) => {
      let schema: any;
      try {
        schema = JSON.parse($(el).html() ?? "");
      } catch {
        return;
      }

      // Eventbrite uses an ItemList wrapping ListItem entries
      const listItems: any[] = schema?.itemListElement ?? [];
      const eventNodes: any[] = listItems
        .map((li: any) => li?.item ?? li)
        .filter(Boolean);

      // Also handle flat arrays or @graph of Event nodes
      const flat: any[] = Array.isArray(schema)
        ? schema
        : schema?.["@graph"] ?? [];
      for (const node of flat) {
        if (node?.["@type"] === "Event") eventNodes.push(node);
      }

      for (const node of eventNodes) {
        const title: string = node.name;
        if (!title) continue;

        const startDate = new Date(node.startDate);
        if (isNaN(startDate.getTime())) continue;

        const endDate = node.endDate ? new Date(node.endDate) : undefined;
        const loc = node.location;
        const venueName: string | undefined = loc?.name ?? undefined;
        const venueAddress: string | undefined =
          ([
            loc?.address?.streetAddress,
            loc?.address?.addressLocality,
            loc?.address?.addressRegion,
          ]
            .filter(Boolean)
            .join(", ")) || undefined;

        const offerPrice = Array.isArray(node.offers)
          ? node.offers[0]?.price
          : node.offers?.price;
        const isFree: boolean =
          node.isAccessibleForFree === true || offerPrice === "0" || offerPrice === 0;
        const price: string | undefined = isFree
          ? "Free"
          : offerPrice != null
          ? `$${offerPrice}`
          : undefined;

        events.push({
          title,
          startDate,
          endDate: endDate && !isNaN(endDate.getTime()) ? endDate : undefined,
          venueName,
          venueAddress,
          price,
          isFree,
          imageUrl: typeof node.image === "string" ? node.image : node.image?.url,
          sourceUrl: node.url ?? node["@id"] ?? this.BASE_URL,
          tags: ["eventbrite"],
        });
      }
    });

    return events;
  }
}
