import * as cheerio from "cheerio";
import { BaseScraper } from "./base";
import type { ScrapedEvent } from "./base";
import { sfDateFromLocal } from "@/lib/sfDate";
import axios from "axios";

/**
 * Eventbrite SF — eventbrite.com/d/ca--san-francisco/events/
 *
 * Eventbrite removed public API search in 2023 and has since moved to
 * full client-side rendering — window.__SERVER_DATA__ is no longer embedded
 * in the initial HTML. Event data is now fetched via their internal API
 * after JS hydration.
 *
 * Strategy: use Playwright (stealth) to load each discovery page, then
 * intercept the JSON API response that carries event data. Falls back to
 * evaluating window.__SERVER_DATA__ (in case they re-add SSR) and then to
 * JSON-LD in the rendered DOM.
 */
export class EventbriteScraper extends BaseScraper {
  readonly sourceSlug = "eventbrite";

  protected readonly BASE_URLS = [
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

  private seriesMeta = new Map<string, { seriesId: string; numChildren: number }>();

  async scrape(): Promise<ScrapedEvent[]> {
    const { chromium } = await import("playwright-extra");
    const StealthPlugin = (await import("puppeteer-extra-plugin-stealth")).default;
    chromium.use(StealthPlugin());

    const browser = await chromium.launch({ headless: true, timeout: 60000 });
    const seenIds = new Set<string>();
    const events: ScrapedEvent[] = [];

    try {
      for (const baseUrl of this.BASE_URLS) {
        const pageEvents = await this.scrapeUrl(browser, baseUrl);
        for (const event of pageEvents) {
          const key = event.externalId || event.sourceUrl;
          if (key && seenIds.has(key)) continue;
          if (key) seenIds.add(key);
          events.push(event);
        }
      }
    } finally {
      await browser.close();
    }

    // Filter spam
    const preSpam = events.length;
    const cleaned = events.filter((e) => {
      const reason = isEventbriteSpam(e);
      if (reason) {
        console.log(`[eventbrite] Spam: "${e.title}" — ${reason}`);
        return false;
      }
      return true;
    });
    if (preSpam - cleaned.length > 0) {
      console.log(`[eventbrite] Filtered ${preSpam - cleaned.length} spam events`);
    }

    await this.enrichPrices(cleaned);

    // Drop paid high-frequency series (free recurring events are kept)
    const filtered = cleaned.filter((e) => {
      const meta = this.seriesMeta.get(e.sourceUrl);
      if (!meta || meta.numChildren <= 52) return true;
      if (e.isFree || e.price === "Free") return true;
      return false;
    });

    const dropped = events.length - filtered.length;
    if (dropped > 0) {
      console.log(`[eventbrite] Filtered out ${dropped} paid series events`);
    }

    return filtered;
  }

  private async scrapeUrl(browser: any, url: string): Promise<ScrapedEvent[]> {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    });
    const page = await context.newPage();
    page.setDefaultTimeout(30000);

    // Block media/fonts to reduce load time — we only need the JSON data
    await page.route(
      /\.(png|jpe?g|gif|svg|webp|css|woff2?|ttf|eot)(\?.*)?$/i,
      (route: any) => route.abort()
    );

    // Capture any JSON responses from Eventbrite that look like event listings
    const capturedJson: any[] = [];
    const inflight: Promise<void>[] = [];

