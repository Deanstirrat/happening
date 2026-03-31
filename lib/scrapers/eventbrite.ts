import axios from "axios";
import * as cheerio from "cheerio";
import { BaseScraper } from "./base";
import type { ScrapedEvent } from "./base";
import { sfDateFromLocal } from "@/lib/sfDate";

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
  private readonly BASE_URLS = [
    "https://www.eventbrite.com/d/ca--san-francisco/events/",
    "https://www.eventbrite.com/d/ca--san-francisco/food-and-drink/",
    "https://www.eventbrite.com/d/ca--san-francisco/outdoors-adventure/",
    "https://www.eventbrite.com/d/ca--san-francisco/arts/",
    "https://www.eventbrite.com/d/ca--san-francisco/community--and--culture/",
    "https://www.eventbrite.com/d/ca--san-francisco/health-and-wellness/",
    "https://www.eventbrite.com/d/ca--san-francisco/nightlife/",
    "https://www.eventbrite.com/d/ca--san-francisco/music/",
    "https://www.eventbrite.com/d/ca--san-francisco/performing-arts/",
    "https://www.eventbrite.com/d/ca--san-francisco/film-media-entertainment/",
    "https://www.eventbrite.com/d/ca--san-francisco/hobbies/",
  ];

  // Track series metadata per event sourceUrl so we can filter after price enrichment
  private seriesMeta = new Map<string, { seriesId: string; numChildren: number }>();

  async scrape(): Promise<ScrapedEvent[]> {
    const seenIds = new Set<string>();
    const events: ScrapedEvent[] = [];

    for (const baseUrl of this.BASE_URLS) {
      for (let page = 1; page <= this.MAX_PAGES; page++) {
        const url = `${baseUrl}?page=${page}`;
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
          console.error(`[eventbrite] Fetch error on ${url}:`, err.message);
          break;
        }

        const $ = cheerio.load(html);
        const pageEvents = this.extractEvents($, html);

        if (pageEvents.length === 0) {
          console.log(`[eventbrite] No events on ${baseUrl} page ${page} — stopping`);
          break;
        }

        // Deduplicate within this scrape run by externalId/sourceUrl
        for (const event of pageEvents) {
          const key = event.externalId || event.sourceUrl;
          if (key && seenIds.has(key)) continue;
          if (key) seenIds.add(key);
          events.push(event);
        }
      }
    }

    // Enrich events with prices from individual event pages (discovery pages
    // no longer include price data). Fetch in batches to avoid rate-limiting.
    await this.enrichPrices(events);

    // Filter out paid high-frequency series (e.g. daily bookable services).
    // Free recurring events are kept.
    const filtered = events.filter((e) => {
      const meta = this.seriesMeta.get(e.sourceUrl);
      if (!meta || meta.numChildren <= 15) return true;
      if (e.isFree || e.price === "Free") return true;
      return false;
    });

    const dropped = events.length - filtered.length;
    if (dropped > 0) {
      console.log(`[eventbrite] Filtered out ${dropped} paid series events`);
    }

    return filtered;
  }

  private async enrichPrices(events: ScrapedEvent[]): Promise<void> {
    const CONCURRENCY = 5;
    const DELAY_MS = 200;
    const needsPrice = events.filter((e) => e.price == null);

    console.log(
      `[eventbrite] Enriching prices for ${needsPrice.length}/${events.length} events`
    );

    for (let i = 0; i < needsPrice.length; i += CONCURRENCY) {
      const batch = needsPrice.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map((event) => this.fetchEventPrice(event)));
      if (i + CONCURRENCY < needsPrice.length) {
        await new Promise((r) => setTimeout(r, DELAY_MS));
      }
    }
  }

  private async fetchEventPrice(event: ScrapedEvent): Promise<void> {
    try {
      const { data: html } = await axios.get(event.sourceUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml",
        },
        timeout: 15000,
      });

      const $ = cheerio.load(html);
      $('script[type="application/ld+json"]').each((_, el) => {
        if (event.price != null) return; // already found
        try {
          const schema = JSON.parse($(el).html() ?? "");
          if (schema?.["@type"] !== "Event") return;
          const offers = schema.offers;
          const lowPrice =
            (Array.isArray(offers) ? offers[0]?.lowPrice : offers?.lowPrice) ??
            (Array.isArray(offers) ? offers[0]?.price : offers?.price);
          if (lowPrice != null) {
            const num = parseFloat(String(lowPrice));
            if (num === 0) {
              event.price = "Free";
              event.isFree = true;
            } else if (!isNaN(num)) {
              event.price = `$${num % 1 === 0 ? num.toFixed(0) : num.toFixed(2)}`;
            }
          }
        } catch {
          // ignore parse errors
        }
      });
    } catch {
      // Silently skip — price remains undefined
    }
  }

  private extractEvents(
    $: ReturnType<typeof cheerio.load>,
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

    if (results.length > 0) {
      return results.flatMap((item: any) => {
        const event = this.parseServerEvent(item);
        return event ? [event] : [];
      });
    }

    // Newer /events/ discovery pages use a "buckets" format: themed groups of events
    const buckets: any[] = data?.buckets ?? [];
    if (buckets.length > 0) {
      const bucketEvents: any[] = buckets.flatMap((b: any) => [
        ...(b?.events ?? []),
        ...(b?.promoted_events ?? []),
      ]);
      return bucketEvents.flatMap((item: any) => {
        const event = this.parseServerEvent(item);
        return event ? [event] : [];
      });
    }

    return [];
  }

  private parseServerEvent(item: any): ScrapedEvent | null {

    const title: string = item?.name ?? item?.title;
    if (!title) return null;

    // --- Start date ---
    // Old format: item.start.utc / item.start.local
    // New format: item.start_date ("2026-04-11") + item.start_time ("21:30")
    const startUtc = item?.start?.utc;
    const startDateField: string | undefined = item?.start_date;
    const startTimeField: string | undefined = item?.start_time;

    let startDate: Date | null = null;
    if (startUtc) {
      startDate = new Date(startUtc);
    } else if (startDateField && !startDateField.includes("T") && startTimeField) {
      startDate = parseEbSeparateDateTime(startDateField, startTimeField);
    } else if (startDateField) {
      startDate = parseEbLocal(startDateField);
    } else if (item?.start?.local) {
      startDate = parseEbLocal(item.start.local);
    }
    if (!startDate || isNaN(startDate.getTime())) return null;

    // --- End date ---
    const endUtc = item?.end?.utc;
    const endDateField: string | undefined = item?.end_date;
    const endTimeField: string | undefined = item?.end_time;

    let endDate: Date | undefined = undefined;
    if (endUtc) {
      endDate = new Date(endUtc);
    } else if (endDateField && !endDateField.includes("T") && endTimeField) {
      endDate = parseEbSeparateDateTime(endDateField, endTimeField) ?? undefined;
    } else if (endDateField) {
      endDate = parseEbLocal(endDateField) ?? undefined;
    } else if (item?.end?.local) {
      endDate = parseEbLocal(item.end.local) ?? undefined;
    }

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

    // Track series metadata for post-enrichment filtering
    if (item?.series_id) {
      this.seriesMeta.set(sourceUrl, {
        seriesId: String(item.series_id),
        numChildren: item?.num_children ?? 0,
      });
    }

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

  private extractFromJsonLd($: ReturnType<typeof cheerio.load>): ScrapedEvent[] {
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

        // Use parseEbLocal so date-only strings ("2026-04-11") are treated as
        // SF local midnight instead of UTC midnight (which shows as 5 PM PDT).
        const startDate = parseEbLocal(node.startDate) ?? new Date(node.startDate);
        if (isNaN(startDate.getTime())) continue;

        const endDate = node.endDate
          ? (parseEbLocal(node.endDate) ?? new Date(node.endDate))
          : undefined;
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
          sourceUrl: node.url ?? node["@id"] ?? this.BASE_URLS[0],
          tags: ["eventbrite"],
        });
      }
    });

    return events;
  }
}

// Eventbrite's .local field is venue-local time with no TZ offset — treat as SF local.
// Also handles date-only strings ("2026-04-11") by defaulting to midnight SF local.
function parseEbLocal(raw: string): Date | null {
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (!m) return null;
  return sfDateFromLocal(+m[1], +m[2], +m[3], +(m[4] ?? 0), +(m[5] ?? 0));
}

// Combines new Eventbrite separate date + time fields (e.g. "2026-04-11" + "21:30")
function parseEbSeparateDateTime(dateStr: string, timeStr: string): Date | null {
  const dm = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!dm) return null;
  const tm = timeStr.match(/^(\d{1,2}):(\d{2})/);
  const hours = tm ? +tm[1] : 0;
  const minutes = tm ? +tm[2] : 0;
  return sfDateFromLocal(+dm[1], +dm[2], +dm[3], hours, minutes);
}
