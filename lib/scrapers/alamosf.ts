import axios from "axios";
import { BaseScraper } from "./base";
import type { ScrapedEvent } from "./base";
import { sfDateFromLocal } from "@/lib/sfDate";

// Public schedule API powering drafthouse.com. The "sf" market spans several
// Bay Area cinemas; we keep only the San Francisco location (New Mission).
const SCHEDULE_URL = "https://drafthouse.com/s/mother/v2/schedule/market/sf";
const SF_CINEMA_ID = "0801"; // New Mission, 2550 Mission Street
const VENUE_NAME = "Alamo Drafthouse New Mission";
const VENUE_ADDRESS = "2550 Mission Street, San Francisco, CA 94110";

interface AlamoShow {
  title: string;
  headline?: string;
  landscapeHeroImage?: { uri?: string };
  posterImages?: { uri?: string }[];
}
interface AlamoPresentation {
  slug: string;
  show: AlamoShow;
}
interface AlamoSession {
  cinemaId: string;
  presentationSlug: string;
  showTimeClt: string; // cinema-local time, e.g. "2026-06-23T19:00:00"
  status: string;
  isHidden?: boolean;
}

/** Parse "2026-06-23T19:00:00" (cinema-local, no offset) into an SF Date. */
function parseCltDate(clt: string): Date | null {
  const m = clt.match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  const date = sfDateFromLocal(
    Number(m[1]),
    Number(m[2]),
    Number(m[3]),
    Number(m[4]),
    Number(m[5])
  );
  return isNaN(date.getTime()) ? null : date;
}

/**
 * Alamo Drafthouse New Mission — drafthouse.com/sf
 *
 * Repertory + first-run cinema in the Mission. The public schedule JSON lists
 * `presentations` (films) and `sessions` (individual showtimes across the whole
 * Bay Area market); we join them and keep only the San Francisco cinema. Each
 * showtime becomes one event.
 */
export class AlamoSfScraper extends BaseScraper {
  readonly sourceSlug = "alamosf";

  async scrape(): Promise<ScrapedEvent[]> {
    let data: { data?: { presentations?: AlamoPresentation[]; sessions?: AlamoSession[] } };
    try {
      const res = await axios.get(SCHEDULE_URL, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          Accept: "application/json",
        },
        timeout: 20_000,
      });
      data = res.data;
    } catch (err: any) {
      console.error("[alamosf] fetch failed:", err.message);
      return [];
    }

    const presentations = data.data?.presentations ?? [];
    const sessions = data.data?.sessions ?? [];
    const presBySlug = new Map(presentations.map((p) => [p.slug, p]));

    const events: ScrapedEvent[] = [];

    for (const session of sessions) {
      if (session.cinemaId !== SF_CINEMA_ID) continue;
      if (session.isHidden) continue;

      const pres = presBySlug.get(session.presentationSlug);
      const show = pres?.show;
      const title = show?.title?.trim();
      if (!title) continue;

      const startDate = parseCltDate(session.showTimeClt);
      if (!startDate) continue;

      const imageUrl =
        show?.landscapeHeroImage?.uri || show?.posterImages?.[0]?.uri || undefined;

      events.push({
        title,
        description: show?.headline?.trim() || undefined,
        startDate,
        venueName: VENUE_NAME,
        venueAddress: VENUE_ADDRESS,
        sourceUrl: `https://drafthouse.com/sf/show/${session.presentationSlug}`,
        imageUrl,
        isFree: false,
      });
    }

    console.log(`[alamosf] scraped ${events.length} upcoming showtimes`);
    return events;
  }
}
