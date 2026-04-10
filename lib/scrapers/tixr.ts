import { BaseScraper } from "./base";
import type { ScrapedEvent } from "./base";

/**
 * Tixr SF — tixr.com/search?q=san+francisco
 *
 * Tixr is a JS-heavy SPA with aggressive bot detection (403 on plain HTTP).
 * Strategy: Playwright + stealth plugin to bypass Cloudflare, then intercept
 * the internal API responses the React frontend fetches (JSON) rather than
 * parsing the DOM.
 *
 * The site's internal API lives at /groups/api/v1/* and returns JSON arrays.
 * We capture responses whose URL matches that pattern and contains event-like
 * objects with a "name" or "title" and a "start_at"/"start_date" field.
 *
 * NOTE: On first run, set DEBUG_REQUESTS=1 to log all captured API URLs so
 * you can identify the right endpoint if the auto-detection misses anything.
 */

// Tixr search URL — city filter via query param
const SEARCH_URL = "https://www.tixr.com/search?q=san+francisco";

// Patterns to identify API responses worth inspecting
const API_URL_PATTERNS = [
  "/groups/api/",
  "/api/v1/",
  "/api/v2/",
  "api.tixr.com",
];

// SF-area venue/city terms for geo-filtering events returned without explicit city
const SF_TERMS = [
  "san francisco",
  " sf,",
  ", sf",
  "oakland",
  "berkeley",
  "san jose",
  "daly city",
  "south san francisco",
  "mission district",
  "soma",
  "tenderloin",
  "castro",
  "haight",
  "richmond",
  "sunset",
  "marina",
  "94",
];

function isSfVenue(address?: string, city?: string): boolean {
  const text = `${address ?? ""} ${city ?? ""}`.toLowerCase();
  if (!text.trim()) return true; // no geo info — assume SF (it's a SF search)
  return SF_TERMS.some((t) => text.includes(t));
}

export class TixrScraper extends BaseScraper {
  readonly sourceSlug = "tixr";

