import axios from "axios";
import { BaseScraper } from "./base";
import type { ScrapedEvent } from "./base";
import { sfDateFromLocal, sfDayKey } from "@/lib/sfDate";

/**
 * OpenMicX — openmicx.com — a community comedy listings site whose unique value
 * is the open-mic / small-room long tail that the ticketed feeds (comedycalendar)
 * never carry. The public SEO page (/shows/san-francisco) only renders the first
 * 20 listings with no working pagination, so instead of scraping that HTML we
 * consume the same JSON the SPA fetches from its `/api` backend:
 *
 *   GET /api/shows/upcoming?city=san-francisco&limit=200
 *     → concrete dated stand-up shows (full ISO `date_time` with TZ offset, so
 *       there is no month/day year-invention problem — see #148 / #150). Includes
 *       small rooms (The Function, Shelton Theater) the ticketed feeds lack, plus
 *       the big names that overlap comedycalendar (dedup handles the overlap).
 *
 *   GET /api/open-mics/city/san-francisco
 *     → recurring weekly/monthly open mics with day_of_week + start_time and real
 *       lat/lng. Like badslava's trivia nights, we expand each weekly mic into
 *       WEEKS_AHEAD upcoming instances; dedup (date + title + venue) keeps repeat
 *       runs from re-inserting them. Because the feed carries coordinates we set
 *       them directly, so these never stall PENDING on a Nominatim miss.
 *
 * Both `city`-scoped endpoints return the whole Bay Area, so out-of-SF rows
 * (San Jose, Oakland, …) are dropped here by the `city_name` / `city` field
 * before the runner's coordinate distance filter would have to (cf. #157).
 */
export class OpenMicXScraper extends BaseScraper {
  readonly sourceSlug = "openmicx";
  private readonly BASE_URL = "https://openmicx.com";
  private readonly CITY_SLUG = "san-francisco";
  private readonly CITY_NAME = "San Francisco";
  private readonly WEEKS_AHEAD = parseInt(
    process.env.MAX_WEEKS_OPENMICX ?? "8"
  );

