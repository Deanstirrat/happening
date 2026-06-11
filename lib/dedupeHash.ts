import { createHash } from "crypto";
import { sfDayKey } from "@/lib/sfDate";

/**
 * Compute a stable deduplication hash for an event.
 * Uses SF local date (not UTC) so that evening events stored as the next
 * UTC day still hash to the correct SF calendar day.
 */
/**
 * Normalize a title for comparison: lowercase, strip punctuation, collapse
 * whitespace. Used both for the dedupe hash and for matching events that are
 * the same offering (e.g. two showings of the same show on one night).
 */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Leading articles/prepositions carry no distinguishing signal, so "The Chapel"
// and "Chapel" should produce the same token.
const VENUE_STOPWORDS = new Set(["the", "a", "an", "at"]);

/**
 * Reduce a venue name to a single coarse token (first significant word of the
 * normalized name). Coarse on purpose: it must separate genuinely different
 * venues ("Trivia Night" at two bars) while still letting true cross-source
 * duplicates — whose venue strings often differ in suffixes/punctuation
 * ("The Chapel" vs "Chapel SF") — share a token so they still merge on the hash.
 * Returns "" when no venue is known, preserving prior behavior for those rows.
 */
export function venueToken(venueName?: string | null): string {
  if (!venueName) return "";
  const words = venueName
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter((w) => w && !VENUE_STOPWORDS.has(w));
  return words[0] ?? "";
}

export function computeDedupeHash(startDate: Date, title: string, venueName?: string | null): string {
  const dateStr = sfDayKey(startDate); // "YYYY-MM-DD" in SF local time
  return createHash("sha256")
    .update(`${dateStr}::${normalizeTitle(title)}::${venueToken(venueName)}`)
    .digest("hex");
}