  async scrape(): Promise<ScrapedEvent[]> {
    const { chromium } = await import("playwright-extra");
    const StealthPlugin = (await import("puppeteer-extra-plugin-stealth")).default;
    chromium.use(StealthPlugin());

    const browser = await chromium.launch({ headless: true, timeout: 60000 });
    const page = await browser.newPage();
    page.setDefaultTimeout(60000);
    await page.setViewportSize({ width: 1280, height: 900 });

    // Collect raw API response bodies that look like event lists
    const capturedEventArrays: any[][] = [];
    const debug = process.env.DEBUG_REQUESTS === "1";

    page.on("response", async (response) => {
      const url = response.url();

      if (debug) {
        // Log every non-asset response to identify the right API endpoint
        const isAsset = /\.(js|css|png|jpg|jpeg|gif|svg|woff|ico)(\?|$)/i.test(url);
        if (!isAsset) {
          console.log(`[tixr] response: ${response.status()} ${url.slice(0, 120)}`);
        }
      }

      const isApiCall = API_URL_PATTERNS.some((p) => url.includes(p));
      if (!isApiCall) return;

      if (response.status() !== 200) return;

      const ct = response.headers()["content-type"] ?? "";
      if (!ct.includes("json")) return;

      try {
        const json = await response.json();
        const arr = extractEventArray(json);
        if (arr && arr.length > 0) {
          console.log(`[tixr] Captured ${arr.length} events from: ${url}`);
          capturedEventArrays.push(arr);
        }
      } catch {
        // Not parseable JSON — skip
      }
    });

    try {
      console.log(`[tixr] Navigating to ${SEARCH_URL}`);
      await page.goto(SEARCH_URL, { waitUntil: "domcontentloaded", timeout: 40000 });

      // Wait for the SPA to hydrate and fire API calls. The selector targets
      // generic event card patterns; adjust if Tixr changes its markup.
      await Promise.race([
        page.waitForSelector('[data-testid*="event"], [class*="EventCard"], [class*="event-card"], a[href*="/events/"]', {
          timeout: 20000,
        }),
        page.waitForTimeout(20000),
      ]).catch(() => {});

      // Extra pause to let lazy-loaded/paginated API calls complete
      await page.waitForTimeout(2000);

      if (debug) {
        const pageTitle = await page.title();
        const pageUrl = page.url();
        console.log(`[tixr] Page title: "${pageTitle}" — url: ${pageUrl}`);
      }

      // If network interception captured events, use those
      if (capturedEventArrays.length > 0) {
        const events = capturedEventArrays.flat().flatMap((raw) => {
          const e = this.parseApiEvent(raw);
          return e ? [e] : [];
        });
        // Dedupe by externalId
        const seen = new Set<string>();
        return events.filter((e) => {
          const key = e.externalId ?? e.sourceUrl;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      }

      // Fallback: DOM scraping if network interception didn't capture anything
      console.log("[tixr] No API events captured — falling back to DOM scrape");
      return await this.scrapeFromDom(page);
    } finally {
      await browser.close();
    }
  }

  private parseApiEvent(raw: any): ScrapedEvent | null {
    // Tixr's internal API uses various field names across versions; try all known shapes.
    const id: string | undefined =
      String(raw?.id ?? raw?.event_id ?? "").trim() || undefined;

    const title: string | undefined =
      raw?.name ?? raw?.title ?? raw?.event_name;
    if (!title) return null;

    // --- Start date ---
    const startRaw: string | undefined =
      raw?.start_at ??
      raw?.start_date ??
      raw?.starts_at ??
      raw?.date ??
      raw?.event_start;

    if (!startRaw) return null;
    const startDate = new Date(startRaw);
    if (isNaN(startDate.getTime())) return null;

    // Skip past events
    if (startDate < new Date()) return null;

    // --- End date ---
    const endRaw: string | undefined =
      raw?.end_at ?? raw?.end_date ?? raw?.ends_at ?? raw?.event_end;
    const endDate = endRaw ? new Date(endRaw) : undefined;

    // --- Venue ---
    const venue = raw?.venue ?? raw?.location ?? raw?.primary_venue ?? {};
    const venueName: string | undefined =
      (typeof venue === "string" ? venue : venue?.name ?? venue?.venue_name) ||
      undefined;
    const venueAddress: string | undefined =
      typeof venue === "object"
        ? ([venue?.address, venue?.city, venue?.state]
            .filter(Boolean)
            .join(", ") || undefined)
        : undefined;
    const venueCity: string | undefined =
      typeof venue === "object" ? venue?.city : undefined;

    // Skip non-SF events
    if (!isSfVenue(venueAddress, venueCity)) return null;

    // --- Price ---
    const lowestPrice: number | undefined =
      raw?.lowest_price ??
      raw?.min_price ??
      raw?.price ??
      raw?.ticket_price;
    const isFree =
      raw?.is_free === true ||
      raw?.free === true ||
      lowestPrice === 0;
    const price: string | undefined = isFree
      ? "Free"
      : typeof lowestPrice === "number" && lowestPrice > 0
      ? `$${lowestPrice % 1 === 0 ? lowestPrice.toFixed(0) : lowestPrice.toFixed(2)}`
      : undefined;

    // --- Image ---
    const imageUrl: string | undefined =
      raw?.cover_photo ??
      raw?.image_url ??
      raw?.image ??
      raw?.cover_image ??
      raw?.thumbnail;

    // --- Source URL ---
    // Tixr event URL pattern: /groups/{group-slug}/events/{id}/{slug}
    const groupSlug: string | undefined =
      raw?.group?.slug ?? raw?.organizer?.slug ?? raw?.group_slug;
    const eventSlug: string | undefined = raw?.slug ?? raw?.url_slug;
    let sourceUrl: string;
    if (groupSlug && id && eventSlug) {
      sourceUrl = `https://www.tixr.com/groups/${groupSlug}/events/${id}/${eventSlug}`;
    } else if (groupSlug && id) {
      sourceUrl = `https://www.tixr.com/groups/${groupSlug}/events/${id}`;
    } else if (raw?.url) {
      sourceUrl = raw.url.startsWith("http")
        ? raw.url
        : `https://www.tixr.com${raw.url}`;
    } else if (id) {
      sourceUrl = `https://www.tixr.com/events/${id}`;
    } else {
      return null; // can't construct a URL — skip
    }

    return {
      externalId: id,
      title,
      startDate,
      endDate: endDate && !isNaN(endDate.getTime()) ? endDate : undefined,
      venueName,
      venueAddress,
      price,
      isFree: isFree || false,
      imageUrl,
      sourceUrl,
      tags: ["tixr"],
    };
  }

  private async scrapeFromDom(page: any): Promise<ScrapedEvent[]> {
    // Log page content snippet to help diagnose structure changes
    const snippet = await page.evaluate(() => document.body?.innerText?.slice(0, 500));
    console.log("[tixr] DOM snippet:", snippet);

    const rawLinks = await page.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="/events/"]'));
      return anchors.map((a) => ({
        href: a.href,
        text: (a as HTMLElement).innerText?.trim() ?? "",
      }));
    });

