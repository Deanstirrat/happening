import axios from "axios";
import { BaseScraper } from "./base";
import type { ScrapedEvent } from "./base";
import { sfDateFromLocal } from "@/lib/sfDate";

/**
 * DNA Lounge — dnalounge.com — 375 Eleventh Street, SoMa.
 *
 * The site serves deliberately garbled markup to non-browser clients, but it
 * publishes a clean iCal feed (linked from every page as
 * <link rel="alternate" type="text/calendar">) intended for calendar
 * subscription. We consume that feed rather than scraping HTML.
 *
 * Each VEVENT gives us a reliable SUMMARY (title), DTSTART in US/Pacific, a
 * per-event URL, and a DESCRIPTION carrying the door price. Image and blurb are
 * left for the runner to backfill from each event page's og: tags (which the
 * site does serve cleanly to a browser User-Agent).
 */

const FEED_URL = "https://cdn.dnalounge.com/calendar/dnalounge.ics";

const VENUE_NAME = "DNA Lounge";
const VENUE_ADDRESS = "375 Eleventh Street, San Francisco, CA 94103";

// The real feed is ~240KB. DNA Lounge actively defends against bots and, from
// datacenter IPs, can serve a multi-hundred-MB anti-scraper "tarpit" instead of
// the calendar. Cap the body so a hostile response fails fast here rather than
// OOM-crashing the whole scrape run (which would take down every other source).
const MAX_FEED_BYTES = 5 * 1024 * 1024;

/** Join RFC 5545 folded lines (continuations begin with a space or tab). */
function unfoldLines(raw: string): string[] {
  const text = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines: string[] = [];
  for (const line of text.split("\n")) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && lines.length > 0) {
      lines[lines.length - 1] += line.slice(1);
    } else {
      lines.push(line);
    }
  }
  return lines;
}

interface Prop {
  name: string;
  params: Record<string, string>;
  value: string;
}

/** Split "DTSTART;TZID=US/Pacific:20260605T213000" into name, params, value. */
function parseProp(line: string): Prop | null {
  const colon = line.indexOf(":");
  if (colon === -1) return null;
  const segments = line.slice(0, colon).split(";");
  const params: Record<string, string> = {};
  for (let i = 1; i < segments.length; i++) {
    const eq = segments[i].indexOf("=");
    if (eq !== -1) {
      params[segments[i].slice(0, eq).toUpperCase()] = segments[i].slice(eq + 1);
    }
  }
  return { name: segments[0].toUpperCase(), params, value: line.slice(colon + 1) };
}

/** Unescape iCal TEXT values (\n \, \; \\). */
function unescapeText(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i++) {
    if (value[i] === "\\" && i + 1 < value.length) {
      const next = value[i + 1];
      if (next === "n" || next === "N") {
        out += "\n";
        i++;
      } else if (next === "," || next === ";" || next === "\\") {
        out += next;
        i++;
      } else {
        out += value[i];
      }
    } else {
      out += value[i];
    }
  }
  return out;
}

function parseICalDate(prop: Prop): { date: Date; allDay: boolean } | null {
  const v = prop.value.trim();
  // All-day: DTSTART;VALUE=DATE:20260605
  if (prop.params.VALUE === "DATE" || /^\d{8}$/.test(v)) {
    const m = v.match(/^(\d{4})(\d{2})(\d{2})/);
    if (!m) return null;
    return { date: sfDateFromLocal(+m[1], +m[2], +m[3], 0, 0), allDay: true };
  }
  const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  if (z === "Z") {
    return { date: new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s)), allDay: false };
  }
  // TZID is US/Pacific (or a floating local time) — treat as SF local.
  return { date: sfDateFromLocal(+y, +mo, +d, +h, +mi), allDay: false };
}

/** Pull the cover charge out of the DESCRIPTION (e.g. "$10 advance; $22 door"). */
function extractPrice(desc: string): { price?: string; isFree?: boolean } {
  if (/\bfree\b/i.test(desc) && !desc.includes("$")) {
    return { isFree: true, price: "Free" };
  }
  const amounts = [...desc.matchAll(/\$\s?(\d{1,3}(?:\.\d{2})?)/g)]
    .map((m) => parseFloat(m[1]))
    .filter((n) => n > 0 && n <= 500);
  if (amounts.length === 0) return {};
  const min = Math.min(...amounts);
  const max = Math.max(...amounts);
  const fmt = (n: number) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`;
  return { price: min === max ? fmt(min) : `${fmt(min)}–${fmt(max)}` };
}

export class DnaLoungeScraper extends BaseScraper {
  readonly sourceSlug = "dnalounge";

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
      console.error("[dnalounge] failed to fetch iCal feed:", err.message);
      return [];
    }

    // Validate this is the real calendar, not an anti-bot tarpit / error page.
    // The feed always begins with the VCALENDAR header; anything else (garbage,
    // HTML, a Markov-text stream) is rejected before we try to parse it.
    if (!feed.startsWith("BEGIN:VCALENDAR")) {
      console.error(
        `[dnalounge] unexpected response (${feed.length} bytes, not an iCal feed) — ` +
          `likely blocked from this IP. First bytes: ${JSON.stringify(feed.slice(0, 120))}`
      );
      return [];
    }

    const events: ScrapedEvent[] = [];
    const nowMs = Date.now();
    const oneDayAgo = nowMs - 86_400_000;
    const oneYearOut = nowMs + 365 * 86_400_000;

    let current: Record<string, Prop> | null = null;
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
      if (!current) continue;
      const prop = parseProp(line);
      // Keep the first occurrence of each property (DTSTART, SUMMARY, URL, …).
      if (prop && !(prop.name in current)) current[prop.name] = prop;
    }

    console.log(`[dnalounge] scraped ${events.length} upcoming events`);
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

    const sourceUrl = props.URL?.value.trim() || "https://www.dnalounge.com/calendar/";
    const description = props.DESCRIPTION ? unescapeText(props.DESCRIPTION.value) : "";
    const { price, isFree } = extractPrice(description);

    events.push({
      title,
      startDate: parsed.date,
      allDay: parsed.allDay,
      sourceUrl,
      price,
      isFree,
      venueName: VENUE_NAME,
      venueAddress: VENUE_ADDRESS,
      latitude: 37.771007,
      longitude: -122.412694,
      tags: ["nightlife", "music", "dna-lounge"],
    });
  }
}
