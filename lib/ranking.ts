import { Prisma } from "@prisma/client";

/**
 * Quality ranking for the default feed.
 *
 * Roughly 38% of future events are low-signal recurring filler (badslava
 * trivia, foopee, sfpl) and 37.5% have no flyer image. Sorting the feed purely
 * by start time lets that filler dominate the visible slice of each day. The
 * ranking here floats the higher-signal events — ones with a flyer, a real
 * (geocoded) venue, that aren't recurring — to the top of each day, pushing the
 * long tail behind the per-day "show more" without dropping any data.
 *
 * This is ordering only: nothing is filtered out, so the full set stays
 * discoverable via the existing filters and the chronological sort toggle.
 */

/** Minimal event shape the quality signals are derived from. */
export interface RankableEvent {
  imageUrl: string | null;
  tags: string[];
  latitude: number | null;
  longitude: number | null;
  interestCount?: number;
}

/**
 * Higher score = higher quality / more discovery value. The weights are tiered
 * so a flyer outranks geocoding outranks a non-zero interest count, and any
 * single positive signal outranks a recurring penalty.
 */
export function eventQualityScore(e: RankableEvent): number {
  let score = 0;
  // A flyer is the strongest perceived-quality signal — imageless cards fall
  // back to generic category tiles and read as lower quality.
  if (e.imageUrl) score += 4;
  // Geocoded events have a real, mappable venue.
  if (e.latitude != null && e.longitude != null) score += 2;
  // Recurring filler (trivia nights, weekly library programs) is de-emphasized.
  if (e.tags.includes("recurring")) score -= 3;
  return score;
}

/**
 * Sort comparator: best quality first, then most-interested, then earliest
 * start time. Stable chronological tiebreak keeps same-tier events in time
 * order within a day.
 */
export function compareByQualityThenTime(
  a: RankableEvent & { startDate: string | Date },
  b: RankableEvent & { startDate: string | Date }
): number {
  const q = eventQualityScore(b) - eventQualityScore(a);
  if (q !== 0) return q;
  const interest = (b.interestCount ?? 0) - (a.interestCount ?? 0);
  if (interest !== 0) return interest;
  return new Date(a.startDate).getTime() - new Date(b.startDate).getTime();
}

/**
 * DB-level approximation of {@link compareByQualityThenTime} for paginated
 * queries that can't sort in memory. Recurring is approximated by
 * `recurringType` (null = non-recurring) since the "recurring" tag lives in an
 * array column that can't be ordered on directly.
 */
export const QUALITY_ORDER_BY: Prisma.EventOrderByWithRelationInput[] = [
  { imageUrl: { sort: "desc", nulls: "last" } },
  { latitude: { sort: "desc", nulls: "last" } },
  { recurringType: { sort: "asc", nulls: "first" } },
  { externalInterest: "desc" },
  { startDate: "asc" },
];
