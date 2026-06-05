import { config } from "dotenv";
config({ path: ".env.local", override: true });
import { prisma } from "@/lib/prisma";
import { isTooFarFromSf, isPlaceholderCoord, distanceFromSfKm, addressLooksSf } from "@/lib/geo";
import { geocodeEvent } from "@/lib/geocode";
import type { ScrapedEvent } from "@/lib/types";

/**
 * One-off / repeatable cleanup for the SF service-area filter (lib/geo.ts):
 *
 *   1. ARCHIVE future PUBLISHED events whose coordinates place them confidently
 *      outside the service area (San Jose, Santa Cruz, Tahoe, Stockton, …).
 *      Archiving (not deleting) hides them from the live site but keeps the row,
 *      and the existing dedupeHash short-circuit means a re-scrape won't
 *      re-publish them. Reversible from the admin UI.
 *
 *   2. RE-GEOCODE future events still carrying a placeholder coordinate (RA's
 *      rounded 38,-122 fallback) or a far coordinate that contradicts a plainly
 *      SF address (a misgeocoded SF venue). These are real SF events; we
 *      re-resolve them from their venue address so they land correctly. Going
 *      forward geocode.ts rejects the placeholder at ingest.
 *
 * Run with `--dry` to preview without writing.
 */
async function main() {
  const dryRun = process.argv.includes("--dry");
  const now = new Date();

  const events = await prisma.event.findMany({
    where: { status: "PUBLISHED", startDate: { gte: now } },
    select: {
      id: true,
      title: true,
      venueName: true,
      venueAddress: true,
      latitude: true,
      longitude: true,
      source: { select: { slug: true } },
    },
  });

  // Far-away coords whose address is plainly SF are misgeocoded SF events
  // (e.g. F8's "1192 Folsom St" parsed as the city Folsom) — re-geocode them
  // rather than archiving. Genuinely-far events have no SF signal in the address.
  const far = events.filter(
    (e) => isTooFarFromSf(e.latitude, e.longitude) && !addressLooksSf(e.venueAddress)
  );
  const placeholders = events.filter(
    (e) =>
      e.latitude != null &&
      e.longitude != null &&
      (isPlaceholderCoord(e.latitude, e.longitude) ||
        (isTooFarFromSf(e.latitude, e.longitude) && addressLooksSf(e.venueAddress)))
  );

  console.log(`${dryRun ? "[DRY RUN] " : ""}Scanned ${events.length} future published events.`);

  // ── 1. Archive far-away events ──────────────────────────────────────────
  console.log(`\n=== ARCHIVE: ${far.length} out-of-area events ===`);
  for (const e of far) {
    const km = distanceFromSfKm(e.latitude!, e.longitude!).toFixed(0);
    console.log(`  ${km.padStart(5)}km [${e.source.slug}] ${e.venueName ?? "?"} — ${(e.venueAddress ?? "").slice(0, 50)}`);
  }
  if (!dryRun && far.length) {
    const res = await prisma.event.updateMany({
      where: { id: { in: far.map((e) => e.id) } },
      data: { status: "ARCHIVED" },
    });
    console.log(`  → archived ${res.count}`);
  }

  // ── 2. Re-geocode placeholder / misgeocoded-SF events ───────────────────
  console.log(`\n=== RE-GEOCODE: ${placeholders.length} placeholder / misgeocoded-SF events ===`);
  let fixed = 0;
  for (const e of placeholders) {
    const scraped = {
      title: e.title,
      venueName: e.venueName ?? undefined,
      venueAddress: e.venueAddress ?? undefined,
      latitude: null,
      longitude: null,
    } as unknown as ScrapedEvent;
    const geo = await geocodeEvent(scraped, e.source.slug);
    const ok = geo.latitude != null && geo.longitude != null;
    console.log(
      `  [${e.source.slug}] ${e.venueName ?? "?"} — ${(e.venueAddress ?? "").slice(0, 45)} → ${
        ok ? `${geo.latitude!.toFixed(4)},${geo.longitude!.toFixed(4)} (${geo.neighborhood ?? "—"})` : "FAILED"
      }`
    );
    if (ok && !dryRun) {
      // If the address resolves to somewhere far, archive instead of locating.
      if (isTooFarFromSf(geo.latitude, geo.longitude)) {
        await prisma.event.update({ where: { id: e.id }, data: { status: "ARCHIVED" } });
        console.log(`    → resolved out-of-area, archived`);
      } else {
        await prisma.event.update({
          where: { id: e.id },
          data: {
            latitude: geo.latitude,
            longitude: geo.longitude,
            neighborhood: geo.neighborhood,
            geocoded: true,
          },
        });
        fixed++;
      }
    }
  }
  if (!dryRun) console.log(`  → re-geocoded ${fixed}`);

  console.log(`\nDone.${dryRun ? " (dry run — no writes)" : ""}`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
