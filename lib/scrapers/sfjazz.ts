import { BaseScraper } from "./base";
import type { ScrapedEvent } from "./base";
import { sfDateFromLocal } from "@/lib/sfDate";

/**
 * SFJAZZ — sfjazz.org/calendar/
 *
 * The site is protected by Cloudflare's cookie challenge, so we use Playwright
 * with the stealth plugin to load the calendar page. The calendar is
 * server-rendered HTML with a custom ace-* CSS framework.
 *
 * Events are <article class="ace-cal-list-event-content"> elements containing:
 *   .ace-cal-list-event-content-inner-date  — "Sun Mar 29"
 *   .ace-cal-list-event-details a > heading  — event title + href
 *   p.ace-cal-list-event-time               — "6:00 PM | Joe Henderson Lab"
 *   .ace-cal-list-event-image img            — event image
 *
 * We load two pages (today and +30 days) to cover a rolling ~60-day window.
 * Room names are ignored — we always use "SFJAZZ Center" as venueName.
 */

const BASE_URL = "https://www.sfjazz.org";

const MONTH_ABBR: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function parseDateLabel(text: string): { month: number; day: number } | null {
  const m = text.trim().match(/\b([A-Za-z]{3})\s+(\d{1,2})\b/);
  if (!m) return null;
  const month = MONTH_ABBR[m[1].toLowerCase()];
  if (!month) return null;
  return { month, day: parseInt(m[2]) };
}

// "6:00 PM | Joe Henderson Lab" → { hour: 18, minute: 0 }
function parseTimePart(text: string): { hour: number; minute: number } | null {
  const timePart = text.split("|")[0].trim();
  const m = timePart.match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)/i);
  if (!m) return null;
  let hour = parseInt(m[1]);
  const minute = m[2] ? parseInt(m[2]) : 0;
  const ampm = m[3].toUpperCase();
  if (ampm === "PM" && hour < 12) hour += 12;
  if (ampm === "AM" && hour === 12) hour = 0;
  return { hour, minute };
}

function toISODate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

export class SFJazzScraper extends BaseScraper {
  readonly sourceSlug = "sfjazz";

  async scrape(): Promise<ScrapedEvent[]> {
    const { chromium } = await import("playwright-extra");
    const StealthPlugin = (await import("puppeteer-extra-plugin-stealth")).default;
    chromium.use(StealthPlugin());

    const browser = await chromium.launch({ headless: true, timeout: 60000 });
    const page = await browser.newPage();

    const now = new Date();
    const dates = [now, addDays(now, 30)];
    const allRaw: Array<{
      dateLabel: string;
      timeText: string;
      title: string;
      href: string;
      imageSrc: string;
    }> = [];

    try {
      for (const date of dates) {
        const url = `${BASE_URL}/calendar/?date=${toISODate(date)}&layout=A`;
        try {
          await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
          await page.waitForSelector("article.ace-cal-list-event-content", { timeout: 20_000 });
        } catch {
          // Page may have no events — continue to parse whatever loaded
        }

        const raw = await page.evaluate(() => {
          const results: Array<{
            dateLabel: string;
            timeText: string;
            title: string;
            href: string;
            imageSrc: string;
          }> = [];
          document.querySelectorAll("article.ace-cal-list-event-content").forEach((el) => {
            const dateLabel =
              el.querySelector(".ace-cal-list-event-content-inner-date")?.textContent?.trim() ?? "";
            const timeText =
              el.querySelector("p.ace-cal-list-event-time")?.textContent?.trim() ?? "";
            const $link = el.querySelector(".ace-cal-list-event-details a") as HTMLAnchorElement | null;
            const heading = $link?.querySelector("h3, h2, h4") as HTMLElement | null;
            const title = heading?.textContent?.trim() || $link?.textContent?.trim() || "";
            const href = $link?.getAttribute("href") ?? "";
            const img = el.querySelector(".ace-cal-list-event-image img") as HTMLImageElement | null;
            const imageSrc = img?.getAttribute("src") ?? img?.getAttribute("data-src") ?? "";
            if (title) results.push({ dateLabel, timeText, title, href, imageSrc });
          });
          return results;
        });

        allRaw.push(...raw);
      }
    } finally {
      await browser.close();
    }

    const nowMs = Date.now();
    const seen = new Set<string>();
    const events: ScrapedEvent[] = [];

    for (const { dateLabel, timeText, title, href, imageSrc } of allRaw) {
      const sourceUrl = href.startsWith("http") ? href : `${BASE_URL}${href}`;
      if (seen.has(sourceUrl)) continue;
      seen.add(sourceUrl);

      const parsed = parseDateLabel(dateLabel);
      if (!parsed) continue;

      const timeParsed = parseTimePart(timeText);
      const hour = timeParsed?.hour ?? 19;
      const minute = timeParsed?.minute ?? 0;
      const year = this.resolveYear(parsed.month, parsed.day);
      const startDate = sfDateFromLocal(year, parsed.month, parsed.day, hour, minute);
      if (startDate.getTime() < nowMs - 86_400_000) continue;

      const imageUrl = imageSrc && imageSrc.startsWith("http")
        ? imageSrc
        : imageSrc
        ? `${BASE_URL}${imageSrc}`
        : undefined;

      events.push({
        title,
        startDate,
        sourceUrl,
        imageUrl,
        venueName: "SFJAZZ Center",
        venueAddress: "201 Franklin St, San Francisco, CA 94102",
        tags: ["jazz", "music", "live music"],
      });
    }

    console.log(`[sfjazz] scraped ${events.length} upcoming events`);
    return events;
  }
}
