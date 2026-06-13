import { config } from "dotenv";
config({ path: ".env.local", override: true });
import { prisma } from "@/lib/prisma";
import { resolveVenue } from "@/lib/venues";
import { detectNeighborhood } from "@/lib/neighborhoods";

/**
 * Backfill coordinates/neighborhood for existing events whose venue is in the
 * static known-venue table (lib/venues.ts) but which were never geocoded — most
 * notably the ~600 SFPL branch events that are 100% ungeocoded.
 *
 * Run with `--dry` to preview without writing.
 */
async function main() {
  const dryRun = process.argv.includes("--dry");
  const now = new Date();

  // All future events with a venue. The static table (lib/venues.ts) is
  // authoritative for any venue it lists, so we re-resolve every event against
  // it — not just the ungeocoded ones. This also corrects events that WERE
  // geocoded but landed on the wrong spot because Nominatim mis-resolved the
  // bare venue name (e.g. "Embarcadero Plaza" → Union Square, ~1 km off) before
  // the venue was added to the table.
  const events = await prisma.event.findMany({
    where: {
      startDate: { gte: now },
      venueName: { not: null },
    },
    select: {
      id: true,
      venueName: true,
      venueAddress: true,
      latitude: true,
      longitude: true,
      neighborhood: true,
      source: { select: { slug: true } },
    },
  });

  console.log(`Scanning ${events.length} future events with a venue${dryRun ? " (dry run)" : ""}`);

  let updated = 0;
  const bySource: Record<string, number> = {};

  for (const event of events) {
    const known = resolveVenue(event.venueName, event.source.slug);
    if (!known) continue;

    const neighborhood = detectNeighborhood(known.latitude, known.longitude);

    // Skip if the event already matches the canonical venue data — keeps the
    // backfill idempotent and avoids rewriting the ~thousands already correct.
    if (
      event.latitude === known.latitude &&
      event.longitude === known.longitude &&
      event.neighborhood === neighborhood &&
      event.venueAddress === known.address
    ) {
      continue;
    }

    bySource[event.source.slug] = (bySource[event.source.slug] ?? 0) + 1;
    updated++;

    if (!dryRun) {
      await prisma.event.update({
        where: { id: event.id },
        data: {
          latitude: known.latitude,
          longitude: known.longitude,
          neighborhood,
          geocoded: true,
          // Upgrade vague/placeholder addresses to the canonical street address.
          venueAddress: known.address,
        },
      });
    }
  }

  console.log(`\n${dryRun ? "Would update" : "Updated"} ${updated} / ${events.length} events`);
  Object.entries(bySource)
    .sort((a, b) => b[1] - a[1])
    .forEach(([slug, n]) => console.log(`  ${slug.padEnd(20)} ${n}`));

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
