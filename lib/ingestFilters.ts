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
