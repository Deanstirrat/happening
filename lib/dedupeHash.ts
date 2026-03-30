import { createHash } from "crypto";
import { sfDayKey } from "@/lib/sfDate";

/**
 * Compute a stable deduplication hash for an event.
 * Uses SF local date (not UTC) so that evening events stored as the next
 * UTC day still hash to the correct SF calendar day.
 */
export function computeDedupeHash(startDate: Date, title: string): string {
  const dateStr = sfDayKey(startDate); // "YYYY-MM-DD" in SF local time
  const normalizedTitle = title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return createHash("sha256").update(`${dateStr}::${normalizedTitle}`).digest("hex");
}
