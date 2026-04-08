import axios from "axios";
import * as cheerio from "cheerio";
import { BaseScraper } from "./base";
import type { ScrapedEvent } from "./base";
import { sfDateFromLocal } from "@/lib/sfDate";

/**
 * University of San Francisco — myusf.usfca.edu/calendar (community events)
 *
 * Drupal-based calendar filtered to the community/open events category (ID 2456).
 * Each event row contains:
 *   <a href="/event/[slug]">   — title link
 *   .event-date or adjacent text — "Wednesday, April 8, 12:00 PM - 1:00 PM"
 *   .event-location             — venue name
 *
 * We skip virtual/Zoom events and limit to in-person events at USF's campus.
 */

const BASE_URL = "https://myusf.usfca.edu";
const CALENDAR_URL = `${BASE_URL}/calendar?search_api_fulltext=&field_start_date=&field_end_date=&field_category%5B2456%5D=2456`;

const MONTH_MAP: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

// Handles both:
//   "Wednesday, April 8, 2026, 12:00 PM - 1:00 PM"  (with year)
//   "Wednesday, April 8, 12:00 PM - 1:00 PM"         (without year)
function parseDateText(text: string, resolveYear: (m: number, d: number) => number): Date | null {
  // Try with year first
  const withYear = text.match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s*(\d{4}),?\s+(\d{1,2}):(\d{2})\s*(AM|PM)/i
  );
  if (withYear) {
    const month = MONTH_MAP[withYear[1].toLowerCase()];
    if (!month) return null;
    const day = parseInt(withYear[2]);
    const year = parseInt(withYear[3]);
    let hour = parseInt(withYear[4]);
    const minute = parseInt(withYear[5]);
    const ampm = withYear[6].toUpperCase();
    if (ampm === "PM" && hour < 12) hour += 12;
    if (ampm === "AM" && hour === 12) hour = 0;
    return sfDateFromLocal(year, month, day, hour, minute);
  }

  // Try without year
  const noYear = text.match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{1,2}):(\d{2})\s*(AM|PM)/i
  );
  if (noYear) {
    const month = MONTH_MAP[noYear[1].toLowerCase()];
    if (!month) return null;
    const day = parseInt(noYear[2]);
    const year = resolveYear(month, day);
    let hour = parseInt(noYear[3]);
    const minute = parseInt(noYear[4]);
    const ampm = noYear[5].toUpperCase();
    if (ampm === "PM" && hour < 12) hour += 12;
    if (ampm === "AM" && hour === 12) hour = 0;
    return sfDateFromLocal(year, month, day, hour, minute);
  }

  return null;
}

function isVirtual(location: string): boolean {
  const lower = location.toLowerCase();
  return lower.includes("zoom") || lower.includes("virtual") || lower.includes("online");
}

export class UsfcaScraper extends BaseScraper {
  readonly sourceSlug = "usfca";

  async scrape(): Promise<ScrapedEvent[]> {
    let html: string;
    try {
      const { data } = await axios.get<string>(CALENDAR_URL, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml",
        },
        timeout: 15_000,
      });
      html = data;
    } catch (err: any) {
      console.error(`[usfca] failed to fetch calendar:`, err.message);
      return [];
    }

    const $ = cheerio.load(html);
    const events: ScrapedEvent[] = [];
    const nowMs = Date.now();
    const seen = new Set<string>();

    // Try structured event rows first (.event-item or .views-row)
    const $rows = $(".event-item, .views-row").filter((_, el) => {
      return $(el).find('a[href*="/event/"]').length > 0;
    });

    if ($rows.length > 0) {
      $rows.each((_, el) => {
        const $row = $(el);
        const $link = $row.find('a[href*="/event/"]').first();
        const href = $link.attr("href") ?? "";
        if (!href || seen.has(href)) return;

        const title = ($link.find("h3").first().text() || $link.text()).trim();
        if (!title) return;

        // Search full row text — Drupal varies its date field class names
        const rowText = $row.text();
        if (isVirtual(rowText)) return;

        const startDate = parseDateText(rowText, this.resolveYear.bind(this));
        if (!startDate || isNaN(startDate.getTime())) {
          console.warn(`[usfca] could not parse date from row for "${title}"`);
          return;
        }
        if (startDate.getTime() < nowMs - 86_400_000) return;

        seen.add(href);
        const sourceUrl = href.startsWith("http") ? href : `${BASE_URL}${href}`;
        const imageUrl = $row.find("img").first().attr("src");

        events.push({
          title,
          startDate,
          sourceUrl,
          imageUrl: imageUrl
            ? imageUrl.startsWith("http")
              ? imageUrl
              : `${BASE_URL}${imageUrl}`
            : undefined,
          venueName: "University of San Francisco",
          venueAddress: "2130 Fulton St, San Francisco, CA 94117",
          tags: ["university", "academic", "community", "usf"],
        });
      });
    } else {
      // Fallback: find all /event/ links on the page and look for date text nearby
      $('a[href*="/event/"]').each((_, el) => {
        const $el = $(el);
        const href = $el.attr("href") ?? "";
        if (!href || seen.has(href)) return;

        const title = ($el.find("h3").first().text() || $el.text()).trim();
        if (!title || title.length < 3) return;

        // Look for date text in surrounding container
        const $container = $el.parent().parent();
        const containerText = $container.text();

        // Skip virtual events
        if (isVirtual(containerText)) return;

        const startDate = parseDateText(containerText, this.resolveYear.bind(this));
        if (!startDate || isNaN(startDate.getTime())) return;
        if (startDate.getTime() < nowMs - 86_400_000) return;

        seen.add(href);
        const sourceUrl = href.startsWith("http") ? href : `${BASE_URL}${href}`;
        const imageUrl = $container.find("img").first().attr("src");

        events.push({
          title,
          startDate,
          sourceUrl,
          imageUrl: imageUrl
            ? imageUrl.startsWith("http")
              ? imageUrl
              : `${BASE_URL}${imageUrl}`
            : undefined,
          venueName: "University of San Francisco",
          venueAddress: "2130 Fulton St, San Francisco, CA 94117",
          tags: ["university", "academic", "community", "usf"],
        });
      });
    }

    console.log(`[usfca] scraped ${events.length} upcoming events`);
    return events;
  }
}
