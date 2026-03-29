import axios from "axios";
import * as cheerio from "cheerio";
import { BaseScraper } from "./base";
import type { ScrapedEvent } from "./base";
import { sfDateFromLocal } from "@/lib/sfDate";

/**
 * 19hz Bay Area Electronic Music — 19hz.info/eventlisting_BayArea.php
 *
 * Table with columns: Date/Time | Event+Venue | Genre | Price | Organizer | Links
 */
export class NineteenHzScraper extends BaseScraper {
  readonly sourceSlug = "19hz";

  async scrape(): Promise<ScrapedEvent[]> {
    const { data: html } = await axios.get(
      "https://19hz.info/eventlisting_BayArea.php",
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
        },
        timeout: 15000,
      }
    );

    const $ = cheerio.load(html);
    const events: ScrapedEvent[] = [];

    // Skip header row; each subsequent tr is one event
    $("table tr").slice(1).each((_i, row) => {
      const tds = $(row).find("td");
      if (tds.length < 3) return;

      // Column 0: "Fri: Mar 28 (10:00pm-3:00am)"
      const dateTimeRaw = $(tds[0]).text().trim();
      const parsed = parseDateTimeCell(dateTimeRaw);
      if (!parsed) return;

      // Column 1: event title (in <b> or link) + venue (after separator or in next line)
      const col1 = $(tds[1]);
      const titleEl = col1.find("b, a").first();
      const title = titleEl.text().trim() || col1.text().split("\n")[0].trim();
      if (!title) return;

      // Venue: text after the title link / bold in same cell
      const col1Text = col1.text();
      const venueMatch = col1Text.replace(title, "").trim();
      const venue = venueMatch.replace(/^[•\-@·\s]+/, "").trim().split("\n")[0].trim();

      // Column 2: genres → tags
      const genreText = $(tds[2]).text().trim();
      const tags = genreText
        ? genreText.split(/[,/]/).map((g) => g.trim().toLowerCase()).filter(Boolean)
        : ["electronic"];

      // Column 3: price
      const priceText = $(tds[3])?.text().trim();
      const price = priceText && priceText !== "-" ? priceText : undefined;

      // Source URL: prefer external links from the Links column (col 5),
      // then fall back to any external link in the row.
      // The first link in col 1 is often a relative 19hz URL like "event.php?id=..."
      // which has no useful image; the Links column has Eventbrite/RA/venue URLs.
      let sourceUrl = "https://19hz.info/eventlisting_BayArea.php";
      if (tds[5]) {
        $(tds[5]).find("a").each((_j, a) => {
          const h = $(a).attr("href");
          if (h?.startsWith("http") && !h.includes("19hz.info")) {
            sourceUrl = h;
            return false; // break
          }
        });
      }
      if (sourceUrl.includes("19hz.info")) {
        $(row).find("a").each((_j, a) => {
          const h = $(a).attr("href");
          if (h?.startsWith("http") && !h.includes("19hz.info")) {
            sourceUrl = h;
            return false; // break
          }
        });
      }

      events.push({
        title,
        startDate: parsed.start,
        endDate: parsed.end ?? undefined,
        venueName: venue || undefined,
        price,
        isFree: this.parseFree(price),
        tags,
        sourceUrl,
      });
    });

    return events;
  }
}

/**
 * Parse "Fri: Mar 28 (10:00pm-3:00am)" into Date objects.
 */
function parseDateTimeCell(
  raw: string
): { start: Date; end: Date | null } | null {
  // Example: "Fri: Mar 28 (10:00pm-3:00am)" or "Sat: Apr 5"
  const dayMonthMatch = raw.match(
    /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})/
  );
  if (!dayMonthMatch) return null;

  const monthMap: Record<string, number> = {
    Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6,
    Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12,
  };
  const month = monthMap[dayMonthMatch[1]];
  const day = parseInt(dayMonthMatch[2]);

  // Determine year using rolling heuristic
  const now = new Date();
  const currentYear = now.getFullYear();
  const candidate = new Date(currentYear, month - 1, day);
  const diffDays =
    (candidate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
  const year = diffDays < -60 ? currentYear + 1 : currentYear;

  // Parse time range
  const timeMatch = raw.match(/\((\d{1,2}(?::\d{2})?(?:am|pm))(?:-(?:(\d{1,2}(?::\d{2})?(?:am|pm))|late))?\)/i);
  const startTime = timeMatch ? parse12h(timeMatch[1]) : { hours: 21, minutes: 0 };
  const endTime = timeMatch?.[2] ? parse12h(timeMatch[2]) : null;

  const start = sfDateFromLocal(year, month, day, startTime.hours, startTime.minutes);

  // End time: if AM and start is PM, it's next day
  let end: Date | null = null;
  if (endTime) {
    const endDay =
      endTime.hours < startTime.hours && startTime.hours >= 20 ? day + 1 : day;
    end = sfDateFromLocal(year, month, endDay, endTime.hours, endTime.minutes);
  }

  return { start, end };
}

function parse12h(timeStr: string): { hours: number; minutes: number } {
  const match = timeStr.match(/(\d{1,2})(?::(\d{2}))?(am|pm)/i);
  if (!match) return { hours: 0, minutes: 0 };
  let hours = parseInt(match[1]);
  const minutes = parseInt(match[2] ?? "0");
  const period = match[3].toLowerCase();
  if (period === "pm" && hours !== 12) hours += 12;
  if (period === "am" && hours === 12) hours = 0;
  return { hours, minutes };
}
