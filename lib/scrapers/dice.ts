import { BaseScraper } from "./base";
import type { ScrapedEvent } from "./base";

const BROWSE_URL = "https://dice.fm/browse/sanfrancisco-60dee10ce5e339918757f0db";

/**
 * Dice.fm San Francisco — dice.fm/browse/sanfrancisco-...
 *
 * Dice is a React SPA. We use Playwright and capture JSON API responses
 * emitted while the browse page loads. The response shape is flexible
 * (Dice has iterated their API multiple times) so we probe several well-known
 * key names and also do a bounded walk of __NEXT_DATA__ as a fallback.
 */
export class DiceScraper extends BaseScraper {
  readonly sourceSlug = "dice";

  async scrape(): Promise<ScrapedEvent[]> {
    const { chromium } = await import("playwright-extra");
    const StealthPlugin = (await import("puppeteer-extra-plugin-stealth")).default;
    chromium.use(StealthPlugin());
    const browser = await chromium.launch({ headless: true, timeout: 60000 });
    const page = await browser.newPage();

    const rawEvents: unknown[] = [];

    try {
      page.on("response", async (response) => {
        const url = response.url();
        if (!/dice\.fm/i.test(url)) return;
        const ct = response.headers()["content-type"] ?? "";
        if (!ct.includes("json")) return;
        try {
          const json = await response.json();
          const found = this.extractEventArray(json);
          if (found.length > 0) rawEvents.push(...found);
        } catch {}
      });

      await page.goto(BROWSE_URL, { waitUntil: "networkidle", timeout: 60000 });

      // Fallback: walk __NEXT_DATA__ if API interception yielded nothing
      if (rawEvents.length === 0) {
        const nextDataText = await page.evaluate(() => {
          const el = document.querySelector<HTMLScriptElement>("script#__NEXT_DATA__");
          return el?.textContent ?? null;
        }).catch(() => null);
        if (nextDataText) {
          try {
            const found = this.walkForEventArray(JSON.parse(nextDataText), 0);
            rawEvents.push(...found);
          } catch {}
        }
      }

      if (rawEvents.length === 0) {
        console.warn("[dice] No events captured — site may have changed structure");
        return [];
      }

      return rawEvents
        .map((e) => this.toScrapedEvent(e))
        .filter((e): e is ScrapedEvent => e !== null);
    } finally {
      await browser.close();
    }
  }

  // ── Parsers ──────────────────────────────────────────────────────────────

  private extractEventArray(json: unknown): unknown[] {
    if (Array.isArray(json) && json.length > 0 && this.looksLikeEvent(json[0])) return json;
    if (typeof json !== "object" || json === null) return [];
    const obj = json as Record<string, unknown>;
    for (const key of ["data", "events", "items", "results", "payload", "event_listings"]) {
      const val = obj[key];
      if (Array.isArray(val) && val.length > 0 && this.looksLikeEvent(val[0])) return val;
    }
    return [];
  }

  private walkForEventArray(obj: unknown, depth: number): unknown[] {
    if (depth > 6) return [];
    if (Array.isArray(obj) && obj.length > 0 && this.looksLikeEvent(obj[0])) return obj;
    if (typeof obj === "object" && obj !== null) {
      return Object.values(obj as object).flatMap((v) => this.walkForEventArray(v, depth + 1));
    }
    return [];
  }

  private looksLikeEvent(obj: unknown): boolean {
    if (typeof obj !== "object" || obj === null) return false;
    const o = obj as Record<string, unknown>;
    const hasName = typeof o.name === "string" || typeof o.title === "string";
    const datesObj = o.dates as Record<string, unknown> | null | undefined;
    const hasDate =
      typeof o.date === "string" ||
      typeof o.start_date === "string" ||
      typeof o.startDate === "string" ||
      typeof o.event_date === "string" ||
      (typeof datesObj === "object" && datesObj !== null && typeof datesObj.event_start_date === "string");
    return hasName && hasDate;
  }

