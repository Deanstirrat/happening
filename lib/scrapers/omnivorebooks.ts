import axios from "axios";
import * as cheerio from "cheerio";
import { BaseScraper } from "./base";
import type { ScrapedEvent } from "./base";
import { sfDateFromLocal } from "@/lib/sfDate";

/**
 * Omnivore Books on Food — omnivorebooks.myshopify.com
 *
 * Events are listed as Shopify products in the "Upcoming Events" collection.
 * The products.json API returns titles, images, and handles, but dates are
 * only visible in the rendered HTML of each individual product page, where
 * they appear as a <p> tag immediately following the <h1> title.
 *
 * Strategy:
 *   1. Fetch /collections/upcoming-events/products.json to get handles + images
 *   2. For each product, fetch the product page HTML to extract the date/time
 *   3. Skip products whose date can't be parsed
 */

const MONTH_INDEX: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

const DATE_RE = /\b(?:(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+)?(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,\s*\d{4})?\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i;

function parseDateFromText(text: string, resolveYear: (m: number, d: number) => number): Date | null {
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

export class OmnivoreBooksScraper extends BaseScraper {
  readonly sourceSlug = "omnivorebooks";
  private readonly BASE_URL = "https://omnivorebooks.myshopify.com";
  private readonly DELAY_MS = 500;

  private sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async scrape(): Promise<ScrapedEvent[]> {
    // Step 1: get product list
    let products: any[];
    try {
      const { data } = await axios.get(
        `${this.BASE_URL}/collections/upcoming-events/products.json?limit=250`,
        {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          },
          timeout: 15_000,
        }
      );
      products = data?.products ?? [];
    } catch (err: any) {
      console.error(`[omnivorebooks] failed to fetch product list:`, err.message);
      return [];
    }

    const events: ScrapedEvent[] = [];
    const now = Date.now();

    for (const product of products) {
      await this.sleep(this.DELAY_MS);

      const handle: string = product.handle;
      const title: string = product.title;
      const imageUrl: string | undefined = product.images?.[0]?.src;
      const productUrl = `${this.BASE_URL}/collections/upcoming-events/products/${handle}`;

      // Step 2: fetch product page to get date
      let html: string;
      try {
        const { data } = await axios.get(productUrl, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          },
          timeout: 15_000,
        });
        html = data;
      } catch (err: any) {
        console.error(`[omnivorebooks] failed to fetch ${handle}:`, err.message);
        continue;
      }

      const $ = cheerio.load(html);

      // Date is in the <p> right after the <h1> title
      const h1 = $("h1").first();
      const dateText = h1.next("p").text().trim();
      const startDate = parseDateFromText(dateText, this.resolveYear.bind(this));

      if (!startDate) {
        // Fallback: scan entire page text for date pattern
        const pageText = $("body").text();
        const fallback = parseDateFromText(pageText, this.resolveYear.bind(this));
        if (!fallback) {
          console.warn(`[omnivorebooks] could not parse date for "${title}" (text: "${dateText}")`);
          continue;
        }
        if (fallback.getTime() < now - 86_400_000) continue;
        events.push({
          title,
          startDate: fallback,
          sourceUrl: productUrl,
          imageUrl,
          venueName: "Omnivore Books on Food",
          venueAddress: "3814 Cesar Chavez St, San Francisco, CA 94131",
          tags: ["bookstore", "literary", "omnivore-books"],
        });
        continue;
      }

      if (startDate.getTime() < now - 86_400_000) continue;

      events.push({
        title,
        startDate,
        sourceUrl: productUrl,
        imageUrl,
        venueName: "Omnivore Books on Food",
        venueAddress: "3814 Cesar Chavez St, San Francisco, CA 94131",
        tags: ["bookstore", "literary", "omnivore-books"],
      });
    }

    console.log(`[omnivorebooks] scraped ${events.length} upcoming events`);
    return events;
  }
}
