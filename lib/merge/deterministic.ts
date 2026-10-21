import { tokenize, isFuzzyMatch, isVenueFuzzyMatch, areLikelyDifferentEvents, MIN_TOKENS } from "@/lib/fuzzy";
import { isSpecificSourceUrl, isGenericVenue, isTimeUnknown } from "@/lib/merge/signals";

/**
 * Programmatic (no-LLM) duplicate detection for the nightly merge run.
 *
 * The LLM adjudicator is reserved for genuinely ambiguous pairs (cost + time).
 * These rules mirror the high-precision signals the inline scraper dedup already
 * trusts (lib/scrapers/runner.ts) and auto-merge a candidate pair outright, so
 * the obvious duplicates never reach Haiku. Each rule is deliberately strict:
 * a false positive here archives a real event with no human in the loop.
 *
 * Callers pass pairs that blocking (lib/merge/blocking.ts) already confirmed
 * share an SF calendar day, so these rules don't re-check the date.
 */
export interface DeterministicEvent {
  id: string;
  title: string;
  venueName: string | null;
  startDate: Date;
  sourceUrl: string;
  allDay: boolean;
}

export interface DeterministicVerdict {
  /** Short, stable label for the rule that fired (persisted as the verdict reason). */
  rule: string;
}

const SAME_TIME_WINDOW_MS = 15 * 60 * 1000; // ±15 minutes

/**
 * Return a verdict when a pair is a duplicate by a high-confidence deterministic
 * rule, or null when it should fall through to the LLM adjudicator.
 */
export function classifyDeterministicDuplicate(
  a: DeterministicEvent,
  b: DeterministicEvent
): DeterministicVerdict | null {
  // Rule 1 — identical specific source URL. Two events scraped from the same
  // individual event page (not a shared list page) on the same day are the same
  // event, even when titles/venues drift between scrapes. Highest-precision
  // signal available; no fuzzy logic needed.
  if (
    a.sourceUrl === b.sourceUrl &&
    isSpecificSourceUrl(a.sourceUrl)
  ) {
    return { rule: "source-url" };
  }

  // Rule 2 — fuzzy venue + close/unknown start time + title containment. Mirrors
  // the runner's "same-time + fuzzy-venue" match: catches the same show listed
  // with different title prefixes/suffixes at the same venue. Fires for short
  // titles too (containment, not Jaccard), guarded by areLikelyDifferentEvents.
  if (
    a.venueName &&
    b.venueName &&
    !isGenericVenue(a.venueName) &&
    !isGenericVenue(b.venueName) &&
    isVenueFuzzyMatch(a.venueName, b.venueName)
  ) {
    const timeUnknown = isTimeUnknown(a.startDate, a.allDay) || isTimeUnknown(b.startDate, b.allDay);
    const timeClose = Math.abs(a.startDate.getTime() - b.startDate.getTime()) <= SAME_TIME_WINDOW_MS;
    if (timeUnknown || timeClose) {
      const tokA = tokenize(a.title);
      const tokB = tokenize(b.title);
      const minSize = Math.min(tokA.size, tokB.size);
      if (minSize > 0 && !areLikelyDifferentEvents(tokA, tokB)) {
        let shared = 0;
        for (const t of tokA) if (tokB.has(t)) shared++;
        if (shared / minSize >= 0.5) return { rule: "venue-time-title" };
      }
    }
  }

  // Rule 3 — strong title-only fuzzy match (Jaccard ≥ 0.65 / containment ≥ 0.60
  // over ≥3 meaningful tokens each). This is the same bar the inline dedup uses
  // for titles alone, so a reworded listing of the same event on the same day
  // merges without the LLM. Short/generic titles (< MIN_TOKENS) don't qualify.
  const tA = tokenize(a.title);
  const tB = tokenize(b.title);
  if (
    tA.size >= MIN_TOKENS &&
    tB.size >= MIN_TOKENS &&
    isFuzzyMatch(tA, tB) &&
    !areLikelyDifferentEvents(tA, tB)
  ) {
    return { rule: "title-fuzzy" };
  }

  return null;
}
