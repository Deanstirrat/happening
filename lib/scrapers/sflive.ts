import axios from "axios";
import * as cheerio from "cheerio";
import { BaseScraper } from "./base";
import type { ScrapedEvent } from "./base";
import { sfDateFromLocal, sfDayKey } from "@/lib/sfDate";

function parseSfliveDate(raw: string): Date | null {
  // raw: "2026-03-27 20:00:00" (no timezone — treat as SF local time)
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (!m) return null;
  return sfDateFromLocal(+m[1], +m[2], +m[3], +m[4], +m[5]);
}

/**
 * SF Live — sflive.art
 *
 * Uses the WordPress REST API with the Vibemap plugin's custom post type.
 * Events are at /wp-json/wp/v2/vibemap_event with standard WP pagination via
 * the X-WP-TotalPages response header.
 *
 * Custom fields live under item.meta (WP REST API nested meta).
 *
 * The WP plugin stores individual occurrence posts for recurring events, each
 * with its own dated slug and vibemap_event_start_date. We simply read the
 * stored start date and filter to the upcoming 60-day window — no RRULE
 * expansion needed.
 *
 * Lat/lng are provided directly by the API — we pass them through to skip
 * Nominatim geocoding.
 *
 * Images: vibemap_event_images (JSON-encoded string) has images for some events.
 * For the rest, we fetch the sflive.art event page and extract the image from
 * the Yoast SEO JSON-LD schema block, in concurrent batches.
 */
export class SfliveScraper extends BaseScraper {
  readonly sourceSlug = "sflive";
  private readonly BASE_URL = "https://sflive.art";
  private readonly PER_PAGE = 100;
  private readonly WINDOW_DAYS = 60;
  private readonly IMAGE_CONCURRENCY = 10;

