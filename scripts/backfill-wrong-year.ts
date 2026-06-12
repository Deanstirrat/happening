/**
 * One-off backfill: fix events whose stored year is wrong.
 *
 * Background: the Instagram extractor (lib/extract.ts) sometimes returned a
 * dateRaw with a year the flyer never printed — typically one+ years in the
 * future — and parseDate trusted any explicit year blindly. The result was
 * ~400 events stored ~12 months too far out (e.g. "Sunday Funday Drag Brunch"
 * landing in 2027). No-time events were also stored at UTC midnight, which
 * renders in SF as 5:00 PM the previous day.
 *
 * This script mirrors the new reanchorFarFuture() guard in lib/createEvent.ts:
 *   - Re-anchor any date >310 days out back to the nearest sensible occurrence.
 *   - For rows at the exact UTC-midnight placeholder (the "5 PM" signature, only
 *     ever produced by the no-real-time path), reset to noon-SF + allDay so they
 *     stop showing a misleading time.
 *   - Recompute dedupeHash (it keys on the SF calendar day) and skip rows that
 *     would collide with an existing event.
 *
 * --fix-midnight-day extends the midnight→noon fix to CORRECT-year rows that
 * still sit at exactly 00:00:00.000 UTC. Those render a day early in SF (00:00Z
 * = 5 PM the prior day) even though their year is fine — the gap the wrong-year
 * pass alone leaves behind. This is opt-in because an exact-UTC-midnight value
 * is AMBIGUOUS: a genuine 5 PM PDT / 4 PM PST start stores the identical
 * instant, and flipping one of those to all-day noon would move it to the wrong
 * day. The flag is Instagram-scoped (the only LLM-dated path) and dry-run still
 * prints every row, so review the list and confirm none are real evening-of-5
 * starts before --apply. (In practice these are nightlife / watch-party posts
 * that never start at 5 PM, so the midnight value is a no-real-time placeholder.)
 *
 * Dry-run by default. Pass --apply to write changes.
 *
 *   npx tsx scripts/backfill-wrong-year.ts                          # preview wrong-year only
 *   npx tsx scripts/backfill-wrong-year.ts --apply                  # execute wrong-year only
 *   npx tsx scripts/backfill-wrong-year.ts --fix-midnight-day       # preview + day-early rows
 *   npx tsx scripts/backfill-wrong-year.ts --fix-midnight-day --apply
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local", override: true });

import { prisma } from "../lib/prisma";
import { computeDedupeHash } from "../lib/dedupeHash";
import { sfDayStart } from "../lib/sfDate";

const APPLY = process.argv.includes("--apply");
const FIX_MIDNIGHT_DAY = process.argv.includes("--fix-midnight-day");
const MAX_FUTURE_DAYS = 310;
const MAX_PAST_DAYS = 60;
// A flyer advertises an event near or after the day it was scraped. A stored
// date more than ~11 months after its scrape is the +1-year LLM signature —
// real far-future events (festivals, tours announced early) top out around 9
// months of gap, so 330 cleanly separates bug from legit (observed: bug gaps
// start at 337d, legit gaps end at 268d).
const GAP_MAX_DAYS = 330;
const DAY_MS = 86_400_000;

// Year-correct a stored date. Prefer the scrape-gap signal (each event carries
// its own scrapedAt anchor); fall back to "now" for rows with no scrapedAt.
function correctYear(d: Date, scrapedAt: Date | null): Date {
  const out = new Date(d);
  if (scrapedAt) {
    while ((out.getTime() - scrapedAt.getTime()) / DAY_MS > GAP_MAX_DAYS) {
      out.setFullYear(out.getFullYear() - 1);
    }
    return out;
  }
  const now = Date.now();
  if ((out.getTime() - now) / DAY_MS <= MAX_FUTURE_DAYS) return out;
  while ((out.getTime() - now) / DAY_MS > MAX_FUTURE_DAYS) {
    out.setFullYear(out.getFullYear() - 1);
  }
  if ((out.getTime() - now) / DAY_MS < -MAX_PAST_DAYS) {
    out.setFullYear(out.getFullYear() + 1);
  }
  return out;
}

// Exactly 00:00:00.000 UTC — the no-real-time placeholder that renders as 5 PM
// the previous SF day. (A real start time goes through sfDateFromLocal and never
// lands on an exact UTC midnight, except the rare genuine 5 PM PDT / 4 PM PST.)
function isMidnightPlaceholder(d: Date): boolean {
  return (
    d.getUTCHours() === 0 &&
    d.getUTCMinutes() === 0 &&
    d.getUTCSeconds() === 0 &&
    d.getUTCMilliseconds() === 0
  );
}

async function main() {
  // Scoped to Instagram: that's the path whose dates come from LLM extraction
  // (lib/extract.ts) and so carry the invent-a-year bug. Structured scrapers
  // (eventbrite, cityboxoffice, bandsintown, …) use their own date parsers and
  // can legitimately list far-future events, so they must NOT be re-anchored.
  // correctYear() is a no-op for correctly-dated rows, so this is idempotent.
  const events = await prisma.event.findMany({
    where: { source: { slug: "instagram" }, startDate: { gt: new Date() } },
    select: {
      id: true,
      title: true,
      venueName: true,
      startDate: true,
      allDay: true,
      scrapedAt: true,
      source: { select: { slug: true } },
    },
    orderBy: { startDate: "asc" },
  });

  console.log(`${APPLY ? "APPLYING" : "DRY RUN"} — scanning ${events.length} future events\n`);

  let changed = 0;
  let deleted = 0;
  const bySource: Record<string, number> = {};
  // Track hashes we've already assigned this run so intra-batch duplicates (the
  // same event stored twice, e.g. a 00:00Z and a 19:00Z row) are caught even in
  // dry-run, not just by the live unique constraint.
  const plannedHashes = new Map<string, string>(); // newHash -> survivor event id

  for (const e of events) {
    const yearCorrected = correctYear(e.startDate, e.scrapedAt);
    const yearChanged = yearCorrected.getTime() !== e.startDate.getTime();
    const midnightPlaceholder = isMidnightPlaceholder(e.startDate);

    // Touch known-broken rows. By default that means wrong-year only: we
    // deliberately do NOT flip every UTC-midnight event to all-day, because a
    // correctly-dated 00:00Z value may be a genuine 5 PM PDT start and we'd
    // erase a real time. --fix-midnight-day opts into also repairing
    // correct-year rows still parked at exact UTC midnight — they render a day
    // early in SF — accepting that ambiguity in exchange for the dry-run review
    // above (see header). Correct-year, non-midnight rows are never touched.
    if (!yearChanged && !(FIX_MIDNIGHT_DAY && midnightPlaceholder)) continue;

    let newStart: Date;
    let newAllDay = e.allDay;

    if (midnightPlaceholder) {
      // Exact UTC midnight = the no-real-time path (renders as 5 PM the prior SF
      // day). The intended SF day is the stored value's UTC date; pin to noon SF
      // on the (year-corrected) date and flag all-day. For correct-year rows
      // yearCorrected === startDate, so this just shifts the time, not the day.
      const y = yearCorrected.getUTCFullYear();
      const m = String(yearCorrected.getUTCMonth() + 1).padStart(2, "0");
      const d = String(yearCorrected.getUTCDate()).padStart(2, "0");
      newStart = new Date(sfDayStart(`${y}-${m}-${d}`).getTime() + 12 * 60 * 60 * 1000);
      newAllDay = true;
    } else {
      // Has a real time — just correct the year, preserving time of day.
      newStart = yearCorrected;
    }

    if (newStart.getTime() === e.startDate.getTime() && newAllDay === e.allDay) continue;

    const newHash = computeDedupeHash(newStart, e.title, e.venueName);
    // Collision = a correctly-dated copy of this event already exists (either
    // already in the DB, or fixed earlier in this run). By the system's own
    // dedupe definition (SF day + normalized title + venue token) this row is a
    // duplicate, so remove it rather than leave an orphan stuck at the bad year.
    const dbClash = await prisma.event.findUnique({ where: { dedupeHash: newHash }, select: { id: true } });
    const clashId = (dbClash && dbClash.id !== e.id ? dbClash.id : undefined) ?? plannedHashes.get(newHash);
    if (clashId) {
      deleted++;
      console.log(`  DELETE dup "${e.title.slice(0, 45)}" (${newStart.toISOString().slice(0, 10)} already covered by ${clashId})`);
      if (APPLY) await prisma.event.delete({ where: { id: e.id } });
      continue;
    }

    changed++;
    plannedHashes.set(newHash, e.id);
    const slug = e.source?.slug ?? "?";
    bySource[slug] = (bySource[slug] ?? 0) + 1;
    console.log(
      `  ${e.startDate.toISOString().slice(0, 16)} -> ${newStart.toISOString().slice(0, 16)}` +
        ` allDay ${e.allDay}->${newAllDay}  [${slug}] "${e.title.slice(0, 45)}"`
    );

    if (APPLY) {
      await prisma.event.update({
        where: { id: e.id },
        data: { startDate: newStart, allDay: newAllDay, dedupeHash: newHash },
      });
    }
  }

  console.log(`\n${APPLY ? "Updated" : "Would update"} ${changed} events, ${APPLY ? "deleted" : "would delete"} ${deleted} duplicates`);
  console.log("By source:", bySource);
  if (!APPLY) console.log("\nRe-run with --apply to write these changes.");
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
