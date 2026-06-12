// Ingestion-quality filters shared by every event path (scrape runner, community
// submit, URL extract, admin create). Keeping them here — rather than in the
// scraper runner — ensures `createEvent` applies the same hygiene the scrapers do,
// so the same off-vibe events are rejected no matter how they arrive.
//
// Field types are intentionally permissive (nullable/optional) so both the
// scraper's `ScrapedEvent` and `createEvent`'s looser shape satisfy them.

// Normalized venue names that indicate an online-only event
const VIRTUAL_VENUE_NORM = new Set([
  "online",
  "virtual",
  "onlineevent",
  "virtualevent",
  "zoom",
  "zoommeeting",
  "zoomwebinar",
  "webinar",
  "webex",
  "livestream",
  "googlemeet",
  "googlemeeting",
  "microsoftteams",
  "teleconference",
  "videoconference",
  "videocall",
]);

// Strong virtual keywords in titles (whole-word)
const VIRTUAL_TITLE_RE = /\b(virtual(?:ly)?|webinar|webcast|livestream|live[\s-]stream)\b/i;

export function isVirtualEvent(event: {
  title: string;
  description?: string | null;
  venueName?: string | null;
}): boolean {
  if (event.venueName) {
    const norm = event.venueName.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (VIRTUAL_VENUE_NORM.has(norm)) return true;
    // "Online Event", "Virtual Classroom", etc.
    if (/^(online|virtual)\b/i.test(event.venueName.trim())) return true;
  }

  if (VIRTUAL_TITLE_RE.test(event.title)) return true;

  if (event.description) {
    // Zoom meeting links or clear online-join language
    if (/zoom\.us\/[jw]\//.test(event.description)) return true;
    if (/\b(join\s+(?:us\s+)?(?:online|virtually)|attend\s+(?:online|virtually)|watch\s+from\s+home)\b/i.test(event.description)) return true;
  }

  return false;
}

// Cancellation filter — some sources keep listing events after they're called off,
// announcing it in the title ("Event CANCELLED: ...", "[CANCELLED] ...") or, less
// often, in the description ("This event has been cancelled"). We weed these out at
// ingestion so they never reach the public listing.
//
// Matching is deliberately narrow to avoid false positives:
//  - We require the past-tense "cancelled"/"canceled" (one or two L's) or "postponed",
//    NOT the bare verb "cancel" — so talks like "Cancel Culture" or "How to Cancel
//    Your Subscription" are left alone.
//  - Title matching is a plain whole-word check (the -ed form in a title is a strong
//    signal). Description matching requires an explicit "this event/it has been
//    cancelled"-style phrase, since descriptions often mention cancellation policies
//    ("no refunds if cancelled") without the event itself being off.
const CANCELED_TITLE_RE = /\b(cancell?ed|postponed)\b/i;
const CANCELED_DESC_RE =
  /\b(?:this\s+)?(?:event|show|performance|class|session|workshop|it)\s+(?:has\s+been|is|was|will\s+be)\s+(?:cancell?ed|postponed)\b/i;

export function isCanceledEvent(event: {
  title: string;
  description?: string | null;
}): boolean {
  if (CANCELED_TITLE_RE.test(event.title)) return true;
  if (event.description && CANCELED_DESC_RE.test(event.description)) return true;
  return false;
}

// Library audience filter — babies/toddlers and seniors/older-adults programming.
// These recurring library programs (storytime, lapsit, senior tech help, etc.) are
// off-vibe for the app. SFPL tags each event with audience labels (e.g.
// "babies & toddlers", "older adults") plus a "library"/"sfpl" marker; we match those
// first and fall back to title cues. Scope is intentionally babies + seniors only —
// school-age kids', teen, and general all-ages library events are left alone.
const LIBRARY_SIGNAL_RE = /\b(librar(?:y|ies)|sfpl)\b/i;
const BABY_AUDIENCE_RE = /\b(babies|baby|toddlers?|infants?|lapsit|preschool(?:ers)?|pre-school|tiny\s+tots|mother\s+goose|wee\s+ones|story\s?time)\b/i;
const SENIOR_AUDIENCE_RE = /\b(seniors?|older\s+adults?|elder(?:s|ly)?|55\+|60\+|65\+)\b/i;

export function isBabyOrSeniorLibraryEvent(event: {
  title: string;
  venueName?: string | null;
  sourceUrl?: string | null;
  tags?: string[];
}): boolean {
  const tagText = (event.tags ?? []).join(" ");

  const isLibrary =
    LIBRARY_SIGNAL_RE.test(tagText) ||
    (event.venueName ? /\blibrar(?:y|ies)\b/i.test(event.venueName) : false) ||
    (event.sourceUrl ? /sfpl\.org/i.test(event.sourceUrl) : false);
  if (!isLibrary) return false;

  const haystack = `${event.title} ${tagText}`;
  return BABY_AUDIENCE_RE.test(haystack) || SENIOR_AUDIENCE_RE.test(haystack);
}

// Out-of-area venue filter for the name-only music scrapers (foopee, bandsintown,
// 19hz, folkyeah — see runner.ts). These sources list the entire Bay Area and
// beyond; their out-of-area venues arrive as a bare name + city ("Mountain Winery,
// Saratoga", "Hopmonk Tavern, Novato") with no street address, so they never
// geocode and the coordinate-based distance filter (isTooFarFromSf in lib/geo.ts)
// can't catch them — they'd otherwise publish locationless (issue #157).
//
// We drop them by matching the city token in the venue string against a deny-list
// of cities OUTSIDE our ~30 km service area (lib/geo.ts). Cities inside the radius
// — San Francisco, Oakland, Berkeley, Daly City, Alameda, Emeryville, Albany,
// Richmond, Sausalito, Mill Valley, San Rafael, San Mateo, … — are deliberately
// absent from the list and kept. Matching is on comma/paren/dash-delimited tokens
// (where these sources put the city) with exact whole-token equality, so a venue
// whose *name* merely contains a city word (e.g. "Mountain View Cemetery, Oakland")
// is not mistaken for that city.
const OUT_OF_AREA_CITIES = new Set([
  // South Bay & lower Peninsula (south of San Mateo)
  "san jose", "san jose ca", "santa clara", "sunnyvale", "mountain view",
  "palo alto", "east palo alto", "menlo park", "redwood city", "san carlos",
  "belmont", "foster city", "atherton", "woodside", "portola valley",
  "los altos", "los altos hills", "saratoga", "cupertino", "campbell",
  "los gatos", "milpitas", "gilroy", "morgan hill", "half moon bay", "stanford",
  // East Bay (beyond the inner Oakland/Berkeley/Alameda ring)
  "hayward", "union city", "newark", "fremont", "dublin", "pleasanton",
  "livermore", "sunol", "walnut creek", "concord", "pleasant hill", "martinez",
  "danville", "san ramon", "alamo", "clayton", "brentwood", "antioch",
  "pittsburg", "bay point", "oakley",
  // North Bay (beyond inner Marin)
  "novato", "petaluma", "santa rosa", "sonoma", "napa", "american canyon",
  "sebastopol", "healdsburg", "windsor", "rohnert park", "cotati", "vallejo",
  "benicia", "fairfield", "vacaville", "suisun city", "guerneville",
  "bodega bay", "point reyes", "point reyes station", "olema",
  // Farther afield (Central Valley, Sacramento, Santa Cruz, Monterey, Tahoe, …)
  "sacramento", "west sacramento", "davis", "stockton", "modesto", "tracy",
  "manteca", "roseville", "folsom", "elk grove", "santa cruz", "capitola",
  "scotts valley", "watsonville", "aptos", "felton", "ben lomond",
  "boulder creek", "monterey", "carmel", "pacific grove", "seaside", "salinas",
  "truckee", "south lake tahoe", "tahoe city", "reno", "fresno",
]);

// Split a venue string into the chunks where these sources put the city — last
// comma token in "Venue, City", a parenthetical "Venue (City)", or a dash-suffix
// "Venue - City" — then normalize each for exact comparison against the deny-list.
export function isOutOfAreaVenue(venueName?: string | null): boolean {
  if (!venueName) return false;
  return venueName
    .split(/[,()\-–—]/)
    .map((tok) => tok.trim().toLowerCase().replace(/\.$/, ""))
    .some((tok) => OUT_OF_AREA_CITIES.has(tok));
}