  async scrape(): Promise<ScrapedEvent[]> {
    const now = new Date();
    const windowEnd = new Date();
    windowEnd.setDate(windowEnd.getDate() + this.WINDOW_DAYS);

    // Collect events alongside their sflive.art page links for image fallback
    const collected: { event: ScrapedEvent; pageLink: string }[] = [];
    let page = 1;
    let totalPages = 1;

    do {
      try {
        const response = await axios.get(
          `${this.BASE_URL}/wp-json/wp/v2/vibemap_event`,
          {
            params: { per_page: this.PER_PAGE, page },
            headers: {
              "User-Agent": "Mozilla/5.0 (compatible; happening-sf/1.0)",
            },
            timeout: 15000,
          }
        );

        if (page === 1) {
          totalPages = parseInt(
            response.headers["x-wp-totalpages"] ?? "1",
            10
          );
        }

        const items: any[] = response.data;
        for (const item of items) {
          const result = this.parseItem(item, now, windowEnd);
          if (result) collected.push(result);
        }
      } catch (err: any) {
        if (err.response?.status === 400) break; // WP returns 400 past last page
        console.error(`[sflive] Error on page ${page}:`, err.message);
        break;
      }

      page++;
    } while (page <= totalPages);

    // Fill in missing images by scraping event pages in concurrent batches
    const needsImage = collected.filter((c) => !c.event.imageUrl);
    for (let i = 0; i < needsImage.length; i += this.IMAGE_CONCURRENCY) {
      const batch = needsImage.slice(i, i + this.IMAGE_CONCURRENCY);
      await Promise.all(
        batch.map(async (c) => {
          const url = await this.fetchPageImage(c.pageLink);
          if (url) c.event.imageUrl = url;
        })
      );
    }

    // Deduplicate by (sourceUrl, SF-local day) — sflive.art creates multiple WP
    // posts for the same recurring event occurrence (e.g. 17× "The Soul Sessions"
    // all pointing to the same ticketing URL on the same day). The runner's source
    // URL dedup would catch these, but deduping here avoids the redundant DB queries.
    const seen = new Set<string>();
    const deduped = collected.filter((c) => {
      const key = `${c.event.sourceUrl}::${sfDayKey(c.event.startDate)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return deduped.map((c) => c.event);
  }

  private parseItem(
    item: any,
    now: Date,
    windowEnd: Date
  ): { event: ScrapedEvent; pageLink: string } | null {
    // Title is HTML-encoded; use cheerio to strip tags and decode entities
    const titleHtml = item.title?.rendered ?? "";
    const title = cheerio.load(titleHtml)("body").text().trim();
    if (!title) return null;

    // Custom fields live under item.meta (WP REST API nested meta)
    const m = item.meta ?? {};

    const startRaw: string = m.vibemap_event_start_date ?? "";
    if (!startRaw) return null;
    const startDate = parseSfliveDate(startRaw);
    if (!startDate || isNaN(startDate.getTime())) return null;

    // Only include events within the upcoming window
    if (startDate < now || startDate > windowEnd) return null;

    // Drop online-only events. sflive's structured `vibemap_event_is_online` flag
    // is never set (False across the entire feed) and the description is generic
    // venue boilerplate, so neither is usable. The reliable signal is an explicit
    // "Online"/"Virtual" tag in vibemap_event_tags: these events geocode to a real
    // physical venue (e.g. Gray Area's "Online Intensive Course …" at 2665 Mission)
    // and would otherwise publish as in-person. Match whole tags only — a substring
    // check would misfire on gallery paths like "/online-shows/".
    const eventTagsRaw: string = m.vibemap_event_tags ?? "";
    const isOnlineTagged = eventTagsRaw
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .some((t) => t === "online" || t === "virtual");
    if (isOnlineTagged) return null;

    const endRaw: string = m.vibemap_event_end_date ?? "";
    let endDate = endRaw ? parseSfliveDate(endRaw) ?? undefined : undefined;

    const venueName: string | undefined =
      m.vibemap_event_venue_name || undefined;
    const venueAddress: string | undefined =
      m.vibemap_event_venue_address || undefined;

    // Use coordinates from the API directly to skip Nominatim geocoding
    const latRaw = m.vibemap_event_venue_latitude;
    const lngRaw = m.vibemap_event_venue_longitude;
    const latitude =
      latRaw != null && latRaw !== "" && latRaw !== 0
        ? parseFloat(String(latRaw))
        : undefined;
    const longitude =
      lngRaw != null && lngRaw !== "" && lngRaw !== 0
        ? parseFloat(String(lngRaw))
        : undefined;

    const priceRaw: string = m.vibemap_event_price ?? "";
    const price = priceRaw || undefined;
    const isFree = this.parseFree(price);

    // vibemap_event_images is stored as a JSON-encoded string or empty string
    const imagesRaw = m.vibemap_event_images;
    let imageUrl: string | undefined;
    try {
      const parsed =
        typeof imagesRaw === "string" && imagesRaw
          ? JSON.parse(imagesRaw)
          : imagesRaw;
      if (Array.isArray(parsed) && parsed[0]) {
        imageUrl =
          typeof parsed[0] === "string" ? parsed[0] : parsed[0]?.url;
      }
    } catch {
      // malformed JSON — no image
    }

    const sourceUrl: string = m.vibemap_event_url || item.link || this.BASE_URL;
    const pageLink: string = item.link || this.BASE_URL;

    // If end time crosses midnight, it will be less than start — add one day
    if (endDate && !isNaN(endDate.getTime()) && endDate < startDate) {
      endDate = new Date(endDate.getTime() + 86400000);
    }

    return {
      event: {
        title,
        startDate,
        endDate: endDate && !isNaN(endDate.getTime()) ? endDate : undefined,
        venueName,
        venueAddress,
        latitude: latitude && !isNaN(latitude) ? latitude : undefined,
        longitude: longitude && !isNaN(longitude) ? longitude : undefined,
        price,
        isFree,
        imageUrl,
        sourceUrl,
        tags: ["sf", "arts", "curated"],
      },
      pageLink,
    };
  }

  /** Fetch an sflive.art event page and extract the image from Yoast JSON-LD. */
  private async fetchPageImage(url: string): Promise<string | undefined> {
    try {
      const { data: html } = await axios.get(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; happening-sf/1.0)" },
        timeout: 10000,
      });
      const $ = cheerio.load(html);
      let imageUrl: string | undefined;
      $('script[type="application/ld+json"]').each((_, el) => {
        if (imageUrl) return;
        try {
          const schema = JSON.parse($(el).html() ?? "");
          const graphs: any[] = schema?.["@graph"] ?? (Array.isArray(schema) ? schema : [schema]);
          for (const node of graphs) {
            const img = node?.image?.url ?? node?.image?.contentUrl ?? node?.thumbnailUrl;
            if (typeof img === "string" && img) {
              imageUrl = img;
              return;
            }
          }
        } catch {
          // ignore parse errors
        }
      });
      return imageUrl;
    } catch {
      return undefined;
    }
  }
}
