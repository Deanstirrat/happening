import pThrottle from "p-throttle";
import type { ScrapedEvent } from "./types";
import { detectNeighborhood } from "./neighborhoods";
import { resolveVenue } from "./venues";
import { isPlaceholderCoord } from "./geo";

interface GeoResult {
  latitude: number | null;
  longitude: number | null;
  neighborhood: string | null;
}

const CONTACT_EMAIL = process.env.GEOCODE_CONTACT_EMAIL ?? "hello@happening.app";
const USER_AGENT = `happening-sf/1.0 (${CONTACT_EMAIL})`;

// Nominatim ToS: max 1 request/second
const throttledFetch = pThrottle({ limit: 1, interval: 1100 })(
  async (url: string) => {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
    });
    return res.json();
  }
);

export async function geocodeEvent(
  event: ScrapedEvent,
  sourceSlug?: string
): Promise<GeoResult> {
  // If scraper already provided coordinates (Eventbrite, Meetup, RA), use them —
  // unless they're a known placeholder (e.g. RA's rounded 38,-122 fallback), in
  // which case fall through to geocode from the venue name/address instead.
  if (
    event.latitude != null &&
    event.longitude != null &&
    !isPlaceholderCoord(Number(event.latitude), Number(event.longitude))
  ) {
    const latitude = Number(event.latitude);
    const longitude = Number(event.longitude);
    return {
      latitude,
      longitude,
      neighborhood: detectNeighborhood(latitude, longitude),
    };
  }

  // Known venue? Resolve deterministically before hitting the geocode API.
  // Covers SFPL branches and other recurring venues that don't geocode by name.
  const known = resolveVenue(event.venueName, sourceSlug);
  if (known) {
    return {
      latitude: known.latitude,
      longitude: known.longitude,
      neighborhood: detectNeighborhood(known.latitude, known.longitude),
    };
  }

  // Build query candidates, tried in order until one resolves.
  //
  // When venueAddress already contains a street number it's a complete address.
  // Geocode it ALONE: prepending the business name (rarely in OSM) and appending
  // a redundant "San Francisco, CA" after an address that already ends in
  // "…CA 94104, USA" makes Nominatim return nothing. The name + city form is kept
  // only as a fallback when the clean address doesn't resolve.
  const address = event.venueAddress?.trim() || null;
  const hasStreetNumber = address != null && /^\s*\d+\s+\S/.test(address);

  const nameAndCity = [event.venueName, "San Francisco, CA"]
    .filter(Boolean)
    .join(", ");
  const candidates = hasStreetNumber
    ? [address!, nameAndCity]
    : [
        [event.venueName, event.venueAddress, "San Francisco, CA"]
          .filter(Boolean)
          .join(", "),
      ];

  // Dedupe and drop empties (e.g. no venueName → nameAndCity is just the city).
  const queries = [...new Set(candidates)].filter(
    (q) => q && q !== "San Francisco, CA"
  );
  if (queries.length === 0) {
    return { latitude: null, longitude: null, neighborhood: null };
  }

  for (const query of queries) {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=jsonv2&countrycodes=us&limit=1`;

    try {
      const results = await throttledFetch(url);
      if (!results?.length) continue;

      const { lat, lon } = results[0];
      const latitude = parseFloat(lat);
      const longitude = parseFloat(lon);

      return {
        latitude,
        longitude,
        neighborhood: detectNeighborhood(latitude, longitude),
      };
    } catch {
      // Try the next candidate.
    }
  }

  return { latitude: null, longitude: null, neighborhood: null };
}
