#!/usr/bin/env tsx
/**
 * Auto-curation script. Runs after the scrape job to:
 *   1. Block predatory/spam events (paid seminars, timeshares, MLM)
 *   2. Feature the week's best events, weighted toward Fri/Sat/Sun
 *
 * Usage:
 *   npm run auto-feature
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local", override: true });

import { prisma } from "../lib/prisma";
import { CATEGORY_LABELS } from "../lib/types";
import { sfDayKey, sfDayStart, sfDayEnd } from "../lib/sfDate";
import { addDays } from "date-fns";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();

// Target featured event count per day-of-week (0=Sun … 6=Sat)
const DAY_TARGETS: Record<number, number> = {
  0: 3, // Sunday
  1: 2, // Monday
  2: 2, // Tuesday
  3: 2, // Wednesday
  4: 2, // Thursday
  5: 4, // Friday
  6: 5, // Saturday
};
const WEEKLY_MAX = 20;
const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

async function main() {
  const now = new Date();
  const todayKey = sfDayKey(now);
  const windowStart = sfDayStart(todayKey);
  const windowEnd = sfDayEnd(sfDayKey(addDays(now, 6)));

  console.log(`\n🎯 happening auto-feature — window: ${todayKey} → ${sfDayKey(addDays(now, 6))}\n`);

  // Count already-featured events per day in the 7-day window
  const alreadyFeatured = await prisma.event.findMany({
    where: {
      status: "PUBLISHED",
      featured: true,
      startDate: { gte: windowStart, lte: windowEnd },
    },
    select: { startDate: true },
  });

  const featuredPerDay = new Map<string, number>();
  for (const e of alreadyFeatured) {
    const key = sfDayKey(e.startDate);
    featuredPerDay.set(key, (featuredPerDay.get(key) ?? 0) + 1);
  }

  const totalAlreadyFeatured = alreadyFeatured.length;
  const remainingWeeklyBudget = Math.max(0, WEEKLY_MAX - totalAlreadyFeatured);

  console.log(`   Already featured this week: ${totalAlreadyFeatured} / ${WEEKLY_MAX}`);

  if (remainingWeeklyBudget === 0) {
    console.log("   ✅ Weekly featured limit already reached — nothing to do.\n");
    return;
  }

  // Build per-day budgets
  const dayBudgets: {
    key: string;
    dow: number;
    current: number;
    target: number;
    remaining: number;
  }[] = [];

  for (let i = 0; i < 7; i++) {
    const key = sfDayKey(addDays(now, i));
    const [y, m, d] = key.split("-").map(Number);
    const dow = new Date(y, m - 1, d).getDay();
    const target = DAY_TARGETS[dow] ?? 2;
    const current = featuredPerDay.get(key) ?? 0;
    dayBudgets.push({ key, dow, current, target, remaining: Math.max(0, target - current) });
    console.log(`   ${key} (${DOW_LABELS[dow]}): ${current} featured, need ${Math.max(0, target - current)} more`);
  }
  console.log();

  // Fetch candidate events
  const candidates = await prisma.event.findMany({
    where: {
      status: "PUBLISHED",
      featured: false,
      startDate: { gte: windowStart, lte: windowEnd },
      NOT: [{ tags: { has: "recurring" } }, { tags: { has: "sfpl" } }],
    },
    orderBy: { startDate: "asc" },
    take: 500,
    select: {
      id: true,
      title: true,
      description: true,
      startDate: true,
      venueName: true,
      neighborhood: true,
      category: true,
      tags: true,
      isFree: true,
      price: true,
      dedupeHash: true,
      sourceUrl: true,
    },
  });

  console.log(`   Candidate events to review: ${candidates.length}\n`);

  if (candidates.length === 0) {
    console.log("   ✅ No candidate events — nothing to do.\n");
    return;
  }

  const clean = (s: string) => s.toWellFormed();

  const dayBudgetSummary = dayBudgets
    .map(
      (b) =>
        `${b.key} (${DOW_LABELS[b.dow]}): ${b.current} already featured, need ${b.remaining} more (target: ${b.target})`
    )
    .join("\n");

  const eventList = candidates
    .map((e) => {
      const cat = e.category ? CATEGORY_LABELS[e.category] : null;
      const venue = clean(e.venueName ?? e.neighborhood ?? "");
      const price = e.isFree ? "Free" : clean(e.price ?? "");
      const desc = e.description ? clean(e.description).slice(0, 180) : "";
      const dayKey = sfDayKey(e.startDate);
      const budget = dayBudgets.find((b) => b.key === dayKey);
      const [y, m, d] = dayKey.split("-").map(Number);
      const dow = new Date(y, m - 1, d).getDay();
      return [
        `ID:${e.id}`,
        `Date: ${dayKey} (${DOW_LABELS[dow]})`,
        `Title: ${clean(e.title)}`,
        venue ? `Venue: ${venue}` : null,
        cat ? `Category: ${cat}` : null,
        price ? `Price: ${price}` : null,
        e.tags.length ? `Tags: ${e.tags.map(clean).join(", ")}` : null,
        desc ? `Desc: ${desc}` : null,
        budget ? `DaySlots: ${budget.remaining} slots remaining for this day` : null,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n")
    .toWellFormed();

  console.log("   🤖 Asking Claude to review events...\n");

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    messages: [
      {
        role: "user",
        content: `You are the automated curator for "happening", a San Francisco events discovery platform. Review these upcoming events and perform two actions:

---
PART 1 — BLOCK (permanent removal from platform)
Flag events with a predatory or mercenary relationship with attendees. Block these categories without exception:
- Paid career growth / professional development seminars (e.g. "Learn to invest", "Build your personal brand", leadership workshops with a ticket price)
- Timeshare or real estate sales pitches disguised as social events
- MLM / "business opportunity" recruitment disguised as networking
- High-pressure sales events marketed as free dinners or social gatherings
- Any event whose primary purpose is to sell attendees something expensive under false pretenses

---
PART 2 — FEATURE (highlight on the platform)
Select the best events for the week. Weekly budget: ${remainingWeeklyBudget} slots remaining (${totalAlreadyFeatured} already featured, ${WEEKLY_MAX} max for the week).

Per-day targets — ensure every day with candidates gets AT LEAST 1 new featured event:
${dayBudgetSummary}

Calibrate your taste against these examples of events that belong on the list:
- Community chaos: BYOBW Big Wheel race, St. Stupid's Day Parade, Hunky Jesus Contest, Hole Party (digging holes on Ocean Beach)
- SF underground: EFUNK SF, Boofiversary, Endzeit x Northern Electronics, East Bay Mean Girls anniversary, Honey Soundsystem
- Hybrid formats: Fight Night (rave + live wrestling), Folk Punk Prom, SF Beer Mile, South Side Beer Ride
- Community with personality: FART MARKET, Bay Bingo: Tenderloin Edition, Curiosity Guild: Fool's Errand
- Civic moments: neighborhood protests, congressional debates, Carnaval dance competition
- Big deals: Black Coffee at Treasure Island, free Big Band in Golden Gate Park

STRONGLY FAVOR:
- Wild, weird, irreverent street events and absurdist community gatherings
- Participatory events where you DO something: races, rides, dances, community builds
- SF underground institutions and scene nights with a real identity
- Hybrid or unexpected formats: sport + party, rave + spectacle, game night with a neighborhood twist
- Civic and cultural moments that reflect SF's actual community life
- Anything with "only in San Francisco" quality

INCLUDE IF genuinely notable:
- Electronic/club nights: only rare SF appearances, international touring acts, or proven SF institutions
- Talks/panels: only unusual subjects or genuine names
- Venue shows: only rare, infrequently-touring, or otherwise special acts
- Art/film: only experimental, boundary-pushing, or tied to notable names

SKIP entirely:
- Generic weekly club nights with no distinct identity
- Tech meetups, startup networking, corporate events
- Standard gallery openings, generic fitness/wellness, book readings from unknown authors
- TECH category events
- Anything that could happen in any American city

Aim to fill the per-day slots shown above. Prioritize Friday/Saturday/Sunday with more picks, Mon-Thu with 1-2 each. Stay within the ${remainingWeeklyBudget} total budget.

Return ONLY a valid JSON object — no prose before or after:
{
  "block": [{ "id": "...", "reason": "one sentence why blocked" }],
  "feature": [{ "id": "...", "reason": "one sentence why featured" }]
}

Events to review (${candidates.length} total, next 7 days):

${eventList}`,
      },
    ],
  });

  const text = message.content[0].type === "text" ? message.content[0].text : "";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`Failed to parse AI response:\n${text.slice(0, 400)}`);
  }

  let picks: { block: { id: string; reason: string }[]; feature: { id: string; reason: string }[] };
  try {
    picks = JSON.parse(jsonMatch[0]);
  } catch {
    throw new Error(`Invalid JSON from AI:\n${jsonMatch[0].slice(0, 400)}`);
  }

  const candidateIds = new Set(candidates.map((c) => c.id));
  const candidateMap = new Map(candidates.map((c) => [c.id, c]));

  const toBlock = (picks.block ?? []).filter((b) => candidateIds.has(b.id));
  const blockIds = new Set(toBlock.map((b) => b.id));
  const toFeature = (picks.feature ?? [])
    .filter((f) => candidateIds.has(f.id) && !blockIds.has(f.id))
    .slice(0, remainingWeeklyBudget);

  // Block events
  let blockedCount = 0;
  for (const b of toBlock) {
    const event = candidateMap.get(b.id)!;
    try {
      await prisma.eventBlocklist.upsert({
        where: { dedupeHash: event.dedupeHash },
        update: { reason: b.reason },
        create: {
          dedupeHash: event.dedupeHash,
          sourceUrl: event.sourceUrl,
          title: event.title,
          reason: b.reason,
        },
      });
      await prisma.event.delete({ where: { id: b.id } });
      blockedCount++;
      console.log(`   🚫 Blocked: ${event.title}`);
      console.log(`      → ${b.reason}`);
    } catch {
      // Already deleted by a concurrent run — skip
    }
  }

  // Feature events
  const featureIds = toFeature.map((f) => f.id);
  if (featureIds.length > 0) {
    await prisma.event.updateMany({
      where: { id: { in: featureIds } },
      data: { featured: true, featuredAt: new Date() },
    });
  }

  console.log();
  for (const f of toFeature) {
    const event = candidateMap.get(f.id)!;
    const dayKey = sfDayKey(event.startDate);
    const [y, m, d] = dayKey.split("-").map(Number);
    const dow = DOW_LABELS[new Date(y, m - 1, d).getDay()];
    console.log(`   ⭐ Featured (${dow}): ${event.title}`);
    console.log(`      → ${f.reason}`);
  }

  console.log(
    `\n✅ Done — featured: ${featureIds.length}, blocked: ${blockedCount}\n`
  );
}

main()
  .catch((err) => {
    console.error("❌ Fatal error:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
