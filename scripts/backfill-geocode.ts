import { config } from "dotenv";
config({ path: ".env.local", override: true });
import { prisma } from "@/lib/prisma";
import { geocodeEvent } from "@/lib/geocode";

/**
 * Backfill coordinates/neighborhood for ungeocoded events.
 *
 * Scraped events publish immediately even when geocoding fails at ingest (we
 * don't human-gate ingest — see lib/scrapers/runner.ts). Those events go live
 * with geocoded=false and no coords, so they're absent from the map and won't
 * match a neighborhood filter. This job re-runs the full geocode chain (known-
 * venue table + Nominatim) over the ungeocoded future backlog to fill them in.
 *
 * It supersedes the venue-table-only scripts/backfill-venues.ts, since
 * geocodeEvent tries the venue table first before hitting Nominatim.
 *
 * This is an on-demand tool, not a scheduled job: re-running the same chain
 * only changes anything when an input changed — most usefully after adding a
 * reliable mapping to lib/venues.ts (the admin "Ungeocoded" tab surfaces the
 * venues worth adding). It also recovers events where Nominatim flaked at
 * ingest. Nominatim is throttled to 1 req/sec inside geocodeEvent, so a large
 * backlog takes a while — LIMIT caps a single run.
 *
 * Run with `--dry` to preview without writing. Override the cap with
 * BACKFILL_LIMIT (default 1000).
 */
async function main() {
  const dryRun = process.argv.includes("--dry");
  const limit = Number(process.env.BACKFILL_LIMIT ?? 1000);
  const now = new Date();

  // Future, ungeocoded events that have something to geocode from.
  const events = await prisma.event.findMany({
    where: {
      startDate: { gte: now },
      geocoded: false,
      venueName: { not: null },
    },
    orderBy: { startDate: "asc" },
    take: limit,
    select: {
      id: true,
      title: true,
      startDate: true,
      endDate: true,
      venueName: true,
      venueAddress: true,
      sourceUrl: true,
      source: { select: { slug: true } },
    },
  });

  console.log(
    `Scanning ${events.length} future ungeocoded events (limit ${limit})${dryRun ? " (dry run)" : ""}`
  );

  let updated = 0;
  let stillMissing = 0;
  const bySource: Record<string, number> = {};

  for (const event of events) {
    const geo = await geocodeEvent(
      {
        title: event.title,
        startDate: event.startDate,
        endDate: event.endDate ?? undefined,
        venueName: event.venueName ?? undefined,
        venueAddress: event.venueAddress ?? undefined,
        sourceUrl: event.sourceUrl,
      },
      event.source.slug
    );

    if (geo.latitude == null || geo.longitude == null) {
      stillMissing++;
      continue;
    }

    bySource[event.source.slug] = (bySource[event.source.slug] ?? 0) + 1;
    updated++;

    if (!dryRun) {
      await prisma.event.update({
        where: { id: event.id },
        data: {
          latitude: geo.latitude,
          longitude: geo.longitude,
          neighborhood: geo.neighborhood,
          geocoded: true,
        },
      });
    }
  }

  console.log(
    `\n${dryRun ? "Would update" : "Updated"} ${updated} / ${events.length} events (${stillMissing} still un-geocodable)`
  );
  Object.entries(bySource)
    .sort((a, b) => b[1] - a[1])
    .forEach(([slug, n]) => console.log(`  ${slug.padEnd(20)} ${n}`));

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
