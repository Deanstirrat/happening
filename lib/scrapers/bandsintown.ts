import { BaseScraper } from "./base";
import type { ScrapedEvent } from "./base";

const BASE_URL = "https://www.bandsintown.com";
const CITY_URL = `${BASE_URL}/c/san-francisco-ca`;

const MONTH_MAP: Record<string, number> = {
  Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6,
  Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12,
};

/**
 * Bandsintown SF — bandsintown.com/c/san-francisco-ca
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

    const browser = await chromium.launch({ headless: true, channel: "chrome" });
    const page = await browser.newPage();
    // Large viewport so all lazy-loaded images enter the visible area at once
    await page.setViewportSize({ width: 1280, height: 20000 });

    // Listen for photo requests to capture image URLs (they may be lazy-loaded)
    const capturedPhotos = new Map<string, string>(); // photoId → full URL
    page.on("request", (request) => {
      const url = request.url();
      if (!url.includes("photos.bandsintown.com")) return;
      const photoIdMatch = url.match(/\/(?:thumb|large)\/(\d+)\./);
      if (photoIdMatch) capturedPhotos.set(photoIdMatch[1], url);
    });

    try {
      await page.goto(CITY_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
      // Wait for at least one event card to appear (JS-rendered SPA)
      await page.waitForSelector('a[href*="/e/"]', { timeout: 45000 });

      // Wait for photo images to load (large viewport makes them all visible)
      await page.waitForSelector('img[src*="photos.bandsintown.com"]', { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(500);

      const rawEvents = await page.evaluate(() => {
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
            const src = img.getAttribute("src") ?? img.getAttribute("data-src") ?? "";
            const match = src.match(/\/(?:thumb|large)\/(\d+)\./);
            if (match) { photoId = match[1]; break; }
          }

          const text = (parent as HTMLElement).innerText ?? "";
          results.push({ path, imgPhotoId: photoId, text });
        }
        return results;
      });

      // Merge captured photo URLs into the results
      const rawEventsWithImages = rawEvents.map((e) => ({
        ...e,
        imgSrc: e.imgPhotoId
          ? (capturedPhotos.get(e.imgPhotoId)?.replace("/thumb/", "/large/") ??
             `https://photos.bandsintown.com/large/${e.imgPhotoId}.jpeg`)
          : "",
      }));

      return rawEventsWithImages.flatMap((raw) => {
        const event = this.parseCard(raw.path, raw.imgSrc, raw.text);
        return event ? [event] : [];
      });
    } finally {
      await browser.close();
    }
  }

  private parseCard(
    path: string,
    imgSrc: string,
    text: string
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
      tags: ["music", "concert", "live"],
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
    return new Date(year, month - 1, day, hours, minutes);
  }
}
