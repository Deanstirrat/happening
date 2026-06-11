import dotenv from "dotenv";
dotenv.config({ path: ".env.local", override: true });

/**
 * Semantic duplicate merge.
 *
 * Pipeline:
 *   1. Load upcoming non-archived events (+ interaction counts).
 *   2. Block into candidate pairs per SF day (lib/merge/blocking).
 *   3. Adjudicate each pair with Claude Haiku — "same event?" (lib/merge/adjudicate).
 *   4. Union-find the confirmed pairs into clusters.
 *   5. For each cluster: pick a survivor, compute best-of-each fields, synthesize
 *      a superior title/description, write the survivor, repoint interactions/
 *      reports, and ARCHIVE the losers pointing at the survivor.
 *
 * Runs as a Railway cron service (railway.merge-dups.toml) after the nightly
 * scrape. Cheap to run: a few hundred Haiku calls/day at most.
 *
 * Usage:
 *   npm run merge-dups -- --dry-run    # report proposed merges, no writes
 *   npm run merge-dups                 # apply merges
 *
 * Env knobs:
 *   MERGE_CONFIDENCE   min adjudicator confidence to merge (default 0.75)
 *   MERGE_MAX_PAIRS    cap on total pairs adjudicated per run (default 2000)
 *   MERGE_WINDOW_DAYS  only consider events starting within the past N days
 *                      onward (default 1 — i.e. from yesterday into the future)
 */
import { prisma } from "../lib/prisma";
import { generateCandidatePairs, type BlockEvent } from "../lib/merge/blocking";
import {
  pickSurvivor,
  mergeFields,
  type MergeableEvent,
} from "../lib/merge/mergeFields";
import { adjudicatePair, synthesizeCluster, ADJUDICATE_MODEL } from "../lib/merge/adjudicate";
import { pairKey } from "../lib/merge/executeMerge";
import { MERGE_CONFIDENCE } from "../lib/merge/thresholds";

// Flags can be set via argv (--dry-run / --all) or env (MERGE_DRY_RUN=1 /
// MERGE_ALL=1). Env is the safer path on Railway: `npm run merge-dups --all`
// does NOT work — npm swallows flags before a `--`, so it would silently run
// live + incremental. Use env vars, or `npm run merge-dups -- --all`.
const DRY_RUN = process.argv.includes("--dry-run") || process.env.MERGE_DRY_RUN === "1";
// By default a run only judges candidate pairs that involve an event scraped in
// the last NEW_SINCE_HOURS — pairs between two older events were already judged
// in a prior run, so re-judging them every night is wasted spend. `--all` (or
// MERGE_ALL=1) reprocesses every pair, for the one-time backlog backfill.
const REPROCESS_ALL = process.argv.includes("--all") || process.env.MERGE_ALL === "1";
const NEW_SINCE_HOURS = Number(process.env.MERGE_NEW_SINCE_HOURS ?? "26");
const MERGE_MAX_PAIRS = Number(process.env.MERGE_MAX_PAIRS ?? "2000");
// Lower bound on which events form the comparison universe (default: from
// yesterday into the future). Keep small — a large window drags in past events
// we don't care about deduping.
const WINDOW_DAYS = Number(process.env.MERGE_WINDOW_DAYS ?? "1");

// Haiku throughput. Defaults are conservative (5 concurrent / 50 req/min) for
// nightly runs; raise both via env for a one-off backlog backfill if your
// Anthropic tier allows (e.g. MERGE_CONCURRENCY=20 MERGE_RPM=1000).
//   MERGE_CONCURRENCY — how many calls run at once
//   MERGE_RPM         — ceiling on calls per minute
const CONCURRENCY = Math.max(1, Number(process.env.MERGE_CONCURRENCY ?? "5"));
const RPM = Math.max(1, Number(process.env.MERGE_RPM ?? "50"));
// Delay between batches so we stay at/under RPM (a floor — actual pace is also
// bounded by API latency, which only makes us slower/safer).
const BATCH_DELAY_MS = Math.ceil((CONCURRENCY / RPM) * 60000);

type LoadedEvent = MergeableEvent & BlockEvent & { sourceId: string; externalInterest: number };

async function loadEvents(): Promise<LoadedEvent[]> {
  const since = new Date(Date.now() - WINDOW_DAYS * 86400000);
  const rows = await prisma.event.findMany({
    where: {
      status: { in: ["PUBLISHED", "PENDING"] },
      startDate: { gte: since },
    },
    select: {
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
      _count: { select: { interactions: true } },
    },
  });

  return rows.map((r) => ({
    ...r,
    interactionCount: r._count.interactions,
  }));
}

