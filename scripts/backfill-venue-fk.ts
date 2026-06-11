import { config } from "dotenv";
config({ path: ".env.local", override: true });
import { prisma } from "@/lib/prisma";
import { resolveVenueIdentity } from "@/lib/venues";
import { seedVenues } from "@/lib/seedVenues";

/**
 * Seed the Venue table from lib/venues.ts and link existing events to it.
 *
 * Sets Event.venueId on every event whose venueName matches a known venue
 * (the ingest path now does this for new events; this backfills the history).
 * Idempotent — reseeding upserts by slug and only events with a null venueId
 * are touched. Run with `--dry` to preview without writing.
 */
async function main() {
  const dryRun = process.argv.includes("--dry");

  const venueCount = await seedVenues(prisma);
  console.log(`Seeded ${venueCount} venues`);

  // slug -> id for the seeded venues, so we resolve each event in memory.
  const venues = await prisma.venue.findMany({ select: { id: true, slug: true } });
  const idBySlug = new Map(venues.map((v) => [v.slug, v.id]));

  // Events not yet linked, that have a venue name to match on.
  const events = await prisma.event.findMany({
    where: { venueId: null, venueName: { not: null } },
    select: { id: true, venueName: true, source: { select: { slug: true } } },
  });

  console.log(`Scanning ${events.length} unlinked events${dryRun ? " (dry run)" : ""}`);

  let updated = 0;
  const byVenue: Record<string, number> = {};

  for (const event of events) {
    const identity = resolveVenueIdentity(event.venueName, event.source.slug);
    if (!identity) continue;
    const venueId = idBySlug.get(identity.slug);
    if (!venueId) continue;

    byVenue[identity.name] = (byVenue[identity.name] ?? 0) + 1;
    updated++;

    if (!dryRun) {
      await prisma.event.update({
        where: { id: event.id },
        data: { venueId },
      });
    }
  }

  console.log(`\n${dryRun ? "Would link" : "Linked"} ${updated} / ${events.length} events`);
  Object.entries(byVenue)
    .sort((a, b) => b[1] - a[1])
    .forEach(([name, n]) => console.log(`  ${name.padEnd(34)} ${n}`));

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