    if (rawLinks.length === 0) {
      console.warn("[tixr] DOM scrape: no event links found — the page structure may have changed");
      console.warn("[tixr] Set DEBUG_REQUESTS=1 and re-run to inspect API calls");
      return [];
    }

    console.log(`[tixr] DOM scrape: found ${rawLinks.length} event link(s)`);

    // DOM events lack structured data — just return minimal stubs for now
    // and rely on the runner's meta backfill (og:image, og:description) to enrich them.
    const events: ScrapedEvent[] = [];
    for (const { href, text } of rawLinks) {
      if (!href.includes("tixr.com")) continue;
      const lines = text.split("\n").map((l: string) => l.trim()).filter(Boolean);
      const title = lines[0];
      if (!title) continue;

      // Try to extract a date from the text lines
      let startDate: Date | null = null;
      for (const line of lines.slice(1)) {
        const d = tryParseDate(line);
        if (d) { startDate = d; break; }
      }
      if (!startDate) continue;

      events.push({
        title,
        startDate,
        sourceUrl: href,
        tags: ["tixr"],
      });
    }

    return events;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Walk a JSON value and find the first array that looks like a list of events
 * (objects with a name/title field and a date field).
 */
function extractEventArray(json: any): any[] | null {
  if (Array.isArray(json)) {
    if (json.length > 0 && looksLikeEvent(json[0])) return json;
    // Array of arrays (paginated?)
    for (const item of json) {
      if (Array.isArray(item) && item.length > 0 && looksLikeEvent(item[0])) return item;
    }
    return null;
  }

  if (json && typeof json === "object") {
    // Common wrapper keys: { data: [...] }, { events: [...] }, { results: [...] }
    for (const key of ["events", "data", "results", "items", "records"]) {
      if (Array.isArray(json[key]) && json[key].length > 0 && looksLikeEvent(json[key][0])) {
        return json[key];
      }
    }
    // Recurse one level into nested objects
    for (const val of Object.values(json)) {
      if (val && typeof val === "object") {
        const found = extractEventArray(val);
        if (found) return found;
      }
    }
  }

  return null;
}

function looksLikeEvent(obj: any): boolean {
  if (!obj || typeof obj !== "object") return false;
  const hasTitle = obj.name || obj.title || obj.event_name;
  const hasDate =
    obj.start_at || obj.start_date || obj.starts_at || obj.date || obj.event_start;
  return Boolean(hasTitle && hasDate);
}

const MONTH_ABBR: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function tryParseDate(text: string): Date | null {
  // ISO-style: "2026-04-15"
  const iso = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const d = new Date(`${iso[0]}T00:00:00`);
    if (!isNaN(d.getTime())) return d;
  }
  // "Apr 15, 2026" or "Apr 15 2026"
  const human = text.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\.?\s+(\d{1,2}),?\s+(\d{4})\b/i);
  if (human) {
    const m = MONTH_ABBR[human[1].toLowerCase().slice(0, 3)];
    if (m) {
      const d = new Date(+human[3], m - 1, +human[2]);
      if (!isNaN(d.getTime())) return d;
    }
  }
  return null;
}
