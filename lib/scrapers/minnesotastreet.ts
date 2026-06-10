import axios from "axios";
import * as cheerio from "cheerio";
import { BaseScraper } from "./base";
import type { ScrapedEvent } from "./base";
import { sfDateFromLocal } from "@/lib/sfDate";

const HOME_URL = "https://minnesotastreetproject.com/";
const BASE_URL = "https://minnesotastreetproject.com";

/** Parse a visible time like "4PM", "4:30PM", "11AM" → 24h components. */
function parseTime(text: string): { hours: number; minutes: number } | null {
  const m = text.match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)/i);
  if (!m) return null;
  let hours = parseInt(m[1], 10);
  const minutes = m[2] ? parseInt(m[2], 10) : 0;
  if (m[3].toUpperCase() === "PM" && hours !== 12) hours += 12;
  if (m[3].toUpperCase() === "AM" && hours === 12) hours = 0;
  return { hours, minutes };
}

/**
 * Minnesota Street Project — minnesotastreetproject.com
 *
 * Contemporary-art complex in the Dogpatch housing ~20 independent galleries
 * across 1275 & 1150 Minnesota St. Its homepage server-renders upcoming gallery
 * `Event`s (openings, performances, talks) and `Exhibition`s. Events carry a
 * start time; exhibitions are anchored (all-day) on their opening date.
 */
export class MinnesotaStreetScraper extends BaseScraper {
  readonly sourceSlug = "minnesotastreet";

  async scrape(): Promise<ScrapedEvent[]> {
    let html: string;
    try {
      const { data } = await axios.get<string>(HOME_URL, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        },
        timeout: 20_000,
      });
      html = data;
    } catch (err: any) {
      console.error("[minnesotastreet] fetch failed:", err.message);
      return [];
    }

    const $ = cheerio.load(html);
    const events: ScrapedEvent[] = [];
    const seen = new Set<string>();

    $(".Event-thumb, .Exhibition-thumb").each((_i, el) => {
      const $el = $(el);
      const isExhibition = $el.hasClass("Exhibition-thumb");

      const title = $el.find("h3.font-large").first().text().trim();
      if (!title) return;

      const $time = $el.find("time").first();
      const isoDate = $time.attr("datetime"); // e.g. "2026-06-13"
      if (!isoDate) return;
      const dm = isoDate.match(/(\d{4})-(\d{2})-(\d{2})/);
      if (!dm) return;
      const year = parseInt(dm[1], 10);
      const month = parseInt(dm[2], 10);
      const day = parseInt(dm[3], 10);

      // Visible time text (e.g. "Sat, Jun 13, 4PM-6PM"). Exhibitions show a date
      // range with no clock time and are treated as all-day.
      const timeText = $time.text();
      const parsedTime = isExhibition ? null : parseTime(timeText);

      const startDate = parsedTime
        ? sfDateFromLocal(year, month, day, parsedTime.hours, parsedTime.minutes)
        : sfDateFromLocal(year, month, day, 12, 0);
      if (isNaN(startDate.getTime())) return;

      const href = $el.find("a[href]").first().attr("href") ?? "";
      const sourceUrl = href
        ? href.startsWith("http")
          ? href
          : `${BASE_URL}${href}`
        : HOME_URL;

      if (seen.has(sourceUrl)) return;
      seen.add(sourceUrl);

      // The second line of the meta paragraph is "<building street> / <gallery>".
      const $p = $time.closest("p");
      const metaText = $p
        .clone()
        .children("time")
        .remove()
        .end()
        .text()
        .replace(/\s+/g, " ")
        .trim();
      let venueName = "Minnesota Street Project";
      let venueAddress = "1275 Minnesota Street, San Francisco, CA 94107";
      const slashIdx = metaText.indexOf("/");
      if (slashIdx !== -1) {
        const street = metaText.slice(0, slashIdx).trim();
        const gallery = metaText.slice(slashIdx + 1).trim();
        if (gallery) venueName = gallery;
        if (/minnesota/i.test(street)) {
          venueAddress = `${street}, San Francisco, CA 94107`;
        }
      }

      const imgSrc = $el.find("img").first().attr("src");
      const imageUrl = imgSrc
        ? imgSrc.startsWith("http")
          ? imgSrc
          : `${BASE_URL}${imgSrc}`
        : undefined;

      events.push({
        title,
        startDate,
        allDay: isExhibition,
        venueName,
        venueAddress,
        sourceUrl,
        imageUrl,
        isFree: true,
        tags: ["art", "gallery"],
      });
    });

    console.log(`[minnesotastreet] scraped ${events.length} upcoming events`);
    return events;
  }
}
