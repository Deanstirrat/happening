const STOPWORDS = new Set([
  "the", "a", "an", "at", "in", "of", "and", "with", "by", "for", "to", "on",
  "live", "presents", "presenting", "featuring", "feat", "vs", "from",
  // Geographic noise: almost every SF event has these, they don't distinguish events
  "san", "francisco",
]);

export function tokenize(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .split(" ")
      .filter((t) => t.length > 1 && !STOPWORDS.has(t))
  );
}

export const FUZZY_THRESHOLD = 0.65;
// When one title's token set is much smaller (e.g. "Cry Me a Raver" buried inside
// a longer listing), Jaccard is too low even though they're clearly the same event.
// Containment measures how much of the *smaller* set overlaps the larger.
export const CONTAINMENT_THRESHOLD = 0.60;
// Minimum shared tokens required regardless of which metric fires.
export const MIN_OVERLAP = 3;
// Minimum meaningful tokens required to attempt fuzzy matching.
export const MIN_TOKENS = 3;

/**
 * Returns true if the two token sets are a fuzzy match, using the more
 * permissive of Jaccard similarity or containment-of-smaller-set.
 * Requires at least MIN_OVERLAP tokens in common.
 */
export function isFuzzyMatch(a: Set<string>, b: Set<string>): boolean {
  let intersection = 0;
  for (const t of a) {
    if (b.has(t)) intersection++;
  }
  if (intersection < MIN_OVERLAP) return false;

  const union = a.size + b.size - intersection;
  const jaccard = intersection / union;
  const containment = intersection / Math.min(a.size, b.size);

  return jaccard >= FUZZY_THRESHOLD || containment >= CONTAINMENT_THRESHOLD;
}

/**
 * Returns true if two venue name strings refer to the same venue.
 * Uses token-based matching: matches if one token set is fully contained in
 * the other, or if Jaccard similarity ≥ 0.5 with at least 1 shared token.
 * Handles cases like "Public Works" vs "Public Works SF".
 */
export function isVenueFuzzyMatch(a: string, b: string): boolean {
  const tokenizeVenue = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .split(/\s+/)
      .filter((t) => t.length > 0);
  const tokA = tokenizeVenue(a);
  const tokB = tokenizeVenue(b);
  if (tokA.length === 0 || tokB.length === 0) return false;
  const setA = new Set(tokA);
  const setB = new Set(tokB);
  let intersection = 0;
  for (const t of setA) {
    if (setB.has(t)) intersection++;
  }
  if (intersection === 0) return false;
  // Full containment: smaller set is entirely within the larger
  if (intersection === Math.min(setA.size, setB.size)) return true;
  // Partial match: Jaccard ≥ 0.5
  const union = setA.size + setB.size - intersection;
  return intersection / union >= 0.5;
}

// Keep the old export for any external callers.
export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const t of a) {
    if (b.has(t)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// Words that indicate different time-slots of the same recurring event.
const TIME_SLOT_WORDS = new Set(["early", "late", "morning", "afternoon", "evening", "night", "matinee"]);

// Generic filler words that one source appends but another omits — not meaningful differentiators.
const GENERIC_DISAMBIG_WORDS = new Set(["more", "djs"]);

/**
 * Returns true if the differing tokens between two title token sets suggest
 * they are genuinely different events (different time slots or sequence numbers)
 * rather than the same event described slightly differently.
 */
export function areLikelyDifferentEvents(a: Set<string>, b: Set<string>): boolean {
  const onlyInA = [...a].filter((t) => !b.has(t));
  const onlyInB = [...b].filter((t) => !a.has(t));
  const diff = [...onlyInA, ...onlyInB];

  // Different time-slot words (e.g. "Early Show" vs "Late Show")
  if (diff.some((t) => TIME_SLOT_WORDS.has(t))) return true;

  // Both sides have a differing pure-numeric token (e.g. #003 vs #004, 730 vs 930)
  const numericA = onlyInA.some((t) => /^\d+$/.test(t));
  const numericB = onlyInB.some((t) => /^\d+$/.test(t));
  if (numericA && numericB) return true;

  // When both titles are long enough (≥5 meaningful tokens each) and both have
  // substantive unique tokens, they're likely different events sharing a template
  // structure (e.g. different fitness class genres, different museum free days,
  // different city locations for the same event series).
  // Guard: only apply at min≥5 to preserve short-title dedup where one source
  // omits a venue suffix or opening act (≤4 tokens — those remain same-event).
  if (Math.min(a.size, b.size) >= 5) {
    const meaningful = (tokens: string[]) =>
      tokens.some((t) => t.length > 2 && !GENERIC_DISAMBIG_WORDS.has(t));
    if (meaningful(onlyInA) && meaningful(onlyInB)) return true;
  }

  return false;
}
