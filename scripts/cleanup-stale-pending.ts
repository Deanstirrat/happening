import { config } from "dotenv";
config({ path: ".env.local", override: true });
import { prisma } from "@/lib/prisma";

/**
 * Triage cleanup for the two non-geocodable backlogs (one-off, repeatable).
 *
 *   1. ARCHIVE past PENDING submissions. Events held PENDING for a placeholder
 *      venue whose start date is already behind us will never publish — they're
 *      stale. Archiving drops them out of the submissions tab while keeping the
 *      row (reversible from the admin UI).
 *
 *   2. ARCHIVE legacy "Bookmobiles / MOS" events. SFPL's mobile service has no
 *      fixed map point; the sfpl scraper now skips it at ingest (lib/venues.ts),
 *      but pre-skip rows remain — some held PENDING, some published ungeocoded.
 *      Pinning 30+ events to one wrong spot would misrepresent the map, so we
 *      archive them out of both the submissions and ungeocoded triage lists.
 *
 * Run with `--dry` to preview without writing.
 */
async function main() {
  const dryRun = process.argv.includes("--dry");
  const now = new Date();

  // ── 1. Past PENDING submissions ─────────────────────────────────────────
  const pastPending = await prisma.event.findMany({
    where: { status: "PENDING", startDate: { lt: now } },
    select: { id: true, title: true, startDate: true, venueName: true, source: { select: { slug: true } } },
    orderBy: { startDate: "asc" },
  });

  console.log(`${dryRun ? "[DRY RUN] " : ""}=== ARCHIVE: ${pastPending.length} past PENDING submissions ===`);
  for (const e of pastPending.slice(0, 15)) {
    console.log(`  ${e.startDate.toISOString().slice(0, 10)} [${e.source?.slug}] ${e.venueName ?? "?"} — ${e.title.slice(0, 45)}`);
  }
  if (pastPending.length > 15) console.log(`  …and ${pastPending.length - 15} more`);
  if (!dryRun && pastPending.length) {
    const res = await prisma.event.updateMany({
      where: { id: { in: pastPending.map((e) => e.id) } },
      data: { status: "ARCHIVED" },
    });
    console.log(`  → archived ${res.count}`);
  }

  // ── 2. Legacy Bookmobiles / MOS ─────────────────────────────────────────
  const bookmobiles = await prisma.event.findMany({
    where: {
      venueName: { startsWith: "Bookmobiles", mode: "insensitive" },
      status: { in: ["PENDING", "PUBLISHED"] },
    },
    select: { id: true, status: true, title: true, startDate: true },
  });
  const byStatus = bookmobiles.reduce<Record<string, number>>((m, e) => {
    m[e.status] = (m[e.status] ?? 0) + 1;
    return m;
  }, {});
  console.log(`\n${dryRun ? "[DRY RUN] " : ""}=== ARCHIVE: ${bookmobiles.length} legacy Bookmobiles / MOS events ===`);
  console.log(`  by status: ${JSON.stringify(byStatus)}`);
  if (!dryRun && bookmobiles.length) {
    const res = await prisma.event.updateMany({
      where: { id: { in: bookmobiles.map((e) => e.id) } },
      data: { status: "ARCHIVED" },
    });
    console.log(`  → archived ${res.count}`);
  }

  console.log(`\nDone.${dryRun ? " (dry run — no writes)" : ""}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
