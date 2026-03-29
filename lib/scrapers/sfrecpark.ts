import axios from "axios";
import * as cheerio from "cheerio";
import { BaseScraper } from "./base";
import type { ScrapedEvent } from "./base";
import { sfDateFromLocal } from "@/lib/sfDate";

/**
 * SF Recreation & Park Department — sfrecpark.org/Calendar.aspx
 *
 * Events are rendered as <li> items inside <div.calendars>. Each item has:
 *   - h3 > a > span        — event title + EID in href/id
 *   - div.date             — human-readable date/time range
 *   - div.eventLocation    — venue name
 *   - span[itemprop="startDate"] (in hidden .hidden div) — ISO datetime
 *   - span[itemprop="address"] parts — full street address
 *   - p (first outside .hidden) — short description
 *
 * Pagination is month-based: ?view=list&month=M&year=YYYY
 * We scrape the current month and next month to get upcoming events.
 */
export class SfrecparkScraper extends BaseScraper {
  readonly sourceSlug = "sfrecpark";
  private readonly BASE_URL = "https://sfrecpark.org/Calendar.aspx";
  private readonly MONTHS_AHEAD = parseInt(process.env.MAX_MONTHS_SFRECPARK ?? "2");

  async scrape(): Promise<ScrapedEvent[]> {
    const events: ScrapedEvent[] = [];
    const seen = new Set<string>();
    const now = new Date();

    for (let offset = 0; offset < this.MONTHS_AHEAD; offset++) {
      const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
      const month = d.getMonth() + 1;
      const year = d.getFullYear();
      const url = `${this.BASE_URL}?view=list&month=${month}&year=${year}`;

      let html: string;
      try {
        const { data } = await axios.get(url, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            Accept: "text/html,application/xhtml+xml",
          },
          timeout: 20000,
        });
        html = data;
      } catch (err: any) {
        console.error(`[sfrecpark] Fetch error (${month}/${year}):`, err.message);
        continue;
      }

      const $ = cheerio.load(html);
      let pageCount = 0;
      const pending: ScrapedEvent[] = [];