/**
 * Run async work over items with bounded concurrency + rate-limit delay.
 * When `label` is set, emits a throttled progress heartbeat (≤ every 2s) so a
 * long phase visibly advances instead of going silent.
 */
async function rateLimitedMap<I, O>(
  items: I[],
  fn: (item: I, index: number) => Promise<O>,
  label?: string
): Promise<O[]> {
  const out: O[] = [];
  const total = items.length;
  const startedAt = Date.now();
  let lastLog = 0;
  for (let i = 0; i < total; i += CONCURRENCY) {
    const batch = items.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map((item, k) => fn(item, i + k)));
    out.push(...results);

    const done = out.length;
    const now = Date.now();
    if (label && (now - lastLog >= 2000 || done === total)) {
      const secs = (now - startedAt) / 1000;
      const rate = done / Math.max(secs, 0.001);
      const etaSecs = rate > 0 ? Math.round((total - done) / rate) : 0;
      console.log(
        `[${label}] ${done}/${total} (${Math.round((done / total) * 100)}%) · ${Math.round(secs)}s elapsed · ${rate.toFixed(1)}/s · eta ${etaSecs}s`
      );
      lastLog = now;
    }

    if (i + CONCURRENCY < total) {
      await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
    }
  }
  return out;
}

async function main() {
  console.log(`Mode: ${DRY_RUN ? "DRY RUN (no writes)" : "LIVE"}`);
  console.log(
    `Confidence ≥ ${MERGE_CONFIDENCE}, max pairs ${MERGE_MAX_PAIRS}, window ${WINDOW_DAYS}d`
  );
  console.log(
    `Throughput: ${CONCURRENCY} concurrent, ≤${RPM} req/min (~${BATCH_DELAY_MS}ms/batch)\n`
  );

  const events = await loadEvents();
  console.log(`Loaded ${events.length} upcoming events`);

  // 2. Block into candidate pairs.
  const { pairs, truncatedDays } = generateCandidatePairs(events);
  if (truncatedDays.length) {
    console.warn(
      `⚠️  Per-day pair cap hit on ${truncatedDays.length} day(s): ${truncatedDays.join(", ")} — lowest-scoring pairs dropped`
    );
  }

  // Incremental gate: skip pairs where both events predate the last run.
  let candidatePairs = pairs;
  if (REPROCESS_ALL) {
    console.log(`Reprocessing ALL ${candidatePairs.length} candidate pairs (--all)`);
  } else {
    const cutoff = Date.now() - NEW_SINCE_HOURS * 3600_000;
    const before = candidatePairs.length;
    candidatePairs = candidatePairs.filter(
      (p) => p.a.scrapedAt.getTime() >= cutoff || p.b.scrapedAt.getTime() >= cutoff
    );
    console.log(
      `Incremental: ${candidatePairs.length} pairs involve an event scraped in the last ${NEW_SINCE_HOURS}h (skipped ${before - candidatePairs.length} already-judged pairs; use --all to reprocess everything)`
    );
  }

  if (candidatePairs.length > MERGE_MAX_PAIRS) {
    candidatePairs = [...candidatePairs]
      .sort((a, b) => b.score - a.score)
      .slice(0, MERGE_MAX_PAIRS);
    console.warn(
      `⚠️  candidate pairs exceed MERGE_MAX_PAIRS=${MERGE_MAX_PAIRS}; adjudicating top ${MERGE_MAX_PAIRS} by score`
    );
  }
  console.log(`Adjudicating ${candidatePairs.length} candidate pairs...\n`);

  // 3. Adjudicate each pair with Haiku. Log the first few confirmed duplicates
  // inline as qualitative proof the matching is working early in the run.
  const SAMPLE_LIMIT = 12;
  let sampleLogged = 0;
  const verdicts = await rateLimitedMap(
    candidatePairs,
    async (pair) => {
      const result = await adjudicatePair(pair.a, pair.b);
      if (
        result.same &&
        result.confidence >= MERGE_CONFIDENCE &&
        sampleLogged < SAMPLE_LIMIT
      ) {
        sampleLogged++;
        console.log(
          `  ✓ dup (${result.confidence.toFixed(2)}): "${pair.a.title}" ≈ "${pair.b.title}"`
        );
      }
      return { pair, result };
    },
    "adjudicate"
  );

  // Surface API failures loudly — otherwise a bad key / rate-limit looks like
  // "no duplicates found" (every failed call returns same:false).
  const ERROR_REASONS = new Set(["no API key", "unparseable response", "api error"]);
  const errored = verdicts.filter((v) => ERROR_REASONS.has(v.result.reason)).length;
  if (errored > 0) {
    console.warn(
      `⚠️  ${errored}/${verdicts.length} adjudications FAILED — check ANTHROPIC_API_KEY / rate limits before trusting results`
    );
  }

  // Persist every successful verdict (both same and not-same) so the admin dedup
  // UI can surface only the uncertain band instead of the raw blocking firehose,
  // and so settled pairs needn't be re-judged. Skip errored adjudications — a
  // transient API failure must never be cached as a false "not a duplicate".
  // Re-judging replaces the prior row (delete-then-insert by pairKey).
  if (!DRY_RUN) {
    const rows = verdicts
      .filter((v) => !ERROR_REASONS.has(v.result.reason))
      .map((v) => ({
        pairKey: pairKey(v.pair.a.id, v.pair.b.id),
        same: v.result.same,
        confidence: v.result.confidence,
        reason: v.result.reason,
        model: ADJUDICATE_MODEL,
      }));
    const keys = rows.map((r) => r.pairKey);
    await prisma.$transaction([
      prisma.duplicateVerdict.deleteMany({ where: { pairKey: { in: keys } } }),
      prisma.duplicateVerdict.createMany({ data: rows }),
    ]);
    console.log(
      `Persisted ${rows.length} verdicts (skipped ${verdicts.length - rows.length} errored)\n`
    );
  }

  const confirmed = verdicts.filter(
    (v) => v.result.same && v.result.confidence >= MERGE_CONFIDENCE
  );
  console.log(
    `Confirmed ${confirmed.length} duplicate pairs (of ${candidatePairs.length} adjudicated)\n`
  );

  // 4. Union-find the confirmed pairs into clusters.
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    if (parent.get(id) !== id) parent.set(id, find(parent.get(id)!));
    return parent.get(id)!;
  };
  const union = (a: string, b: string) => {
    parent.set(find(a), find(b));
  };
  for (const e of events) parent.set(e.id, e.id);
  for (const { pair } of confirmed) union(pair.a.id, pair.b.id);

  const clusters = new Map<string, LoadedEvent[]>();
  for (const e of events) {
    const root = find(e.id);
    const g = clusters.get(root) ?? [];
    g.push(e);
    clusters.set(root, g);
  }
  const dupClusters = [...clusters.values()].filter((g) => g.length > 1);
  console.log(`Found ${dupClusters.length} duplicate clusters\n`);

  // 5. Merge each cluster. Clusters are disjoint sets of event ids (union-find
  // partitions), so their writes never touch the same rows — safe to run with
  // the same bounded concurrency as adjudication. The RPM ceiling applies here
  // too, since each cluster makes one synthesis call.
  const mergeResults = await rateLimitedMap(dupClusters, async (cluster) => {
    const survivor = pickSurvivor(cluster);
    const losers = cluster.filter((e) => e.id !== survivor.id);
    const merged = mergeFields(cluster, survivor);

    // Synthesize a superior title + description from all members.
    const synth = await synthesizeCluster(
      cluster.map((e) => ({
        title: e.title,
        description: e.description,
        venueName: e.venueName,
      }))
    );
    const finalTitle = synth?.title ?? merged.fallbackTitle;
    const finalDescription = synth?.description ?? merged.description;
    const titleSource = synth ? "llm" : "fallback";

    const memberLines = cluster
      .map((e) => `    ${e.id === survivor.id ? "KEEP " : "merge"} "${e.title}" [${hostOf(e.sourceUrl)}]`)
      .join("\n");
    console.log(
      `Cluster → keep ${survivor.id}\n  title: "${finalTitle}" [${titleSource}]\n${memberLines}\n`
    );

    if (DRY_RUN) {
      return losers.length;
    }

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
    const loserIds = losers.map((e) => e.id);

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

      // Write the superior survivor record.
      // NOTE: dedupeHash is intentionally left unchanged — it keys the inline
      // scraper's exact-match dedup against each source's *original* title, so
      // re-scrapes keep folding into this row.
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
          // Keep the strongest external interest signal in the cluster (e.g. an
          // RA event merged into a survivor from another source).
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

    return losers.length;
  }, "merge");

  const mergedCount = mergeResults.length;
  const archivedCount = mergeResults.reduce((sum, n) => sum + n, 0);

  console.log("Summary:");
  console.log(`  ${mergedCount} clusters ${DRY_RUN ? "would be" : ""} merged`);
  console.log(`  ${archivedCount} events ${DRY_RUN ? "would be" : ""} archived`);

  await prisma.$disconnect();
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url.split("/")[2] ?? url;
  }
}

main().catch(async (err) => {
  console.error("Fatal error:", err);
  await prisma.$disconnect();
  process.exit(1);
});
