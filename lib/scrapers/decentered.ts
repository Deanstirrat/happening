import axios from "axios";
import * as cheerio from "cheerio";
import { BaseScraper } from "./base";
import type { ScrapedEvent } from "./base";
import { sfDateFromLocal } from "@/lib/sfDate";

/**
 * Decentered — events.decentered.org
 *
 * Bay Area arts, culture, and community events calendar. Exposes a public RSS
 * feed at /feeds/rss.xml. Each <item> contains:
 *   - <title>        — event name
 *   - <pubDate>      — RFC 2822 with timezone; already the event start datetime
 *   - <link>         — either an S3 image URL (poster) or external event URL
 *   - <guid>         — https://events.decentered.org/events/{ID}
 *   - <description>  — entity-encoded HTML; sections separated by <br />:
 *                      event description, Location, Address, Hours
 */
export class DecenteredScraper extends BaseScraper {
  readonly sourceSlug = "decentered";
  private readonly FEED_URL = "https://events.decentered.org/feeds/rss.xml";

  async scrape(): Promise<ScrapedEvent[]> {
    let xml: string;
    try {
      const { data } = await axios.get(this.FEED_URL, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          Accept: "application/rss+xml, application/xml, text/xml, */*",
        },
        timeout: 20000,
      });
      xml = data;
    } catch (err: any) {
      console.error("[decentered] Fetch error:", err.message);
      return [];
    }

    const $ = cheerio.load(xml, { xmlMode: true });
    const events: ScrapedEvent[] = [];
    const now = Date.now();

    $("item").each((_i, el) => {
      const $el = $(el);

      const title = $el.find("title").text().trim();
      if (!title) return;

      const pubDate = $el.find("pubDate").text().trim();
      if (!pubDate) return;
      const startDate = new Date(pubDate);
      if (isNaN(startDate.getTime())) return;

      // Skip events more than a day in the past
      if (startDate.getTime() < now - 86400000) return;

      const guid = $el.find("guid").text().trim();
      const externalId = guid.match(/\/events\/(\d+)/)?.[1];
      const internalUrl = externalId
        ? `https://events.decentered.org/events/${externalId}`
        : undefined;

      // <link> is either an S3 image URL (poster) or an external event URL
      const link = $el.find("link").text().trim();
      let sourceUrl: string;
      let imageUrl: string | undefined;

      if (link && (link.includes("s3.amazonaws.com") || link.includes("decentered-images"))) {
        imageUrl = link;
        sourceUrl = internalUrl ?? `https://events.decentered.org`;
      } else if (link) {
        sourceUrl = link;
      } else {
        sourceUrl = internalUrl ?? `https://events.decentered.org`;
      }

      // Description is entity-encoded HTML; cheerio decodes entities in xmlMode
      const rawDesc = $el.find("description").text().trim();
      const sections = rawDesc
        .split(/<br\s*\/?>/i)
        .map((s) => s.trim())
        .filter(Boolean);

      let description: string | undefined;
      let venueAddress: string | undefined;

      for (const section of sections) {
        if (/^Location:/i.test(section) || /^Hours:/i.test(section)) continue;
        if (/^Address:/i.test(section)) {
          const addr = section.replace(/^Address:\s*/i, "").trim();
          if (addr) venueAddress = addr;
        } else if (!description) {
          description = section;
        }
      }

      // Parse end time from "Hours: HH:MM AM/PM - HH:MM AM/PM"
      const endDate = this.parseEndDate(sections, startDate);

      events.push({
        externalId,
        title,
        description: description || undefined,
        startDate,
        endDate,
        venueAddress,
        sourceUrl,
        imageUrl,
        tags: ["arts", "community"],
      });
    });

    console.log(`[decentered] ${events.length} events`);
    return events;
  }

  private parseEndDate(sections: string[], startDate: Date): Date | undefined {
    const hoursSection = sections.find((s) => /^Hours:/i.test(s));
    if (!hoursSection) return undefined;

    // Format: "Hours: 06:00 PM - 09:00 PM"
    const match = hoursSection.match(
      /Hours:\s*\d{1,2}:\d{2}\s*(?:AM|PM)?\s*-\s*(\d{1,2}):(\d{2})\s*(AM|PM)?/i
    );
    if (!match) return undefined;

    let eh = parseInt(match[1]);
    const em = parseInt(match[2]);
    const ampm = match[3]?.toUpperCase();
    if (ampm === "PM" && eh !== 12) eh += 12;
    else if (ampm === "AM" && eh === 12) eh = 0;

    // Use the same calendar date as startDate (in SF local time)
    const sf = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Los_Angeles",
      year: "numeric",
      month: "numeric",
      day: "numeric",
    }).formatToParts(startDate);
    const getPart = (type: string) =>
      parseInt(sf.find((p) => p.type === type)?.value ?? "0");

    const endDate = sfDateFromLocal(getPart("year"), getPart("month"), getPart("day"), eh, em);
    // If end < start, event crosses midnight
    if (endDate < startDate) return new Date(endDate.getTime() + 86400000);
    return endDate;
  }
}
