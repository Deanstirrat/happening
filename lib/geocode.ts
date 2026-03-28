import pThrottle from "p-throttle";
import type { ScrapedEvent } from "./types";
import { detectNeighborhood } from "./neighborhoods";

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

export async function geocodeEvent(event: ScrapedEvent): Promise<GeoResult> {
  // If scraper already provided coordinates (Eventbrite, Meetup, RA), use them
  if (event.latitude != null && event.longitude != null) {
    const latitude = Number(event.latitude);
    const longitude = Number(event.longitude);
    return {
      latitude,
      longitude,
      neighborhood: detectNeighborhood(latitude, longitude),
    };
  }

  // Build query
  const parts = [event.venueName, event.venueAddress, "San Francisco, CA"].filter(
    Boolean
  );
  if (parts.length === 0) return { latitude: null, longitude: null, neighborhood: null };

  const query = parts.join(", ");
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=jsonv2&countrycodes=us&limit=1`;

  try {
    const results = await throttledFetch(url);
    if (!results?.length) return { latitude: null, longitude: null, neighborhood: null };

    const { lat, lon } = results[0];
    const latitude = parseFloat(lat);
    const longitude = parseFloat(lon);

    return {
      latitude,
      longitude,
      neighborhood: detectNeighborhood(latitude, longitude),
    };
  } catch {
    return { latitude: null, longitude: null, neighborhood: null };
  }
}
