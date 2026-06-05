/**
 * Scraper health classification.
 *
 * A scraper that quietly returns 0 future events looks identical to a healthy
 * one until you query the DB. These pure helpers turn the per-source state we
 * already track (last scraped time + upcoming event count) into an actionable
 * health status, shared by the admin scrapers panel and the alert job.
 */

export type SourceHealthStatus =
  /** Not auto-scraped (MANUAL) or disabled — intentionally not monitored. */
  | "ignored"
  /** Scraper ran recently but produced 0 upcoming events. */
  | "dark"
  /** Scraper hasn't run in too long (or never). */
  | "stale"
  /** Running and producing upcoming events. */
  | "healthy";

export interface SourceHealthInput {
  slug: string;
  name: string;
  enabled: boolean;
  /** ScrapeType: CHEERIO | PLAYWRIGHT | API | MANUAL */
  scrapeType: string;
  lastScrapedAt: Date | null;
  /** Count of future-dated events currently attributed to this source. */
  upcomingCount: number;
}

export interface SourceHealthResult extends SourceHealthInput {
  status: SourceHealthStatus;
  /** Human-readable explanation, null when healthy/ignored. */
  reason: string | null;
  /** Whole days since the last successful scrape, null if never scraped. */
  daysSinceScrape: number | null;
}

/**
 * A monitored source is considered stale if it hasn't been scraped within this
 * many days. The scrape job runs daily, so a multi-day silence means the
 * scraper (or its Railway cron) has stopped running.
 */
export const STALE_AFTER_DAYS = 3;

const MS_PER_DAY = 86_400_000;

function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / MS_PER_DAY);
}

export function computeSourceHealth(
  input: SourceHealthInput,
  now: Date,
  staleAfterDays: number = STALE_AFTER_DAYS
): SourceHealthResult {
  const daysSinceScrape =
    input.lastScrapedAt === null ? null : daysBetween(input.lastScrapedAt, now);

  // MANUAL sources (user submissions) and disabled sources are expected to be
  // quiet — never flag them.
  if (input.scrapeType === "MANUAL" || !input.enabled) {
    return { ...input, status: "ignored", reason: null, daysSinceScrape };
  }

  // Diagnose staleness first: if the scraper hasn't run, that's the root cause,
  // even if it would also read as "dark" (0 upcoming).
  if (daysSinceScrape === null) {
    return {
      ...input,
      status: "stale",
      reason: "never scraped",
      daysSinceScrape,
    };
  }
  if (daysSinceScrape > staleAfterDays) {
    return {
      ...input,
      status: "stale",
      reason: `not scraped in ${daysSinceScrape}d`,
      daysSinceScrape,
    };
  }

  // Runs on schedule but yields nothing — the silent-coverage-loss case.
  if (input.upcomingCount === 0) {
    return {
      ...input,
      status: "dark",
      reason: "0 upcoming events",
      daysSinceScrape,
    };
  }

  return { ...input, status: "healthy", reason: null, daysSinceScrape };
}

export interface HealthSummary {
  results: SourceHealthResult[];
  dark: SourceHealthResult[];
  stale: SourceHealthResult[];
  healthy: SourceHealthResult[];
  ignored: SourceHealthResult[];
  /** dark + stale, sorted worst-first — the sources needing attention. */
  attention: SourceHealthResult[];
}

export function summarizeHealth(
  inputs: SourceHealthInput[],
  now: Date,
  staleAfterDays: number = STALE_AFTER_DAYS
): HealthSummary {
  const results = inputs.map((i) => computeSourceHealth(i, now, staleAfterDays));

  const dark = results.filter((r) => r.status === "dark");
  const stale = results.filter((r) => r.status === "stale");
  const healthy = results.filter((r) => r.status === "healthy");
  const ignored = results.filter((r) => r.status === "ignored");

  // Worst-first: longest-stale sources lead, then dark sources.
  const attention = [...stale, ...dark].sort(
    (a, b) => (b.daysSinceScrape ?? Infinity) - (a.daysSinceScrape ?? Infinity)
  );

  return { results, dark, stale, healthy, ignored, attention };
}
