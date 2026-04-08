import axios from "axios";
import * as cheerio from "cheerio";
import { BaseScraper } from "./base";
import type { ScrapedEvent } from "./base";
import { sfDateFromLocal } from "@/lib/sfDate";

/**
 * Fort Mason Center for Arts & Culture — fortmason.org/events/
 *
 * WordPress site using The Events Calendar plugin. Each event page embeds
 * an application/ld+json block with @type "Event".
 *
 * Fort Mason hosts both one-time events and multi-week installations.
 * For ongoing installations (startDate in the past, endDate in the future),
 * we use endDate as the relevance cutoff so they remain visible.
 *
 * WordPress all-day events store midnight UTC — normalized to noon SF.
 */

const EVENTS_URL = "https://fortmason.org/events/";

function parseEventDate(dateStr: string): Date {
  if (!dateStr) return new Date(NaN);
  // WordPress all-day: midnight UTC → noon SF
  if (/T00:00:00(\+00:00|Z)$/.test(dateStr)) {
    const [y, m, d] = dateStr.split("T")[0].split("-").map(Number);
    return sfDateFromLocal(y, m, d, 12, 0);
  }
  return new Date(dateStr);
}

export class FortMasonScraper extends BaseScraper {
  readonly sourceSlug = "fortmason";

  async scrape(): Promise<ScrapedEvent[]> {
    let html: string;
    try {
      const { data } = await axios.get<string>(EVENTS_URL, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml",
        },
        timeout: 15_000,
      });
      html = data;
    } catch (err: any) {
      console.error(`[fortmason] failed to fetch events page:`, err.message);
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

        const url: string = item.url ?? EVENTS_URL;
        if (seen.has(url)) continue;
        seen.add(url);

        const startDate = parseEventDate(item.startDate);
        if (isNaN(startDate.getTime())) continue;

        // For multi-day installations: keep if endDate is still in the future
        const endDate = item.endDate ? parseEventDate(item.endDate) : undefined;
        const relevantDate = endDate && !isNaN(endDate.getTime()) ? endDate : startDate;
        if (relevantDate.getTime() < nowMs - 86_400_000) continue;

        const description = item.description
          ? item.description.replace(/<[^>]+>/g, "").trim()
          : undefined;

        const isFree = item.offers?.price === "0" || item.offers?.price === 0;

        events.push({
          title: (item.name ?? "").trim(),
          description: description || undefined,
          startDate,
          endDate: endDate && !isNaN(endDate.getTime()) ? endDate : undefined,
          sourceUrl: url,
          imageUrl: item.image ?? undefined,
          isFree: isFree || undefined,
          venueName: "Fort Mason Center",
          venueAddress: "2 Marina Blvd, San Francisco, CA 94123",
          tags: ["community", "arts", "fort-mason"],
        });
      }
    });

    console.log(`[fortmason] scraped ${events.length} upcoming events`);
    return events;
  }
}
