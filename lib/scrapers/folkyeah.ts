import axios from "axios";
import * as cheerio from "cheerio";
import { BaseScraper } from "./base";
import type { ScrapedEvent } from "./base";
import { sfDateFromLocal } from "@/lib/sfDate";

const SOURCE_URL = "https://folkyeah.com/";

const MONTH_MAP: Record<string, number> = {
  January: 1, February: 2, March: 3, April: 4, May: 5, June: 6,
  July: 7, August: 8, September: 9, October: 10, November: 11, December: 12,
};

function parseDate(text: string): { month: number; day: number; year?: number } | null {
  // Handles: "Friday, June 12, 2026", "June 12, 2026", "June 12th, 2026",
  //          "June 4" (no year), "Monday, June 8, 2026 - Performing Tigermilk"
  const match = text.match(
    /(?:[A-Z][a-z]+,\s+)?([A-Z][a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})?/
  );
  if (!match) return null;
  const month = MONTH_MAP[match[1]];
  const day = parseInt(match[2]);
  const year = match[3] ? parseInt(match[3]) : undefined;
  if (!month || !day) return null;
  return { month, day, year };
}

function parseShowTime(text: string): { hour: number; minute: number } {
  // "Doors 7pm / Show 8pm", "Doors at 7:30PM / Show at 8:30PM",
  // "Gates 5pm / Show 7pm", "Doors 7 pm / Show 8 pm"
  // Prefer "Show" time; fall back to "Doors/Gates" time; default 8 PM
  const showMatch = text.match(/[Ss]how\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|AM|PM)/);
  if (showMatch) {
    let hour = parseInt(showMatch[1]);
    const minute = showMatch[2] ? parseInt(showMatch[2]) : 0;
    if (showMatch[3].toLowerCase() === "pm" && hour !== 12) hour += 12;
    if (showMatch[3].toLowerCase() === "am" && hour === 12) hour = 0;
    return { hour, minute };
  }
  const doorsMatch = text.match(/(?:[Dd]oors|[Gg]ates)\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|AM|PM)/);
  if (doorsMatch) {
    let hour = parseInt(doorsMatch[1]);
    const minute = doorsMatch[2] ? parseInt(doorsMatch[2]) : 0;
    if (doorsMatch[3].toLowerCase() === "pm" && hour !== 12) hour += 12;
    if (doorsMatch[3].toLowerCase() === "am" && hour === 12) hour = 0;
    return { hour, minute };
  }
  return { hour: 20, minute: 0 };
}

const TITLE_LOWERCASE = new Set(["a", "an", "the", "and", "but", "or", "for", "nor", "on", "at", "to", "by", "in", "of", "up"]);

function toTitleCase(str: string): string {
  return str
    .toLowerCase()
    .split(/\s+/)
    .map((word, i) => {
      if (i === 0 || !TITLE_LOWERCASE.has(word)) return word.charAt(0).toUpperCase() + word.slice(1);
      return word;
    })
    .join(" ");
}

export class FolkYeahScraper extends BaseScraper {
  readonly sourceSlug = "folkyeah";

