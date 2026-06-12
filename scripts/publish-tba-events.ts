import { config } from "dotenv";
config({ path: ".env.local", override: true });
import { prisma } from "@/lib/prisma";
import { isServiceAreaTBA, serviceAreaTBACity } from "@/lib/venues";

/**
 * Publish the backlog of location-TBA events we can confirm are local.
 *
 * Placeholder-venue events ("TBA (San Francisco)", "TBA (Oakland)", "SF") were
 * historically held PENDING and hidden. We now publish the ones inside the
 * service area as location-TBA events: visible in the feed, off the map (no
 * coords), badged in the UI (see lib/scrapers/runner.ts, EventCard, event
 * detail). This flips the existing held rows to PUBLISHED. Out-of-area / generic
 * placeholders ("Bay Area", "San Jose", bare "TBA") stay PENDING.
 *
 * Run with `--dry` to preview without writing.
 */
async function main() {
  const dryRun = process.argv.includes("--dry");
  const now = new Date();

  const held = await prisma.event.findMany({
    where: { status: "PENDING", startDate: { gte: now } },
    select: { id: true, title: true, venueName: true, source: { select: { slug: true } } },
    orderBy: { startDate: "asc" },
  });

  const toPublish = held.filter((e) => isServiceAreaTBA(e.venueName));

  const byCity = toPublish.reduce<Record<string, number>>((m, e) => {
    const c = serviceAreaTBACity(e.venueName) ?? "?";
    m[c] = (m[c] ?? 0) + 1;
    return m;
  }, {});

  console.log(
    `${dryRun ? "[DRY RUN] " : ""}Publishing ${toPublish.length} / ${held.length} future PENDING events as location-TBA`
  );
  console.log(`  by confirmed city: ${JSON.stringify(byCity)}`);
  for (const e of toPublish.slice(0, 20)) {
    console.log(`  [${e.source?.slug}] ${e.venueName} — ${e.title.slice(0, 50)}`);
  }
  if (toPublish.length > 20) console.log(`  …and ${toPublish.length - 20} more`);

  if (!dryRun && toPublish.length) {
    const res = await prisma.event.updateMany({
      where: { id: { in: toPublish.map((e) => e.id) } },
      data: { status: "PUBLISHED" },
    });
    console.log(`\n  → published ${res.count}`);
  }

  console.log(`\nDone.${dryRun ? " (dry run — no writes)" : ""}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
