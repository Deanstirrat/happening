import dotenv from "dotenv";
dotenv.config({ path: ".env.local", override: true });

import { createHash } from "crypto";
import { prisma } from "../lib/prisma";
import { tokenize, isFuzzyMatch, areLikelyDifferentEvents, MIN_TOKENS } from "../lib/fuzzy";

const DRY_RUN = process.argv.includes("--dry-run");
const LOW_QUALITY_DOMAINS = ["foopee.com", "19hz.info"];

function computeHash(startDate: Date, title: string): string {
  const dateStr = startDate.toISOString().slice(0, 10);
  const normalizedTitle = title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return createHash("sha256").update(`${dateStr}::${normalizedTitle}`).digest("hex");
}

async function main() {
  console.log(`Mode: ${DRY_RUN ? "DRY RUN (no writes)" : "LIVE"}\n`);

  const events = await prisma.event.findMany({
    select: { id: true, title: true, startDate: true, imageUrl: true, sourceUrl: true, dedupeHash: true },
  });
  console.log(`Loaded ${events.length} events`);

  // Group by calendar date
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

  for (const [, group] of byDate) {
    if (group.length < 2) continue;

    for (let i = 0; i < group.length; i++) {
      const tokensI = tokenize(group[i].title);
      if (tokensI.size < MIN_TOKENS) continue;

      for (let j = i + 1; j < group.length; j++) {
        pairsChecked++;
        const tokensJ = tokenize(group[j].title);
        if (tokensJ.size < MIN_TOKENS) continue;

        if (isFuzzyMatch(tokensI, tokensJ) && !areLikelyDifferentEvents(tokensI, tokensJ)) {
          union(group[i].id, group[j].id);
          fuzzyHits++;
        }
      }
    }
  }

  console.log(`Pairs checked: ${pairsChecked}, fuzzy hits: ${fuzzyHits}\n`);

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

  let totalDeleted = 0;
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
      await prisma.event.deleteMany({ where: { id: { in: losers.map((e) => e.id) } } });
      const newHash = computeHash(winner.startDate, winner.title);
      await prisma.event.update({ where: { id: winner.id }, data: { dedupeHash: newHash } });
    }

    totalDeleted += losers.length;
    totalMerged++;
  }

  console.log(`\nSummary:`);
  console.log(`  ${totalMerged} duplicate groups resolved`);
  console.log(`  ${totalDeleted} events ${DRY_RUN ? "would be" : ""} deleted`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
