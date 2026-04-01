import axios from "axios";
import { BaseScraper } from "./base";
import type { ScrapedEvent } from "./base";
import { sfDateFromLocal } from "@/lib/sfDate";

/**
 * Reddit r/SFEvents — reddit.com/r/SFEvents
 *
 * Uses Reddit's public JSON API (no auth required).
 * Parses event date/time from post titles, which commonly follow patterns like:
 *   [3/28] Event Name at Venue
 *   [March 28] Event Name
 *   [Sat 3/28] Event Name @ Venue, 8pm
 *   [03/28/26] Event Name
 *
 * Posts where no date can be extracted are skipped.
 */

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

const MONTH_NAMES: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

/**
 * Try to extract a date (and optional time) from a Reddit post title.
 * Returns a Date in SF local time, or null if no date found.
 */
function parseDateFromTitle(title: string, createdUtc: number): Date | null {
  const now = new Date();
  const currentYear = now.getFullYear();

  // Strip leading day-of-week abbreviations inside brackets: [Sat 3/28] → [3/28]
  const normalizedTitle = title.replace(/\[(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?\s+/i, "[");

  // Pattern 1: [M/D] or [MM/DD] or [M/D/YY] or [MM/DD/YY] or [MM/DD/YYYY]
  const numericDateMatch = normalizedTitle.match(/\[(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\]/i);
  if (numericDateMatch) {
    const month = parseInt(numericDateMatch[1]);
    const day = parseInt(numericDateMatch[2]);
    let year = currentYear;
    if (numericDateMatch[3]) {
      const raw = parseInt(numericDateMatch[3]);
      year = raw < 100 ? 2000 + raw : raw;
    } else {
      year = resolveYear(month, day, now);
    }
    const time = extractTime(title);
    return sfDateFromLocal(year, month, day, time.hours, time.minutes);
  }

  // Pattern 2: [Month D] or [Month DD] e.g. [March 28] or [Mar 28]
  const namedMonthMatch = normalizedTitle.match(/\[([A-Za-z]+)\.?\s+(\d{1,2})(?:,?\s*(\d{4}))?\]/i);
  if (namedMonthMatch) {
    const monthKey = namedMonthMatch[1].toLowerCase();
    const month = MONTH_NAMES[monthKey];
    if (month) {
      const day = parseInt(namedMonthMatch[2]);
      const year = namedMonthMatch[3] ? parseInt(namedMonthMatch[3]) : resolveYear(month, day, now);
      const time = extractTime(title);
      return sfDateFromLocal(year, month, day, time.hours, time.minutes);
    }
  }

  // Pattern 3: date anywhere in title like "March 28," or "March 28th"
  const looseMatch = title.match(/\b([A-Za-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?/i);
  if (looseMatch) {
    const monthKey = looseMatch[1].toLowerCase();
    const month = MONTH_NAMES[monthKey];
    if (month) {
      const day = parseInt(looseMatch[2]);
      const year = looseMatch[3] ? parseInt(looseMatch[3]) : resolveYear(month, day, now);
      const time = extractTime(title);
      return sfDateFromLocal(year, month, day, time.hours, time.minutes);
    }
  }

  return null;
}

function resolveYear(month: number, day: number, now: Date): number {
  const currentYear = now.getFullYear();
  const candidate = new Date(currentYear, month - 1, day);
  const diffDays = (candidate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
  return diffDays < -60 ? currentYear + 1 : currentYear;
}

/**
 * Try to extract a time from a string like "8pm", "7:30pm", "8:00 PM".
 * Returns { hours: 0, minutes: 0 } (midnight) if none found — events without
 * a time will still appear on the correct day.
 */
function extractTime(text: string): { hours: number; minutes: number } {
  const match = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (!match) return { hours: 0, minutes: 0 };
  let hours = parseInt(match[1]);
  const minutes = match[2] ? parseInt(match[2]) : 0;
  const period = match[3].toLowerCase();
  if (period === "pm" && hours !== 12) hours += 12;
  if (period === "am" && hours === 12) hours = 0;
  return { hours, minutes };
}

/**
 * Strip the bracketed date/time prefix commonly used in r/SFEvents titles,
 * e.g. "[3/28] Live Jazz at The Fillmore" → "Live Jazz at The Fillmore"
 */
function cleanTitle(title: string): string {
  return title
    .replace(/^\[.*?\]\s*/, "")
    .replace(/\s*\(.*?\)\s*$/, "")
    .trim();
}

interface RedditPost {
  data: {
    id: string;
    title: string;
    selftext: string;
    url: string;
    permalink: string;
    created_utc: number;
    thumbnail: string;
    preview?: {
      images: Array<{
        source: { url: string };
      }>;
    };
  };
}

interface RedditListing {
  data: {
    children: RedditPost[];
    after: string | null;
  };
}

export class RedditSFEventsScraper extends BaseScraper {
  readonly sourceSlug = "reddit-sfevents";
  private readonly MAX_PAGES = parseInt(process.env.MAX_PAGES_REDDIT ?? "3");
  private readonly SUBREDDIT_URL = "https://www.reddit.com/r/SFEvents";

  async scrape(): Promise<ScrapedEvent[]> {
    const events: ScrapedEvent[] = [];
    let after: string | null = null;

    for (let page = 0; page < this.MAX_PAGES; page++) {
      const requestUrl: string = `${this.SUBREDDIT_URL}.json?limit=100${after ? `&after=${after}` : ""}`;

      try {
        const response: import("axios").AxiosResponse<RedditListing> = await axios.get<RedditListing>(requestUrl, {
          headers: {
            "User-Agent": "web:happening-sf:1.0 (by /u/happeningsf)",
            Accept: "application/json",
          },
          timeout: 15000,
        });

        const posts = response.data.data.children;
        if (posts.length === 0) break;

        for (const post of posts) {
          const event = this.parsePost(post);
          if (event) events.push(event);
        }

        after = response.data.data.after;
        if (!after) break;
      } catch (err: any) {
        console.error(`[reddit-sfevents] Error on page ${page + 1}:`, (err as Error).message);
        break;
      }
    }

    return events;
  }

  private parsePost(post: RedditPost): ScrapedEvent | null {
    const { id, selftext, permalink, created_utc, preview } = post.data;
    const title = decodeHtmlEntities(post.data.title);

    const startDate = parseDateFromTitle(title, created_utc);
    if (!startDate) return null;

    // Skip events in the past (more than 1 day ago)
    if (startDate.getTime() < Date.now() - 86400_000) return null;

    const cleanedTitle = cleanTitle(title) || title;
    const sourceUrl = `https://www.reddit.com${permalink}`;

    // Extract image from Reddit's preview (if available)
    let imageUrl: string | undefined;
    if (preview?.images?.[0]?.source?.url) {
      // Reddit encodes preview URLs with HTML entities
      imageUrl = preview.images[0].source.url.replace(/&amp;/g, "&");
    }

    // Use selftext as description if it has meaningful content
    const description = selftext && selftext !== "[removed]" && selftext !== "[deleted]"
      ? selftext.slice(0, 500).replace(/\s+\S*$/, "").trim() || undefined
      : undefined;

    return {
      externalId: id,
      title: cleanedTitle,
      description,
      startDate,
      sourceUrl,
      imageUrl,
      tags: ["reddit", "sf"],
    };
  }
}
