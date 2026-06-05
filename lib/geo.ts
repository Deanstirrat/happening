/**
 * Service area — how far from San Francisco we're willing to list events.
 *
 * happening is an SF app. We also keep events in cities that are a short
 * (~20–30 minute) drive away — Oakland, Berkeley, Daly City, San Mateo,
 * Richmond, Alameda, Emeryville, Sausalito, etc. — but not the wider Bay
 * Area (San Jose, Santa Cruz, Concord, Walnut Creek, Fairfield, …) or beyond.
 *
 * The cutoff is a straight-line radius from SF's center. On the current data
 * the genuinely-nearby cities all fall under ~25 km while the far ones start at
 * ~38 km (the 30–38 km band is empty), so 30 km cleanly separates the two with
 * margin to spare. Tune SERVICE_RADIUS_KM if the boundary needs to move.
 */

export const SF_CENTER = { latitude: 37.7749, longitude: -122.4194 };
export const SERVICE_RADIUS_KM = 30;

/**
 * Junk/placeholder coordinates emitted by some sources instead of a real
 * location. Resident Advisor hands back a rounded `38.0, -122.0` (out in the
 * bay, ~45 km away) for SF events whose venue it failed to geo-resolve, and
 * `0, 0` is null-island. These are NOT real far-away points — treat them as
 * "location unknown" so the event still geocodes from its street address
 * rather than being filtered out as out-of-area.
 */
const PLACEHOLDER_COORDS = new Set(["38.0000,-122.0000", "0.0000,0.0000"]);

export function isPlaceholderCoord(latitude: number, longitude: number): boolean {
  return PLACEHOLDER_COORDS.has(`${latitude.toFixed(4)},${longitude.toFixed(4)}`);
}

export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371; // Earth radius, km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function distanceFromSfKm(latitude: number, longitude: number): number {
  return haversineKm(SF_CENTER.latitude, SF_CENTER.longitude, latitude, longitude);
}

/**
 * Heuristic: does this address clearly belong to San Francisco? Used as a safety
 * net so a misgeocoded coordinate (e.g. a scraper parsing "1192 Folsom St" into
 * the city "Folsom", 148 km away) doesn't get the event wrongly archived when
 * its address is plainly SF. Matches the literal city name or an SF ZIP (941xx).
 */
export function addressLooksSf(address: string | null | undefined): boolean {
  if (!address) return false;
  return /san francisco/i.test(address) || /\b941\d\d\b/.test(address);
}

/**
 * True only when we can confidently say a point is outside the service area.
 * Missing or placeholder coordinates return false — we can't tell, so we don't
 * filter on that basis (the event is kept and located by other means).
 */
export function isTooFarFromSf(
  latitude: number | null | undefined,
  longitude: number | null | undefined
): boolean {
  if (latitude == null || longitude == null) return false;
  if (isPlaceholderCoord(latitude, longitude)) return false;
  return distanceFromSfKm(latitude, longitude) > SERVICE_RADIUS_KM;
}
