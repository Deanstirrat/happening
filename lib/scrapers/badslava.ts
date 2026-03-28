import axios from "axios";
import { BaseScraper } from "./base";
import type { ScrapedEvent } from "./base";
import { sfDateFromLocal, sfDayKey } from "@/lib/sfDate";

/**
 * Badslava — badslava.com/san-francisco-trivia-nights.php
 *
 * Recurring weekly trivia nights across SF bars/restaurants.
 * Data is embedded in JavaScript arrays (not HTML):
 *   var venue = ["Day<br>Event Name<br><b>Venue</b><br>Address<br>City, CA<br>Time<br>Cost<br>Frequency[<br>Phone]", ...]
 *   var latitude = [37.xxx, ...]
 *   var longitude = [-122.xxx, ...]
 *
 * Since events repeat weekly, the scraper generates WEEKS_AHEAD upcoming
 * instances per venue. Deduplication (date + title hash) prevents re-insertion
 * across scrape runs.
 */
export class BadslavaTriviaScraper extends BaseScraper {
  readonly sourceSlug = "badslava";
  private readonly PAGE_URL =
    "https://badslava.com/san-francisco-trivia-nights.php";
  private readonly WEEKS_AHEAD = parseInt(
    process.env.MAX_WEEKS_BADSLAVA ?? "8"
  );

  async scrape(): Promise<ScrapedEvent[]> {
    const { data: html } = await axios.get(this.PAGE_URL, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; happening-sf/1.0)" },
      timeout: 15000,
    });

    const venues = this.extractJsArray(html, "venue");
    const lats = this.extractJsNumberArray(html, "latitude");
    const lngs = this.extractJsNumberArray(html, "longitude");

    if (venues.length === 0) {
      console.error("[badslava] No venue entries found — page structure may have changed");
      return [];
    }

    const events: ScrapedEvent[] = [];

    // Today's calendar date in SF timezone
    const sfTodayStr = sfDayKey(new Date()); // "YYYY-MM-DD"
    const [todayY, todayM, todayD] = sfTodayStr.split("-").map(Number);
    const todayDow = new Date(Date.UTC(todayY, todayM - 1, todayD)).getUTCDay(); // 0=Sun..6=Sat

    for (let i = 0; i < venues.length; i++) {
      const raw = venues[i];
      // Fields separated by <br> (the JS strings use <br> not \n)
      const parts = raw.split(/<br\s*\/?>/i).map((s) => s.trim());

      // Expected layout: [dayOfWeek, eventName, venueName, street, cityState, time, cost, frequency, ?phone]
      if (parts.length < 7) continue;

      const [dayStr, , venueRaw, street, cityState, timeStr, cost] = parts;

      const targetDow = this.parseDayOfWeek(dayStr);
      if (targetDow === null) continue;

      const time = this.parseTime(timeStr);
      if (!time) continue;

      // Strip HTML tags from venue name (e.g. "<b>Asiento</b>")
      const venueName = venueRaw.replace(/<[^>]+>/g, "").trim();
      if (!venueName) continue;

      // Build address string
      const venueAddress = [street, cityState].filter(Boolean).join(", ") || undefined;

      const latitude = lats[i] != null && !isNaN(lats[i]) ? lats[i] : undefined;
      const longitude = lngs[i] != null && !isNaN(lngs[i]) ? lngs[i] : undefined;

      const isFree = this.parseFree(cost);
      const price = cost && cost.toLowerCase() !== "free" ? cost : undefined;

      // Generate upcoming weekly instances
      const daysUntilNext = (targetDow - todayDow + 7) % 7;
      for (let week = 0; week < this.WEEKS_AHEAD; week++) {
        const daysToAdd = daysUntilNext + week * 7;
        const target = new Date(
          Date.UTC(todayY, todayM - 1, todayD + daysToAdd)
        );
        const yr = target.getUTCFullYear();
        const mo = target.getUTCMonth() + 1;
        const dy = target.getUTCDate();
        const startDate = sfDateFromLocal(yr, mo, dy, time.hour, time.minute);

        events.push({
          title: `Trivia at ${venueName}`,
          startDate,
          venueName,
          venueAddress,
          latitude,
          longitude,
          sourceUrl: this.PAGE_URL,
          isFree,
          price,
          tags: ["trivia", "recurring"],
        });
      }
    }

    console.log(
      `[badslava] Generated ${events.length} trivia events from ${venues.length} venues (${this.WEEKS_AHEAD} weeks ahead)`
    );
    return events;
  }

  /** Extract a JS string array: var <name> = ["...", "..."]; */
  private extractJsArray(html: string, name: string): string[] {
    const match = html.match(
      new RegExp(`var\\s+${name}\\s*=\\s*\\[([\\s\\S]*?)\\];`)
    );
    if (!match?.[1]) return [];
    try {
      return JSON.parse(`[${match[1]}]`);
    } catch {
      return [];
    }
  }

  /** Extract a JS number array: var <name> = [1.23, 4.56, ...]; */
  private extractJsNumberArray(html: string, name: string): number[] {
    const match = html.match(
      new RegExp(`var\\s+${name}\\s*=\\s*\\[([\\s\\S]*?)\\];`)
    );
    if (!match?.[1]) return [];
    try {
      return JSON.parse(`[${match[1]}]`);
    } catch {
      return [];
    }
  }

  /** Parse "7:30pm" → { hour: 19, minute: 30 } */
  private parseTime(timeStr: string): { hour: number; minute: number } | null {
    const m = timeStr
      .trim()
      .match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
    if (!m) return null;
    let hour = parseInt(m[1]);
    const minute = m[2] ? parseInt(m[2]) : 0;
    const ampm = m[3].toLowerCase();
    if (ampm === "pm" && hour !== 12) hour += 12;
    if (ampm === "am" && hour === 12) hour = 0;
    return { hour, minute };
  }

  /** Parse day name → weekday index (0=Sun..6=Sat), null if unrecognized */
  private parseDayOfWeek(dayStr: string): number | null {
    const map: Record<string, number> = {
      sunday: 0, sun: 0,
      monday: 1, mon: 1,
      tuesday: 2, tue: 2,
      wednesday: 3, wed: 3,
      thursday: 4, thu: 4, thur: 4, thurs: 4,
      friday: 5, fri: 5,
      saturday: 6, sat: 6,
    };
    return map[dayStr.toLowerCase().trim()] ?? null;
  }
}
