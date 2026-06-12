import { BaseScraper } from "./base";
import type { ScrapedEvent } from "./base";
import { sfDateFromLocal } from "@/lib/sfDate";

const BASE_URL = "https://www.bandsintown.com";
const CITY_URL = `${BASE_URL}/c/san-francisco-ca`;

const MONTH_MAP: Record<string, number> = {
  Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6,
  Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12,
};

/**
 * Genre pages to load. The default city page is all-genres (mostly music); the
 * comedy genre page is a filtered subset. Comedy is loaded first so that any
 * event appearing on both pages keeps the explicit COMEDY category/tags (see
 * cross-page dedupe in scrape()).
 */
type Genre = {
  url: string;
  /** Pre-assigned category — skips LLM categorization in the runner. */
  category?: string;
  tags: string[];
};

const GENRES: Genre[] = [
  { url: `${CITY_URL}/all-dates/genre/comedy`, category: "COMEDY", tags: ["comedy"] },
  { url: CITY_URL, tags: ["music", "concert", "live"] },
];

type RawCard = { path: string; imgPhotoId: string; text: string };

/**
 * Bandsintown SF — bandsintown.com/c/san-francisco-ca (+ /genre/comedy)
 *
 * JS-rendered SPA. Each event card is an <a href="/e/ID-slug"> containing:
 *   - img src: https://photos.bandsintown.com/thumb/NNNNN.jpeg  (use /large/)
 *   - innerText: "<month> <day> - <time>\n<attendees>\n<artist>\n<venue>\nTickets"
 */
export class BandsintownScraper extends BaseScraper {
  readonly sourceSlug = "bandsintown";

  async scrape(): Promise<ScrapedEvent[]> {
    const { chromium } = await import("playwright-extra");
    const StealthPlugin = (await import("puppeteer-extra-plugin-stealth")).default;
    chromium.use(StealthPlugin());

    const browser = await chromium.launch({ headless: true, timeout: 60000 });
    const page = await browser.newPage();
    page.setDefaultTimeout(60000);
    // Large viewport so all lazy-loaded images enter the visible area at once
    await page.setViewportSize({ width: 1280, height: 20000 });

    // Listen for photo requests to capture image URLs (they may be lazy-loaded)
    const capturedPhotos = new Map<string, string>(); // photoId → full URL
    page.on("request", (request) => {
      const url = request.url();
      if (!url.includes("photos.bandsintown.com")) return;
      // Bandsintown uses Next.js image proxy: /_next/image?url=<encoded-url>
      // The encoded URL still contains "photos.bandsintown.com" as a substring,
      // but slashes are encoded as %2F so the path regex won't match directly.
      const nextImgParam = url.match(/[?&]url=([^&]+)/);
      const effectiveUrl = nextImgParam ? decodeURIComponent(nextImgParam[1]) : url;
      const photoIdMatch = effectiveUrl.match(/\/(?:thumb|large)\/(\d+)\./);
      if (photoIdMatch) capturedPhotos.set(photoIdMatch[1], effectiveUrl);
    });

    try {
      const events: ScrapedEvent[] = [];
      // Dedupe across genre pages — the all-genres city page overlaps the comedy
      // page, so we keep the first occurrence (comedy is loaded first).
      const seenPaths = new Set<string>();

      for (const genre of GENRES) {
        const rawCards = await this.loadGenrePage(page, genre.url);

        for (const raw of rawCards) {
          if (seenPaths.has(raw.path)) continue;
          seenPaths.add(raw.path);

          const imgSrc = raw.imgPhotoId
            ? (capturedPhotos.get(raw.imgPhotoId)?.replace("/thumb/", "/large/") ??
               `https://photos.bandsintown.com/large/${raw.imgPhotoId}.jpeg`)
            : "";

          const event = this.parseCard(raw.path, imgSrc, raw.text, genre);
          if (event) events.push(event);
        }
      }

      return events;
    } finally {
      await browser.close();
    }
  }

