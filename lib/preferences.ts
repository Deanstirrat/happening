import { prisma } from "@/lib/prisma";
import type { PreferenceVector } from "@/lib/ranking";

/**
 * Per-session preference vectors (issue #99).
 *
 * `EventInteraction` (featured VIEW/CLICK) and `EventInterest` ("I'm
 * interested" votes) are already collected per anonymous session but were
 * otherwise unused for ranking. This turns that history into category +
 * neighborhood affinities the home feed can boost on — anonymous,
 * session-level signal that becomes durable once accounts land (#96).
 */

// Signal strength by source. A click is a stronger pull than a passive
// impression; an explicit "interested" vote is stronger still.
const WEIGHT_VIEW = 1;
const WEIGHT_CLICK = 2;
const WEIGHT_INTEREST = 3;

// Cap the history scan so an unusually active session can't make this query
// unbounded. Most recent rows dominate current taste anyway.
const MAX_ROWS = 500;

function addWeight(map: Record<string, number>, key: string | null, w: number) {
  if (!key) return;
  map[key] = (map[key] ?? 0) + w;
}

/** Scale a raw affinity map so its strongest entry is 1.0; mutates in place. */
function normalize(map: Record<string, number>) {
  const max = Math.max(0, ...Object.values(map));
  if (max <= 0) return;
  for (const k of Object.keys(map)) map[k] /= max;
}

/**
 * Build a {@link PreferenceVector} from a session's interaction history.
 * Returns `null` for a missing session or one with no usable signal, so callers
 * can cheaply fall back to the un-personalized feed.
 */
export async function buildSessionPreferences(
  sessionId: string | null | undefined
): Promise<PreferenceVector | null> {
  if (!sessionId) return null;
  try {
    const [interactions, interests] = await Promise.all([
      prisma.eventInteraction.findMany({
        where: { sessionId },
        orderBy: { createdAt: "desc" },
        take: MAX_ROWS,
        select: { type: true, event: { select: { category: true, neighborhood: true } } },
      }),
      prisma.eventInterest.findMany({
        where: { sessionId },
        orderBy: { createdAt: "desc" },
        take: MAX_ROWS,
        select: { event: { select: { category: true, neighborhood: true } } },
      }),
    ]);

    const category: Record<string, number> = {};
    const neighborhood: Record<string, number> = {};

    for (const i of interactions) {
      const w = i.type === "CLICK" ? WEIGHT_CLICK : WEIGHT_VIEW;
      addWeight(category, i.event.category, w);
      addWeight(neighborhood, i.event.neighborhood, w);
    }
    for (const i of interests) {
      addWeight(category, i.event.category, WEIGHT_INTEREST);
      addWeight(neighborhood, i.event.neighborhood, WEIGHT_INTEREST);
    }

    normalize(category);
    normalize(neighborhood);

    if (Object.keys(category).length === 0 && Object.keys(neighborhood).length === 0) {
      return null;
    }
    return { category, neighborhood };
  } catch {
    // Personalization is best-effort: never let it break the feed render.
    return null;
  }
}
