/**
 * Static venue → coordinates lookup.
 *
 * Many sources reuse the same fixed set of venues (SF Public Library branches,
 * recurring bookstores/theaters). Their names alone don't geocode reliably
 * through Nominatim (e.g. "Marina Branch, San Francisco, CA" resolves to the
 * neighborhood, not the building), so they were left ungeocoded. This table
 * resolves them deterministically at ingest time — no API cost or flakiness —
 * before the geocode API is consulted as a fallback.
 *
 * Coordinates were obtained by geocoding each venue's real street address once
 * (the `address` field below) via Nominatim and are baked in here. Neighborhood
 * is NOT stored — it is derived from the coordinates via detectNeighborhood(),
 * so it stays consistent with every other event in the system. To add a venue,
 * geocode its street address once and paste the resulting lat/lng.
 */

export interface KnownVenue {
  latitude: number;
  longitude: number;
  /** Canonical full address, used to backfill venueAddress when missing. */
  address: string;
}

/**
 * SF Public Library branches, keyed by the branch label the sfpl scraper stores
 * in venueName (the text of the /locations/ link). The fixed set of physical
 * branches; "Bookmobiles / MOS" is intentionally omitted (mobile, no fixed point).
 */
export const SFPL_BRANCHES: Record<string, KnownVenue> = {
  Main: { latitude: 37.77919, longitude: -122.41578, address: "100 Larkin St, San Francisco, CA 94102" },
  Anza: { latitude: 37.77852, longitude: -122.49718, address: "550 37th Ave, San Francisco, CA 94121" },
  Bayview: { latitude: 37.73255, longitude: -122.39114, address: "5075 3rd St, San Francisco, CA 94124" },
  "Bernal Heights": { latitude: 37.73885, longitude: -122.41615, address: "500 Cortland Ave, San Francisco, CA 94110" },
  Chinatown: { latitude: 37.79522, longitude: -122.41022, address: "1135 Powell St, San Francisco, CA 94108" },
  "Eureka Valley": { latitude: 37.76406, longitude: -122.43191, address: "1 Jose Sarria Ct, San Francisco, CA 94114" },
  Excelsior: { latitude: 37.72713, longitude: -122.43331, address: "4400 Mission St, San Francisco, CA 94112" },
  "Glen Park": { latitude: 37.73403, longitude: -122.43356, address: "2825 Diamond St, San Francisco, CA 94131" },
  "Golden Gate Valley": { latitude: 37.79679, longitude: -122.42901, address: "1801 Green St, San Francisco, CA 94123" },
  Ingleside: { latitude: 37.72419, longitude: -122.4563, address: "1298 Ocean Ave, San Francisco, CA 94112" },
  Marina: { latitude: 37.8014, longitude: -122.43419, address: "1890 Chestnut St, San Francisco, CA 94123" },
  Merced: { latitude: 37.72662, longitude: -122.47449, address: "155 Winston Dr, San Francisco, CA 94132" },
  Mission: { latitude: 37.75197, longitude: -122.41984, address: "300 Bartlett St, San Francisco, CA 94110" },
  "Mission Bay": { latitude: 37.77539, longitude: -122.3932, address: "960 4th St, San Francisco, CA 94158" },
  "Noe Valley": { latitude: 37.75024, longitude: -122.43512, address: "451 Jersey St, San Francisco, CA 94114" },
  "North Beach": { latitude: 37.80255, longitude: -122.41314, address: "850 Columbus Ave, San Francisco, CA 94133" },
  "Ocean View": { latitude: 37.71414, longitude: -122.466, address: "345 Randolph St, San Francisco, CA 94132" },
  Ortega: { latitude: 37.75114, longitude: -122.49811, address: "3223 Ortega St, San Francisco, CA 94122" },
  Park: { latitude: 37.77017, longitude: -122.45102, address: "1833 Page St, San Francisco, CA 94117" },
  Parkside: { latitude: 37.74316, longitude: -122.47931, address: "1200 Taraval St, San Francisco, CA 94116" },
  Portola: { latitude: 37.72711, longitude: -122.40637, address: "380 Bacon St, San Francisco, CA 94134" },
  Potrero: { latitude: 37.76008, longitude: -122.39766, address: "1616 20th St, San Francisco, CA 94107" },
  Presidio: { latitude: 37.78886, longitude: -122.44485, address: "3150 Sacramento St, San Francisco, CA 94115" },
  Richmond: { latitude: 37.78186, longitude: -122.46812, address: "351 9th Ave, San Francisco, CA 94118" },
  Sunset: { latitude: 37.76334, longitude: -122.47632, address: "1305 18th Ave, San Francisco, CA 94122" },
  "Visitacion Valley": { latitude: 37.71248, longitude: -122.4079, address: "201 Leland Ave, San Francisco, CA 94134" },
  "West Portal": { latitude: 37.7414, longitude: -122.46615, address: "190 Lenox Way, San Francisco, CA 94127" },
  "Western Addition": { latitude: 37.78411, longitude: -122.43757, address: "1550 Scott St, San Francisco, CA 94115" },
};

/**
 * Other recurring SF venues, keyed by a normalized venueName (see normalize()).
 * These appear across multiple sources with stable names but were failing to
 * geocode. Aliases for the same venue point at the same coordinates.
 */
export const KNOWN_VENUES: Record<string, KnownVenue> = {
  "green apple books on the park": { latitude: 37.76535, longitude: -122.46672, address: "1231 9th Ave, San Francisco, CA 94122" },
  "books on the park on 9th avenue": { latitude: 37.76535, longitude: -122.46672, address: "1231 9th Ave, San Francisco, CA 94122" },
  exploratorium: { latitude: 37.80162, longitude: -122.39737, address: "Pier 15, Embarcadero, San Francisco, CA 94111" },
  "city lights booksellers & publishers": { latitude: 37.79765, longitude: -122.40662, address: "261 Columbus Ave, San Francisco, CA 94133" },
  "sf spca": { latitude: 37.76723, longitude: -122.41243, address: "201 Alabama St, San Francisco, CA 94103" },
  "sydney goldstein theater": { latitude: 37.77689, longitude: -122.42096, address: "275 Hayes St, San Francisco, CA 94102" },
  audium: { latitude: 37.78843, longitude: -122.42404, address: "1616 Bush St, San Francisco, CA 94109" },
  "roxie theater": { latitude: 37.76481, longitude: -122.42231, address: "3117 16th St, San Francisco, CA 94103" },
  "the castro theatre": { latitude: 37.76199, longitude: -122.43475, address: "429 Castro St, San Francisco, CA 94114" },
  "castro theater": { latitude: 37.76199, longitude: -122.43475, address: "429 Castro St, San Francisco, CA 94114" },
};

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Resolve a venue name to fixed coordinates, or null if not a known venue.
 * SFPL branch labels are matched only for the sfpl source (the labels are
 * generic words like "Main"/"Park" that would collide with other sources).
 */
export function resolveVenue(
  venueName: string | null | undefined,
  sourceSlug?: string
): KnownVenue | null {
  if (!venueName) return null;
  if (sourceSlug === "sfpl") {
    const branch = SFPL_BRANCHES[venueName.trim()];
    if (branch) return branch;
  }
  return KNOWN_VENUES[normalize(venueName)] ?? null;
}
