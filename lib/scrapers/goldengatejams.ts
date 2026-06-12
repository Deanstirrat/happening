import axios from "axios";
import { BaseScraper } from "./base";
import type { ScrapedEvent } from "./base";
import { sfDateFromLocal } from "@/lib/sfDate";

// Public Google Calendar ("Community Music Hangout") linked from the site. The
// homepage only announces the next hangout; the ICS feed carries the full
// schedule, so we read it directly.
const CAL_ID =
  "88c5018286c9ab2d0e27326287e61a2b5d42b3ed4008ba650b81f054f65026dd@group.calendar.google.com";
const ICS_URL = `https://calendar.google.com/calendar/ical/${encodeURIComponent(
  CAL_ID
)}/public/basic.ics`;
const SITE_URL = "https://goldengatejams.com/";

// Default location: the public piano on JFK Promenade by Blue Heron Lake in
// Golden Gate Park. Set coordinates directly so hangouts publish on the map.
const GGP_VENUE = "JFK Promenade Public Piano, Golden Gate Park";
const GGP_LAT = 37.7706;
const GGP_LNG = -122.4757;
// "Noe Valley CMH" hangouts meet in Noe Valley instead.
const NOE_VENUE = "Noe Valley";
const NOE_LAT = 37.751;
const NOE_LNG = -122.4331;

/** Unfold RFC-5545 folded lines (continuation lines begin with space/tab). */
function unfoldIcs(ics: string): string {
  return ics.replace(/\r?\n[ \t]/g, "");
}

/** Parse an ICS DTSTART/DTEND value into a Date (UTC instant, floating-SF, or all-day). */
function parseIcsDate(raw: string): { date: Date; allDay: boolean } | null {
  const z = raw.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (z) {
    const d = new Date(
      Date.UTC(+z[1], +z[2] - 1, +z[3], +z[4], +z[5], +z[6])
    );
    return { date: d, allDay: false };
  }
  const local = raw.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/);
  if (local) {
    return {
      date: sfDateFromLocal(+local[1], +local[2], +local[3], +local[4], +local[5]),
      allDay: false,
    };
  }
  const dateOnly = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (dateOnly) {
    return {
      date: sfDateFromLocal(+dateOnly[1], +dateOnly[2], +dateOnly[3], 12, 0),
      allDay: true,
    };
  }
  return null;
}

function icsField(block: string, name: string): string | null {
  const m = block.match(new RegExp(`(?:^|\\n)${name}(?:;[^:\\n]*)?:(.*)`));
  return m ? m[1].trim() : null;
}

/**
 * Golden Gate Jams / Community Music Hangout — goldengatejams.com
 *
 * A free, weekend open-mic / singalong jam at the Golden Gate Park public
 * pianos. The site links a public Google Calendar; we read its ICS feed,
 * keeping future hangouts. Summaries are terse ("CMH", "Noe Valley CMH"), so we
 * give them a descriptive title and infer the meetup spot from the summary.
 */
export class GoldenGateJamsScraper extends BaseScraper {
  readonly sourceSlug = "goldengatejams";

  async scrape(): Promise<ScrapedEvent[]> {
    let ics: string;
    try {
      const { data } = await axios.get<string>(ICS_URL, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        },
        timeout: 20_000,
        responseType: "text",
      });
      ics = data;
    } catch (err: any) {
      console.error("[goldengatejams] fetch failed:", err.message);
      return [];
    }

    const events: ScrapedEvent[] = [];
    const cutoff = Date.now() - 86_400_000; // keep today + future
    const blocks = unfoldIcs(ics).split("BEGIN:VEVENT").slice(1);

    for (const block of blocks) {
      const dtStartRaw = icsField(block, "DTSTART");
      if (!dtStartRaw) continue;
      const start = parseIcsDate(dtStartRaw);
      if (!start || isNaN(start.date.getTime())) continue;
      if (start.date.getTime() < cutoff) continue;

      const summary = (icsField(block, "SUMMARY") ?? "").trim();
      const isNoe = /noe valley/i.test(summary);
      const title = isNoe
        ? "Noe Valley Community Music Hangout"
        : "Community Music Hangout";

      const dtEndRaw = icsField(block, "DTEND");
      const end = dtEndRaw ? parseIcsDate(dtEndRaw) : null;

      events.push({
        externalId: icsField(block, "UID") ?? undefined,
        title,
        description:
          "A free, all-levels open mic, singalong and jam session — bring an instrument, a song, or just yourself.",
        startDate: start.date,
        endDate: end && !isNaN(end.date.getTime()) ? end.date : undefined,
        allDay: start.allDay,
        venueName: isNoe ? NOE_VENUE : GGP_VENUE,
        venueAddress: isNoe
          ? "Noe Valley, San Francisco, CA"
          : "John F Kennedy Dr, San Francisco, CA 94118",
        latitude: isNoe ? NOE_LAT : GGP_LAT,
        longitude: isNoe ? NOE_LNG : GGP_LNG,
        sourceUrl: SITE_URL,
        isFree: true,
        price: "Free",
        category: "MUSIC_OTHER",
        tags: ["music", "free", "open-mic", "jam", "golden-gate-park"],
      });
    }

    console.log(`[goldengatejams] scraped ${events.length} upcoming hangouts`);
    return events;
  }
}