  async scrape(): Promise<ScrapedEvent[]> {
    const events: ScrapedEvent[] = [];
    const now = Date.now();
    const oneDayAgo = now - 86_400_000;
    const oneYearOut = now + 365 * 86_400_000;

    const [shows, mics] = await Promise.all([
      this.fetchJson<{ events?: any[] }>(
        `/api/shows/upcoming?city=${this.CITY_SLUG}&limit=200`
      ),
      this.fetchJson<{ data?: any[] }>(
        `/api/open-mics/city/${this.CITY_SLUG}`
      ),
    ]);

    // ── Concrete dated comedy shows ──────────────────────────────────────────
    for (const s of shows?.events ?? []) {
      if (s.city_name && s.city_name !== this.CITY_NAME) continue;
      const title = String(s.title ?? "").trim();
      if (!title || !s.date_time) continue;

      const startDate = new Date(s.date_time);
      const ms = startDate.getTime();
      if (isNaN(ms) || ms < oneDayAgo || ms > oneYearOut) continue;

      const venueName = String(s.venue_name ?? "").trim() || undefined;
      const street = String(s.venue_address ?? "").trim();
      const venueAddress = street
        ? `${street}, San Francisco, CA`
        : undefined;

      events.push({
        externalId: s.id != null ? `openmicx-show-${s.id}` : undefined,
        title,
        description: String(s.description ?? "").trim() || undefined,
        startDate,
        sourceUrl: s.slug
          ? `${this.BASE_URL}/shows/${s.slug}`
          : `${this.BASE_URL}/shows/${this.CITY_SLUG}`,
        imageUrl:
          s.poster_override_image_url || s.poster_url || undefined,
        venueName,
        venueAddress,
        category: "COMEDY",
        tags: ["comedy"],
      });
    }

    // ── Recurring open mics → expanded into upcoming instances ───────────────
    const sfTodayStr = sfDayKey(new Date()); // "YYYY-MM-DD" in SF time
    const [todayY, todayM, todayD] = sfTodayStr.split("-").map(Number);
    const todayDow = new Date(
      Date.UTC(todayY, todayM - 1, todayD)
    ).getUTCDay(); // 0=Sun..6=Sat

    let micCount = 0;
    for (const m of mics?.data ?? []) {
      if (m.city && m.city !== this.CITY_NAME) continue;
      if (m.status && m.status !== "published") continue;

      const targetDow = this.parseDayOfWeek(m.day_of_week);
      const time = this.parseTime(m.start_time);
      if (targetDow === null || !time) continue;

      const venueName = String(m.venue_name ?? "").trim() || undefined;
      const title =
        String(m.show_name ?? "").trim() ||
        (venueName ? `Open Mic at ${venueName}` : "Open Mic");

      const street = String(m.venue_address ?? "").trim();
      const venueAddress = street
        ? `${street}, San Francisco, CA`
        : undefined;

      const lat = parseFloat(m.latitude);
      const lng = parseFloat(m.longitude);
      const latitude = isNaN(lat) ? undefined : lat;
      const longitude = isNaN(lng) ? undefined : lng;

      const sourceUrl = m.slug
        ? `${this.BASE_URL}/venues/${m.slug}`
        : `${this.BASE_URL}/shows/${this.CITY_SLUG}`;

      // Weekly mics recur every 7 days; monthly mics give no week-of-month, so we
      // only project their single next occurrence rather than guess a date.
      const isWeekly =
        String(m.recurrence ?? "").toLowerCase() === "weekly";
      const occurrences = isWeekly ? this.WEEKS_AHEAD : 1;

      const daysUntilNext = (targetDow - todayDow + 7) % 7;
      for (let week = 0; week < occurrences; week++) {
        const daysToAdd = daysUntilNext + week * 7;
        const target = new Date(
          Date.UTC(todayY, todayM - 1, todayD + daysToAdd)
        );
        const startDate = sfDateFromLocal(
          target.getUTCFullYear(),
          target.getUTCMonth() + 1,
          target.getUTCDate(),
          time.hour,
          time.minute
        );

        events.push({
          title,
          startDate,
          sourceUrl,
          venueName,
          venueAddress,
          latitude,
          longitude,
          isFree: true, // every mic in the feed is fee_type "free"
          category: "COMEDY",
          tags: ["comedy", "open-mic", "recurring"],
        });
      }
      micCount++;
    }

    console.log(
      `[openmicx] ${events.length} events (${shows?.events?.length ?? 0} shows feed, ${micCount} SF open mics × up to ${this.WEEKS_AHEAD}w)`
    );
    return events;
  }

  private async fetchJson<T>(path: string): Promise<T | null> {
    try {
      const { data } = await axios.get<T>(`${this.BASE_URL}${path}`, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          Accept: "application/json",
        },
        timeout: 20_000,
      });
      return data;
    } catch (err: any) {
      console.error(`[openmicx] fetch error (${path}):`, err.message);
      return null;
    }
  }

  /** Parse "13:00:00" or "19:30" → { hour, minute }; null if unparseable. */
  private parseTime(
    timeStr: unknown
  ): { hour: number; minute: number } | null {
    const m = String(timeStr ?? "").match(/^(\d{1,2}):(\d{2})/);
    if (!m) return null;
    const hour = parseInt(m[1]);
    const minute = parseInt(m[2]);
    if (hour > 23 || minute > 59) return null;
    return { hour, minute };
  }

  /** Day name → weekday index (0=Sun..6=Sat), null if unrecognized. */
  private parseDayOfWeek(dayStr: unknown): number | null {
    const map: Record<string, number> = {
      sunday: 0,
      monday: 1,
      tuesday: 2,
      wednesday: 3,
      thursday: 4,
      friday: 5,
      saturday: 6,
    };
    return map[String(dayStr ?? "").toLowerCase().trim()] ?? null;
  }
}
