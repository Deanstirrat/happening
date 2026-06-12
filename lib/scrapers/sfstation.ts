import axios from "axios";
import * as cheerio from "cheerio";
import { BaseScraper } from "./base";
import type { ScrapedEvent } from "./base";
import { sfDateFromLocal } from "@/lib/sfDate";

/**
 * SF Station — sfstation.com/comedy/calendar (see #163)
 *
 * SF Station is a long-running curated SF listings site. Its comedy calendar is
 * our best line into the *independent* / bar / small-theater comedy scene —
 * Cheaper Than Therapy & Secret Improv Society at the Shelton Theater, clown
 * showcases at the Church of Clown, mentalist nights at Marrakech Magic, plus
 * pub shows (Mayes Oyster House, O'Reilly's, Abbey Tavern) — none of which the
 * ticketed `comedycalendar` iCal feed carries. The big-club overlap (Cobb's,
 * Punch Line, The Masonic, Palace of Fine Arts) is left to the runner's dedupe.
 *
 * The #163 spike found no DataDome wall (plain HTTP 200 with a browser UA, unlike
 * `tixr`) and no JSON/RSS/iCal feed — but each event is server-rendered with
 * schema.org/Event microdata, so a CHEERIO pass suffices (no Playwright). Per
 * `.event-wrapper`:
 *   - [itemprop="startDate"] content="YYYY-MM-DD"  — date only, NO time
 *   - .event-time                                  — messy time string ("7:45pm",
 *       "7:45pm & 9:45pm", "8pm - 9pm", "830P", "8 PM"); we take the first time
 *   - h4 > a                                        — title + relative event URL
 *   - [itemprop="location"] [itemprop="name"]       — venue name
 *   - [itemprop="address"] {streetAddress,addressLocality,addressRegion}
 *   - [itemprop="image"] src                         — listing thumbnail
 *
 * Every listing carries a complete street address, so the runner geocodes venues
 * cleanly (see #167) — we deliberately don't invent coordinates here.
 *
 * The calendar paginates via ?page=N (~5 days/page). We walk pages until events
 * run past the horizon, a page is empty, or a page repeats the previous one.
 */
export class SfStationScraper extends BaseScraper {
  readonly sourceSlug = "sfstation";
  private readonly MAX_PAGES = parseInt(process.env.MAX_PAGES_SFSTATION ?? "12");
  private readonly HORIZON_DAYS = parseInt(process.env.SFSTATION_HORIZON_DAYS ?? "60");
  private readonly BASE_URL = "https://www.sfstation.com";
  private readonly CALENDAR_URL = "https://www.sfstation.com/comedy/calendar";

  async scrape(): Promise<ScrapedEvent[]> {
    const events: ScrapedEvent[] = [];
    const seen = new Set<string>();
    const horizonMs = Date.now() + this.HORIZON_DAYS * 86_400_000;
    let prevPageKey = "";

    for (let page = 1; page <= this.MAX_PAGES; page++) {
      const url = page === 1 ? this.CALENDAR_URL : `${this.CALENDAR_URL}?page=${page}`;

      let html: string;
      try {
        const res = await axios.get<string>(url, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          },
          responseType: "text",
          timeout: 15_000,
        });
        html = res.data;
      } catch (err: any) {
        if (err.response?.status === 404) break;
        console.error(`[sfstation] failed to fetch page ${page}:`, err.message);
        break;
      }

      const pageEvents = this.parsePage(cheerio.load(html));
      if (pageEvents.length === 0) break;

      // Guard against the site clamping out-of-range ?page values to page 1 and
      // looping us over the same events forever.
      const pageKey = pageEvents.map((e) => e.externalId ?? e.sourceUrl).join("|");
      if (pageKey === prevPageKey) break;
      prevPageKey = pageKey;

