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
 *   p.shortcode-date          — has data-test (Unix start timestamp in seconds)
 *   h3.shortcode-title a      — event title + URL
 *   .list-img img             — event thumbnail
 *   .description-text         — event description
 */

const EVENTS_URL = "https://citylights.com/events/";

export class CityLightsScraper extends BaseScraper {
  readonly sourceSlug = "citylights";

  async scrape(): Promise<ScrapedEvent[]> {
    const { chromium } = await import("playwright-extra");
    const StealthPlugin = (await import("puppeteer-extra-plugin-stealth")).default;
    chromium.use(StealthPlugin());

    const browser = await chromium.launch({ headless: true, channel: "chrome" });
    const page = await browser.newPage();

    try {
      await page.goto(EVENTS_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
      // Wait for the Sucuri JS challenge to resolve and the event cards to appear
      await page.waitForSelector(".list-item-block", { timeout: 30_000 });
    } catch (err: any) {
      console.error(`[citylights] failed to load events page:`, err.message);
      await browser.close();
      return [];
    }

    const nowMs = Date.now();

    const rawEvents = await page.evaluate(() => {
      const results: Array<{
        tsSeconds: number;
        title: string;
        sourceUrl: string;
        imageSrc: string;
        description: string;
      }> = [];

      document.querySelectorAll(".list-item-block").forEach((el) => {
        const tsRaw = el.querySelector("p.shortcode-date")?.getAttribute("data-test");
        if (!tsRaw) return;
        const tsSeconds = parseInt(tsRaw, 10);
        if (isNaN(tsSeconds)) return;

        const $titleLink = el.querySelector("h3.shortcode-title a") as HTMLAnchorElement | null;
        const title = $titleLink?.textContent?.trim() ?? "";
        if (!title) return;
        const sourceUrl = $titleLink?.href ?? EVENTS_URL;

        const imageSrc =
          (el.querySelector(".list-img img.calendar-list-thumb") as HTMLImageElement | null)?.src ?? "";

        const description =
          (el.querySelector(".description-text") as HTMLElement | null)?.textContent?.trim() ?? "";

        results.push({ tsSeconds, title, sourceUrl, imageSrc, description });
      });

      return results;
    });

    await browser.close();

    const events: ScrapedEvent[] = [];
    for (const { tsSeconds, title, sourceUrl, imageSrc, description } of rawEvents) {
      const tsMs = tsSeconds * 1000;
      if (tsMs < nowMs - 86_400_000) continue;

      events.push({
        title,
        startDate: new Date(tsMs),
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
  }
}
