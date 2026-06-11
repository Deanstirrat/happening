import type { PrismaClient } from "@prisma/client";
import { allKnownVenues } from "@/lib/venues";

/**
 * Idempotently upsert one Venue row per known venue (lib/venues.ts), keyed by
 * the deterministic `slug`. Safe to run on every deploy/seed — reseeding never
 * creates duplicates and keeps name/address/coords/photo in sync with the table.
 * Returns the number of venues seeded.
 */
export async function seedVenues(prisma: PrismaClient): Promise<number> {
  const venues = allKnownVenues();
  for (const v of venues) {
    const data = {
      name: v.name,
      address: v.address,
      latitude: v.latitude,
      longitude: v.longitude,
      photoUrl: v.photoUrl ?? null,
    };
    await prisma.venue.upsert({
      where: { slug: v.slug },
      update: data,
      create: { slug: v.slug, ...data },
    });
  }
  return venues.length;
}
