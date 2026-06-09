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

export function computeDedupeHash(startDate: Date, title: string): string {
  const dateStr = sfDayKey(startDate); // "YYYY-MM-DD" in SF local time
  return createHash("sha256").update(`${dateStr}::${normalizeTitle(title)}`).digest("hex");
}
