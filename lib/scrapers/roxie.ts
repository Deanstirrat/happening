import axios from "axios";
import * as cheerio from "cheerio";
import { BaseScraper } from "./base";
import type { ScrapedEvent } from "./base";
import { sfDateFromLocal } from "@/lib/sfDate";

const CALENDAR_URL = "https://roxie.com/calendar/";
const BASE_URL = "https://roxie.com";
const VENUE_ADDRESS = "3117 16th Street, San Francisco, CA 94103";
// Single fixed venue. Nominatim can't resolve the theater by name/address, so
// supply coordinates directly — otherwise every showtime is held ungeocoded
// (status PENDING) and never publishes.
const VENUE_LAT = 37.764671;
const VENUE_LNG = -122.422431;

/**
 * Parse a showtime string like "6:00 pm" / "11:30 am" into 24h components.
 */
function parseShowtime(text: string): { hours: number; minutes: number } | null {
  const m = text.match(/(\d{1,2}):(\d{2})\s*(am|pm)/i);
  if (!m) return null;
  let hours = parseInt(m[1], 10);
  const minutes = parseInt(m[2], 10);
  const period = m[3].toLowerCase();
  if (period === "pm" && hours !== 12) hours += 12;
  if (period === "am" && hours === 12) hours = 0;
  return { hours, minutes };
}

/**
 * Roxie Theater — roxie.com
 *
 * Historic nonprofit repertory cinema in the Mission (since 1909). Its calendar
 * page server-renders one `.calendar-block__day` per date (id="day-YYYY-MM-DD"),
 * each containing `.film-strip` blocks with title, image, description, and one
 * or more showtimes. Each showtime becomes a separate event.
 */
export class RoxieScraper extends BaseScraper {
  readonly sourceSlug = "roxie";

  async scrape(): Promise<ScrapedEvent[]> {
    let html: string;
    try {
      const { data } = await axios.get<string>(CALENDAR_URL, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        },
        timeout: 20_000,
      });
      html = data;
    } catch (err: any) {
      console.error("[roxie] fetch failed:", err.message);
      return [];
    }

    const $ = cheerio.load(html);
    const events: ScrapedEvent[] = [];

    $(".calendar-block__day").each((_i, dayEl) => {
      const $day = $(dayEl);
      const idAttr = $day.attr("id") ?? "";
      const dateMatch = idAttr.match(/day-(\d{4})-(\d{2})-(\d{2})/);
      if (!dateMatch) return;
      const year = parseInt(dateMatch[1], 10);
      const month = parseInt(dateMatch[2], 10);
      const day = parseInt(dateMatch[3], 10);

      $day.find(".film-strip").each((_j, filmEl) => {
        const $film = $(filmEl);

        const $titleLink = $film.find(".film-strip__title a").first();
        const title = $titleLink.text().trim();
        if (!title) return;

        const href = $titleLink.attr("href") ?? $film.find(".film-strip__thumb").attr("href");
        const sourceUrl = href
          ? href.startsWith("http")
            ? href
            : `${BASE_URL}${href}`
          : CALENDAR_URL;

        const description =
          $film.find(".film-strip__description").first().text().trim() || undefined;

        // Image: lazy-loaded thumbs keep the real URL in data-src and put an
        // inline SVG placeholder in src, so prefer data-src and skip data: URIs.
        const $img = $film.find(".film-strip__thumb img").first();
        const rawSrc = $img.attr("data-src") || $img.attr("src");
        const imageUrl = rawSrc && !rawSrc.startsWith("data:") ? rawSrc : undefined;

        // One event per showtime link in this day's strip.
        const showtimeLinks = $film.find(".film-strip__showtimes a");
        if (showtimeLinks.length === 0) return;

        showtimeLinks.each((_k, timeEl) => {
          const timeText = $(timeEl).text().trim();
          const parsed = parseShowtime(timeText);
          if (!parsed) return;

          const startDate = sfDateFromLocal(
            year,
            month,
            day,
            parsed.hours,
            parsed.minutes
          );
          if (isNaN(startDate.getTime())) return;

          events.push({
            title,
            description,
            startDate,
            venueName: "Roxie Theater",
            venueAddress: VENUE_ADDRESS,
            latitude: VENUE_LAT,
            longitude: VENUE_LNG,
            sourceUrl,
            imageUrl,
            isFree: false,
          });
        });
      });
    });

    console.log(`[roxie] scraped ${events.length} upcoming showtimes`);
    return events;
  }
}
