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
  /**
   * In-app "I'm interested" votes only (the {@link EventInterest} relation
   * count), distinct from the blended {@link interestCount} which also folds in
   * the source's external signal. This is the local demand signal the hype
   * boost rewards — kept separate so a few real clicks aren't drowned out by RA
   * "interested" counts that run into the hundreds.
   */
  localInterestCount?: number;
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

/**
 * Per-vote and cap for the in-app hype boost. Sized against the quality signals
 * (flyer +4, geocoded +2) so local demand interleaves with quality rather than
 * steamrolling it: a couple of clicks nudges an event up, ~3 clears a flyer,
 * and the cap (4 votes → +6) lets a genuinely hyped event clear flyer +
 * geocoded while bounding how far any single event can run.
 *
 * Deliberately reads {@link RankableEvent.localInterestCount} (in-app votes
 * only), not the blended {@link RankableEvent.interestCount}: the source's
 * "interested" numbers run into the hundreds, so blending them in would let RA
 * volume dominate the boost and bury exactly the homegrown demand it exists to
 * surface.
 */
const HYPE_BOOST_PER_VOTE = 1.5;
const HYPE_BOOST_CAP_VOTES = 4;

/**
 * Additive boost for events our own visitors are clicking "interested" on.
 * Returns 0 for events with no in-app votes, so the feed degrades cleanly to
 * the quality-only ordering before any community signal exists.
 */
export function hypeScore(e: RankableEvent): number {
  const votes = e.localInterestCount ?? 0;
  return Math.min(votes, HYPE_BOOST_CAP_VOTES) * HYPE_BOOST_PER_VOTE;
}

/**
 * Weighting for the curation demand signal — the number trending, the digest,
 * and feed tiebreaks rank on. Real in-app votes dominate; the source's external
 * "interested" count is deliberately down-weighted.
 *
 * Why: only ~1% of events carry an external signal and it's almost entirely
 * Resident Advisor / dance-venue counts, so ranking on the raw blended count
 * (which runs into the hundreds) made electronic shows monopolize every curated
 * surface. Here external is log-compressed and hard-capped into a narrow band
 * (0..{@link EXTERNAL_CREDIT_CAP}), so it only ever *breaks ties* — while a
 * single real vote is worth {@link LOCAL_INTEREST_WEIGHT}, enough to outrank the
 * biggest external count on the site. As homegrown votes accumulate they take
 * over the ordering on their own; the two knobs tune that ratio without touching
 * any call site.
 */
export const LOCAL_INTEREST_WEIGHT = 10; // one in-app vote = 10 curation points
const EXTERNAL_CREDIT_SCALE = 2; // log compression of the source's count
const EXTERNAL_CREDIT_CAP = 8; // most any external count can ever contribute

/**
 * Blends local votes and the source's external interest into a single curation
 * score, with local weighted far above external (see the constants above). Both
 * inputs default to 0, so callers can pass whichever signal they have.
 */
export function curationInterest(
  localVotes: number,
  externalInterest: number
): number {
  const ext =
    externalInterest > 0
      ? Math.min(
          EXTERNAL_CREDIT_CAP,
          Math.round(EXTERNAL_CREDIT_SCALE * Math.log1p(externalInterest))
        )
      : 0;
  return localVotes * LOCAL_INTEREST_WEIGHT + ext;
}

type SortableEvent = PersonalizableEvent & { startDate: string | Date };

/**
 * Builds the per-day feed comparator. The primary key is quality + in-app hype
 * + (optional) personalization score, so both community demand and a session's
 * tastes boost matching events without filtering anything out; ties fall back
 * to most-interested, then earliest start time for a stable chronological order
 * within each tier.
 *
 * Pass `null` (or omit) for the un-personalized feed — with no vector and no
 * Spotify match this reduces to quality → hype → interest → time.
 */
export function makeFeedComparator(vector: PreferenceVector | null = null) {
  return (a: SortableEvent, b: SortableEvent): number => {
    const sb = eventQualityScore(b) + hypeScore(b) + personalizationScore(b, vector);
    const sa = eventQualityScore(a) + hypeScore(a) + personalizationScore(a, vector);
    if (sb !== sa) return sb - sa;
    // Tie-break on the curation signal (real votes weighted far above the
    // source's external count), not the raw blended interestCount — otherwise a
    // few hundred RA "interested" marks would decide the order. External is
    // interestCount minus the local votes already folded into it.
    const cb = curationInterest(
      b.localInterestCount ?? 0,
      (b.interestCount ?? 0) - (b.localInterestCount ?? 0)
    );
    const ca = curationInterest(
      a.localInterestCount ?? 0,
      (a.interestCount ?? 0) - (a.localInterestCount ?? 0)
    );
    if (cb !== ca) return cb - ca;
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
 *
 * Locally-hyped events lead: ordering by the in-app `interests` relation count
 * floats events our visitors are clicking "interested" on to the top of the
 * "load more" pages and the map. This is coarser than the in-memory
 * {@link hypeScore} — a lexicographic orderBy can't express the per-vote cap,
 * so any in-app vote sorts ahead here — but it pushes in the same direction:
 * homegrown demand surfaces above the RA-sourced filler. The blended count
 * shown on cards still folds in `externalInterest`; only the *ordering* signal
 * is the local-vote count.
 *
 * `externalInterest` is deliberately *not* an ordering key here: it's almost
 * entirely Resident Advisor / dance-venue counts, so sorting on it floated
 * electronic shows to the top of every "load more" page. Real votes lead;
 * everything else falls back to quality signals then start time. (See
 * {@link curationInterest} for how the in-memory surfaces weight the two.)
 */
export const QUALITY_ORDER_BY: Prisma.EventOrderByWithRelationInput[] = [
  { interests: { _count: "desc" } },
  { imageUrl: { sort: "desc", nulls: "last" } },
  { latitude: { sort: "desc", nulls: "last" } },
  { recurringType: { sort: "asc", nulls: "first" } },
  { startDate: "asc" },
];
