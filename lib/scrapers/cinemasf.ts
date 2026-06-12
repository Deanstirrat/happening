import axios from "axios";
import * as cheerio from "cheerio";
import { BaseScraper } from "./base";
import type { ScrapedEvent } from "./base";
import { decodeHtmlEntities } from "@/lib/decodeEntities";

interface SquarespaceEvent {
  title?: string;
  fullUrl?: string;
  startDate?: number; // epoch ms (true UTC instant of the showtime)
  endDate?: number;
  excerpt?: string;
  body?: string;
  assetUrl?: string;
}

const DESCRIPTION_MAX = 500;

/** Strip HTML and collapse whitespace from a Squarespace body/excerpt blob. */
function toPlainText(html?: string): string | undefined {
  if (!html) return undefined;
  const text = cheerio.load(html).root().text().replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  return text.length > DESCRIPTION_MAX
    ? text.slice(0, DESCRIPTION_MAX).replace(/\s+\S*$/, "") + "…"
    : text;
}

/**
 * CinemaSF repertory cinemas — Balboa, Vogue and 4-Star.
 *
 * All three are run by CinemaSF on Squarespace and expose their showtimes via
 * the native events collection JSON at `/calendar-of-events?format=json`
 * (`upcoming` array). Each entry is one showtime: `startDate` is a true UTC
 * instant, the title carries a "~ 7 PM" suffix we trim off, and the per-event
 * location is a Squarespace placeholder — so each cinema supplies its own fixed
 * coordinates. Mirrors the roxie/alamosf single-venue cinema pattern.
 */
abstract class CinemaSfScraper extends BaseScraper {
  protected abstract host: string;
  protected abstract venueName: string;
  protected abstract venueAddress: string;
  protected abstract lat: number;
  protected abstract lng: number;

  async scrape(): Promise<ScrapedEvent[]> {
    const url = `https://${this.host}/calendar-of-events?format=json`;
    let upcoming: SquarespaceEvent[];
    try {
      const { data } = await axios.get<{ upcoming?: SquarespaceEvent[] }>(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          Accept: "application/json",
        },
        timeout: 20_000,
      });
      upcoming = data.upcoming ?? [];
    } catch (err: any) {
      console.error(`[${this.sourceSlug}] fetch failed:`, err.message);
      return [];
    }

    const events: ScrapedEvent[] = [];

    for (const item of upcoming) {
      if (!item.startDate) continue;
      const startDate = new Date(item.startDate);
      if (isNaN(startDate.getTime())) continue;

      const rawTitle = decodeHtmlEntities(item.title ?? "").trim();
      // Drop the showtime suffix ("Disclosure Day ~ 7 PM") — startDate has the time.
      const title = rawTitle.replace(/\s*~\s*.*$/, "").trim();
      if (!title) continue;

      const sourceUrl = item.fullUrl
        ? `https://${this.host}${item.fullUrl}`
        : `https://${this.host}/calendar`;

      const description = item.excerpt
        ? toPlainText(item.excerpt)
        : toPlainText(item.body);

      events.push({
        title,
        description,
        startDate,
        endDate:
          item.endDate && !isNaN(new Date(item.endDate).getTime())
            ? new Date(item.endDate)
            : undefined,
        venueName: this.venueName,
        venueAddress: this.venueAddress,
        latitude: this.lat,
        longitude: this.lng,
        sourceUrl,
        imageUrl: item.assetUrl || undefined,
        category: "FILM",
        tags: ["film", "cinema", "movies"],
        isFree: false,
      });
    }

    console.log(`[${this.sourceSlug}] scraped ${events.length} upcoming showtimes`);
    return events;
  }
}

export class BalboaScraper extends CinemaSfScraper {
  readonly sourceSlug = "balboa";
  protected host = "www.balboamovies.com";
  protected venueName = "Balboa Theatre";
  protected venueAddress = "3630 Balboa St, San Francisco, CA 94121";
  protected lat = 37.77573;
  protected lng = -122.5006;
}

export class VogueScraper extends CinemaSfScraper {
  readonly sourceSlug = "vogue";
  protected host = "www.voguemovies.com";
  protected venueName = "Vogue Theatre";
  protected venueAddress = "3290 Sacramento St, San Francisco, CA 94115";
  protected lat = 37.78808;
  protected lng = -122.4476;
}

export class FourStarScraper extends CinemaSfScraper {
  readonly sourceSlug = "fourstar";
  protected host = "www.4-star-movies.com";
  protected venueName = "4-Star Theater";
  protected venueAddress = "2200 Clement St, San Francisco, CA 94121";
  protected lat = 37.7821;
  protected lng = -122.4842;
}