  private toScrapedEvent(raw: unknown): ScrapedEvent | null {
    if (typeof raw !== "object" || raw === null) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const e = raw as Record<string, any>;

    const title: string = e.name ?? e.title;
    if (typeof title !== "string" || !title.trim()) return null;

    // dates may be nested under e.dates (current Dice API) or flat
    const datesObj = (typeof e.dates === "object" && e.dates !== null) ? e.dates as Record<string, unknown> : null;
    const dateStr: string = datesObj?.event_start_date ?? e.date ?? e.start_date ?? e.startDate ?? e.event_date;
    if (!dateStr) return null;
    const startDate = new Date(dateStr);
    if (isNaN(startDate.getTime())) return null;
    if (startDate.getTime() < Date.now() - 86_400_000) return null;

    let endDate: Date | undefined;
    const endStr: string = datesObj?.event_end_date ?? e.end_date ?? e.endDate;
    if (endStr) {
      const d = new Date(endStr);
      if (!isNaN(d.getTime())) endDate = d;
    }

    // Venue — may be an array (current) or a single object/flat fields
    const venueArr: Record<string, unknown>[] = Array.isArray(e.venues) ? e.venues : [];
    const venueObj = venueArr[0] ?? e.venue ?? e.location ?? {};
    const venueName: string | undefined =
      (typeof e.location_name === "string" ? e.location_name : undefined) ??
      (typeof venueObj.name === "string" ? venueObj.name : undefined) ??
      undefined;
    const venueAddress: string | undefined =
      (typeof e.address === "string" ? e.address : undefined) ??
      (typeof venueObj.address === "string" ? venueObj.address : undefined) ??
      (typeof venueObj.full_address === "string" ? venueObj.full_address : undefined) ??
      undefined;
    const venueLocation = (typeof venueObj.location === "object" && venueObj.location !== null)
      ? venueObj.location as Record<string, unknown> : venueObj;
    const latitude: number | undefined =
      typeof venueLocation.lat === "number" ? venueLocation.lat :
      typeof venueLocation.latitude === "number" ? venueLocation.latitude : undefined;
    const longitude: number | undefined =
      typeof venueLocation.lng === "number" ? venueLocation.lng :
      typeof venueLocation.longitude === "number" ? venueLocation.longitude : undefined;

    // Source URL — prefer perm_name slug, then explicit url fields, then id
    let sourceUrl = BROWSE_URL;
    const rawUrl: string = e.url ?? e.event_url ?? e.permalink ?? "";
    if (rawUrl) {
      sourceUrl = rawUrl.startsWith("http") ? rawUrl : `https://dice.fm${rawUrl}`;
    } else if (typeof e.perm_name === "string") {
      sourceUrl = `https://dice.fm/event/${e.perm_name}`;
    } else if (e.id) {
      sourceUrl = `https://dice.fm/event/${e.id}`;
    }

    // Image — current API returns an object {square, landscape, portrait}
    let imageUrl: string | undefined;
    if (typeof e.images === "object" && e.images !== null && !Array.isArray(e.images)) {
      const imgs = e.images as Record<string, unknown>;
      imageUrl = (typeof imgs.landscape === "string" ? imgs.landscape : undefined) ??
                 (typeof imgs.square === "string" ? imgs.square : undefined) ?? undefined;
    } else if (typeof e.image_url === "string") {
      imageUrl = e.image_url;
    } else if (typeof e.banner === "string") {
      imageUrl = e.banner;
    } else if (Array.isArray(e.images) && e.images.length > 0) {
      const img = e.images[0];
      imageUrl = typeof img === "string" ? img : (img.url ?? img.src ?? undefined);
    }

    // Price — current API: e.price.amount_from in cents
    let price: string | undefined;
    let isFree = false;
    const priceObj = (typeof e.price === "object" && e.price !== null) ? e.price as Record<string, unknown> : null;
    const amountFrom: number | null = typeof priceObj?.amount_from === "number" ? priceObj.amount_from : null;
    const ticketTypes: Record<string, unknown>[] = e.ticket_types ?? e.ticketTypes ?? [];
    if (amountFrom !== null) {
      if (amountFrom === 0) {
        isFree = true;
        price = "Free";
      } else {
        price = `$${(amountFrom / 100).toFixed(2)}`;
      }
    } else if (ticketTypes.length > 0) {
      const amounts = ticketTypes
        .map((tt) => {
          const p = tt.price ?? tt.face_value ?? tt.total;
          return typeof p === "number" ? p : null;
        })
        .filter((p): p is number => p !== null);
      if (amounts.length > 0) {
        const minAmount = Math.min(...amounts);
        if (minAmount === 0) {
          isFree = true;
          price = "Free";
        } else {
          const dollars = minAmount > 1000 ? minAmount / 100 : minAmount;
          price = `$${dollars.toFixed(2)}`;
        }
      }
    }

    // Performers — current API: summary_lineup.top_artists, or legacy artists/lineup
    const performers: string[] = [];
    const topArtists = e.summary_lineup?.top_artists;
    if (Array.isArray(topArtists)) {
      for (const a of topArtists) {
        const name = typeof a === "string" ? a : a?.name;
        if (typeof name === "string") performers.push(name);
      }
    }
    if (Array.isArray(e.artists)) {
      for (const a of e.artists) {
        const name = typeof a === "string" ? a : a?.name;
        if (typeof name === "string" && !performers.includes(name)) performers.push(name);
      }
    }
    if (Array.isArray(e.lineup)) {
      for (const l of e.lineup) {
        const name = typeof l === "string" ? l : l?.name;
        if (typeof name === "string" && !performers.includes(name)) performers.push(name);
      }
    }

    // Description — current API: e.about is {description: string}
    let description: string | undefined;
    const aboutObj = (typeof e.about === "object" && e.about !== null) ? e.about as Record<string, unknown> : null;
    const rawDesc = (typeof aboutObj?.description === "string" ? aboutObj.description : null)
      ?? e.description ?? e.summary;
    if (typeof rawDesc === "string") {
      description = rawDesc.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 500) || undefined;
    }

    return {
      externalId: e.id ? String(e.id) : undefined,
      title: title.trim(),
      description,
      startDate,
      endDate,
      venueName,
      venueAddress,
      latitude: latitude != null && !isNaN(latitude) ? latitude : undefined,
      longitude: longitude != null && !isNaN(longitude) ? longitude : undefined,
      imageUrl,
      price,
      isFree,
      sourceUrl,
      tags: ["music", "dice"],
      performers,
    };
  }
}
