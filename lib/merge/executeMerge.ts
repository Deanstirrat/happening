/**
 * Apply a duplicate merge to the database.
 *
 * This is the shared write path behind both the nightly cron (scripts/merge-dups.ts)
 * and the admin one-click "merge" in the dedup review UI (issue #102). It owns the
 * transactional side effects — repoint analytics/reports onto the survivor, write
 * the best-of-each survivor record, archive the losers pointing at the survivor —
 * while the deterministic field selection lives in lib/merge/mergeFields.
 *
 * Field selection is reused verbatim from the cron: pickSurvivor + mergeFields,
 * with optional LLM title/description synthesis (synthesizeCluster). Synthesis
 * fails safe to the deterministic fallback title, so a missing ANTHROPIC_API_KEY
 * never blocks a merge.
 */
import { prisma } from "@/lib/prisma";
import { pickSurvivor, mergeFields, type MergeableEvent } from "@/lib/merge/mergeFields";
import { synthesizeCluster } from "@/lib/merge/adjudicate";

/** Columns needed to merge a cluster — mirrors loadEvents() in scripts/merge-dups.ts. */
const MERGE_SELECT = {
  id: true,
  title: true,
  description: true,
  startDate: true,
  endDate: true,
  allDay: true,
  venueName: true,
  venueAddress: true,
  neighborhood: true,
  latitude: true,
  longitude: true,
  category: true,
  price: true,
  isFree: true,
  imageUrl: true,
  sourceUrl: true,
  sourceId: true,
  tags: true,
  performers: true,
  featured: true,
  featuredAt: true,
  recurringType: true,
  scrapedAt: true,
  externalInterest: true,
  status: true,
  _count: { select: { interactions: true } },
} as const;

export interface MergeClusterResult {
  survivorId: string;
  archivedIds: string[];
  title: string;
  titleSource: "llm" | "fallback";
}

/**
 * Merge a cluster of duplicate events (≥2 ids) into a single survivor.
 *
 * Loads the rows, picks the survivor + best-of-each fields, optionally synthesizes
 * a superior title/description, then in one transaction repoints interactions and
 * reports onto the survivor, updates it, and archives the losers (mergedIntoId →
 * survivor, so their /events/<id> URLs 301 to it).
 *
 * @throws if fewer than two of the ids resolve to live (non-archived) events.
 */
export async function mergeEventCluster(
  eventIds: string[],
  opts: { synthesize?: boolean } = {}
): Promise<MergeClusterResult> {
  const synthesize = opts.synthesize ?? true;
  const uniqueIds = [...new Set(eventIds)];
  if (uniqueIds.length < 2) {
    throw new Error("A merge needs at least two distinct events");
  }

  const rows = await prisma.event.findMany({
    where: { id: { in: uniqueIds } },
    select: MERGE_SELECT,
  });

  // Only merge live events; an already-archived row (e.g. a stale candidate that
  // was merged by the cron between page load and click) must not be resurrected.
  const cluster: (MergeableEvent & { sourceId: string; externalInterest: number })[] = rows
    .filter((r) => r.status !== "ARCHIVED")
    .map((r) => ({ ...r, interactionCount: r._count.interactions }));

  if (cluster.length < 2) {
    throw new Error("Fewer than two of these events are still live to merge");
  }

  const survivor = pickSurvivor(cluster);
  const losers = cluster.filter((e) => e.id !== survivor.id);
  const merged = mergeFields(cluster, survivor);

  const synth = synthesize
    ? await synthesizeCluster(
        cluster.map((e) => ({
          title: e.title,
          description: e.description,
          venueName: e.venueName,
        }))
      )
    : null;
  const finalTitle = synth?.title ?? merged.fallbackTitle;
  const finalDescription = synth?.description ?? merged.description;
  const titleSource: "llm" | "fallback" = synth ? "llm" : "fallback";

  const loserIds = losers.map((e) => e.id);
  const provenance = {
    mergedAt: new Date().toISOString(),
    survivorId: survivor.id,
    titleSource,
    members: cluster.map((e) => ({
      id: e.id,
      title: e.title,
      sourceUrl: e.sourceUrl,
      sourceId: e.sourceId,
    })),
  };

  await prisma.$transaction(async (tx) => {
    // Repoint analytics + reports onto the survivor so counts consolidate.
    await tx.eventInteraction.updateMany({
      where: { eventId: { in: loserIds } },
      data: { eventId: survivor.id },
    });
    await tx.eventReport.updateMany({
      where: { eventId: { in: loserIds } },
      data: { eventId: survivor.id },
    });

    // Write the superior survivor record. dedupeHash is intentionally left
    // unchanged so re-scrapes keep folding into this row.
    await tx.event.update({
      where: { id: survivor.id },
      data: {
        title: finalTitle,
        description: finalDescription,
        endDate: merged.endDate,
        venueName: merged.venueName,
        venueAddress: merged.venueAddress,
        neighborhood: merged.neighborhood,
        latitude: merged.latitude,
        longitude: merged.longitude,
        category: merged.category,
        price: merged.price,
        isFree: merged.isFree,
        imageUrl: merged.imageUrl,
        sourceUrl: merged.sourceUrl,
        tags: merged.tags,
        performers: merged.performers,
        featured: merged.featured,
        featuredAt: merged.featuredAt,
        recurringType: merged.recurringType,
        externalInterest: Math.max(...cluster.map((e) => e.externalInterest)),
        mergeProvenance: provenance,
      },
    });

    // Archive losers, pointing them at the survivor (their URLs 301 to it).
    await tx.event.updateMany({
      where: { id: { in: loserIds } },
      data: { status: "ARCHIVED", mergedIntoId: survivor.id },
    });
  });

  return { survivorId: survivor.id, archivedIds: loserIds, title: finalTitle, titleSource };
}

/** Canonical key for a candidate pair: the two ids sorted, joined by ":". */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}
