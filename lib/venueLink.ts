import { prisma } from "@/lib/prisma";
import { resolveVenueIdentity } from "@/lib/venues";

// slug -> Venue.id. Venues change rarely (only when lib/venues.ts is reseeded),
// so once a slug resolves its id is stable for the process. Misses are not cached
// so a venue seeded after boot is still picked up on the next event.
const idBySlug = new Map<string, string>();

/**
 * Resolve an event's venue to a normalized Venue id, or null if its venueName
 * isn't a known venue. Called at ingest (after geocoding) by createEvent and the
 * scraper runner to set Event.venueId. Pass the source slug so SFPL branch labels
 * resolve only for the sfpl source (matches resolveVenue/geocodeEvent semantics).
 */
export async function resolveVenueId(
  venueName: string | null | undefined,
  sourceSlug?: string
): Promise<string | null> {
  const identity = resolveVenueIdentity(venueName, sourceSlug);
  if (!identity) return null;

  const cached = idBySlug.get(identity.slug);
  if (cached) return cached;

  const venue = await prisma.venue.findUnique({
    where: { slug: identity.slug },
    select: { id: true },
  });
  if (!venue) return null;

  idBySlug.set(identity.slug, venue.id);
  return venue.id;
}
