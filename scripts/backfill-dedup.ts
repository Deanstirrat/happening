/**
 * Backfill deduplication: finds existing duplicate events in the DB using the
 * same logic as the scraper runner and archives the lower-quality duplicate.
 *
 * Duplicate = same SF calendar day AND (same specific sourceUrl OR same venue + ≥2 shared title tokens).
 * The same-day constraint prevents archiving different occurrences of recurring events.
 *
 * Run with: npx tsx scripts/backfill-dedup.ts
 */

import { prisma } from "@/lib/prisma";
import { tokenize, areLikelyDifferentEvents } from "@/lib/fuzzy";
import { sfDayKey } from "@/lib/sfDate";

const GENERIC_SOURCE_URL_PATTERNS = [
  "foopee.com/punk/the-list/",
  "19hz.info/eventlisting_BayArea.php",
  "badslava.com/san-francisco-trivia-nights.php",
];
const LOW_QUALITY_DOMAINS = ["foopee.com", "19hz.info"];

const isSpecificUrl = (url: string) =>
  !GENERIC_SOURCE_URL_PATTERNS.some((p) => url.includes(p));

const isLowQuality = (url: string) =>
  LOW_QUALITY_DOMAINS.some((d) => url.includes(d));

// Venue names that are placeholders and shouldn't be used for matching
const GENERIC_VENUE_NAMES = new Set([
  "locationprovidedafterbooking",
  "locationtobeprovided",
  "onlineevent",
  "virtualevent",
  "tba",
  "tbd",
]);

function normalizeVenue(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isGenericVenue(s: string) {
  return GENERIC_VENUE_NAMES.has(normalizeVenue(s));
}

function scoreEvent(e: { imageUrl: string | null; description: string | null; sourceUrl: string }) {
  let score = 0;
  if (e.imageUrl) score += 2;
  if (e.description) score += 2;
  if (!isLowQuality(e.sourceUrl)) score += 1;
  return score;
}

async function main() {
  let archived = 0;

  // Fetch all published events once
  const events = await prisma.event.findMany({
    where: { status: "PUBLISHED" },
    select: { id: true, title: true, startDate: true, venueName: true, imageUrl: true, description: true, sourceUrl: true },
    orderBy: { startDate: "asc" },
  });

  // Group by sfDay — all duplicate checks are scoped to the same SF calendar day
  const byDay = new Map<string, typeof events>();
  for (const e of events) {
    const day = sfDayKey(e.startDate);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day)!.push(e);
  }

  const archived_ids = new Set<string>();

  for (const [day, dayEvents] of byDay) {
    if (dayEvents.length < 2) continue;

    for (let i = 0; i < dayEvents.length; i++) {
      if (archived_ids.has(dayEvents[i].id)) continue;
      const a = dayEvents[i];

      for (let j = i + 1; j < dayEvents.length; j++) {
        if (archived_ids.has(dayEvents[j].id)) continue;
        const b = dayEvents[j];

        let isDuplicate = false;
        let reason = "";

        // Check 1: same specific sourceUrl on the same SF day
        if (
          a.sourceUrl === b.sourceUrl &&
          isSpecificUrl(a.sourceUrl)
        ) {
          isDuplicate = true;
          reason = `same URL (${a.sourceUrl})`;
        }

        // Check 2: same venue + ≥2 shared title tokens on the same SF day
        if (!isDuplicate && a.venueName && b.venueName && !isGenericVenue(a.venueName)) {
          const venueA = normalizeVenue(a.venueName);
          const venueB = normalizeVenue(b.venueName);
          if (venueA === venueB && venueA.length > 0) {
            // Skip venue-as-title placeholders
            if (normalizeVenue(a.title) === venueA || normalizeVenue(b.title) === venueB) continue;
            // Skip identical titles (already handled by dedupeHash)
            if (a.title === b.title) continue;

            const tokensA = tokenize(a.title);
            const tokensB = tokenize(b.title);
            let shared = 0;
            for (const t of tokensA) {
              if (tokensB.has(t)) shared++;
            }
            if (shared >= 2 && !areLikelyDifferentEvents(tokensA, tokensB)) {
              isDuplicate = true;
              reason = `same venue (${a.venueName}) + ${shared} shared tokens`;
            }
          }
        }

        if (!isDuplicate) continue;

        const keepId = scoreEvent(a) >= scoreEvent(b) ? a.id : b.id;
        const archiveId = keepId === a.id ? b.id : a.id;
        const keepTitle = keepId === a.id ? a.title : b.title;
        const archiveTitle = keepId === a.id ? b.title : a.title;

        console.log(`  [${day}] ${reason}`);
        console.log(`    archiving: "${archiveTitle}"`);
        console.log(`    keeping:   "${keepTitle}"`);

        await prisma.event.update({ where: { id: archiveId }, data: { status: "ARCHIVED" } });
        archived_ids.add(archiveId);
        archived++;
      }
    }
  }

  console.log(`\nDone — archived ${archived} duplicate events`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