      let anyInWindow = false;
      for (const ev of pageEvents) {
        if (ev.startDate.getTime() > horizonMs) continue;
        anyInWindow = true;
        const key = ev.externalId ?? `${ev.title}@${ev.startDate.toISOString()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        events.push(ev);
      }

      // Pages are chronological — once a whole page sits past the horizon we're done.
      if (!anyInWindow) break;
    }

    console.log(`[sfstation] scraped ${events.length} upcoming comedy events`);
    return events;
  }

  private parsePage($: ReturnType<typeof cheerio.load>): ScrapedEvent[] {
    const events: ScrapedEvent[] = [];

    $(".event-wrapper").each((_i, el) => {
      const $el = $(el);

      const title = $el.find("h4").first().text().trim();
      if (!title) return;

      const dateStr = $el.find('[itemprop="startDate"]').attr("content")?.trim();
      if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return;

      const startDate = this.buildStartDate(dateStr, $el.find(".event-time").first().text());
      if (!startDate) return;

      const href = $el.find("h4 a").attr("href")?.trim();
      const sourceUrl = href
        ? href.startsWith("http")
          ? href
          : `${this.BASE_URL}${href}`
        : this.CALENDAR_URL;
      // Event URLs end in "-e<digits>" — a stable per-event id.
      const externalId = href?.match(/-e(\d+)(?:[/?#]|$)/)?.[1];

      const venueName =
        $el.find('[itemprop="location"] [itemprop="name"]').first().text().trim() || undefined;

      const street = $el.find('[itemprop="streetAddress"]').first().text().trim();
      const locality = $el.find('[itemprop="addressLocality"]').first().text().trim();
      const region = $el.find('[itemprop="addressRegion"]').first().text().trim();
      const venueAddress =
        [street, locality, region].filter(Boolean).join(", ") || undefined;

      const imageUrl = $el.find('[itemprop="image"]').attr("src")?.trim() || undefined;

      events.push({
        externalId,
        title,
        startDate,
        venueName,
        venueAddress,
        imageUrl,
        sourceUrl,
        category: "COMEDY",
        tags: ["comedy"],
      });
    });

    return events;
  }

  /**
   * Combine a "YYYY-MM-DD" date with SF Station's free-form time string into a
   * real SF-local Date. Comedy listings are virtually always evening shows, so
   * when no time can be parsed we promote the date-only listing to 8:00 PM rather
   * than leaving a midnight placeholder (cf. #153).
   */
  private buildStartDate(dateStr: string, timeText: string): Date | null {
    const [y, m, d] = dateStr.split("-").map(Number);
    if (!y || !m || !d) return null;
    const hm = this.parseTime(timeText) ?? { hour: 20, minute: 0 };
    return sfDateFromLocal(y, m, d, hm.hour, hm.minute);
  }

  /** Pull the first time out of strings like "7:45pm & 9:45pm", "830P", "8 PM". */
  private parseTime(raw: string): { hour: number; minute: number } | null {
    const s = raw.toLowerCase();
    // "7:45pm", "7:15 pm"
    let m = s.match(/(\d{1,2}):(\d{2})\s*([ap])m?/);
    if (m) return this.toHM(+m[1], +m[2], m[3]);
    // "830p", "1230p" — no colon, last two digits are minutes
    m = s.match(/\b(\d{3,4})\s*([ap])m?/);
    if (m) {
      const n = m[1];
      return this.toHM(+n.slice(0, n.length - 2), +n.slice(-2), m[2]);
    }
    // "8pm", "8 pm"
    m = s.match(/\b(\d{1,2})\s*([ap])m?\b/);
    if (m) return this.toHM(+m[1], 0, m[2]);
    return null;
  }

  private toHM(hour: number, minute: number, ap: string): { hour: number; minute: number } | null {
    if (hour < 1 || hour > 12 || minute > 59) return null;
    if (ap === "p" && hour !== 12) hour += 12;
    if (ap === "a" && hour === 12) hour = 0;
    return { hour, minute };
  }
}
