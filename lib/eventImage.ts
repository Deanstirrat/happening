import type { EventCategory } from "@prisma/client";
import { CATEGORY_IMAGES } from "@/lib/categoryImages";
import { resolveVenuePhoto } from "@/lib/venues";

/**
 * Route an external image URL through /api/image-proxy (to dodge hotlink blocks
 * and add caching). Protocol-relative URLs are upgraded to https; non-http
 * values (e.g. local /category-images/*) are returned untouched. Null in → null.
 */
export function proxiedImage(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const url = raw.startsWith("//") ? `https:${raw}` : raw;
  return url.startsWith("http") ? `/api/image-proxy?url=${encodeURIComponent(url)}` : url;
}

/**
 * The fallback image to show when an event has no flyer of its own: a photo of
 * its venue if it's at a known venue, otherwise the generic category tile.
 * Returns null when neither applies (caller renders a gradient). This is the
 * image one rung below the flyer in the fallback chain:
 *   flyer → venue photo → category tile → gradient
 */
export function resolveFallbackImage(opts: {
  venueName: string | null | undefined;
  sourceSlug: string | undefined;
  category: EventCategory | null;
}): string | null {
  const venuePhoto = proxiedImage(resolveVenuePhoto(opts.venueName, opts.sourceSlug));
  if (venuePhoto) return venuePhoto;
  return opts.category ? (CATEGORY_IMAGES[opts.category] ?? null) : null;
}
