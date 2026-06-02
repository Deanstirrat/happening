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
    const hasDate =
      typeof o.date === "string" ||
      typeof o.start_date === "string" ||
      typeof o.startDate === "string" ||
      typeof o.event_date === "string";
    return hasName && hasDate;
  }

  private toScrapedEvent(raw: unknown): ScrapedEvent | null {
    if (typeof raw !== "object" || raw === null) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const e = raw as Record<string, any>;

    const title: string = e.name ?? e.title;
    if (typeof title !== "string" || !title.trim()) return null;

    const dateStr: string = e.date ?? e.start_date ?? e.startDate ?? e.event_date;
    if (!dateStr) return null;
    const startDate = new Date(dateStr);
    if (isNaN(startDate.getTime())) return null;
    if (startDate.getTime() < Date.now() - 86_400_000) return null;

    let endDate: Date | undefined;
    const endStr: string = e.end_date ?? e.endDate;
    if (endStr) {
      const d = new Date(endStr);
      if (!isNaN(d.getTime())) endDate = d;
    }

    // Venue — may be nested or flat
    const venueObj = e.venue ?? e.location ?? {};
    const venueName: string | undefined =
      (typeof e.location_name === "string" ? e.location_name : undefined) ??
      (typeof venueObj.name === "string" ? venueObj.name : undefined) ??
      undefined;
    const venueAddress: string | undefined =
      (typeof e.address === "string" ? e.address : undefined) ??
      (typeof venueObj.address === "string" ? venueObj.address : undefined) ??
      (typeof venueObj.full_address === "string" ? venueObj.full_address : undefined) ??
      undefined;
    const latitude: number | undefined =
      typeof venueObj.lat === "number" ? venueObj.lat :
      typeof venueObj.latitude === "number" ? venueObj.latitude : undefined;
    const longitude: number | undefined =
      typeof venueObj.lng === "number" ? venueObj.lng :
      typeof venueObj.longitude === "number" ? venueObj.longitude : undefined;

    // Source URL — Dice event paths are like /event/{slug}
    let sourceUrl = BROWSE_URL;
    const rawUrl: string = e.url ?? e.event_url ?? e.permalink ?? "";
    if (rawUrl) {
      sourceUrl = rawUrl.startsWith("http") ? rawUrl : `https://dice.fm${rawUrl}`;
    } else if (e.id) {
      sourceUrl = `https://dice.fm/event/${e.id}`;
    }

    // Image
    let imageUrl: string | undefined;
    if (typeof e.image_url === "string") {
      imageUrl = e.image_url;
    } else if (typeof e.banner === "string") {
      imageUrl = e.banner;
    } else if (Array.isArray(e.images) && e.images.length > 0) {
      const img = e.images[0];
      imageUrl = typeof img === "string" ? img : (img.url ?? img.src ?? undefined);
    }

    // Price — Dice stores prices in the smallest currency unit (pence/cents)
    let price: string | undefined;
    let isFree = false;
    const ticketTypes: Record<string, unknown>[] = e.ticket_types ?? e.ticketTypes ?? [];
    if (ticketTypes.length > 0) {
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
          // Heuristic: values > 1000 are likely in pence/cents
          const dollars = minAmount > 1000 ? minAmount / 100 : minAmount;
          price = `$${dollars.toFixed(2)}`;
        }
      }
    }

    // Performers
    const performers: string[] = [];
    if (Array.isArray(e.artists)) {
      for (const a of e.artists) {
        const name = typeof a === "string" ? a : a?.name;
        if (typeof name === "string") performers.push(name);
      }
    }
    if (Array.isArray(e.lineup)) {
      for (const l of e.lineup) {
        const name = typeof l === "string" ? l : l?.name;
        if (typeof name === "string" && !performers.includes(name)) performers.push(name);
      }
    }

    // Description
    let description: string | undefined;
    const rawDesc = e.description ?? e.summary ?? e.about;
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