    page.on("response", (response: any) => {
      const p = (async () => {
        try {
          if (!response.url().includes("eventbrite.com")) return;
          const ct = response.headers()["content-type"] ?? "";
          if (!ct.includes("json")) return;
          const json = await response.json();
          if (this.looksLikeEventData(json)) capturedJson.push(json);
        } catch {
          // ignore parse errors
        }
      })();
      inflight.push(p);
    });

    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
      await Promise.allSettled(inflight);
    } catch (err: any) {
      console.error(`[eventbrite] Failed to load ${url}:`, err.message);
      await context.close();
      return [];
    }

    let events: ScrapedEvent[] = [];

    // Strategy 1: window.__SERVER_DATA__ populated after JS hydration
    try {
      const serverData = await page.evaluate(() => (window as any).__SERVER_DATA__);
      if (serverData) events = this.extractFromServerData(serverData);
    } catch {
      // not available
    }

    // Strategy 2: intercepted API JSON responses
    if (events.length === 0) {
      for (const json of capturedJson) {
        const parsed = this.extractFromServerData(json);
        if (parsed.length > 0) {
          events = parsed;
          break;
        }
      }
    }

    // Strategy 3: JSON-LD in the rendered DOM
    if (events.length === 0) {
      const html = await page.content();
      events = this.extractFromJsonLd(cheerio.load(html));
    }

    await context.close();

    console.log(`[eventbrite] ${url} → ${events.length} events`);
    return events;
  }

  private looksLikeEventData(json: any): boolean {
    return !!(
      json?.search_data?.events?.results?.length ||
      json?.events?.results?.length ||
      json?.components?.search_results?.events?.length ||
      (Array.isArray(json?.buckets) && json.buckets.length > 0) ||
      (Array.isArray(json?.results) && json.results.some((r: any) => r?.id && (r?.name ?? r?.title)))
    );
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

    // Flat results array (intercepted API response format)
    if (Array.isArray(data?.results)) {
      return data.results.flatMap((item: any) => {
        const event = this.parseServerEvent(item);
        return event ? [event] : [];
      });
    }

    return [];
  }

  private parseServerEvent(item: any): ScrapedEvent | null {
    if (item?.is_online_event === true || item?.online_event === true) return null;

    const title: string = item?.name ?? item?.title;
    if (!title) return null;

    // --- Start date ---
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

    if (venueAddress && !isLikelyBayArea(venueAddress)) return null;

    const isFree: boolean =
      item?.is_free ?? item?.ticket_availability?.is_free ?? false;
    const price: string | undefined = isFree
      ? "Free"
      : item?.ticket_availability?.minimum_ticket_price?.display ??
        item?.min_price?.display ??
        undefined;

    const imageUrl: string | undefined =
      item?.image?.original?.url ??
      item?.image?.url ??
      item?.logo?.original?.url ??
      item?.logo?.url ??
      item?.image_url ??
      undefined;

    const sourceUrl: string =
      item?.url ??
      item?.eventbrite_url ??
      `https://www.eventbrite.com/e/${item?.id}`;

    if (item?.series_id) {
      this.seriesMeta.set(sourceUrl, {
        seriesId: String(item.series_id),
        numChildren: item?.num_children ?? 0,
      });
    }

    return {
      externalId: String(item?.id ?? ""),
      title,
      description: (item?.summary ?? item?.description?.text ?? "").slice(0, 1000) || undefined,
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

      const listItems: any[] = schema?.itemListElement ?? [];
      const eventNodes: any[] = listItems
        .map((li: any) => li?.item ?? li)
        .filter(Boolean);

      const flat: any[] = Array.isArray(schema)
        ? schema
        : schema?.["@graph"] ?? [];
      for (const node of flat) {
        if (node?.["@type"] === "Event") eventNodes.push(node);
      }

      for (const node of eventNodes) {
        const title: string = node.name;
        if (!title) continue;

        const startDate = parseEbLocal(node.startDate) ?? new Date(node.startDate);
        if (isNaN(startDate.getTime())) continue;

        const endDate = node.endDate
          ? (parseEbLocal(node.endDate) ?? new Date(node.endDate))
          : undefined;
        const loc = node.location;
        if (loc?.["@type"] === "VirtualLocation") continue;
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
        if (event.price != null) return;
        try {
          const schema = JSON.parse($(el).html() ?? "");
          const schemaType: string = schema?.["@type"] ?? "";
          if (!schemaType.endsWith("Event")) return;
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
}

// ── Spam filtering ──────────────────────────────────────────────────────────

const SPAM_VENUE_PATTERNS = [
  "regus",
  "for venue details reach us at",
  "learnerring",
  "mountskills",
  "adeptskil",
];

const SPAM_VENUE_EXACT = new Set(["mid-market"]);

const SPAM_TITLE_PATTERNS: RegExp[] = [
  /classpop/i,
  /cozymeal/i,
];

function isEventbriteSpam(event: ScrapedEvent): string | null {
  const venueLower = (event.venueName ?? "").toLowerCase();
  for (const p of SPAM_VENUE_PATTERNS) {
    if (venueLower.includes(p)) return `spam venue: ${p}`;
  }
  const venueNorm = venueLower.replace(/[^a-z0-9-]/g, "");
  if (SPAM_VENUE_EXACT.has(venueNorm)) return `spam venue (exact): ${event.venueName}`;
  for (const re of SPAM_TITLE_PATTERNS) {
    if (re.test(event.title)) return `spam title: ${re.source}`;
  }
  return null;
}

// ── Geography ───────────────────────────────────────────────────────────────

const BAY_AREA_TERMS = [
  "san francisco", " sf,", ",sf,", "sf ", "oakland", "berkeley", "san jose",
  "palo alto", "mountain view", "sunnyvale", "santa clara", "fremont",
  "hayward", "daly city", "south san francisco", "marin", "sausalito",
  "mill valley", "san mateo", "redwood city", "emeryville", "alameda",
  "san leandro", "richmond", " ca ", ", ca", ", ca,", "94",
];

function isLikelyBayArea(addr: string): boolean {
  const lower = addr.toLowerCase();
  return BAY_AREA_TERMS.some((t) => lower.includes(t));
}

function parseEbLocal(raw: string): Date | null {
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (!m) return null;
  return sfDateFromLocal(+m[1], +m[2], +m[3], +(m[4] ?? 0), +(m[5] ?? 0));
}

function parseEbSeparateDateTime(dateStr: string, timeStr: string): Date | null {
  const dm = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!dm) return null;
  const tm = timeStr.match(/^(\d{1,2}):(\d{2})/);
  const hours = tm ? +tm[1] : 0;
  const minutes = tm ? +tm[2] : 0;
  return sfDateFromLocal(+dm[1], +dm[2], +dm[3], hours, minutes);
}
