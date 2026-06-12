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
  "indpendent, s.f": { name: "The Independent", latitude: 37.77553, longitude: -122.43764, address: "628 Divisadero St, San Francisco, CA 94117" },
  "yerba buena center for the arts": { name: "Yerba Buena Center for the Arts", latitude: 37.78589, longitude: -122.40233, address: "701 Mission St, San Francisco, CA 94103" },
  ybca: { name: "Yerba Buena Center for the Arts", latitude: 37.78589, longitude: -122.40233, address: "701 Mission St, San Francisco, CA 94103" },
  // DNA Lounge — the dedicated dnalounge scraper hardcodes these coords, but the
  // instagram variants ("DNA Lounge", "Above DNA Lounge", the bare address) miss
  // the scraper and need the table to resolve.
  "dna lounge": { name: "DNA Lounge", latitude: 37.77101, longitude: -122.41269, address: "375 Eleventh Street, San Francisco, CA 94103" },
  "above dna lounge": { name: "DNA Lounge", latitude: 37.77101, longitude: -122.41269, address: "375 Eleventh Street, San Francisco, CA 94103" },
  "375 eleventh street, san francisco, ca": { name: "DNA Lounge", latitude: 37.77101, longitude: -122.41269, address: "375 Eleventh Street, San Francisco, CA 94103" },
  // ── Ungeocoded triage batch (#177 follow-up) — recurring in-area venues that
  //    arrive name-only (or with a city suffix Nominatim can't place) from
  //    foopee, bandsintown, 19hz, funcheap, instagram, cityboxoffice. Coords were
  //    geocoded once from each street address via Nominatim. Aliases capture the
  //    exact spellings seen in the feed, including foopee's ", S.F." suffix and
  //    common typos. ───────────────────────────────────────────────────────────
  // Foopee tacks ", S.F." onto venue names; add suffixed aliases for venues
  // already in the table above so those events resolve too.
  "castro theater, s.f": { name: "The Castro Theatre", latitude: 37.76199, longitude: -122.43475, address: "429 Castro St, San Francisco, CA 94114", photoUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Castro%2C_San_Francisco%2C_CA.jpg?width=1200" },
  "the castro theatre, s.f": { name: "The Castro Theatre", latitude: 37.76199, longitude: -122.43475, address: "429 Castro St, San Francisco, CA 94114", photoUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Castro%2C_San_Francisco%2C_CA.jpg?width=1200" },
  "swedish american hall, s.f": { name: "Swedish American Hall", latitude: 37.76652, longitude: -122.43047, address: "2174 Market St, San Francisco, CA 94114" },
  // UC Berkeley's Hearst Greek Theatre — the single biggest ungeocoded group.
  "greek theater, uc berkeley campus": { name: "Hearst Greek Theatre", latitude: 37.87296, longitude: -122.25449, address: "2001 Gayley Rd, Berkeley, CA 94720" },
  "the greek theatre at uc berkeley": { name: "Hearst Greek Theatre", latitude: 37.87296, longitude: -122.25449, address: "2001 Gayley Rd, Berkeley, CA 94720" },
  "hearst greek theatre": { name: "Hearst Greek Theatre", latitude: 37.87296, longitude: -122.25449, address: "2001 Gayley Rd, Berkeley, CA 94720" },
  // Sigmund Stern Grove (free summer festival meadow).
  "stern grove festival, s.f": { name: "Sigmund Stern Grove", latitude: 37.73592, longitude: -122.47503, address: "2750 19th Ave, San Francisco, CA 94116" },
  "stern grove concert meadow": { name: "Sigmund Stern Grove", latitude: 37.73592, longitude: -122.47503, address: "2750 19th Ave, San Francisco, CA 94116" },
  "stern grove festival": { name: "Sigmund Stern Grove", latitude: 37.73592, longitude: -122.47503, address: "2750 19th Ave, San Francisco, CA 94116" },
  "stern grove": { name: "Sigmund Stern Grove", latitude: 37.73592, longitude: -122.47503, address: "2750 19th Ave, San Francisco, CA 94116" },
  // Chase Center — foopee/bandsintown call it "Warriors Stadium" with many typos.
  "warriors stadium, s.f": { name: "Chase Center", latitude: 37.7679, longitude: -122.38742, address: "1 Warriors Way, San Francisco, CA 94158" },
  "warriros stadium, s.f": { name: "Chase Center", latitude: 37.7679, longitude: -122.38742, address: "1 Warriors Way, San Francisco, CA 94158" },
  "warrior's stadium, s.f": { name: "Chase Center", latitude: 37.7679, longitude: -122.38742, address: "1 Warriors Way, San Francisco, CA 94158" },
  "warriors stadiom, s.f": { name: "Chase Center", latitude: 37.7679, longitude: -122.38742, address: "1 Warriors Way, San Francisco, CA 94158" },
  "warriors stadium": { name: "Chase Center", latitude: 37.7679, longitude: -122.38742, address: "1 Warriors Way, San Francisco, CA 94158" },
  "chase center": { name: "Chase Center", latitude: 37.7679, longitude: -122.38742, address: "1 Warriors Way, San Francisco, CA 94158" },
  // The Back Room — Berkeley listening room (bandsintown "The Back Room Music").
  "the back room music": { name: "The Back Room", latitude: 37.87208, longitude: -122.27205, address: "1984 Bonita Ave, Berkeley, CA 94704" },
  "the back room": { name: "The Back Room", latitude: 37.87208, longitude: -122.27205, address: "1984 Bonita Ave, Berkeley, CA 94704" },
  // Freight & Salvage — bandsintown/folkyeah shorten it to "The Freight".
  "the freight": { name: "Freight & Salvage", latitude: 37.87076, longitude: -122.26953, address: "2020 Addison St, Berkeley, CA 94704" },
  "freight & salvage": { name: "Freight & Salvage", latitude: 37.87076, longitude: -122.26953, address: "2020 Addison St, Berkeley, CA 94704" },
  "freight and salvage": { name: "Freight & Salvage", latitude: 37.87076, longitude: -122.26953, address: "2020 Addison St, Berkeley, CA 94704" },
  // Thee Stork Club — Oakland (foopee mislabels it ", S.F."). Matches the
  // storkclub scraper's canonical "Thee Stork Club" so they share one Venue row.
  "thee stork club, s.f": { name: "Thee Stork Club", latitude: 37.81314, longitude: -122.26838, address: "2330 Telegraph Ave, Oakland, CA 94612" },
  "thee stork club": { name: "Thee Stork Club", latitude: 37.81314, longitude: -122.26838, address: "2330 Telegraph Ave, Oakland, CA 94612" },
  "stork club": { name: "Thee Stork Club", latitude: 37.81314, longitude: -122.26838, address: "2330 Telegraph Ave, Oakland, CA 94612" },
  // Rickshaw Stop (foopee "Ricksaw Stop, S.F." typo).
  "rickshaw stop": { name: "Rickshaw Stop", latitude: 37.77599, longitude: -122.42048, address: "155 Fell St, San Francisco, CA 94102" },
  "ricksaw stop, s.f": { name: "Rickshaw Stop", latitude: 37.77599, longitude: -122.42048, address: "155 Fell St, San Francisco, CA 94102" },
  "ricksaw stop": { name: "Rickshaw Stop", latitude: 37.77599, longitude: -122.42048, address: "155 Fell St, San Francisco, CA 94102" },
  // Mr. Tipple's Jazz Club.
  "mr. tipple's jazz club": { name: "Mr. Tipple's Jazz Club", latitude: 37.77637, longitude: -122.41857, address: "39 Fell St, San Francisco, CA 94102" },
  "mr tipple's jazz club": { name: "Mr. Tipple's Jazz Club", latitude: 37.77637, longitude: -122.41857, address: "39 Fell St, San Francisco, CA 94102" },
  "mr. tipples jazz club": { name: "Mr. Tipple's Jazz Club", latitude: 37.77637, longitude: -122.41857, address: "39 Fell St, San Francisco, CA 94102" },
  // The Midway (900 Marin St) — 19hz/instagram suffix it with room names.
  "the midway": { name: "The Midway", latitude: 37.74953, longitude: -122.38609, address: "900 Marin St, San Francisco, CA 94124" },
  "the midway - gods & monsters": { name: "The Midway", latitude: 37.74953, longitude: -122.38609, address: "900 Marin St, San Francisco, CA 94124" },
  "the midway terrace": { name: "The Midway", latitude: 37.74953, longitude: -122.38609, address: "900 Marin St, San Francisco, CA 94124" },
  "the midway patio": { name: "The Midway", latitude: 37.74953, longitude: -122.38609, address: "900 Marin St, San Francisco, CA 94124" },
  // Public Works (161 Erie St) — 19hz "Public Works Loft (San Francisco)".
  "public works": { name: "Public Works", latitude: 37.76889, longitude: -122.41927, address: "161 Erie St, San Francisco, CA 94103" },
  "public works loft": { name: "Public Works", latitude: 37.76889, longitude: -122.41927, address: "161 Erie St, San Francisco, CA 94103" },
  // SFJAZZ Center — matches the sfjazz scraper's canonical venueName.
  "sfjazz center": { name: "SFJAZZ Center", latitude: 37.77638, longitude: -122.42157, address: "201 Franklin St, San Francisco, CA 94102" },
  sfjazz: { name: "SFJAZZ Center", latitude: 37.77638, longitude: -122.42157, address: "201 Franklin St, San Francisco, CA 94102" },
  "miner auditorium, sfjazz center": { name: "SFJAZZ Center", latitude: 37.77638, longitude: -122.42157, address: "201 Franklin St, San Francisco, CA 94102" },
  "miner auditorium, sfjazz": { name: "SFJAZZ Center", latitude: 37.77638, longitude: -122.42157, address: "201 Franklin St, San Francisco, CA 94102" },
  // Cow Palace (Daly City; foopee "Daily City" typo, 19hz "(San Francisco)").
  "cow palace, daily city": { name: "Cow Palace", latitude: 37.70676, longitude: -122.41869, address: "2600 Geneva Ave, Daly City, CA 94014" },
  "cow palace, daly city": { name: "Cow Palace", latitude: 37.70676, longitude: -122.41869, address: "2600 Geneva Ave, Daly City, CA 94014" },
  "cow palace": { name: "Cow Palace", latitude: 37.70676, longitude: -122.41869, address: "2600 Geneva Ave, Daly City, CA 94014" },
  // Oracle Park — foopee "Giants Ballpark" with assorted spellings.
  "giants ballpark, s.f": { name: "Oracle Park", latitude: 37.77861, longitude: -122.38947, address: "24 Willie Mays Plaza, San Francisco, CA 94107" },
  "giant's ball park, s.f": { name: "Oracle Park", latitude: 37.77861, longitude: -122.38947, address: "24 Willie Mays Plaza, San Francisco, CA 94107" },
  "giants ball park, s.f": { name: "Oracle Park", latitude: 37.77861, longitude: -122.38947, address: "24 Willie Mays Plaza, San Francisco, CA 94107" },
  "oracle park": { name: "Oracle Park", latitude: 37.77861, longitude: -122.38947, address: "24 Willie Mays Plaza, San Francisco, CA 94107" },
  // Palace of Fine Arts (funcheap "SF's Palace of Fine Arts").
  "palace of fine arts": { name: "Palace of Fine Arts", latitude: 37.80149, longitude: -122.44787, address: "3601 Lyon St, San Francisco, CA 94123" },
  "sf's palace of fine arts": { name: "Palace of Fine Arts", latitude: 37.80149, longitude: -122.44787, address: "3601 Lyon St, San Francisco, CA 94123" },
  "the palace of fine arts": { name: "Palace of Fine Arts", latitude: 37.80149, longitude: -122.44787, address: "3601 Lyon St, San Francisco, CA 94123" },
  // Starline Social Club (Oakland).
  "starline social club": { name: "Starline Social Club", latitude: 37.81228, longitude: -122.27255, address: "2236 Martin Luther King Jr Way, Oakland, CA 94612" },
  // Mad Oak Bar N' Yard (Oakland).
  "mad oak bar n' yard": { name: "Mad Oak Bar N' Yard", latitude: 37.79986, longitude: -122.26464, address: "135 12th St, Oakland, CA 94607" },
  "mad oak bar n yard": { name: "Mad Oak Bar N' Yard", latitude: 37.79986, longitude: -122.26464, address: "135 12th St, Oakland, CA 94607" },
  "mad oak bar": { name: "Mad Oak Bar N' Yard", latitude: 37.79986, longitude: -122.26464, address: "135 12th St, Oakland, CA 94607" },
  // UC Botanical Garden at Berkeley.
  "university of california botanical garden": { name: "UC Botanical Garden", latitude: 37.88045, longitude: -122.24679, address: "200 Centennial Dr, Berkeley, CA 94720" },
  "uc botanical garden": { name: "UC Botanical Garden", latitude: 37.88045, longitude: -122.24679, address: "200 Centennial Dr, Berkeley, CA 94720" },
  // 142 Throckmorton Theatre (Mill Valley).
  "142 throckmorton theatre": { name: "142 Throckmorton Theatre", latitude: 37.90583, longitude: -122.54901, address: "142 Throckmorton Ave, Mill Valley, CA 94941" },
  "throckmorton theatre": { name: "142 Throckmorton Theatre", latitude: 37.90583, longitude: -122.54901, address: "142 Throckmorton Ave, Mill Valley, CA 94941" },
  // The Belrose (San Rafael).
  "the belrose": { name: "The Belrose", latitude: 37.97446, longitude: -122.53216, address: "1415 5th Ave, San Rafael, CA 94901" },
  // Down Home Music (El Cerrito).
  "down home music, el cerrito": { name: "Down Home Music", latitude: 37.90684, longitude: -122.30593, address: "10341 San Pablo Ave, El Cerrito, CA 94530" },
  "down home music": { name: "Down Home Music", latitude: 37.90684, longitude: -122.30593, address: "10341 San Pablo Ave, El Cerrito, CA 94530" },
  // Cornerstone Berkeley (foopee "Cornerstone, Berkely" typo).
  "cornerstone, berkely": { name: "Cornerstone Berkeley", latitude: 37.86656, longitude: -122.26693, address: "2367 Shattuck Ave, Berkeley, CA 94704" },
  "cornerstone, berkeley": { name: "Cornerstone Berkeley", latitude: 37.86656, longitude: -122.26693, address: "2367 Shattuck Ave, Berkeley, CA 94704" },
  "cornerstone berkeley": { name: "Cornerstone Berkeley", latitude: 37.86656, longitude: -122.26693, address: "2367 Shattuck Ave, Berkeley, CA 94704" },
  // Presidio Theatre (cityboxoffice doubles the address so it won't geocode raw).
  "presidio theatre performing arts center": { name: "Presidio Theatre", latitude: 37.79889, longitude: -122.46054, address: "99 Moraga Ave, San Francisco, CA 94129" },
  "presidio theatre": { name: "Presidio Theatre", latitude: 37.79889, longitude: -122.46054, address: "99 Moraga Ave, San Francisco, CA 94129" },
  // Herbst Theatre (War Memorial Veterans Building).
  "herbst theatre": { name: "Herbst Theatre", latitude: 37.77953, longitude: -122.42103, address: "401 Van Ness Ave, San Francisco, CA 94102" },
  // SVN West (10 South Van Ness; 19hz "Svn West Rooftop (San Francisco)").
  "svn west": { name: "SVN West", latitude: 37.77409, longitude: -122.41945, address: "10 South Van Ness Ave, San Francisco, CA 94103" },
  "svn west rooftop": { name: "SVN West", latitude: 37.77409, longitude: -122.41945, address: "10 South Van Ness Ave, San Francisco, CA 94103" },
  // Fort Mason Center — matches the fortmason scraper's canonical venueName.
  "festival pavilion at fort mason center": { name: "Fort Mason Center", latitude: 37.80689, longitude: -122.43221, address: "2 Marina Blvd, San Francisco, CA 94123" },
  "fort mason center": { name: "Fort Mason Center", latitude: 37.80689, longitude: -122.43221, address: "2 Marina Blvd, San Francisco, CA 94123" },
  "fort mason": { name: "Fort Mason Center", latitude: 37.80689, longitude: -122.43221, address: "2 Marina Blvd, San Francisco, CA 94123" },
  // KQED headquarters (kqed scraper "The Commons at KQED").
  "the commons at kqed": { name: "KQED", latitude: 37.76262, longitude: -122.40972, address: "2601 Mariposa St, San Francisco, CA 94110" },
  kqed: { name: "KQED", latitude: 37.76262, longitude: -122.40972, address: "2601 Mariposa St, San Francisco, CA 94110" },
  // Chinese Culture Center (inside the Hilton, 750 Kearny St).
  "chinese culture center gallery": { name: "Chinese Culture Center", latitude: 37.79514, longitude: -122.40431, address: "750 Kearny St, San Francisco, CA 94108" },
  "chinese culture center": { name: "Chinese Culture Center", latitude: 37.79514, longitude: -122.40431, address: "750 Kearny St, San Francisco, CA 94108" },
  // Lanesplitter Pizza (Emeryville; foopee "Lane Splitters Pizza, Emeryville").
  "lane splitters pizza, emeryville": { name: "Lanesplitter Pizza", latitude: 37.83203, longitude: -122.28041, address: "4031 San Pablo Ave, Emeryville, CA 94608" },
  "lanesplitter pizza": { name: "Lanesplitter Pizza", latitude: 37.83203, longitude: -122.28041, address: "4031 San Pablo Ave, Emeryville, CA 94608" },
  // Monarch (101 6th St; decentered stores the venue as bare "Monarch").
  monarch: { name: "Monarch", latitude: 37.78097, longitude: -122.40833, address: "101 6th St, San Francisco, CA 94103" },
  // Hotel VIA rooftop (19hz "Via Hotel Rooftop (San Francisco)").
  "via hotel rooftop": { name: "Hotel VIA", latitude: 37.77929, longitude: -122.39064, address: "138 King St, San Francisco, CA 94107" },
  "hotel via": { name: "Hotel VIA", latitude: 37.77929, longitude: -122.39064, address: "138 King St, San Francisco, CA 94107" },
  // The Warfield's own Instagram handle (instagram scraper "thewarfield").
  thewarfield: { name: "The Warfield", latitude: 37.78262, longitude: -122.41034, address: "982 Market St, San Francisco, CA 94102" },
  // ── User-confirmed venues (second triage pass) — addresses supplied by hand. ──
  // "Hedge Coffee" is a 19hz promoter name, not a venue; its shows are at 434 Shotwell.
  "hedge coffee": { name: "434 Shotwell", latitude: 37.76143, longitude: -122.41613, address: "434 Shotwell St, San Francisco, CA 94110" },
  // Gold Bar distillery/tasting room on Treasure Island.
  "gold bar whiskey distillery tasting room": { name: "Gold Bar Distillery", latitude: 37.81751, longitude: -122.37138, address: "1 Avenue of the Palms, San Francisco, CA 94130" },
  "goldbar distillery treasure island": { name: "Gold Bar Distillery", latitude: 37.81751, longitude: -122.37138, address: "1 Avenue of the Palms, San Francisco, CA 94130" },
  // Now Place — Chinatown art gallery.
  "now place 此间": { name: "Now Place", latitude: 37.79443, longitude: -122.40435, address: "679 Clay St, San Francisco, CA 94111" },
  "now place": { name: "Now Place", latitude: 37.79443, longitude: -122.40435, address: "679 Clay St, San Francisco, CA 94111" },
  // O'Reilly's Pub — Haight (curly apostrophe folded by normalize).
  "o'reilly's pub": { name: "O'Reilly's Pub", latitude: 37.76951, longitude: -122.45262, address: "1840 Haight St, San Francisco, CA 94117" },
  // Evolution Night Club — Portola/San Bruno Ave.
  "evolution night club san francisco": { name: "Evolution Night Club", latitude: 37.7307, longitude: -122.4052, address: "2470 San Bruno Ave, San Francisco, CA 94134" },
  "evolution night club": { name: "Evolution Night Club", latitude: 37.7307, longitude: -122.4052, address: "2470 San Bruno Ave, San Francisco, CA 94134" },
  // Slim's — reopened as Buddha Night Club at the same 333 11th St address.
  "slim's": { name: "Slim's", latitude: 37.77151, longitude: -122.41326, address: "333 11th St, San Francisco, CA 94103" },
  slims: { name: "Slim's", latitude: 37.77151, longitude: -122.41326, address: "333 11th St, San Francisco, CA 94103" },
  "buddha night club": { name: "Slim's", latitude: 37.77151, longitude: -122.41326, address: "333 11th St, San Francisco, CA 94103" },
  // The Castro Room (97 Collingwood St).
  "the castro room": { name: "The Castro Room", latitude: 37.76097, longitude: -122.43603, address: "97 Collingwood St, San Francisco, CA 94114" },
  // XeX — bar/club on Polk.
  xex: { name: "XeX", latitude: 37.78736, longitude: -122.42018, address: "1131 Polk St, San Francisco, CA 94109" },
  // Bric-a-Brac — Visitacion Valley.
  "bric-a-brac": { name: "Bric-a-Brac", latitude: 37.71263, longitude: -122.4069, address: "178 Leland Ave, San Francisco, CA 94134" },
  // The Loom — Jingletown, Oakland.
  "the loom": { name: "The Loom", latitude: 37.78098, longitude: -122.24011, address: "2220 Livingston St, Oakland, CA 94606" },
  // Gold Bar Hangar — Alameda Point (distinct from the SF Gold Bar distillery).
  "the gold bar hangar": { name: "Gold Bar Hangar", latitude: 37.7886, longitude: -122.30829, address: "2505 Monarch St, Alameda, CA 94501" },
  "gold bar hangar": { name: "Gold Bar Hangar", latitude: 37.7886, longitude: -122.30829, address: "2505 Monarch St, Alameda, CA 94501" },
  // 888 Garage — a room at The Midway (900 Marin St).
  "888 garage": { name: "The Midway", latitude: 37.74953, longitude: -122.38609, address: "900 Marin St, San Francisco, CA 94124" },
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

/**
 * Cities inside the service area (lib/geo.ts, SERVICE_RADIUS_KM = 30): SF plus
 * the ~20–30 min East Bay / peninsula towns. Used to decide whether a
 * placeholder venue names a location we can confirm is local. Lowercased; "sf"
 * is canonicalized to "san francisco" for display below.
 */
const SERVICE_AREA_CITY_LABELS: Record<string, string> = {
  sf: "San Francisco",
  "san francisco": "San Francisco",
  oakland: "Oakland",
  berkeley: "Berkeley",
  alameda: "Alameda",
  emeryville: "Emeryville",
  richmond: "Richmond",
  albany: "Albany",
  "el cerrito": "El Cerrito",
  "daly city": "Daly City",
  "south san francisco": "South San Francisco",
  brisbane: "Brisbane",
  sausalito: "Sausalito",
  "san mateo": "San Mateo",
};

/**
 * City candidates a placeholder venue might name, lowercased. A placeholder can
 * carry its city in a trailing parenthetical ("TBA (San Francisco)") OR as the
 * base string ("San Francisco, CA", "SF"), and funcheap puts a *time* in the
 * parenthetical ("SF (7p + 9p)") — so we consider both the parenthetical and the
 * base and let the caller match against the service-area set.
 */
function placeholderCityCandidates(venueName: string): string[] {
  const clean = (s: string) =>
    s
      .trim()
      .toLowerCase()
      .replace(/^tb[ad]\b[\s,\-–—]*/, "") // strip a leading "TBA"/"TBD"
      .replace(/,?\s*(ca|california)\s*$/, "") // strip a trailing state
      .replace(/[.,\s]+$/, "")
      .trim();
  const out: string[] = [];
  const paren = venueName.match(/\(([^)]+)\)\s*$/);
  if (paren) out.push(clean(paren[1]));
  out.push(clean(venueName.replace(/\s*\([^)]*\)\s*$/, "")));
  return out.filter(Boolean);
}

