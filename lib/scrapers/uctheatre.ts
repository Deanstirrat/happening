import axios from "axios";
import * as cheerio from "cheerio";
import { BaseScraper } from "./base";
import type { ScrapedEvent } from "./base";
import { sfDateFromLocal } from "@/lib/sfDate";

/**
 * The UC Theatre — theuctheatre.org
 *
 * Webflow CMS site. Events are server-rendered as `.w-dyn-item` collection items.
 * Confirmed HTML structure per each card:
 *
 *   .date-div
 *     h1.heading-2      → month abbreviation ("Apr")
 *     h1.heading-3      → day number ("09")
 *   h1.headliner-listing → event title ("Fia - THE LOVE ME TOUR")
 *   h1.support-listing   → supporting acts (ignored)
 *   .text-block-82       → doors time ("7:00 pm")
 *   .text-block-84       → show time ("8:00 pm")
 *   a[href^="/shows/"]   → detail page URL
 */

const BASE_URL = "https://www.theuctheatre.org";

const MONTH_ABBR: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

// "8:00 pm" → { hour: 20, minute: 0 }
function parseTime(text: string): { hour: number; minute: number } | null {
  const m = text.match(/(\d{1,2}):(\d{2})\s*(am|pm)/i);
  if (!m) return null;
  let hour = parseInt(m[1]);
  const minute = parseInt(m[2]);
  const ampm = m[3].toLowerCase();
  if (ampm === "pm" && hour < 12) hour += 12;
  if (ampm === "am" && hour === 12) hour = 0;
  return { hour, minute };
}

export class UcTheatreScraper extends BaseScraper {
  readonly sourceSlug = "uctheatre";

  async scrape(): Promise<ScrapedEvent[]> {
    let html: string;
    try {
      const { data } = await axios.get<string>(BASE_URL, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml",
        },
        timeout: 15_000,
      });
      html = data;
    } catch (err: any) {
      console.error(`[uctheatre] failed to fetch homepage:`, err.message);
      return [];
    }

    const $ = cheerio.load(html);
    const events: ScrapedEvent[] = [];
    const nowMs = Date.now();
    const seen = new Set<string>();

    // Webflow CMS collection items
    $(".w-dyn-item").each((_, el) => {
      const $card = $(el);

      // Date
      const $dateDivContainer = $card.find(".date-div").first();
      const monthStr = $dateDivContainer.find(".heading-2").first().text().trim().toLowerCase();
      const dayStr = $dateDivContainer.find(".heading-3").first().text().trim();

      if (!monthStr || !dayStr) return;
      const month = MONTH_ABBR[monthStr];
      if (!month) return;
      const day = parseInt(dayStr);
      if (isNaN(day) || day < 1 || day > 31) return;

      // Title
      const title = $card.find("h1.headliner-listing").first().text().trim();
      if (!title) return;

      // Show URL (the BUY TICKETS anchor inside the card)
      const href = $card.find('a[href^="/shows/"]').first().attr("href") ?? "";
      const sourceUrl = href ? `${BASE_URL}${href}` : BASE_URL;
      if (seen.has(sourceUrl)) return;
      seen.add(sourceUrl);

      // Time: prefer show time, fall back to doors, default to 8pm
      const showTime = parseTime($card.find(".text-block-84").first().text());
      const doorsTime = parseTime($card.find(".text-block-82").first().text());
      const timeParsed = showTime ?? doorsTime;
      const hour = timeParsed?.hour ?? 20;
      const minute = timeParsed?.minute ?? 0;

      const year = this.resolveYear(month, day);
      const startDate = sfDateFromLocal(year, month, day, hour, minute);
      if (startDate.getTime() < nowMs - 86_400_000) return;

      events.push({
        title,
        startDate,
        sourceUrl,
        venueName: "The UC Theatre",
        venueAddress: "2036 University Ave, Berkeley, CA 94704",
        tags: ["music", "live music", "concert", "uc-theatre"],
      });
    });

    console.log(`[uctheatre] scraped ${events.length} upcoming events`);
    return events;
  }
}
