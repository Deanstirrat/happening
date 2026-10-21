import { sfDayStart, sfDayKey } from "@/lib/sfDate";

/**
 * Deterministic dedup signals shared by the inline scraper dedup
 * (lib/scrapers/runner.ts) and the nightly merge pre-pass
 * (lib/merge/deterministic.ts). Keeping them in one place stops the two paths
 * from drifting — a URL pattern or placeholder venue added for one must apply
 * to the other.
 */

// Source URLs that point to list pages rather than individual events. Two
// events sharing one of these is NOT evidence they're the same event, so the
// identical-source-URL signal must skip them.
export const GENERIC_SOURCE_URL_PATTERNS = [
  "foopee.com/punk/the-list/",
  "19hz.info/eventlisting_BayArea.php",
  "badslava.com/san-francisco-trivia-nights.php",
  "noevalleytownsquare.com/events",
  "assemblepuzzlery.com/pages/events",
];

/** True when a URL points at a specific event page (not a shared list page). */
export const isSpecificSourceUrl = (url: string): boolean =>
  !GENERIC_SOURCE_URL_PATTERNS.some((p) => url.includes(p));

// Placeholder venue strings that don't identify a real place, so a venue match
// against one carries no signal.
export const GENERIC_VENUE_NAMES = new Set([
  "locationprovidedafterbooking",
  "locationtobeprovided",
  "onlineevent",
  "virtualevent",
  "tba",
  "tbd",
]);

/** True when a venue string is a known placeholder rather than a real venue. */
export const isGenericVenue = (s: string | null | undefined): boolean =>
  !!s && GENERIC_VENUE_NAMES.has(s.toLowerCase().replace(/[^a-z0-9]/g, ""));

/**
 * True when an event has no reliable start time. Either it's flagged allDay, or
 * its time is exactly the noon-SF placeholder several scrapers assign when a
 * source provides only a date (see lib/createEvent.ts, instagram.ts). Such a
 * time is meaningless for matching, so dedup must not treat it as a real start
 * time. The noon-sentinel check also covers events stored before allDay was set.
 */
export const isTimeUnknown = (startDate: Date, allDay: boolean): boolean => {
  if (allDay) return true;
  const noonSf = sfDayStart(sfDayKey(startDate)).getTime() + 12 * 60 * 60 * 1000;
  return startDate.getTime() === noonSf;
};
