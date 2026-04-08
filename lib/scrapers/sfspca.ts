import axios from "axios";
import * as cheerio from "cheerio";
import { BaseScraper } from "./base";
import type { ScrapedEvent } from "./base";
import { sfDateFromLocal } from "@/lib/sfDate";

/**
 * SF SPCA — sfspca.org/events/list/
 *
 * WordPress site using The Events Calendar plugin, which embeds
 * application/ld+json blocks with @type "Event" for each listing.
 * We parse those directly for clean structured data.
 *
 * JSON-LD fields used: name, startDate, endDate, image, url, description.
 *
 * WordPress all-day events store midnight UTC — we normalize those to noon SF.
 */

const LIST_URL = "https://www.sfspca.org/events/list/";

function parseEventDate(dateStr: string): Date {
  if (!dateStr) return new Date(NaN);
  // WordPress all-day: midnight UTC → use noon SF time instead
  if (/T00:00:00(\+00:00|Z)$/.test(dateStr)) {
    const [y, m, d] = dateStr.split("T")[0].split("-").map(Number);
    return sfDateFromLocal(y, m, d, 12, 0);
  }
  return new Date(dateStr);
}

export class SfSpcaScraper extends BaseScraper {
  readonly sourceSlug = "sfspca";

  async scrape(): Promise<ScrapedEvent[]> {
    let html: string;
    try {
      const { data } = await axios.get<string>(LIST_URL, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml",
        },
        timeout: 15_000,
      });
      html = data;
    } catch (err: any) {
      console.error(`[sfspca] failed to fetch events page:`, err.message);
      return [];
    }

    const $ = cheerio.load(html);
    const events: ScrapedEvent[] = [];
    const nowMs = Date.now();
    const seen = new Set<string>();

    $('script[type="application/ld+json"]').each((_, el) => {
      let json: any;
      try {
        json = JSON.parse($(el).html() ?? "");
      } catch {
        return;
      }

      const items: any[] = Array.isArray(json) ? json : [json];
      for (const item of items) {
        if (item["@type"] !== "Event") continue;

        const url: string = item.url ?? LIST_URL;
        if (seen.has(url)) continue;
        seen.add(url);

        const startDate = parseEventDate(item.startDate);
        if (isNaN(startDate.getTime())) continue;

        // Filter events that ended more than 24h ago
        const endDate = item.endDate ? parseEventDate(item.endDate) : undefined;
        const relevantDate = endDate && !isNaN(endDate.getTime()) ? endDate : startDate;
        if (relevantDate.getTime() < nowMs - 86_400_000) continue;

        const description = item.description
          ? item.description.replace(/<[^>]+>/g, "").trim()
          : undefined;

        events.push({
          title: (item.name ?? "").trim(),
          description: description || undefined,
          startDate,
          endDate: endDate && !isNaN(endDate.getTime()) ? endDate : undefined,
          sourceUrl: url,
          imageUrl: item.image ?? undefined,
          venueName: "SF SPCA",
          venueAddress: "250 Florida St, San Francisco, CA 94103",
          tags: ["animals", "pets", "community", "sfspca"],
        });
      }
    });

    console.log(`[sfspca] scraped ${events.length} upcoming events`);
    return events;
  }
}
