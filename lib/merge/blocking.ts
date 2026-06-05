/**
 * Candidate-pair generation for semantic merge.
 *
 * The inline scraper dedup (lib/scrapers/runner.ts) only merges high-confidence
 * lexical matches (Jaccard ≥ 0.65 etc.). This blocking step is deliberately
 * *looser* — it surfaces pairs that share a venue, a time slot, or a couple of
 * tokens so the LLM adjudicator can judge the ones lexical rules miss (reworded
 * titles, dropped headliners, paraphrased listings). It runs per SF calendar
 * day, since true duplicate events almost always share a date.
 *
 * Output is bounded: each day is capped at MAX_PAIRS_PER_DAY so a pathological
 * day (e.g. 300 generic "DJ Night" listings) can't explode into tens of
 * thousands of LLM calls. Truncation is reported, never silent.
 */
import { tokenize, isVenueFuzzyMatch } from "@/lib/fuzzy";
import { sfDayKey } from "@/lib/sfDate";

export interface BlockEvent {
  id: string;
  title: string;
  venueName: string | null;
  startDate: Date;
}

export interface CandidatePair<T extends BlockEvent> {
  a: T;
  b: T;
  /** Cheap ranking signal: higher = more likely a true duplicate. */
  score: number;
}

export interface BlockingResult<T extends BlockEvent> {
  pairs: CandidatePair<T>[];
  /** Day keys where the per-day cap dropped lower-scoring pairs. */
  truncatedDays: string[];
}

const GENERIC_VENUE_NORM = new Set([
  "locationprovidedafterbooking",
  "locationtobeprovided",
  "onlineevent",
  "virtualevent",
  "tba",
  "tbd",
  "",
]);

function normVenue(s: string | null): string {
  return (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isGenericVenue(s: string | null): boolean {
  return GENERIC_VENUE_NORM.has(normVenue(s));
}

const TIME_WINDOW_MS = 180 * 60 * 1000; // ±3h — covers doors-vs-start and listing drift

/**
 * Generate candidate duplicate pairs, grouped by SF calendar day.
 *
 * A pair within the same day qualifies if ANY of:
 *  - both have a non-generic venue that fuzzy-matches (strongest signal), OR
 *  - they share ≥ 2 meaningful title tokens, OR
 *  - they start within ±3h AND share ≥ 1 meaningful title token.
 */
export function generateCandidatePairs<T extends BlockEvent>(
  events: T[],
  opts: { maxPairsPerDay?: number } = {}
): BlockingResult<T> {
  const maxPairsPerDay = opts.maxPairsPerDay ?? 600;

  const byDay = new Map<string, T[]>();
  for (const e of events) {
    const key = sfDayKey(e.startDate);
    const group = byDay.get(key) ?? [];
    group.push(e);
    byDay.set(key, group);
  }

  const pairs: CandidatePair<T>[] = [];
  const truncatedDays: string[] = [];

  for (const [day, group] of byDay) {
    if (group.length < 2) continue;

    // Pre-tokenize once per event in the group.
    const tokens = group.map((e) => tokenize(e.title));
    const dayPairs: CandidatePair<T>[] = [];

    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i];
        const b = group[j];

        let shared = 0;
        for (const t of tokens[i]) if (tokens[j].has(t)) shared++;

        const venueMatch =
          !isGenericVenue(a.venueName) &&
          !isGenericVenue(b.venueName) &&
          isVenueFuzzyMatch(a.venueName!, b.venueName!);

        const timeClose =
          Math.abs(a.startDate.getTime() - b.startDate.getTime()) <= TIME_WINDOW_MS;

        const qualifies =
          venueMatch || shared >= 2 || (timeClose && shared >= 1);
        if (!qualifies) continue;

        // Score: venue match is the strongest signal, then token overlap, then time.
        const score =
          (venueMatch ? 100 : 0) + shared * 10 + (timeClose ? 5 : 0);
        dayPairs.push({ a, b, score });
      }
    }

    if (dayPairs.length > maxPairsPerDay) {
      dayPairs.sort((x, y) => y.score - x.score);
      dayPairs.length = maxPairsPerDay;
      truncatedDays.push(day);
    }
    pairs.push(...dayPairs);
  }

  return { pairs, truncatedDays };
}