/**
 * For a placeholder venue we can confirm is inside the service area, the city's
 * display label ("San Francisco", "Oakland"); otherwise null. Non-placeholder
 * venues and placeholders we can't place — generic "Bay Area", out-of-area
 * cities like "San Jose", bare "TBA" — return null.
 */
export function serviceAreaTBACity(
  venueName: string | null | undefined
): string | null {
  if (!isPlaceholderVenue(venueName)) return null;
  for (const c of placeholderCityCandidates(venueName!)) {
    const label = SERVICE_AREA_CITY_LABELS[c];
    if (label) return label;
  }
  return null;
}

/**
 * A placeholder venue we can confirm is local — "TBA (San Francisco)",
 * "TBA (Oakland)", "SF". These are intentionally locationless (secret-location
 * raves, venue not yet set) but confirmed in-area, so they publish as
 * "location TBA" events: visible in the feed, off the map (no coords), badged in
 * the UI. Out-of-area / generic placeholders stay held PENDING at ingest.
 */
export function isServiceAreaTBA(venueName: string | null | undefined): boolean {
  return serviceAreaTBACity(venueName) !== null;
}

function normalize(s: string): string {
  return s
    .trim()
    .toLowerCase()
    // Fold curly apostrophes/quotes to straight so feed spellings match the
    // ASCII keys below — funcheap/instagram emit "Mr. Tipple’s", "SF’s …".
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    // Drop a trailing parenthetical the aggregators tack onto an otherwise-clean
    // venue name — 19hz appends the city ("Public Works Loft (San Francisco)"),
    // funcheap appends a date ("Yerba Buena Center for the Arts (YBCA)" aside,
    // "...Palace of Fine Arts (July 11-12)") — so the name still matches its base
    // key. Leaves the placeholder path alone: "TBA (San Francisco)" → "tba",
    // which matches no known venue, exactly as before.
    .replace(/\s*\([^)]*\)\s*$/, "")
    // Strip surrounding punctuation so labels like "Castro Theater," match the
    // punctuation-free known-venue keys instead of falling through to Nominatim
    // (where they misgeocode — "Castro Theater," resolved to Castro *Valley*).
    .replace(/^[\s.,;:]+|[\s.,;:]+$/g, "");
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
