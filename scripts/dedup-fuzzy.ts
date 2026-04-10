import dotenv from "dotenv";
dotenv.config({ path: ".env.local", override: true });

import { prisma } from "../lib/prisma";
import { tokenize, isFuzzyMatch, areLikelyDifferentEvents, MIN_TOKENS } from "../lib/fuzzy";

const DRY_RUN = process.argv.includes("--dry-run");
const LOW_QUALITY_DOMAINS = ["foopee.com", "19hz.info"];

async function main() {
  console.log(`Mode: ${DRY_RUN ? "DRY RUN (no writes)" : "LIVE"}\n`);

  const events = await prisma.event.findMany({
    where: { status: { not: "ARCHIVED" } },
    select: { id: true, title: true, startDate: true, imageUrl: true, sourceUrl: true, dedupeHash: true, venueName: true },
  });
  console.log(`Loaded ${events.length} events`);

  // Group by calendar date (UTC)
  const byDate = new Map<string, typeof events>();
  for (const event of events) {
    const dateKey = event.startDate.toISOString().slice(0, 10);
    const group = byDate.get(dateKey) ?? [];
    group.push(event);
    byDate.set(dateKey, group);
  }

  // Find duplicate groups using union-find
  const parent = new Map<string, string>();
  function find(id: string): string {
    if (parent.get(id) !== id) parent.set(id, find(parent.get(id)!));
    return parent.get(id)!;
  }
  function union(a: string, b: string) {
    parent.set(find(a), find(b));
  }
  for (const event of events) parent.set(event.id, event.id);

  let pairsChecked = 0;
  let fuzzyHits = 0;
  let containmentHits = 0;

  const normVenue = (s: string) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

  for (const [, group] of byDate) {
    if (group.length < 2) continue;

    for (let i = 0; i < group.length; i++) {
      const tokensI = tokenize(group[i].title);

      for (let j = i + 1; j < group.length; j++) {
        pairsChecked++;
        const tokensJ = tokenize(group[j].title);

        // Standard fuzzy match (requires MIN_TOKENS on both sides)
        if (
          tokensI.size >= MIN_TOKENS &&
          tokensJ.size >= MIN_TOKENS &&
          isFuzzyMatch(tokensI, tokensJ) &&
          !areLikelyDifferentEvents(tokensI, tokensJ)
        ) {
          union(group[i].id, group[j].id);
          fuzzyHits++;
          continue;
        }

        // Token-containment check: handles short headliner titles (1-2 tokens) like single-word
        // band names where the shorter title's tokens are fully contained in the longer title.
        // E.g. "Goh" (1 token) vs "Goh, Ingrata, Sissy Fit, Fatale" (5 tokens).
        // Requires same normalized venue to avoid false positives across different events.
        const shorterSize = Math.min(tokensI.size, tokensJ.size);
        if (shorterSize >= 1 && shorterSize <= 2) {
          const [shorter, longer] = tokensI.size <= tokensJ.size
            ? [tokensI, tokensJ]
            : [tokensJ, tokensI];

          let allContained = true;
          for (const t of shorter) {
            if (!longer.has(t)) { allContained = false; break; }
          }

          if (allContained && !areLikelyDifferentEvents(shorter, longer)) {
            const vI = normVenue(group[i].venueName ?? "");
            const vJ = normVenue(group[j].venueName ?? "");
            if (vI && vI === vJ) {
              union(group[i].id, group[j].id);
              containmentHits++;
            }
          }
        }
      }
    }
  }

  console.log(`Pairs checked: ${pairsChecked}, fuzzy hits: ${fuzzyHits}, containment hits: ${containmentHits}\n`);

  // Build duplicate groups
  const groups = new Map<string, typeof events>();
  for (const event of events) {
    const root = find(event.id);
    const g = groups.get(root) ?? [];
    g.push(event);
    groups.set(root, g);
  }

  const duplicateGroups = [...groups.values()].filter((g) => g.length > 1);
  console.log(`Duplicate groups found: ${duplicateGroups.length}`);

  let totalArchived = 0;
  let totalMerged = 0;

  for (const group of duplicateGroups) {
    // Pick winner: has imageUrl > non-low-quality sourceUrl > earliest id (lexicographic)
    const winner = [...group].sort((a, b) => {
      const aImg = a.imageUrl ? 1 : 0;
      const bImg = b.imageUrl ? 1 : 0;
      if (bImg !== aImg) return bImg - aImg;

      const aHQ = LOW_QUALITY_DOMAINS.some((d) => a.sourceUrl.includes(d)) ? 0 : 1;
      const bHQ = LOW_QUALITY_DOMAINS.some((d) => b.sourceUrl.includes(d)) ? 0 : 1;
      if (bHQ !== aHQ) return bHQ - aHQ;

      return a.id < b.id ? -1 : 1;
    })[0];

    const losers = group.filter((e) => e.id !== winner.id);

    const titles = group.map((e) => `"${e.title}" [${e.sourceUrl.split("/")[2]}]`).join("\n    ");
    console.log(`\n  Group (keeping "${winner.title}"):\n    ${titles}`);

    if (!DRY_RUN) {
      await prisma.event.updateMany({
        where: { id: { in: losers.map((e) => e.id) } },
        data: { status: "ARCHIVED" },
      });
    }

    totalArchived += losers.length;
    totalMerged++;
  }

  console.log(`\nSummary:`);
  console.log(`  ${totalMerged} duplicate groups resolved`);
  console.log(`  ${totalArchived} events ${DRY_RUN ? "would be" : ""} archived`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
