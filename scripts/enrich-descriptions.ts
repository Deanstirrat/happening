#!/usr/bin/env tsx
/**
 * Description enrichment for auto-feature candidates.
 *
 * Runs after the scrape job and BEFORE auto-feature, over the exact set of
 * events auto-feature will consider (next 7 SF days, PUBLISHED, not yet
 * featured, excluding recurring/sfpl filler). For each event whose description
 * is still thin, it re-fetches the source page and:
 *   1. tries free metadata extraction (JSON-LD Event copy → og: → meta), then
 *   2. falls back to a Haiku-written summary from the page body.
 *
 * This is what lets auto-feature judge events on real content instead of just
 * the title, and gives the in-app event view enough detail that users rarely
 * need to click through. AI cost is bounded: only candidates, only the ones
 * still thin after free extraction.
 *
 * Usage:
 *   npm run enrich-descriptions
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local", override: true });

import { prisma } from "../lib/prisma";
import { sfDayKey, sfDayStart, sfDayEnd } from "../lib/sfDate";
import { addDays } from "date-fns";
import {
  fetchPageMeta,
  pickStoredDescription,
  generateDescription,
  DESC_MIN_LENGTH,
} from "../lib/enrichDescription";

const CONCURRENCY = 5;

// Listing-page sources whose URL is shared across all of a day's events, so the
// page carries no event-specific description worth fetching (matches the dedup
// runner's low-quality-domain handling).
const SKIP_SOURCE_SLUGS = new Set(["foopee", "19hz"]);

type DescSource = "meta" | "ai";

interface EnrichRow {
  id: string;
  title: string;
  description: string | null;
  sourceUrl: string;
  venueName: string | null;
  startDate: Date;
  source: { slug: string } | null;
}

async function enrichOne(
  event: EnrichRow
): Promise<{ enriched: boolean; source: DescSource | null; from: number }> {
  const from = (event.description ?? "").length;
  const meta = await fetchPageMeta(event.sourceUrl);

  // 1. Free: best storable description from page metadata.
  let description = pickStoredDescription(meta);
  let source: DescSource | null = description ? "meta" : null;

  // 2. AI fallback when metadata is still thin and we have page body to work with.
  if ((!description || description.length < DESC_MIN_LENGTH) && meta.ok && meta.bodyText.length > 100) {
    const aiDesc = await generateDescription({
      title: event.title,
      venueName: event.venueName,
      startDate: event.startDate,
      pageText: meta.bodyText,
    });
    if (aiDesc) {
      description = aiDesc;
      source = "ai";
    }
  }

  // Only write when we actually improved on what's already stored.
  if (!description || description.length <= from) {
    return { enriched: false, source: null, from };
  }
  await prisma.event.update({ where: { id: event.id }, data: { description } });
  return { enriched: true, source, from };
}

async function main() {
  const now = new Date();
  const todayKey = sfDayKey(now);
  const windowStart = sfDayStart(todayKey);
  const windowEnd = sfDayEnd(sfDayKey(addDays(now, 6)));

  console.log(
    `\n📝 happening enrich-descriptions — window: ${todayKey} → ${sfDayKey(addDays(now, 6))}\n`
  );

  // Same candidate pool auto-feature reads, narrowed to events still thin.
  const candidates = await prisma.event.findMany({
    where: {
      status: "PUBLISHED",
      featured: false,
      startDate: { gte: windowStart, lte: windowEnd },
      NOT: [{ tags: { has: "recurring" } }, { tags: { has: "sfpl" } }],
    },
    orderBy: { startDate: "asc" },
    select: {
      id: true,
      title: true,
      description: true,
      sourceUrl: true,
      venueName: true,
      startDate: true,
      source: { select: { slug: true } },
    },
  });

  const eligible = candidates.filter(
    (e) =>
      (e.description ?? "").length < DESC_MIN_LENGTH &&
      !SKIP_SOURCE_SLUGS.has(e.source?.slug ?? "")
  );

  console.log(
    `   ${candidates.length} candidate events, ${eligible.length} with thin descriptions to enrich\n`
  );

  if (eligible.length === 0) {
    console.log("   ✅ Nothing to enrich.\n");
    await prisma.$disconnect();
    return;
  }

  let viaMeta = 0;
  let viaAi = 0;
  let failed = 0;
  let i = 0;

  for (let batch = 0; batch < eligible.length; batch += CONCURRENCY) {
    const chunk = eligible.slice(batch, batch + CONCURRENCY);
    const results = await Promise.all(
      chunk.map(async (event) => {
        const n = ++i;
        const r = await enrichOne(event);
        if (r.enriched) {
          if (r.source === "ai") viaAi++;
          else viaMeta++;
          console.log(
            `[${n}/${eligible.length}] ${event.title.slice(0, 60)} — ${r.from} → enriched via ${r.source} ✓`
          );
        } else {
          failed++;
          console.log(`[${n}/${eligible.length}] ${event.title.slice(0, 60)} — could not enrich`);
        }
        return r;
      })
    );
    void results;
  }

  console.log("\n=== Summary ===");
  console.log(`   Eligible:        ${eligible.length}`);
  console.log(`   Enriched (meta): ${viaMeta}`);
  console.log(`   Enriched (AI):   ${viaAi}`);
  console.log(`   Could not fix:   ${failed}`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