      $("div.calendars li").each((_i, el) => {
        const $el = $(el);

        // Title and EID
        const titleLink = $el.find("h3 a").first();
        const title = titleLink.find("span").text().trim() || titleLink.text().trim();
        if (!title) return;

        const href = titleLink.attr("href") ?? "";
        const eidMatch = href.match(/[?&]EID=(\d+)/i);
        if (!eidMatch) return;
        const eid = eidMatch[1];

        // De-dupe by EID (same event can appear across month boundaries)
        if (seen.has(eid)) return;
        seen.add(eid);

        const sourceUrl = `https://sfrecpark.org${href.startsWith("/") ? href : "/" + href}`;

        // ISO start date from Schema.org microdata (most reliable)
        const isoDate = $el.find("span[itemprop='startDate']").first().text().trim();
        let startDate: Date;
        let endDate: Date | undefined;

        if (isoDate) {
          // Format: "2026-03-28T11:30:00"
          const isoMatch = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
          if (isoMatch) {
            startDate = sfDateFromLocal(
              parseInt(isoMatch[1]),
              parseInt(isoMatch[2]),
              parseInt(isoMatch[3]),
              parseInt(isoMatch[4]),
              parseInt(isoMatch[5])
            );
          } else {
            return; // Can't parse date, skip
          }
        } else {
          // Fallback: parse div.date text — "March 28, 2026, 11:30 AM - 1:30 PM"
          const dateText = $el.find("div.date").first().text().trim();
          const dateMatch = dateText.match(
            /(\w+)\s+(\d{1,2}),\s+(\d{4}),\s+(\d{1,2}):(\d{2})\s*(AM|PM)/i
          );
          if (!dateMatch) return;
          const MONTHS: Record<string, number> = {
            january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
            july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
          };
          const mo = MONTHS[dateMatch[1].toLowerCase()];
          if (!mo) return;
          let sh = parseInt(dateMatch[4]);
          const sm = parseInt(dateMatch[5]);
          const ampm = dateMatch[6].toUpperCase();
          if (ampm === "PM" && sh !== 12) sh += 12;
          if (ampm === "AM" && sh === 12) sh = 0;
          startDate = sfDateFromLocal(parseInt(dateMatch[3]), mo, parseInt(dateMatch[2]), sh, sm);
        }

        // End time from div.date: "... - 1:30 PM"
        const dateText = $el.find("div.date").first().text().trim();
        const endMatch = dateText.match(/-\s*(\d{1,2}):(\d{2})\s*(AM|PM)/i);
        if (endMatch) {
          let eh = parseInt(endMatch[1]);
          const em = parseInt(endMatch[2]);
          const eampm = endMatch[3].toUpperCase();
          if (eampm === "PM" && eh !== 12) eh += 12;
          if (eampm === "AM" && eh === 12) eh = 0;
          // Use the same date as startDate
          const sf = new Intl.DateTimeFormat("en-US", {
            timeZone: "America/Los_Angeles",
            year: "numeric", month: "numeric", day: "numeric",
          }).formatToParts(startDate);
          const getPart = (type: string) => parseInt(sf.find((p) => p.type === type)?.value ?? "0");
          endDate = sfDateFromLocal(getPart("year"), getPart("month"), getPart("day"), eh, em);
          // If end < start, it crossed midnight
          if (endDate < startDate) endDate = new Date(endDate.getTime() + 86400000);
        }

        // Skip events more than a day in the past
        if (startDate.getTime() < Date.now() - 86400000) return;

        // Venue name
        const venueName =
          $el.find("div.eventLocation div.name").first().text().trim() ||
          $el.find("span[itemprop='location'] span[itemprop='name']").first().text().trim() ||
          undefined;

        // Full address from Schema.org
        const street = $el.find("span[itemprop='streetAddress']").first().text().trim();
        const city = $el.find("span[itemprop='addressLocality']").first().text().trim() || "San Francisco";
        const state = $el.find("span[itemprop='addressRegion']").first().text().trim() || "CA";
        const zip = $el.find("span[itemprop='postalCode']").first().text().trim();
        const venueAddress = street
          ? [street, city, state, zip].filter(Boolean).join(", ")
          : venueName
            ? `${venueName}, San Francisco, CA`
            : "San Francisco, CA";

        // Description — first <p> not inside .hidden
        let description: string | undefined;
        $el.find("p").each((_j, p) => {
          if ($(p).closest(".hidden").length === 0) {
            const text = $(p).text().trim();
            if (text) { description = text; return false; }
          }
        });

        pending.push({
          externalId: `sfrecpark-${eid}`,
          title,
          description,
          startDate,
          endDate,
          venueName,
          venueAddress,
          sourceUrl,
          isFree: true,
          tags: ["parks", "recreation", "sfrecpark", "free"],
        });
        pageCount++;
      });

      // Fetch images for all events on this page
      for (const event of pending) {
        event.imageUrl = await this.fetchEventImage(event.sourceUrl!);
        events.push(event);
      }

      console.log(`[sfrecpark] ${month}/${year}: ${pageCount} events (${events.length} total)`);
    }

    return events;
  }

  private async fetchEventImage(eventUrl: string): Promise<string | undefined> {
    try {
      const { data } = await axios.get(eventUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml",
        },
        timeout: 15000,
      });
      const $ = cheerio.load(data);
      // The event detail page embeds an image in the description body
      const img = $(".eventBody img, .eventDescription img, #EventDetails img").first();
      const src = img.attr("src");
      if (!src) return undefined;
      return src.startsWith("http") ? src : `https://sfrecpark.org${src.startsWith("/") ? src : "/" + src}`;
    } catch {
      return undefined;
    }
  }
}
