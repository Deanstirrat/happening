import { BaseScraper } from "./base";
import type { ScrapedEvent } from "./base";
import { sfDateFromLocal } from "@/lib/sfDate";

/**
 * The UC Theatre — theuctheatre.org
 *
 * Webflow site powered by Opendate. Events are loaded client-side via JS,
 * so we use Playwright to get the fully-rendered page.
 *
 * Each event card is an <a href="/shows/[slug]"> containing:
 *   - Separate divs for month abbreviation and day number (no space between)
 *   - h3 for the event title
 *   - Text with "Show: H:MM pm" for the start time
 *
 * The month+day divs render as concatenated text (e.g. "Apr09") in Cheerio,
 * so we parse with a regex that doesn't require a word boundary after the day.
 */

const BASE_URL = "https://www.theuctheatre.org";

const MONTH_ABBR: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

// Handles both "Apr09Thu" (abbreviated, concatenated) and "April 8" (full name, spaced)
function parseDateFromText(text: string): { month: number; day: number } | null {
  const m = text.match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[\s]*(\d{1,2})(?!\d)/i
  );
  if (!m) return null;
  const monthStr = m[1].toLowerCase().slice(0, 3);
  const month = MONTH_ABBR[monthStr];
  if (!month) return null;
  return { month, day: parseInt(m[2]) };
}

// "Show: 8:00 pm" or "Doors: 7:00 pm"
function parseShowTime(text: string): { hour: number; minute: number } | null {
  const m = text.match(/(?:Show|Showtime):\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
  if (!m) return null;
  let hour = parseInt(m[1]);
  const minute = m[2] ? parseInt(m[2]) : 0;
  if (m[3].toLowerCase() === "pm" && hour < 12) hour += 12;
  if (m[3].toLowerCase() === "am" && hour === 12) hour = 0;
  return { hour, minute };
}

export class UcTheatreScraper extends BaseScraper {
  readonly sourceSlug = "uctheatre";

  async scrape(): Promise<ScrapedEvent[]> {
    const { chromium } = await import("playwright-extra");
    const StealthPlugin = (await import("puppeteer-extra-plugin-stealth")).default;
    chromium.use(StealthPlugin());

    const browser = await chromium.launch({ headless: true, timeout: 60_000 });
    const page = await browser.newPage();

    try {
      try {
        await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
        // Wait for JS-rendered event cards, then extra time for all cards to load
        await page.waitForSelector('a[href^="/shows/"]', { timeout: 20_000 });
        await page.waitForTimeout(3_000);
      } catch {
        // Continue with whatever loaded
      }

      const rawCards = await page.evaluate(() => {
        const results: Array<{
          href: string;
          text: string;
          title: string;
          imageSrc: string;
        }> = [];

        document.querySelectorAll<HTMLAnchorElement>('a[href^="/shows/"]').forEach((el) => {
          const href = el.getAttribute("href") ?? "";
          if (!href) return;
          const title =
            (el.querySelector("h3, h2") as HTMLElement | null)?.textContent?.trim() ?? "";
          if (!title) return;
          const text = el.textContent ?? "";
          const imageSrc =
            (el.querySelector("img") as HTMLImageElement | null)?.getAttribute("src") ?? "";
          results.push({ href, text, title, imageSrc });
        });

        return results;
      });

      const events: ScrapedEvent[] = [];
      const nowMs = Date.now();
      const seen = new Set<string>();

      for (const { href, text, title, imageSrc } of rawCards) {
        if (seen.has(href)) continue;
        seen.add(href);

        const dateParsed = parseDateFromText(text);
        if (!dateParsed) {
          console.warn(`[uctheatre] could not parse date for "${title}"`);
          continue;
        }

        const timeParsed = parseShowTime(text);
        const hour = timeParsed?.hour ?? 20; // default 8pm
        const minute = timeParsed?.minute ?? 0;

        const year = this.resolveYear(dateParsed.month, dateParsed.day);
        const startDate = sfDateFromLocal(year, dateParsed.month, dateParsed.day, hour, minute);
        if (startDate.getTime() < nowMs - 86_400_000) continue;

        const sourceUrl = `${BASE_URL}${href}`;
        const imageUrl = imageSrc
          ? imageSrc.startsWith("http")
            ? imageSrc
            : `${BASE_URL}${imageSrc}`
          : undefined;

        events.push({
          title,
          startDate,
          sourceUrl,
          imageUrl,
          venueName: "The UC Theatre",
          venueAddress: "2036 University Ave, Berkeley, CA 94704",
          tags: ["music", "live music", "concert", "uc-theatre"],
        });
      }

      console.log(`[uctheatre] scraped ${events.length} upcoming events`);
      return events;
    } finally {
      await browser.close();
    }
  }
}
