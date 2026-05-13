import axios from "axios";
import * as cheerio from "cheerio";
import { BaseScraper } from "./base";
import type { ScrapedEvent } from "./base";
import { sfDateFromLocal } from "@/lib/sfDate";

/**
 * Borderlands Books — borderlands-books.com/v2/events/
 *
 * Static HTML events page. Dates appear as natural-language text near headings
 * (e.g. "January 15 at 7 pm"). Event program may periodically be on hold;
 * scraper returns [] gracefully when no parseable events are found.
 */

const EVENTS_URL = "https://borderlands-books.com/v2/events/";

const MONTH_INDEX: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

// Matches: "January 15 at 7 pm", "March 3rd at 6:30 pm", etc.
const DATE_RE =
  /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*\d{4})?\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i;

function parseBorderlandsDate(
  text: string,
  resolveYear: (m: number, d: number) => number
): Date | null {
  const m = DATE_RE.exec(text);
  if (!m) return null;

  const month = MONTH_INDEX[m[1].toLowerCase()];
  if (!month) return null;

  const day = parseInt(m[2]);
  let hour = parseInt(m[3]);
  const minute = m[4] ? parseInt(m[4]) : 0;
  const ampm = m[5].toLowerCase();

  if (ampm === "pm" && hour < 12) hour += 12;
  if (ampm === "am" && hour === 12) hour = 0;

  const year = resolveYear(month, day);
  return sfDateFromLocal(year, month, day, hour, minute);
}

export class BorderlandsBooksScraper extends BaseScraper {
  readonly sourceSlug = "borderlandsbooks";

  async scrape(): Promise<ScrapedEvent[]> {
    let html: string;
    try {
      const { data } = await axios.get<string>(EVENTS_URL, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml",
        },
        timeout: 15_000,
      });
      html = data;
    } catch (err: any) {
      console.error("[borderlandsbooks] failed to fetch events page:", err.message);
      return [];
    }

    const $ = cheerio.load(html);
    const events: ScrapedEvent[] = [];
    const nowMs = Date.now();

    // Look for event blocks: article, .event, or headings (h3/h4) with date text nearby
    const candidates: Array<{ title: string; text: string; url: string; imageUrl?: string }> = [];

    // Strategy 1: article or .event containers
    $("article, .event, .event-item").each((_i, el) => {
      const $el = $(el);
      const heading = $el.find("h1,h2,h3,h4").first();
      const title = heading.text().trim();
      if (!title) return;
      const linkEl = $el.find("a[href]").first();
      const url = linkEl.attr("href") ?? EVENTS_URL;
      const imageUrl = $el.find("img").first().attr("src") || undefined;
      candidates.push({ title, text: $el.text(), url: url.startsWith("http") ? url : `https://borderlands-books.com${url}`, imageUrl });
    });

    // Strategy 2: standalone h3/h4 headings followed by paragraphs with dates
    if (candidates.length === 0) {
      $("h3, h4").each((_i, el) => {
        const $heading = $(el);
        const title = $heading.text().trim();
        if (!title || title.length < 4) return;
        // Gather text from heading + following siblings until next heading
        let combinedText = title;
        let sibling = $heading.next();
        for (let i = 0; i < 5; i++) {
          if (!sibling.length) break;
          if (sibling.is("h1,h2,h3,h4")) break;
          combinedText += " " + sibling.text();
          sibling = sibling.next();
        }
        const linkEl = $heading.find("a[href]").first();
        const url = linkEl.attr("href") ?? EVENTS_URL;
        candidates.push({ title, text: combinedText, url: url.startsWith("http") ? url : `https://borderlands-books.com${url}` });
      });
    }

    for (const { title, text, url, imageUrl } of candidates) {
      const startDate = parseBorderlandsDate(text, this.resolveYear.bind(this));
      if (!startDate) continue;
      if (startDate.getTime() < nowMs - 86_400_000) continue;

      events.push({
        title,
        startDate,
        sourceUrl: url,
        imageUrl,
        venueName: "Borderlands Books",
        venueAddress: "866 Valencia St, San Francisco, CA 94110",
        tags: ["bookstore", "literary", "borderlands-books"],
      });
    }

    console.log(`[borderlandsbooks] scraped ${events.length} upcoming events`);
    return events;
  }
}
