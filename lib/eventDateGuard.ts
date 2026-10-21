/**
 * Ingest-time plausibility guard for scraped event dates (issue #215).
 *
 * The scrape pipeline (lib/scrapers/runner.ts) otherwise publishes whatever
 * startDate a scraper emits, with no validation. Several organizer reports trace
 * to date mis-parses that went live unchecked — most egregiously an event pulled
 * in with the wrong *year* (2027 instead of 2026). This is a source-agnostic
 * catch: an event whose start date is clearly implausible is held PENDING (see
 * runner.ts) for admin review instead of publishing wrong.
 *
 * It deliberately only catches *gross* errors (past dates, far-future years).
 * Subtly-wrong times (5pm vs 7pm, door 4pm vs 6pm) sit inside any plausible
 * window and only the organizer knows — that's what the correction flow is for.
 */

/** Grace for already-started/just-passed events (timezone slop, late scrapes). */
const PAST_GRACE_MS = 24 * 60 * 60 * 1000; // 1 day

/**
 * How far ahead a start date may legitimately be. Generous on purpose: real
 * season programming (Stern Grove, SFJazz, symphony seasons) announces up to a
 * year out, while a current-year event mis-parsed into next-next year lands well
 * beyond this.
 */
const FUTURE_HORIZON_MONTHS = 18;

/**
 * Returns a short reason string when `startDate` is implausible for a freshly
 * scraped event, or `null` when it looks fine. Pure — pass `now` for tests.
 */
export function implausibleDateReason(startDate: Date, now: Date = new Date()): string | null {
  const t = startDate.getTime();
  if (Number.isNaN(t)) return "invalid date";

  if (t < now.getTime() - PAST_GRACE_MS) {
    return "start date is in the past";
  }

  const horizon = new Date(now);
  horizon.setMonth(horizon.getMonth() + FUTURE_HORIZON_MONTHS);
  if (t > horizon.getTime()) {
    return `start date is more than ${FUTURE_HORIZON_MONTHS} months out (likely a year mis-parse)`;
  }

  return null;
}
