import axios from "axios";
import * as cheerio from "cheerio";
import { BaseScraper } from "./base";
import type { ScrapedEvent } from "./base";
import { sfDateFromLocal } from "@/lib/sfDate";

/**
 * Great Star Theater — greatstartheater.org
 *
 * Chinatown venue with its own CMS. We scrape two listing pages:
 *   /whats-playing — current and upcoming shows
 *   /special-events — additional community events
 *
 * Each event card is an <a> element linking to the ticketing platform
 * (Ticket Tailor, Fever, etc.) containing:
 *   <img>          — event poster
 *   <h3>           — event title
 *   <p>            — date text: "April 18, 2026 at 8:00 PM" or "April 10, 2026"
 *
 * The Ticket Tailor URL is used as sourceUrl for deduplication.
 */

const BASE_URL = "https://www.greatstartheater.org";
const LISTING_PAGES = ["/whats-playing", "/special-events"];

const MONTH_MAP: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

// "April 18, 2026 at 8:00 PM" or "April 10, 2026" or "April 25 - 28, 2026"
function parseDateText(text: string): Date | null {
  const m = text.match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:\s*[-–]\s*\d{1,2})?,?\s*(\d{4})(?:\s+at\s+(\d{1,2}):(\d{2})\s*(AM|PM))?/i
  );
  if (!m) return null;

  const month = MONTH_MAP[m[1].toLowerCase()];
  if (!month) return null;

  const day = parseInt(m[2]);
  const year = parseInt(m[3]);

  let hour = 19; // default 7pm
  let minute = 0;

  if (m[4] && m[6]) {
    hour = parseInt(m[4]);
    minute = parseInt(m[5] ?? "0");
    const ampm = m[6].toUpperCase();
    if (ampm === "PM" && hour < 12) hour += 12;
    if (ampm === "AM" && hour === 12) hour = 0;
  }

  return sfDateFromLocal(year, month, day, hour, minute);
}

async function fetchPage(url: string): Promise<string | null> {
  try {
    const { data } = await axios.get<string>(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
      timeout: 15_000,
    });
    return data;
  } catch (err: any) {
    console.error(`[greatstartheater] failed to fetch ${url}:`, err.message);
    return null;
  }
}

export class GreatStarTheaterScraper extends BaseScraper {
  readonly sourceSlug = "greatstartheater";

  async scrape(): Promise<ScrapedEvent[]> {
    const events: ScrapedEvent[] = [];
    const nowMs = Date.now();
    const seen = new Set<string>();

    for (const path of LISTING_PAGES) {
      const html = await fetchPage(`${BASE_URL}${path}`);
      if (!html) continue;

      const $ = cheerio.load(html);

      // Event cards: <a> elements linking to external ticketing platforms
      $("a[href]").each((_, el) => {
        const $el = $(el);
        const href = $el.attr("href") ?? "";

        // Only process links to ticketing platforms or detail pages
        const isTicketingLink =
          href.includes("tickettailor.com") ||
          href.includes("fever") ||
          href.includes("eventbrite") ||
          href.match(/greatstartheater\.org\/(shows|events)\//);
        if (!isTicketingLink) return;
        if (seen.has(href)) return;

        const title = $el.find("h3, h2").first().text().trim();
        if (!title) return;

        // Date may be a plain text node or in a <p> — scan the full card text
        const cardText = $el.text();
        const startDate = parseDateText(cardText);

        if (!startDate || isNaN(startDate.getTime())) return;
        if (startDate.getTime() < nowMs - 86_400_000) return;

        seen.add(href);

        const imageUrl = $el.find("img").first().attr("src");
        const resolvedImage = imageUrl
          ? imageUrl.startsWith("http")
            ? imageUrl
            : `${BASE_URL}${imageUrl}`
          : undefined;

        events.push({
          title,
          startDate,
          sourceUrl: href,
          imageUrl: resolvedImage,
          venueName: "Great Star Theater",
          venueAddress: "636 Jackson St, San Francisco, CA 94133",
          tags: ["theater", "arts", "chinatown", "great-star"],
        });
      });
    }

    console.log(`[greatstartheater] scraped ${events.length} upcoming events`);
    return events;
  }
}
