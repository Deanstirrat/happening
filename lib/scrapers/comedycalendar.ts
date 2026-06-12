import axios from "axios";
import { BaseScraper } from "./base";
import type { ScrapedEvent } from "./base";
import { unfoldLines, parseProp, unescapeText, parseICalDate, type Prop } from "./ical";

/**
 * Comedy Calendar — comedycalendar.com — an aggregator of SF stand-up shows.
 *
 * This is our first direct line into the major ticketed clubs — Punch Line SF,
 * Cobb's Comedy Club, The Masonic, Castro Theatre — none of which expose their
 * own machine-readable calendars. Comedy Calendar resells the same inventory but,
 * unlike its lookalikes (comedy.tickets, san-francisco.events), publishes a clean
 * public iCal feed, so we consume that rather than parsing HTML (see #160).
 *
 * Each VEVENT gives a SUMMARY (title), DTSTART/DTEND with real show times, a
 * LOCATION carrying "Venue, Street, City, State", a per-event URL, and a stable
 * UID we use as externalId. Image and blurb are left for the runner to backfill
 * from each event page's og: tags.
 */

const FEED_URL = "https://comedycalendar.com/calendar-feed/city/san-francisco.ics";

// The real feed is ~60KB (~60 events). Cap the body so a hostile or runaway
// response fails fast here rather than OOM-crashing the whole scrape run.
const MAX_FEED_BYTES = 5 * 1024 * 1024;

/**
 * Coordinates for the venues this feed actually lists. The LOCATION addresses
 * geocode cleanly via Nominatim, but these are a small, stable set of major
 * rooms, so pinning their coords here guarantees correct map placement without a
 * per-event geocode round-trip (and survives Nominatim flakiness). Keyed by the
 * venue name lowercased with all non-alphanumerics stripped. Unknown venues fall
 * back to address geocoding in the runner.
 */
const VENUE_COORDS: Record<string, { lat: number; lng: number }> = {
  cobbscomedyclub: { lat: 37.80147, lng: -122.41356 }, // 915 Columbus Ave
  punchlinecomedyclubsanfrancisco: { lat: 37.79519, lng: -122.4006 }, // 444 Battery St
  themasonic: { lat: 37.79155, lng: -122.41311 }, // 1111 California St
  thecastrotheatre: { lat: 37.76199, lng: -122.43475 }, // 429 Castro St
  palaceoffinearts: { lat: 37.80293, lng: -122.44839 }, // 3601 Lyon St
  augusthall: { lat: 37.78677, lng: -122.40988 }, // 420 Mason St
};

const normalizeVenue = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Split "Cobb's Comedy Club, 915 Columbus Ave, San Francisco, California". */
function parseLocation(raw: string): { venueName?: string; venueAddress?: string } {
  const value = unescapeText(raw).trim();
  if (!value) return {};
  const comma = value.indexOf(",");
  if (comma === -1) return { venueName: value };
  return {
    venueName: value.slice(0, comma).trim(),
    venueAddress: value.slice(comma + 1).trim() || undefined,
  };
}

export class ComedyCalendarScraper extends BaseScraper {
  readonly sourceSlug = "comedycalendar";

  async scrape(): Promise<ScrapedEvent[]> {
    let feed: string;
    try {
      const { data } = await axios.get<string>(FEED_URL, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          Accept: "text/calendar,text/plain",
        },
        responseType: "text",
        timeout: 15_000,
        maxContentLength: MAX_FEED_BYTES,
        maxBodyLength: MAX_FEED_BYTES,
      });
      feed = data;
    } catch (err: any) {
      console.error("[comedycalendar] failed to fetch iCal feed:", err.message);
      return [];
    }

    if (!feed.startsWith("BEGIN:VCALENDAR")) {
      console.error(
        `[comedycalendar] unexpected response (${feed.length} bytes, not an iCal feed). ` +
          `First bytes: ${JSON.stringify(feed.slice(0, 120))}`
      );
      return [];
    }

    const events: ScrapedEvent[] = [];
    const nowMs = Date.now();
    const oneDayAgo = nowMs - 86_400_000;
    const oneYearOut = nowMs + 365 * 86_400_000;

    let current: Record<string, Prop> | null = null;
    let inAlarm = false;
    for (const line of unfoldLines(feed)) {
      if (line === "BEGIN:VEVENT") {
        current = {};
        continue;
      }
      if (line === "END:VEVENT") {
        if (current) this.pushEvent(current, events, oneDayAgo, oneYearOut);
        current = null;
        continue;
      }
      // VEVENTs carry a nested VALARM with its own DESCRIPTION/TRIGGER — ignore
      // those props so they don't leak into the event.
      if (line === "BEGIN:VALARM") {
        inAlarm = true;
        continue;
      }
      if (line === "END:VALARM") {
        inAlarm = false;
        continue;
      }
      if (!current || inAlarm) continue;
      const prop = parseProp(line);
      // Keep the first occurrence of each property (DTSTART, SUMMARY, URL, …).
      if (prop && !(prop.name in current)) current[prop.name] = prop;
    }

    console.log(`[comedycalendar] scraped ${events.length} upcoming events`);
    return events;
  }

  private pushEvent(
    props: Record<string, Prop>,
    events: ScrapedEvent[],
    oneDayAgo: number,
    oneYearOut: number
  ): void {
    const summary = props.SUMMARY;
    const dtstart = props.DTSTART;
    if (!summary || !dtstart) return;

    const title = unescapeText(summary.value).trim();
    if (!title) return;

    const parsed = parseICalDate(dtstart);
    if (!parsed) return;
    const startMs = parsed.date.getTime();
    if (startMs < oneDayAgo || startMs > oneYearOut) return;

    const end = props.DTEND ? parseICalDate(props.DTEND) : null;

    const sourceUrl = props.URL?.value.trim() || "https://comedycalendar.com/city/san-francisco/";
    const { venueName, venueAddress } = props.LOCATION
      ? parseLocation(props.LOCATION.value)
      : {};

    const coords = venueName ? VENUE_COORDS[normalizeVenue(venueName)] : undefined;

    events.push({
      externalId: props.UID?.value.trim() || undefined,
      title,
      startDate: parsed.date,
      endDate: end?.date,
      allDay: parsed.allDay,
      sourceUrl,
      venueName,
      venueAddress,
      latitude: coords?.lat,
      longitude: coords?.lng,
      category: "COMEDY",
      tags: ["comedy"],
    });
  }
}