  async scrape(): Promise<ScrapedEvent[]> {
    let html: string;
    try {
      const { data } = await axios.get<string>(SOURCE_URL, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml",
        },
        timeout: 15_000,
      });
      html = data;
    } catch (err: any) {
      console.error("[folkyeah] failed to fetch page:", err.message);
      return [];
    }

    const $ = cheerio.load(html);
    const events: ScrapedEvent[] = [];
    const nowMs = Date.now();

    $(".project.gallery-project").each((_i, el) => {
      const $el = $(el);
      const descEl = $el.find(".project-description");
      if (!descEl.length) return;

      // Fallback URL: the project's own page on folkyeah.com
      const dataUrl = $el.attr("data-url") ?? "";
      const projectUrl = dataUrl ? `https://folkyeah.com${dataUrl}` : SOURCE_URL;

      // First external ticket link in the description
      let ticketUrl = projectUrl;
      descEl.find("a[href]").each((_j, a) => {
        if (ticketUrl !== projectUrl) return false;
        const href = $(a).attr("href") ?? "";
        if (href.startsWith("http")) {
          ticketUrl = href;
          return false;
        }
      });

      // Collect all strong-tag text values (strip HTML, normalize &nbsp;)
      const strongs: string[] = [];
      descEl.find("strong").each((_j, s) => {
        const text = $(s).text().replace(/ /g, " ").replace(/&amp;/g, "&").trim();
        if (text) strongs.push(text);
      });

      // Artist name: first ALL-CAPS strong (letters only) that isn't a ticket/presenter line
      let artistName = "";
      for (const s of strongs) {
        if (s === "PURCHASE TICKETS HERE" || s === "TICKETS") continue;
        if (/folkYEAH/i.test(s)) continue;
        const letters = s.replace(/[^a-zA-Z]/g, "");
        if (letters.length > 0 && letters === letters.toUpperCase()) {
          artistName = toTitleCase(s);
          break;
        }
      }
      if (!artistName) return;

      // Date strongs: contain a month name and digits, but not time keywords
      const dateStrings: string[] = [];
      for (const s of strongs) {
        if (
          /(?:January|February|March|April|May|June|July|August|September|October|November|December)/i.test(s) &&
          /\d/.test(s) &&
          !/Doors|Show|Gates/i.test(s)
        ) {
          dateStrings.push(s);
        }
      }

      // Time: first strong containing "Doors", "Show", or "Gates"
      let timeInfo = { hour: 20, minute: 0 };
      for (const s of strongs) {
        if (/[Dd]oors|[Ss]how|[Gg]ates/i.test(s)) {
          timeInfo = parseShowTime(s);
          break;
        }
      }

      // Venue: the strong immediately before a "City, CA" strong. folkYEAH is a
      // statewide touring promoter, so we also capture that "City, CA" line into
      // venueAddress — it's the only locality signal these listings carry, and it
      // lets the out-of-area filter (lib/ingestFilters.ts) drop the many shows
      // outside our service area (Ojai, Santa Cruz, Ventura, …).
      let venueName: string | undefined;
      let venueAddress: string | undefined;
      for (let i = 1; i < strongs.length; i++) {
        if (/,\s*CA\b/i.test(strongs[i])) {
          venueAddress = strongs[i].trim();
          const prev = strongs[i - 1];
          const isDateLike = /(?:January|February|March|April|May|June|July|August|September|October|November|December)/i.test(prev);
          const isPresenter = /folkYEAH/i.test(prev);
          const isTicket = prev === "PURCHASE TICKETS HERE" || prev === "TICKETS";
          const isTime = /[Dd]oors|[Ss]how|[Gg]ates/i.test(prev);
          if (!isDateLike && !isPresenter && !isTicket && !isTime) {
            venueName = prev;
          }
          break;
        }
      }

      // Emit one event per date found (handles multi-night events)
      if (dateStrings.length > 0) {
        for (const dateStr of dateStrings) {
          const parsed = parseDate(dateStr);
          if (!parsed) continue;
          const year = parsed.year ?? this.resolveYear(parsed.month, parsed.day);
          const startDate = sfDateFromLocal(year, parsed.month, parsed.day, timeInfo.hour, timeInfo.minute);
          if (startDate.getTime() < nowMs - 86_400_000) continue;

          events.push({
            title: artistName,
            startDate,
            sourceUrl: ticketUrl,
            venueName,
            venueAddress,
            tags: ["music", "live", "folkyeah"],
          });
        }
        return;
      }

      // Fallback: parse date from h2 text "Artist City M/D"
      const h2Text = $el.find("h2.project-title").text().trim();
      const shortDateMatch = h2Text.match(/(\d{1,2})\/(\d{1,2})$/);
      if (shortDateMatch) {
        const month = parseInt(shortDateMatch[1]);
        const day = parseInt(shortDateMatch[2]);
        const year = this.resolveYear(month, day);
        const startDate = sfDateFromLocal(year, month, day, timeInfo.hour, timeInfo.minute);
        if (startDate.getTime() < nowMs - 86_400_000) {
          events.push({
            title: artistName,
            startDate,
            sourceUrl: ticketUrl,
            venueName,
            venueAddress,
            tags: ["music", "live", "folkyeah"],
          });
        }
      }
    });

    console.log(`[folkyeah] scraped ${events.length} upcoming events`);
    return events;
  }
}
