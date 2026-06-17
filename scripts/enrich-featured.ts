import dotenv from "dotenv";
dotenv.config({ path: ".env.local", override: true });

import { prisma } from "../lib/prisma";
import { DESC_MIN_LENGTH } from "../lib/enrichDescription";
import { enrichEvent, type EnrichResult } from "../lib/enrichFeatured";

const CONCURRENCY = 3;

// The per-event enrichment (title cleanup, image cascade, description) lives in
// lib/enrichFeatured.ts — shared with the admin-triggered API route so the two
// paths can't drift. This script is the nightly Railway cron entry point: it
// queries the featured set, runs enrichEvent over it, and logs progress.

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const now = new Date();
  const events = await prisma.event.findMany({
    where: { featured: true, startDate: { gte: now }, status: "PUBLISHED" },
    select: {
      id: true,
      title: true,
      description: true,
      sourceUrl: true,
      imageUrl: true,
      venueName: true,
      city: true,
      startDate: true,
      category: true,
      source: { select: { slug: true } },
    },
    orderBy: { featuredAt: "desc" },
  });

  console.log(`\n=== Enriching ${events.length} featured event(s) ===\n`);

  if (events.length === 0) {
    console.log("No upcoming featured events found.");
    await prisma.$disconnect();
    return;
  }

  const results: EnrichResult[] = [];
  let i = 0;

  for (let batch = 0; batch < events.length; batch += CONCURRENCY) {
    const chunk = events.slice(batch, batch + CONCURRENCY);
    const chunkResults = await Promise.all(
      chunk.map(async (event) => {
        i++;
        console.log(`[${i}/${events.length}] ${event.title}`);
        const { source, ...row } = event;
        const r = await enrichEvent({ ...row, sourceSlug: source.slug });

        const sourceLabel = r.sourceOk ? `${r.sourceStatus} OK` : `${r.sourceStatus || "ERR"} ⚠`;
        console.log(`  source:      ${event.sourceUrl.slice(0, 70)} → ${sourceLabel}`);

        if (r.imageFixed) {
          const via = r.imageSource === "websearch" ? "web search" : "og:image";
          const from = event.imageUrl ? `${event.imageUrl.slice(0, 50)} → ` : "none → ";
          console.log(`  image:       ${from}found via ${via} ✓`);
        } else if (r.usedFallbackImage) {
          console.log(`  image:       no real image found → using fallback placeholder ⚑`);
        } else if (event.imageUrl) {
          console.log(`  image:       ${event.imageUrl.slice(0, 70)} → OK`);
        } else {
          console.log(`  image:       null`);
        }

        const descLen = (event.description ?? "").length;
        if (r.descriptionEnriched) {
          console.log(`  description: ${descLen} chars → enriched via ${r.descriptionSource} ✓`);
        } else if (descLen < DESC_MIN_LENGTH) {
          console.log(`  description: ${descLen} chars → could not enrich`);
        } else {
          console.log(`  description: ${descLen} chars OK`);
        }

        if (r.titleRenamed) {
          console.log(`  title:       "${event.title.slice(0, 55)}"`);
          console.log(`               → "${r.titleRenamed.slice(0, 55)}" ✓`);
        } else if (r.titleMismatch) {
          console.log(`  title check: ⚠ page says "${r.titleMismatch.slice(0, 60)}" (review manually)`);
        }

        console.log();
        return r;
      })
    );
    results.push(...chunkResults);
  }

  // Summary
  const brokenSources = results.filter((r) => !r.sourceOk).length;
  const imagesFixed = results.filter((r) => r.imageFixed).length;
  const imagesFromSearch = results.filter((r) => r.imageSource === "websearch").length;
  const usedFallback = results.filter((r) => r.usedFallbackImage).length;
  const descsEnriched = results.filter((r) => r.descriptionEnriched).length;
  const titlesRenamed = results.filter((r) => r.titleRenamed).length;
  const titleMismatches = results.filter((r) => r.titleMismatch).length;

  console.log("=== Summary ===");
  console.log(`  Events processed:    ${results.length}`);
  console.log(`  Broken source URLs:  ${brokenSources}`);
  console.log(`  Images fixed:        ${imagesFixed} (${imagesFromSearch} via web search)`);
  console.log(`  Fallback images:     ${usedFallback} (no real image — kept featured)`);
  console.log(`  Descriptions added:  ${descsEnriched}`);
  console.log(`  Titles renamed:      ${titlesRenamed}`);
  console.log(`  Title mismatches:    ${titleMismatches} (review manually)`);

  if (titlesRenamed > 0) {
    console.log("\n  Titles renamed:");
    results.filter((r) => r.titleRenamed).forEach((r) => {
      console.log(`    "${r.title}"`);
      console.log(`      → "${r.titleRenamed}"`);
    });
  }

  if (usedFallback > 0) {
    console.log("\n  Using fallback image (no real image — kept featured):");
    results.filter((r) => r.usedFallbackImage).forEach((r) => {
      console.log(`    "${r.title}"`);
    });
  }

  if (brokenSources > 0) {
    console.log("\n  Broken sources:");
    results.filter((r) => !r.sourceOk).forEach((r) => {
      console.log(`    [${r.sourceStatus || "ERR"}] ${r.title}`);
    });
  }
  if (titleMismatches > 0) {
    console.log("\n  Title mismatches (page title vs stored title):");
    results.filter((r) => r.titleMismatch).forEach((r) => {
      console.log(`    stored: "${r.title}"`);
      console.log(`    page:   "${r.titleMismatch}"`);
    });
  }

  await prisma.$disconnect();
}

main().catch(console.error);
