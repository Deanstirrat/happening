import axios from "axios";
import * as cheerio from "cheerio";
import { BaseScraper } from "./base";
import type { ScrapedEvent } from "./base";
import { sfDateFromLocal } from "@/lib/sfDate";

const EVENTS_URL =
  "https://www.civickitchensf.com/home-content/ajax-class-sort.php";
const BASE_URL = "https://www.civickitchensf.com";

const MONTH_ABBREV: Record<string, number> = {
  Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6,
  Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12,
};

/**
 * Parse Civic Kitchen's date/time display.
 * The date cell text looks like: "Tue Apr 14 | 6P PT" or "Thu Apr 16 | 6P PT"
 * Time variants: "6P", "6:30P", "10A", "11:30A"
 */
function parseCivicKitchenDate(
  dateText: string,
  resolveYear: (month: number, day: number) => number
): Date | null {
  // Extract month abbreviation + day
  const dateMatch = dateText.match(/([A-Za-z]{3})\s+(\d{1,2})/);
  if (!dateMatch) return null;
  const month = MONTH_ABBREV[dateMatch[1]];
  if (!month) return null;
  const day = parseInt(dateMatch[2]);

  // Extract time: e.g. "6P", "6:30P", "10A", "11:30A"
  const timeMatch = dateText.match(/(\d{1,2})(?::(\d{2}))?([AP])\b/i);
  let hours = 12;
  let minutes = 0;
  if (timeMatch) {
    hours = parseInt(timeMatch[1]);
    minutes = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
    const period = timeMatch[3].toUpperCase();
    if (period === "P" && hours !== 12) hours += 12;
    if (period === "A" && hours === 12) hours = 0;
  }

  const year = resolveYear(month, day);
  return sfDateFromLocal(year, month, day, hours, minutes);
}

/**
 * Civic Kitchen SF — civickitchensf.com
 *
 * SF cooking school at 2961 Mission Street. Offers in-person cooking
 * classes in a commercial kitchen. Online classes are filtered out.
 */
export class CivicKitchenScraper extends BaseScraper {
  readonly sourceSlug = "civickitchen";

  async scrape(): Promise<ScrapedEvent[]> {
    let html: string;
    try {
      const { data } = await axios.get<string>(EVENTS_URL, {
        params: { sort: "all", hidesoldout: "No", hideseries: "No" },
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          Referer: `${BASE_URL}/events`,
        },
        timeout: 15_000,
      });
      html = data;
    } catch (err: any) {
      console.error("[civickitchen] fetch failed:", err.message);
      return [];
    }

    const $ = cheerio.load(html);
    const events: ScrapedEvent[] = [];

    $(".class-box").each((_i, el) => {
      const $el = $(el);

      // Skip online classes
      if ($el.find(".color-online").length) return;

      // Title
      const title = $el.find("h4.caslon").first().text().trim();
      if (!title) return;

      // Source URL from onclick
      const onclick = $el.attr("onclick") ?? "";
      const urlMatch = onclick.match(/document\.location\.href='([^']+)'/);
      const sourceUrl = urlMatch
        ? `${BASE_URL}${urlMatch[1]}`
        : `${BASE_URL}/events`;

      // Image from background-image style on .class-hero
      const heroStyle = $el.find(".class-hero").first().attr("style") ?? "";
      const imgMatch = heroStyle.match(/url\(['"]?([^'")\s]+)['"]?\)/);
      const imageUrl = imgMatch
        ? imgMatch[1].startsWith("http")
          ? imgMatch[1]
          : `${BASE_URL}${imgMatch[1]}`
        : undefined;

      // Description
      const description = $el.find("p.no-margin").first().text().trim() || undefined;

      // Date: extract from the bottom date cell text
      // The date/time spans are inside the last .table-row
      const dateCell = $el.find(".table-cell").last();
      const dateText = dateCell.text().replace(/\s+/g, " ").trim();

      const startDate = parseCivicKitchenDate(dateText, this.resolveYear.bind(this));
      if (!startDate || isNaN(startDate.getTime())) return;

      events.push({
        title,
        description,
        startDate,
        venueName: "Civic Kitchen",
        venueAddress: "2961 Mission Street, San Francisco, CA 94110",
        sourceUrl,
        imageUrl,
        isFree: false,
      });
    });

    console.log(`[civickitchen] scraped ${events.length} upcoming events`);
    return events;
  }
}