  /** Navigate to a genre page and extract the raw card data for each event. */
  private async loadGenrePage(
    page: import("playwright-core").Page,
    url: string
  ): Promise<RawCard[]> {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    // Wait for at least one event card to appear (JS-rendered SPA). A genre page
    // with no upcoming events never renders a card — treat that as empty.
    const hasCards = await page
      .waitForSelector('a[href*="/e/"]', { timeout: 45000 })
      .then(() => true)
      .catch(() => false);
    if (!hasCards) return [];

    // Wait for photo images to load (large viewport makes them all visible).
    // Bandsintown proxies images via /_next/image, so match on that or the direct CDN URL.
    await page.waitForSelector('img[src*="photos.bandsintown.com"], img[src*="/_next/image"]', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(500);

    return page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('a[href*="/e/"]'));
      const seen = new Set<string>();
      const results: Array<{
        path: string;
        imgPhotoId: string;
        text: string;
      }> = [];

      for (const card of cards) {
        const anchor = card as HTMLAnchorElement;
        const path = anchor.pathname;
        if (seen.has(path)) continue;
        seen.add(path);

        const parent =
          anchor.closest("li") ??
          anchor.closest("[data-testid]") ??
          anchor.parentElement?.parentElement ??
          anchor;

        // Try to find photo ID from any img in the card
        let photoId = "";
        const imgs = (parent as Element).querySelectorAll("img");
        for (const img of Array.from(imgs)) {
          let src = img.getAttribute("src") ?? img.getAttribute("data-src") ?? "";
          // Decode Next.js image proxy URLs: /_next/image?url=<encoded-url>
          const nextImgParam = src.match(/[?&]url=([^&]+)/);
          if (nextImgParam) src = decodeURIComponent(nextImgParam[1]);
          const match = src.match(/\/(?:thumb|large)\/(\d+)\./);
          if (match) { photoId = match[1]; break; }
        }

        const text = (parent as HTMLElement).innerText ?? "";
        results.push({ path, imgPhotoId: photoId, text });
      }
      return results;
    });
  }

  private parseCard(
    path: string,
    imgSrc: string,
    text: string,
    genre: Genre
  ): ScrapedEvent | null {
    // Text format (lines after trimming):
    // ["Apr 6 - 7:00 pm", "563", "The Strokes", "Bill Graham Civic Auditorium", "Tickets"]
    // Some cards may also have a "PROMOTED" prefix line.
    const lines = text
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    // Find the date/time line: "Apr 6 - 7:00 pm"
    const dateLineIdx = lines.findIndex((l) =>
      /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d/.test(l)
    );
    if (dateLineIdx === -1) return null;

    const dateLine = lines[dateLineIdx]; // e.g. "Apr 6 - 7:00 pm"
    const dateMatch = dateLine.match(
      /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})\s*[-–]\s*(\d{1,2}:\d{2}\s*[ap]m)/i
    );
    if (!dateMatch) return null;

    const month = MONTH_MAP[dateMatch[1]];
    const day = parseInt(dateMatch[2]);
    const timeStr = dateMatch[3].toLowerCase().replace(/\s/g, ""); // "7:00pm"
    const year = this.resolveYear(month, day);

    const startDate = this.parseDateTime(year, month, day, timeStr);
    if (!startDate) return null;

    // Skip the attendee count line (pure number like "563" or "1,232")
    const afterDate = lines.slice(dateLineIdx + 1);
    const attendeeIdx = afterDate.findIndex((l) => /^\d[\d,]*$/.test(l));
    const contentLines = attendeeIdx >= 0 ? afterDate.slice(attendeeIdx + 1) : afterDate;

    // First content line = artist/event name; second = venue
    const [artist, venue] = contentLines;
    if (!artist) return null;

    const sourceUrl = `${BASE_URL}${path}`;
    const imageUrl = imgSrc && !imgSrc.includes("assets.prod.bandsintown.com") && !imgSrc.includes("/null.") ? imgSrc : undefined;

    return {
      title: artist,
      startDate,
      venueName: venue ?? undefined,
      imageUrl,
      sourceUrl,
      category: genre.category,
      tags: genre.tags,
      performers: [artist],
    };
  }

  private parseDateTime(
    year: number,
    month: number,
    day: number,
    timeStr: string // e.g. "7:00pm"
  ): Date | null {
    const match = timeStr.match(/(\d{1,2}):(\d{2})(am|pm)/i);
    if (!match) return null;
    let hours = parseInt(match[1]);
    const minutes = parseInt(match[2]);
    const period = match[3].toLowerCase();
    if (period === "pm" && hours !== 12) hours += 12;
    if (period === "am" && hours === 12) hours = 0;
    return sfDateFromLocal(year, month, day, hours, minutes);
  }
}
