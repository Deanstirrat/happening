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
  /**
   * Canonical display name for the physical venue, used to seed the Venue table
   * and resolve Event.venueId (see resolveVenueIdentity). Multiple alias keys may
   * point at the same physical venue; they share one `name` so they collapse to a
   * single Venue row. Omitted for SFPL branches, whose name is derived from the
   * branch label (see sfplBranchName).
   */
  name?: string;
  /**
   * Optional venue photo, shown as the card/flyer image for events at this venue
   * that have no flyer of their own (see resolveVenuePhoto). Lifts the perceived
   * quality of the imageless ~37% over a generic category tile.
   *
   * These are stable Wikimedia Commons URLs (Special:FilePath redirects to the
   * current file, width-capped to keep payloads small) and were each verified to
   * return an image once before being baked in. Not every venue has one; those
   * without simply keep falling back to the category tile. They are served via
   * /api/image-proxy like every other external image.
   */
  photoUrl?: string;
}

/**
 * SF Public Library branches, keyed by the branch label the sfpl scraper stores
 * in venueName (the text of the /locations/ link). The fixed set of physical
 * branches; "Bookmobiles / MOS" is intentionally omitted (mobile, no fixed point).
 */
export const SFPL_BRANCHES: Record<string, KnownVenue> = {
  Main: { latitude: 37.77919, longitude: -122.41578, address: "100 Larkin St, San Francisco, CA 94102", photoUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/SFPL_Main_Library_Full_Exterior.jpg?width=1200" },
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
  "green apple books on the park": { name: "Green Apple Books on the Park", latitude: 37.76535, longitude: -122.46672, address: "1231 9th Ave, San Francisco, CA 94122", photoUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Greenapplebooks.jpg?width=1200" },
  "books on the park on 9th avenue": { name: "Green Apple Books on the Park", latitude: 37.76535, longitude: -122.46672, address: "1231 9th Ave, San Francisco, CA 94122", photoUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Greenapplebooks.jpg?width=1200" },
  exploratorium: { name: "Exploratorium", latitude: 37.80162, longitude: -122.39737, address: "Pier 15, Embarcadero, San Francisco, CA 94111", photoUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Main_Entrance_to_the_Exploratorium_at_Pier_15.jpg?width=1200" },
  "city lights booksellers & publishers": { name: "City Lights Booksellers & Publishers", latitude: 37.79765, longitude: -122.40662, address: "261 Columbus Ave, San Francisco, CA 94133", photoUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/City_Lights_Booksellers.jpg?width=1200" },
  "sf spca": { name: "San Francisco SPCA", latitude: 37.76723, longitude: -122.41243, address: "201 Alabama St, San Francisco, CA 94103" },
  "sydney goldstein theater": { name: "Sydney Goldstein Theater", latitude: 37.77689, longitude: -122.42096, address: "275 Hayes St, San Francisco, CA 94102", photoUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Nourse_Theater.jpeg?width=1200" },
  audium: { name: "Audium", latitude: 37.78843, longitude: -122.42404, address: "1616 Bush St, San Francisco, CA 94109", photoUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Audium_door_sign.jpg?width=1200" },
  "roxie theater": { name: "Roxie Theater", latitude: 37.76481, longitude: -122.42231, address: "3117 16th St, San Francisco, CA 94103", photoUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/RoxieSF.jpg?width=1200" },
  "the castro theatre": { name: "The Castro Theatre", latitude: 37.76199, longitude: -122.43475, address: "429 Castro St, San Francisco, CA 94114", photoUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Castro%2C_San_Francisco%2C_CA.jpg?width=1200" },
  "castro theater": { name: "The Castro Theatre", latitude: 37.76199, longitude: -122.43475, address: "429 Castro St, San Francisco, CA 94114", photoUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Castro%2C_San_Francisco%2C_CA.jpg?width=1200" },
  // F8 nightclub — some sources mis-parse "1192 Folsom St" as the city Folsom, CA (148 km away).
  f8sf: { name: "F8", latitude: 37.77313, longitude: -122.4099, address: "1192 Folsom St, San Francisco, CA 94103" },
  f8: { name: "F8", latitude: 37.77313, longitude: -122.4099, address: "1192 Folsom St, San Francisco, CA 94103" },
  // ── Recurring SF music venues (#158) — arrive name-only from bandsintown,
  //    instagram, foopee and don't geocode by name through Nominatim. ──────
  "brick & mortar music hall": { name: "Brick & Mortar Music Hall", latitude: 37.76974, longitude: -122.41985, address: "1710 Mission St, San Francisco, CA 94103" },
  "brick & mortar": { name: "Brick & Mortar Music Hall", latitude: 37.76974, longitude: -122.41985, address: "1710 Mission St, San Francisco, CA 94103" },
  "brick and mortar music hall": { name: "Brick & Mortar Music Hall", latitude: 37.76974, longitude: -122.41985, address: "1710 Mission St, San Francisco, CA 94103" },
  "brick and mortar": { name: "Brick & Mortar Music Hall", latitude: 37.76974, longitude: -122.41985, address: "1710 Mission St, San Francisco, CA 94103" },
  "the warfield": { name: "The Warfield", latitude: 37.78262, longitude: -122.41034, address: "982 Market St, San Francisco, CA 94102" },
  warfield: { name: "The Warfield", latitude: 37.78262, longitude: -122.41034, address: "982 Market St, San Francisco, CA 94102" },
  "the warfield theatre": { name: "The Warfield", latitude: 37.78262, longitude: -122.41034, address: "982 Market St, San Francisco, CA 94102" },
  "warfield theatre": { name: "The Warfield", latitude: 37.78262, longitude: -122.41034, address: "982 Market St, San Francisco, CA 94102" },
  "the great american music hall": { name: "Great American Music Hall", latitude: 37.78477, longitude: -122.41884, address: "859 O'Farrell St, San Francisco, CA 94109" },
  "great american music hall": { name: "Great American Music Hall", latitude: 37.78477, longitude: -122.41884, address: "859 O'Farrell St, San Francisco, CA 94109" },
  gamh: { name: "Great American Music Hall", latitude: 37.78477, longitude: -122.41884, address: "859 O'Farrell St, San Francisco, CA 94109" },
  "bottom of the hill": { name: "Bottom of the Hill", latitude: 37.76496, longitude: -122.39641, address: "1233 17th St, San Francisco, CA 94107" },
  "cafe du nord": { name: "Cafe Du Nord", latitude: 37.76652, longitude: -122.43047, address: "2174 Market St, San Francisco, CA 94114" },
  "café du nord": { name: "Cafe Du Nord", latitude: 37.76652, longitude: -122.43047, address: "2174 Market St, San Francisco, CA 94114" },
  // Swedish American Hall sits above Cafe Du Nord in the same building (2174 Market).
  "swedish american hall": { name: "Swedish American Hall", latitude: 37.76652, longitude: -122.43047, address: "2174 Market St, San Francisco, CA 94114" },
  "swedish american music hall": { name: "Swedish American Hall", latitude: 37.76652, longitude: -122.43047, address: "2174 Market St, San Francisco, CA 94114" },
  "the independent": { name: "The Independent", latitude: 37.77553, longitude: -122.43764, address: "628 Divisadero St, San Francisco, CA 94117" },
  independent: { name: "The Independent", latitude: 37.77553, longitude: -122.43764, address: "628 Divisadero St, San Francisco, CA 94117" },
  // foopee misspells it "Indpendent" and appends ", S.F." (also corrected in foopee.ts).
  indpendent: { name: "The Independent", latitude: 37.77553, longitude: -122.43764, address: "628 Divisadero St, San Francisco, CA 94117" },
  "indpendent, s.f.": { name: "The Independent", latitude: 37.77553, longitude: -122.43764, address: "628 Divisadero St, San Francisco, CA 94117" },
  "yerba buena center for the arts": { name: "Yerba Buena Center for the Arts", latitude: 37.78589, longitude: -122.40233, address: "701 Mission St, San Francisco, CA 94103" },
  ybca: { name: "Yerba Buena Center for the Arts", latitude: 37.78589, longitude: -122.40233, address: "701 Mission St, San Francisco, CA 94103" },
  // DNA Lounge — the dedicated dnalounge scraper hardcodes these coords, but the
  // instagram variants ("DNA Lounge", "Above DNA Lounge", the bare address) miss
  // the scraper and need the table to resolve.
  "dna lounge": { name: "DNA Lounge", latitude: 37.77101, longitude: -122.41269, address: "375 Eleventh Street, San Francisco, CA 94103" },
  "above dna lounge": { name: "DNA Lounge", latitude: 37.77101, longitude: -122.41269, address: "375 Eleventh Street, San Francisco, CA 94103" },
  "375 eleventh street, san francisco, ca": { name: "DNA Lounge", latitude: 37.77101, longitude: -122.41269, address: "375 Eleventh Street, San Francisco, CA 94103" },
};

/**
 * True when a venue string is a non-venue placeholder — a source's stand-in for
 * an unannounced or non-physical location rather than a real place. 19hz uses
 * "TBA (San Francisco)" for events whose venue isn't announced yet; funcheap
 * emits bare city strings like "SF (7p + 9p)". These have no resolvable location
 * and are held PENDING at ingest rather than published locationless (#158, see
 * lib/scrapers/runner.ts). SFPL's mobile "Bookmobiles / MOS" is handled
 * separately — the sfpl scraper skips it outright.
 */
export function isPlaceholderVenue(venueName: string | null | undefined): boolean {
  if (!venueName) return false;
  // Drop a trailing parenthetical annotation and trailing punctuation:
  // "TBA (San Francisco)" → "tba", "SF (7p + 9p)" → "sf".
  const base = venueName
    .trim()
    .toLowerCase()
    .replace(/\s*\([^)]*\)\s*$/, "")
    .replace(/[.,\s]+$/, "")
    .trim();
  if (!base) return true;
  // "TBA"/"TBD", alone or as a prefix ("TBA - venue to be announced").
  if (/^tba\b|^tbd\b/.test(base)) return true;
  // A bare city name with no venue attached ("SF", "San Francisco, CA").
  if (/^(sf|san francisco)(,?\s*(ca|california))?$/.test(base)) return true;
  return false;
}

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

/**
 * Resolve a venue name to its photo URL, or null if the venue is unknown or has
 * no photo. Used as the image fallback for events lacking their own flyer,
 * sitting between the event flyer and the generic category tile.
 */
export function resolveVenuePhoto(
  venueName: string | null | undefined,
  sourceSlug?: string
): string | null {
  return resolveVenue(venueName, sourceSlug)?.photoUrl ?? null;
}

/**
 * Stable, normalized identity for a known venue — the bridge between the static
 * table above and the Venue table in the database. `slug` is the natural key:
 * it is deterministic from `name`, so reseeding never creates duplicate rows and
 * every alias of the same physical venue resolves to the same Venue.
 */
export interface VenueIdentity {
  /** Deterministic natural key, unique per physical venue. */
  slug: string;
  /** Canonical display name. */
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  photoUrl?: string;
}

/** Deterministic slug for a venue name, used as the Venue natural key. */
export function slugifyVenue(name: string): string {
  return name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Canonical display name for an SFPL branch, derived from its branch label. */
function sfplBranchName(label: string): string {
  return label === "Main" ? "SFPL Main Library" : `SFPL ${label} Branch`;
}

function toIdentity(name: string, v: KnownVenue): VenueIdentity {
  return {
    slug: slugifyVenue(name),
    name,
    address: v.address,
    latitude: v.latitude,
    longitude: v.longitude,
    ...(v.photoUrl ? { photoUrl: v.photoUrl } : {}),
  };
}

/**
 * Resolve a venue name to its normalized Venue identity, or null if not a known
 * venue. Same matching rules as resolveVenue (SFPL branches only for the sfpl
 * source); used at ingest to set Event.venueId and by the backfill.
 */
export function resolveVenueIdentity(
  venueName: string | null | undefined,
  sourceSlug?: string
): VenueIdentity | null {
  if (!venueName) return null;
  if (sourceSlug === "sfpl") {
    const label = venueName.trim();
    const branch = SFPL_BRANCHES[label];
    if (branch) return toIdentity(sfplBranchName(label), branch);
  }
  const known = KNOWN_VENUES[normalize(venueName)];
  if (known?.name) return toIdentity(known.name, known);
  return null;
}

/**
 * Every known venue as a deduped list of identities, for seeding the Venue
 * table. Aliases that share a physical venue collapse to one entry by slug.
 */
export function allKnownVenues(): VenueIdentity[] {
  const bySlug = new Map<string, VenueIdentity>();
  for (const [label, v] of Object.entries(SFPL_BRANCHES)) {
    const identity = toIdentity(sfplBranchName(label), v);
    if (!bySlug.has(identity.slug)) bySlug.set(identity.slug, identity);
  }
  for (const v of Object.values(KNOWN_VENUES)) {
    if (!v.name) continue;
    const identity = toIdentity(v.name, v);
    if (!bySlug.has(identity.slug)) bySlug.set(identity.slug, identity);
  }
  return [...bySlug.values()];
}
