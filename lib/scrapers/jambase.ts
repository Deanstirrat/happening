import { BaseScraper } from "./base";
import type { ScrapedEvent } from "./base";
import { sfDateFromLocal } from "@/lib/sfDate";

const BASE_URL = "https://www.jambase.com";
// Concert finder centered on San Francisco. The finder returns a wide Bay Area
// radius, so we filter to SF-proper below and let the ingest pipeline drop any
// remaining out-of-area events via geocoding (lib/geo.ts isTooFarFromSf).
const FINDER_URL = `${BASE_URL}/concerts/finder?location=San%20Francisco%2C%20CA%2C%20USA&lat=37.7749&lng=-122.4194`;

/**
 * JamBase concerts — jambase.com/concerts/finder
 *
 * JS-rendered and bot-protected (plain fetch returns 403), so we drive it with
 * Playwright + stealth like Bandsintown/Dice. Rather than depend on JamBase's
 * volatile CSS classes, we anchor on their stable URL patterns:
 *   - event links:  /show/<artist>-<venue>-<YYYYMMDD>   → date comes from the URL
 *   - venue links:  /venue/<slug>                        → venue name = link text
 * Cards show a date but no start time, so events use the noon-SF placeholder
 * + allDay convention that the dedup pipeline treats as "time unknown".
 */
export class JamBaseScraper extends BaseScraper {
  readonly sourceSlug = "jambase";

  async scrape(): Promise<ScrapedEvent[]> {
    const { chromium } = await import("playwright-extra");
    const StealthPlugin = (await import("puppeteer-extra-plugin-stealth")).default;
    chromium.use(StealthPlugin());

    const browser = await chromium.launch({ headless: true, timeout: 60000 });
    const page = await browser.newPage();
    page.setDefaultTimeout(60000);
    // Tall viewport so lazy-loaded cards/images render in one pass
    await page.setViewportSize({ width: 1280, height: 20000 });

    try {
      await page.goto(FINDER_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
      // Wait for the JS-rendered event links to appear
      await page.waitForSelector('a[href*="/show/"]', { timeout: 45000 });
      await page.waitForTimeout(1000);

      const rawEvents = await page.evaluate(() => {
        const SHOW_RE = /\/show\/[^/?#]+-(\d{8})(?:[/?#]|$)/;
        const seen = new Set<string>();
        const results: Array<{
          url: string;
          ymd: string;
          title: string;
          venue: string;
          city: string;
          image: string;
        }> = [];

        const anchors = Array.from(
          document.querySelectorAll<HTMLAnchorElement>('a[href*="/show/"]')
        );

        for (const anchor of anchors) {
          const href = anchor.href;
          const m = href.match(SHOW_RE);
          if (!m) continue;
          const cleanUrl = href.split(/[?#]/)[0];
          if (seen.has(cleanUrl)) continue;
          seen.add(cleanUrl);

          // Climb to the card container that holds the venue/city/image siblings
          const card =
            anchor.closest("li") ??
            anchor.closest("[class*='card']") ??
            anchor.parentElement?.parentElement ??
            anchor;
          const scope = (card as HTMLElement) ?? anchor;

          // Title: prefer a heading or the show-link text, fall back to img alt
          const titleEl = scope.querySelector("h1,h2,h3,h4,h5") ?? anchor;
          let title = (titleEl.textContent ?? "").trim();
          if (!title) {
            const img = scope.querySelector("img");
            title = (img?.getAttribute("alt") ?? "").trim();
          }

          // Venue: the sibling /venue/ link's text
          const venueEl = scope.querySelector<HTMLAnchorElement>('a[href*="/venue/"]');
          const venue = (venueEl?.textContent ?? "").trim();

          // City: a "City, ST" line in the card text
          const cityMatch = (scope.innerText ?? "").match(
            /([A-Za-z .'-]+,\s*[A-Z]{2})(?:\b|$)/
          );
          const city = cityMatch ? cityMatch[1].trim() : "";

          // Image: first cloudinary asset on the card (src / data-src / srcset)
          let image = "";
          for (const img of Array.from(scope.querySelectorAll("img"))) {
            const candidate =
              img.getAttribute("src") ??
              img.getAttribute("data-src") ??
              img.getAttribute("srcset")?.split(" ")[0] ??
              "";
            if (candidate.includes("res.cloudinary.com")) {
              image = candidate;
              break;
            }
          }

          results.push({ url: cleanUrl, ymd: m[1], title, venue, city, image });
        }
        return results;
      });

      return rawEvents.flatMap((raw) => {
        const event = this.parseEvent(raw);
        return event ? [event] : [];
      });
    } finally {
      await browser.close();
    }
  }

  private parseEvent(raw: {
    url: string;
    ymd: string;
    title: string;
    venue: string;
    city: string;
    image: string;
  }): ScrapedEvent | null {
    if (!raw.title) return null;

    // The finder covers the whole Bay Area. When we can read the city, keep only
    // San Francisco; when we can't, keep it and let geocoding place/drop it.
    if (raw.city && !/san francisco/i.test(raw.city)) return null;

    const year = parseInt(raw.ymd.slice(0, 4), 10);
    const month = parseInt(raw.ymd.slice(4, 6), 10);
    const day = parseInt(raw.ymd.slice(6, 8), 10);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;

    // No time on the listing — store at noon SF and mark allDay so the dedup
    // pipeline treats the start time as unknown (see runner.ts isTimeUnknown).
    const startDate = sfDateFromLocal(year, month, day, 12, 0);
    if (isNaN(startDate.getTime())) return null;

    return {
      title: raw.title,
      startDate,
      allDay: true,
      venueName: raw.venue || undefined,
      venueAddress: raw.city ? `${raw.city}` : undefined,
      imageUrl: this.normalizeImage(raw.image),
      sourceUrl: raw.url,
      tags: ["music", "concert", "live"],
      performers: [raw.title],
    };
  }

  /**
   * JamBase serves images through Cloudinary with an inline transformation
   * segment (often a tiny vectorized placeholder, e.g. w_150,e_vectorize). Swap
   * it for a clean, reasonably sized render. If the URL doesn't match the
   * expected shape, drop it and let the runner backfill og:image from the show
   * page instead.
   */
  private normalizeImage(src: string): string | undefined {
    if (!src.includes("res.cloudinary.com")) return undefined;
    const m = src.match(/^(https:\/\/res\.cloudinary\.com\/[^/]+\/)[^/]+\/(.+)$/);
    if (!m) return undefined;
    return `${m[1]}w_640,c_fit,q_auto,f_auto/${m[2]}`;
  }
}
