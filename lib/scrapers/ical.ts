import { sfDateFromLocal } from "@/lib/sfDate";

/**
 * Minimal RFC 5545 (iCalendar) parsing helpers shared by the iCal-feed scrapers
 * (DNA Lounge, Comedy Calendar). Just enough to pull VEVENTs out of a published
 * `.ics` feed — line unfolding, property/param splitting, TEXT unescaping, and
 * DTSTART/DTEND date parsing. Not a general-purpose iCal library.
 */

/** Join RFC 5545 folded lines (continuations begin with a space or tab). */
export function unfoldLines(raw: string): string[] {
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

export interface Prop {
  name: string;
  params: Record<string, string>;
  value: string;
}

/** Split "DTSTART;TZID=US/Pacific:20260605T213000" into name, params, value. */
export function parseProp(line: string): Prop | null {
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
export function unescapeText(value: string): string {
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

/**
 * Parse a DTSTART/DTEND value into a Date.
 *
 * A trailing `Z` means UTC. Everything else — a TZID-tagged local time or a
 * floating local time — is treated as SF wall-clock. These feeds list SF events,
 * so even a mislabeled TZID (Comedy Calendar tags some SF shows
 * `TZID=America/New_York`) still means "the time printed on the ticket," which is
 * SF local. All-day VALUE=DATE values anchor to SF midnight.
 */
export function parseICalDate(prop: Prop): { date: Date; allDay: boolean } | null {
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
  return { date: sfDateFromLocal(+y, +mo, +d, +h, +mi), allDay: false };
}
