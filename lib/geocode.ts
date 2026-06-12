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
  // When venueAddress already contains a street number it's a complete address —
  // geocode it ALONE, unbounded: prepending the business name (rarely in OSM) or
  // appending a redundant city after an address that already ends in
  // "…CA 94104, USA" makes Nominatim return nothing.
  //
  // Otherwise fall back to the venue name biased to the Bay Area via a bounded
  // viewbox. We must NOT force "San Francisco, CA" onto the name: most scraped
  // venues here are East-Bay/regional and many already carry their own city
  // ("Fox Theater, Oakland", "Ivy Room, Albany"), so a hard SF suffix produced a
  // self-contradictory query ("Fox Theater, Oakland, San Francisco, CA") that
  // resolved to nothing. Appending only the *state* keeps an embedded city
  // intact, and the viewbox stops a bare name ("Yoshi's", "Fox Theater") from
  // matching Phoenix or LA. The service-area filter (lib/geo.ts, 30 km) makes the
  // final keep/drop decision after a coordinate lands.
  const address = event.venueAddress?.trim() || null;
  const hasStreetNumber = address != null && /^\s*\d+\s+\S/.test(address);

  // Bay Area bounding box (lon_min, lat_max, lon_max, lat_min). Covers SF + the
  // whole near Bay with margin; generous on purpose — its only job is to reject
  // far-away same-name matches, not to define the service area.
  const BAY_AREA_VIEWBOX = "-122.75,38.25,-121.65,37.05";

  interface Candidate {
    q: string;
    bounded: boolean;
  }
  const rawCandidates: Candidate[] = hasStreetNumber
    ? [
        { q: address!, bounded: false },
        { q: [event.venueName, "CA"].filter(Boolean).join(", "), bounded: true },
      ]
    : [
        {
          q: [event.venueName, address, "CA"].filter(Boolean).join(", "),
          bounded: true,
        },
        { q: [event.venueName, "CA"].filter(Boolean).join(", "), bounded: true },
      ];

  // Dedupe; drop empties and no-op queries that carry no venue signal.
  const seen = new Set<string>();
  const queries = rawCandidates.filter((c) => {
    const q = c.q.trim();
    if (!q || q === "CA" || seen.has(q)) return false;
    seen.add(q);
    return true;
  });
  if (queries.length === 0) {
    return { latitude: null, longitude: null, neighborhood: null };
  }

  for (const { q, bounded } of queries) {
    const params = new URLSearchParams({
      q,
      format: "jsonv2",
      countrycodes: "us",
      limit: "1",
    });
    if (bounded) {
      params.set("viewbox", BAY_AREA_VIEWBOX);
      params.set("bounded", "1");
    }
    const url = `https://nominatim.openstreetmap.org/search?${params.toString()}`;

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
