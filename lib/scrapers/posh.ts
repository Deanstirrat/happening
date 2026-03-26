import axios from "axios";
import { BaseScraper } from "./base";
import type { ScrapedEvent } from "./base";

/**
 * Posh — posh.vip
 *
 * Uses Posh's internal tRPC API (no auth required). Fetches:
 *  1. Featured events via /api/web/v2/trpc/events.fetchFeaturedEvents
 *  2. Trending/upcoming events via /api/web/v2/trpc/events.fetchMarketplaceEvents
 *     across multiple time windows (Today, This Week, This Month).
 *
 * Event pages live at https://posh.vip/e/{url}.
 */
export class PoshScraper extends BaseScraper {
  readonly sourceSlug = "posh";

  private readonly BASE = "https://posh.vip";
  private readonly HEADERS = {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
    Referer: "https://posh.vip/explore",
  };

  // SF center coordinates (used by the browser when auto-detecting location)
  private readonly SF_LAT = 37.77493;
  private readonly SF_LNG = -122.41942;

  async scrape(): Promise<ScrapedEvent[]> {
    const seen = new Set<string>();
    const events: ScrapedEvent[] = [];

    const addUnique = (batch: ScrapedEvent[]) => {
      for (const e of batch) {
        if (!seen.has(e.sourceUrl)) {
          seen.add(e.sourceUrl);
          events.push(e);
        }
      }
    };

    // Marketplace events — geo-filtered to SF/Bay Area by the API
    for (const when of ["Today", "This Week", "This Month"] as const) {
      addUnique(await this.fetchMarketplace(when));
    }

    return events;
  }

  private async fetchMarketplace(
    when: "Today" | "This Week" | "This Month"
  ): Promise<ScrapedEvent[]> {
    const input = {
      sort: "Trending",
      when,
      search: "",
      location: {
        type: "custom",
        lat: this.SF_LAT,
        long: this.SF_LNG,
        location: "San Francisco, CA",
      },
      secondaryFilters: [],
      where: "San Francisco, CA",
      coordinates: [this.SF_LNG, this.SF_LAT],
      limit: 50,
      clientTimezone: "America/Los_Angeles",
    };

    try {
      const res = await axios.get(
        `${this.BASE}/api/web/v2/trpc/events.fetchMarketplaceEvents`,
        {
          params: { input: JSON.stringify(input) },
          headers: this.HEADERS,
          timeout: 15000,
        }
      );
      const items: any[] = res.data?.result?.data?.events ?? [];
      return items.flatMap((item) => this.parseEvent(item) ?? []);
    } catch (err: any) {
      console.warn(`[posh] fetchMarketplace(${when}) error:`, err.message);
      return [];
    }
  }

  private isBayArea(address?: string): boolean {
    if (!address) return true; // Secret location events — include optimistically
    const lower = address.toLowerCase();
    return (
      lower.includes(", ca ") ||
      lower.includes(", ca,") ||
      lower.endsWith(", ca") ||
      lower.includes("california")
    );
  }

  private parseEvent(item: any): ScrapedEvent | null {
    const title: string = item.name?.trim();
    if (!title) return null;

    const slug: string = item.url;
    if (!slug) return null;

    const startDate = item.startUtc ? new Date(item.startUtc) : null;
    if (!startDate || isNaN(startDate.getTime())) return null;

    // Discard events outside California (marketplace API is geofenced but occasionally
    // returns national results; featured events are always national)
    if (!this.isBayArea(item.venue?.address)) return null;

    const endDate =
      item.endUtc ? new Date(item.endUtc) : undefined;

    const venueName: string | undefined = item.venue?.name || undefined;
    const venueAddress: string | undefined = item.venue?.address || undefined;

    // Derive price from tickets array
    const tickets: any[] = item.tickets ?? [];
    const paidTickets = tickets.filter(
      (t) => !t.isHidden && t.price > 0 && t.isAvailable !== false
    );
    const freeTickets = tickets.filter(
      (t) => !t.isHidden && t.price === 0 && t.isAvailable !== false
    );
    const isFree = paidTickets.length === 0 && freeTickets.length > 0;
    const minPrice =
      paidTickets.length > 0
        ? Math.min(...paidTickets.map((t) => t.price))
        : null;
    const price =
      isFree ? "Free" : minPrice != null ? `$${minPrice}` : undefined;

    const imageUrl: string | undefined = item.flyer || undefined;
    const sourceUrl = `${this.BASE}/e/${slug}`;

    return {
      title,
      startDate,
      endDate: endDate && !isNaN(endDate.getTime()) ? endDate : undefined,
      venueName,
      venueAddress,
      price,
      isFree,
      imageUrl,
      sourceUrl,
      tags: ["posh", "nightlife", "sf"],
    };
  }
}
