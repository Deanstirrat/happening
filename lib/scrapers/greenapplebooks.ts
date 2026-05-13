import axios from "axios";
import * as cheerio from "cheerio";
import { BaseScraper } from "./base";
import type { ScrapedEvent } from "./base";
import { sfDateFromLocal } from "@/lib/sfDate";

/**
 * Green Apple Books — greenapplebooks.com/events
 *
 * Month-based URL navigation: /events/YYYY/MM
 * Scrapes current month + 2 months ahead.
 *
 * Date format: "Monday, May 5"  (year from URL)
 * Time format: "2:00 PM - 3:30 PM" or "6:00pm - 7:30pm"
 * Venue: parsed from "Place:" paragraph; defaults to the main store.
 */

const BASE_URL = "https://greenapplebooks.com";
const MONTHS_AHEAD = 2;

const MONTH_MAP: Record<string, number> = {
  January: 1, February: 2, March: 3, April: 4, May: 5, June: 6,
  July: 7, August: 8, September: 9, October: 10, November: 11, December: 12,
};

function parseTime(timeStr: string): { hour: number; minute: number } | null {
  // "2:00 PM", "6:00pm", "10:00 AM"
  const m = timeStr.match(/(\d{1,2}):(\d{2})\s*(am|pm)/i);
  if (!m) return null;
  let hour = parseInt(m[1]);
  const minute = parseInt(m[2]);
  const ampm = m[3].toLowerCase();
  if (ampm === "pm" && hour !== 12) hour += 12;
  if (ampm === "am" && hour === 12) hour = 0;
  return { hour, minute };
}

function parseDateLine(
  dateLine: string,
  timeLine: string,
  year: number
): { startDate: Date; endDate?: Date } | null {
  // dateLine: "Monday, May 5" or "Mon, 5/4/2026"
  let month: number | undefined;
  let day: number | undefined;

  // Try "Month Day" format first
  const namedMatch = dateLine.match(/([A-Z][a-z]+)\s+(\d{1,2})/);
  if (namedMatch) {
    month = MONTH_MAP[namedMatch[1]];
    day = parseInt(namedMatch[2]);
  }

  // Fall back to M/D/YYYY numeric format
  if (!month || !day) {
    const numericMatch = dateLine.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?/);
    if (numericMatch) {
      month = parseInt(numericMatch[1]);
      day = parseInt(numericMatch[2]);
      if (numericMatch[3]) year = parseInt(numericMatch[3]);
    }
  }

  if (!month || !day) return null;

  // timeLine: "2:00 PM - 3:30 PM" or "6:00pm"
  const timeParts = timeLine.split(/\s*[-–]\s*/);
  const start = parseTime(timeParts[0] ?? "");
  if (!start) {
    // Default to 7 PM if no time found
    return {
      startDate: sfDateFromLocal(year, month, day, 19, 0),
    };
  }

  const startDate = sfDateFromLocal(year, month, day, start.hour, start.minute);

  let endDate: Date | undefined;
  if (timeParts[1]) {
    const end = parseTime(timeParts[1]);
    if (end) endDate = sfDateFromLocal(year, month, day, end.hour, end.minute);
  }

  return { startDate, endDate };
}

export class GreenAppleBooksScraper extends BaseScraper {
  readonly sourceSlug = "greenapplebooks";

  async scrape(): Promise<ScrapedEvent[]> {
    const events: ScrapedEvent[] = [];
    const seen = new Set<string>();
    const nowMs = Date.now();

    const now = new Date();

    for (let offset = 0; offset <= MONTHS_AHEAD; offset++) {
      const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
      const year = d.getFullYear();
      const month = d.getMonth() + 1;
      const monthStr = month.toString().padStart(2, "0");
      const url = `${BASE_URL}/events/${year}/${monthStr}`;

      let html: string;
      try {
        const { data } = await axios.get<string>(url, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            Accept: "text/html,application/xhtml+xml",
          },
          timeout: 15_000,
        });
        html = data;
      } catch (err: any) {
        console.error(`[greenapplebooks] failed to fetch ${url}:`, err.message);
        continue;
      }

      const $ = cheerio.load(html);
      this.parsePage($, year, month, nowMs, seen, events);
    }

    console.log(`[greenapplebooks] scraped ${events.length} upcoming events`);
    return events;
  }

  private parsePage(
    $: ReturnType<typeof cheerio.load>,
    year: number,
    month: number,
    nowMs: number,
    seen: Set<string>,
    events: ScrapedEvent[]
  ): void {
    // Find event anchor links — Green Apple uses /event/YYYY-MM-DD/slug paths
    const eventLinks = $('a[href*="/event/"]');
    const processed = new Set<string>();

    eventLinks.each((_i, el) => {
      const $a = $(el);
      const href = $a.attr("href") ?? "";
      if (!href || processed.has(href)) return;
      processed.add(href);

      // Walk up to find the containing event block
      const $block =
        $a.closest("article") ??
        $a.closest(".views-row") ??
        $a.closest("li") ??
        $a.parent();

      const title = ($block.find("h1,h2,h3,h4").first().text() || $a.text()).trim();
      if (!title || title.length < 3) return;

      const sourceUrl = href.startsWith("http") ? href : `${BASE_URL}${href}`;
      if (seen.has(sourceUrl)) return;
      seen.add(sourceUrl);

      const blockText = $block.text();

      // Extract date line: looks for "Monday, May 5" or "Mon, 5/4/2026"
      const dateLine =
        blockText.match(/(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,?\s+(?:\d{1,2}\/\d{1,2}\/\d{4}|[A-Z][a-z]+ \d{1,2})/)?.[0] ?? "";

      // Extract time line: "2:00 PM - 3:30 PM" or "6:00pm"
      const timeLine =
        blockText.match(/\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)(?:\s*[-–]\s*\d{1,2}:\d{2}\s*(?:AM|PM|am|pm))?/)?.[0] ?? "";

      const parsed = dateLine
        ? parseDateLine(dateLine, timeLine, year)
        : null;

      if (!parsed) return;
      if (parsed.startDate.getTime() < nowMs - 86_400_000) return;

      // Venue: look for "Place:" label in block text
      let venueName = "Green Apple Books";
      let venueAddress = "506 Clement St, San Francisco, CA 94118";
      const placeMatch = blockText.match(/Place:\s*([^\n]+)/);
      if (placeMatch) {
        const placeText = placeMatch[1].trim();
        // First line = venue name, rest = address (rough heuristic)
        const placeParts = placeText.split(/\s{2,}|\n/);
        if (placeParts[0]) venueName = placeParts[0].trim();
        if (placeParts[1]) venueAddress = placeParts.slice(1).join(", ").trim();
      }

      // Image
      const imageUrl =
        $block.find('img[src*="/sites/default/files/"]').first().attr("src") ??
        $block.find("img").first().attr("src") ??
        undefined;

      // Prefer external RSVP/ticket link as sourceUrl if present
      const rsvpLink = $block
        .find('a[href*="eventbrite"], a[href*="thethirdplace"], a[href*="forms.gle"]')
        .first()
        .attr("href");

      events.push({
        title,
        startDate: parsed.startDate,
        endDate: parsed.endDate,
        sourceUrl: rsvpLink ?? sourceUrl,
        imageUrl: imageUrl ? (imageUrl.startsWith("http") ? imageUrl : `${BASE_URL}${imageUrl}`) : undefined,
        venueName,
        venueAddress,
        tags: ["bookstore", "literary", "green-apple-books"],
      });
    });
  }
}
