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
 * A session's learned tastes, derived from its interaction history (see
 * {@link buildSessionPreferences} in lib/preferences.ts). Each map holds
 * affinities normalized to 0..1, where 1 is the session's strongest signal in
 * that dimension. Empty maps mean "no signal" — a cold-start session ranks
 * exactly like the un-personalized feed.
 */
export interface PreferenceVector {
  /** EventCategory enum value → affinity (0..1). */
  category: Record<string, number>;
  /** Neighborhood name → affinity (0..1). */
  neighborhood: Record<string, number>;
}

/** Event shape the personalization boost reads, on top of {@link RankableEvent}. */
export interface PersonalizableEvent extends RankableEvent {
  category?: string | null;
  neighborhood?: string | null;
  /** Set when the event matches a connected Spotify session's artists. */
  spotifyArtist?: string;
}

/**
 * Personalization weights. Kept in the same magnitude as the quality signals
 * (flyer +4, geocoded +2) so personalization *interleaves* with quality rather
 * than overriding it: a strongly-matched event can float above a generic
 * high-signal one, but a flyer + geocoded + non-recurring event still competes.
 *
 * Spotify artist matching is deliberately just one term here — issue #99 moves
 * it from being the only personalization to one boost among several.
 */
const SPOTIFY_BOOST = 2.5;
const CATEGORY_BOOST = 2; // × affinity (0..1)
const NEIGHBORHOOD_BOOST = 1; // × affinity (0..1)

/**
 * Additive personalization score for an event given a session's preference
 * vector. Returns 0 for a cold-start session with no Spotify match, so the
 * personalized feed degrades cleanly to the quality-only ordering.
 */
export function personalizationScore(
  e: PersonalizableEvent,
  vector: PreferenceVector | null
): number {
  let score = 0;
  if (e.spotifyArtist) score += SPOTIFY_BOOST;
  if (vector) {
    if (e.category && vector.category[e.category]) {
      score += vector.category[e.category] * CATEGORY_BOOST;
    }
    if (e.neighborhood && vector.neighborhood[e.neighborhood]) {
      score += vector.neighborhood[e.neighborhood] * NEIGHBORHOOD_BOOST;
    }
  }
  return score;
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

type SortableEvent = PersonalizableEvent & { startDate: string | Date };

/**
 * Builds the per-day feed comparator. The primary key is quality + (optional)
 * personalization score, so a session's tastes boost matching events without
 * filtering anything out; ties fall back to most-interested, then earliest
 * start time for a stable chronological order within each tier.
 *
 * Pass `null` (or omit) for the un-personalized feed — with no vector and no
 * Spotify match this reduces exactly to quality → interest → time.
 */
export function makeFeedComparator(vector: PreferenceVector | null = null) {
  return (a: SortableEvent, b: SortableEvent): number => {
    const sb = eventQualityScore(b) + personalizationScore(b, vector);
    const sa = eventQualityScore(a) + personalizationScore(a, vector);
    if (sb !== sa) return sb - sa;
    const interest = (b.interestCount ?? 0) - (a.interestCount ?? 0);
    if (interest !== 0) return interest;
    return new Date(a.startDate).getTime() - new Date(b.startDate).getTime();
  };
}

/**
 * Un-personalized comparator: best quality first, then most-interested, then
 * earliest start time. Kept as a named export for callers that have no session
 * context; {@link makeFeedComparator} is the personalized form.
 */
export const compareByQualityThenTime = makeFeedComparator(null);

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
