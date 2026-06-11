// Shared artist-matching used by both the Spotify "for you" homepage feed and
// the "following" feed (issue #98). Keeping one implementation means a followed
// artist surfaces exactly the events the Spotify match would, so the two feeds
// agree on what "an event by this artist" means.

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Common English words that appear constantly in event titles and are too
// ambiguous to reliably identify an artist, even with word-boundary matching.
const TITLE_MATCH_DENYLIST = new Set([
  "free", "live", "open", "real", "bass", "band", "solo", "wave", "soul",
  "rock", "jazz", "funk", "folk", "doom", "pure", "wild", "blue", "gold",
  "dark", "dawn", "rise", "echo", "fire", "rain", "sage", "west", "east",
  "moon", "star", "nova", "void", "holy", "dead", "loud", "soft", "warm",
]);

/**
 * Return the matched artist name (lowercased) if `event` is by one of the
 * artists in `artistSet`, else null. `artistSet` holds lowercased names.
 *
 * Structured performers match exactly; for music events with no performers we
 * fall back to a word-boundary title match, gated by length + denylist to avoid
 * false positives (an artist literally named "live" or "free").
 */
export function matchesArtists(
  event: { performers: string[]; title: string; category: string | null },
  artistSet: Set<string>
): string | null {
  // Check structured performers first (Bandsintown, RA, Foopee). Returns the
  // performer's original casing for display; callers that need a stable key
  // (e.g. a follow targetId) lowercase the result themselves.
  for (const p of event.performers) {
    if (artistSet.has(p.toLowerCase())) return p;
  }
  // For music events with no structured performers, fall back to title
  // word-boundary match. Word boundaries prevent "Char" matching "Charles".
  if (event.category?.startsWith("MUSIC_") && event.performers.length === 0) {
    const titleLower = event.title.toLowerCase();
    for (const artist of artistSet) {
      if (
        artist.length >= 4 &&
        !TITLE_MATCH_DENYLIST.has(artist) &&
        new RegExp(`\\b${escapeRegExp(artist)}\\b`).test(titleLower)
      ) {
        return artist;
      }
    }
  }
  return null;
}
