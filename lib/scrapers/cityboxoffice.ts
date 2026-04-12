import axios from "axios";
import { BaseScraper } from "./base";
import type { ScrapedEvent } from "./base";
import { sfDateFromLocal } from "@/lib/sfDate";

const API_URL =
  "https://www.cityboxoffice.com/include/widgets/events/performancelist.asp";
const BASE_URL = "https://www.cityboxoffice.com";
const IMAGE_BASE = `${BASE_URL}/UPLImage/`;

// "Sunday, April 12, 2026 3:00:00 PM"
const MONTH_NAMES: Record<string, number> = {
  January: 1, February: 2, March: 3, April: 4, May: 5, June: 6,
  July: 7, August: 8, September: 9, October: 10, November: 11, December: 12,
};

function parseCboDate(str: string): Date | null {
  if (!str) return null;
  const m = str.match(
    /^[A-Za-z]+,\s+([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s+(AM|PM)$/i
  );
  if (!m) return null;
  const month = MONTH_NAMES[m[1]];
  if (!month) return null;
  const day = parseInt(m[2]);
  const year = parseInt(m[3]);
  let hours = parseInt(m[4]);
  const minutes = parseInt(m[5]);
  const period = m[7].toUpperCase();
  if (period === "PM" && hours !== 12) hours += 12;
  if (period === "AM" && hours === 12) hours = 0;
  return sfDateFromLocal(year, month, day, hours, minutes);
}

function formatPrice(min: number | null, max: number | null): string | undefined {
  if (min == null && max == null) return undefined;
  if (min === max || max == null) return `$${min}`;
  if (min == null) return `$${max}`;
  return `$${min}–$${max}`;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * City Box Office — cityboxoffice.com
 *
 * Ticketing platform (accesso ShoWare) for SF classical music venues:
 * Davies Symphony Hall, Herbst Theatre, YBCA, Brava Theater, etc.
 *
 * Data comes from the same undocumented JSON API that powers the
 * public PerformanceList widget — no auth required.
 */
export class CityBoxOfficeScraper extends BaseScraper {
  readonly sourceSlug = "cityboxoffice";

  async scrape(): Promise<ScrapedEvent[]> {
    let data: any;
    try {
      const { data: json } = await axios.get(API_URL, {
        params: { action: "perf", page: 1 },
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; happening-sf/1.0)",
          Referer: `${BASE_URL}/performancelisting.asp`,
        },
        timeout: 15_000,
      });
      data = json;
    } catch (err: any) {
      console.error("[cityboxoffice] fetch failed:", err.message);
      return [];
    }

    const performances: any[] = data?.performance ?? [];
    const now = Date.now();
    const oneYearFromNow = now + 365 * 24 * 60 * 60 * 1000;
    const events: ScrapedEvent[] = [];

    for (const p of performances) {
      // SF only
      if (p.VenueCity !== "San Francisco") continue;

      // Skip subscription packages and bundles
      if (p.isPackage === 1 || p.ItemType === "Bundle") continue;

      // Skip gift certificates and non-event products
      const nameLower = (p.PerformanceName ?? "").toLowerCase();
      if (nameLower.includes("gift certificate") || nameLower.includes("create your own series")) continue;

      const startDate = parseCboDate(p.PerformanceDateTime);
      if (!startDate || isNaN(startDate.getTime())) continue;
      if (startDate.getTime() < now) continue;

      const endDate = p.PerformanceEndDateTime
        ? parseCboDate(p.PerformanceEndDateTime) ?? undefined
        : undefined;

      // Skip multi-year gift certs / open-ended offerings
      if (endDate && endDate.getTime() > oneYearFromNow) continue;

      const price = formatPrice(p.PerformanceMinPrice, p.PerformanceMaxPrice);
      const isFree =
        p.PerformanceMinPrice === 0 && p.PerformanceMaxPrice === 0
          ? true
          : this.parseFree(price);

      const image =
        p.Image1 && p.Image1.toLowerCase() !== "blank.gif" && p.Image1 !== ""
          ? `${IMAGE_BASE}${p.Image1}`
          : undefined;

      const description = p.Description ? stripHtml(p.Description) : undefined;

      events.push({
        externalId: String(p.PerformanceID),
        title: (p.PerformanceName ?? "").trim(),
        description: description || undefined,
        startDate,
        endDate: endDate && !isNaN(endDate.getTime()) ? endDate : undefined,
        venueName: p.Venue ?? undefined,
        venueAddress: p.VenueAddress ?? undefined,
        sourceUrl: `${BASE_URL}/eventperformances.asp?evt=${p.EventID}`,
        imageUrl: image,
        price,
        isFree: isFree || undefined,
      });
    }

    console.log(`[cityboxoffice] scraped ${events.length} upcoming SF events`);
    return events;
  }
}
