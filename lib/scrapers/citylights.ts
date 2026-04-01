import { BaseScraper } from "./base";
import type { ScrapedEvent } from "./base";

/**
 * City Lights Booksellers & Publishers — citylights.com/events/
 *
 * WordPress site protected by Sucuri/Cloudproxy, which serves a JavaScript
 * cookie challenge to non-browser clients. We use Playwright with the stealth
 * plugin to pass the challenge and load the actual page.
 *
 * After the challenge resolves, the events listing renders standard HTML:
 *   .list-item-block          — event card
 *   h3.shortcode-title a      — event title + URL
 *   .list-img img             — event thumbnail
 *   .description-text         — event description
 *
 * NOTE: The p.shortcode-date[data-test] timestamp on the listing page is
 * unreliable (returns the current time instead of the event date). We visit
 * each event's detail page and parse the date from the visible text instead,
 * e.g. "TUESDAY, APRIL 7, 2026, 6:00 PM PST".
 */

const EVENTS_URL = "https://citylights.com/events/";

const MONTH_MAP: Record<string, number> = {
  JANUARY: 0, FEBRUARY: 1, MARCH: 2, APRIL: 3, MAY: 4, JUNE: 5,
  JULY: 6, AUGUST: 7, SEPTEMBER: 8, OCTOBER: 9, NOVEMBER: 10, DECEMBER: 11,
};

function parseCityLightsDate(dateStr: string): Date | null {
  // e.g. "TUESDAY, APRIL 7, 2026, 6:00 PM PST"
  const match = dateStr.match(
    /(\w+)\s+(\d+),\s+(\d{4}),\s+(\d+):(\d+)\s+(AM|PM)\s+(PST|PDT)/i
  );
  if (!match) return null;
  const [, month, day, year, hour, minute, ampm, tz] = match;
  const monthIdx = MONTH_MAP[month.toUpperCase()];
  if (monthIdx === undefined) return null;
  let h = parseInt(hour, 10);
  if (ampm.toUpperCase() === "PM" && h !== 12) h += 12;
  if (ampm.toUpperCase() === "AM" && h === 12) h = 0;
  const tzOffsetHours = tz.toUpperCase() === "PST" ? 8 : 7; // PST=UTC-8, PDT=UTC-7
  return new Date(
    Date.UTC(parseInt(year, 10), monthIdx, parseInt(day, 10), h + tzOffsetHours, parseInt(minute, 10))
  );
}

export class CityLightsScraper extends BaseScraper {
  readonly sourceSlug = "citylights";

  async scrape(): Promise<ScrapedEvent[]> {
    const { chromium } = await import("playwright-extra");
    const StealthPlugin = (await import("puppeteer-extra-plugin-stealth")).default;
    chromium.use(StealthPlugin());

    const browser = await chromium.launch({ headless: true, timeout: 60000 });
    const page = await browser.newPage();

    try {
      try {
        await page.goto(EVENTS_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
        // Wait for the Sucuri JS challenge to resolve and the event cards to appear
        await page.waitForSelector(".list-item-block", { timeout: 30_000 });
      } catch (err: any) {
        console.error(`[citylights] failed to load events page:`, err.message);
        return [];
      }

      const listingItems = await page.evaluate(() => {
        const results: Array<{
          title: string;
          sourceUrl: string;
          imageSrc: string;
          description: string;
        }> = [];

        document.querySelectorAll(".list-item-block").forEach((el) => {
          const $titleLink = el.querySelector("h3.shortcode-title a") as HTMLAnchorElement | null;
          const title = $titleLink?.textContent?.trim() ?? "";
          if (!title) return;
          const sourceUrl = $titleLink?.href ?? "";
          if (!sourceUrl) return;

          const imageSrc =
            (el.querySelector(".list-img img.calendar-list-thumb") as HTMLImageElement | null)?.src ?? "";
          const description =
            (el.querySelector(".description-text") as HTMLElement | null)?.textContent?.trim() ?? "";

          results.push({ title, sourceUrl, imageSrc, description });
        });

        return results;
      });

      const nowMs = Date.now();
      const events: ScrapedEvent[] = [];

      for (const { title, sourceUrl, imageSrc, description } of listingItems) {
        let startDate: Date | null = null;

        try {
          await page.goto(sourceUrl, { waitUntil: "domcontentloaded", timeout: 20_000 });

          const dateText = await page.evaluate(() => {
            // Try known selectors for the date element
            for (const sel of [".tribe-events-schedule", ".shortcode-date", ".event-date", ".tribe-event-date-start"]) {
              const text = (document.querySelector(sel) as HTMLElement | null)?.textContent?.trim();
              if (text) return text;
            }
            // Fall back: scan full page text for the date pattern
            const m = document.body.innerText.match(
              /(?:MONDAY|TUESDAY|WEDNESDAY|THURSDAY|FRIDAY|SATURDAY|SUNDAY),\s+[A-Z]+\s+\d+,\s+\d{4},\s+\d+:\d+\s+[AP]M\s+P[SD]T/i
            );
            return m ? m[0] : null;
          });

          if (dateText) {
            startDate = parseCityLightsDate(dateText);
          }
        } catch (err: any) {
          console.warn(`[citylights] failed to load detail page ${sourceUrl}: ${err.message}`);
        }

        if (!startDate || isNaN(startDate.getTime())) {
          console.warn(`[citylights] could not parse date for "${title}" — skipping`);
          continue;
        }

        if (startDate.getTime() < nowMs - 86_400_000) continue;

        events.push({
          title,
          startDate,
          sourceUrl,
          imageUrl: imageSrc || undefined,
          description: description || undefined,
          venueName: "City Lights Booksellers & Publishers",
          venueAddress: "261 Columbus Ave, San Francisco, CA 94133",
          tags: ["bookstore", "literary", "city-lights"],
        });
      }

      console.log(`[citylights] scraped ${events.length} upcoming events`);
      return events;
    } finally {
      await browser.close();
    }
  }
}
