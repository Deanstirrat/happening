import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkAuth } from "@/lib/adminAuth";
import { CATEGORY_LABELS } from "@/lib/types";
import { sfDayKey, sfDayStart, sfDayEnd } from "@/lib/sfDate";
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

function checkCronOrAdminAuth(req: NextRequest): boolean {
  if (checkAuth(req)) return true;
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get("authorization");
    if (auth === `Bearer ${cronSecret}`) return true;
  }
  return false;
}

async function runAutoFeature() {
  const now = new Date();
  const todayKey = sfDayKey(now);
  const windowStart = sfDayStart(todayKey);
  const windowEnd = sfDayEnd(sfDayKey(addDays(now, 6)));

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

  if (remainingWeeklyBudget === 0) {
    return { ok: true, message: "Weekly featured limit already reached", featured: 0, blocked: 0 };
  }

  // Load the two most recent weekly reflections to feed back into the prompt
  const recentInsights = await prisma.curationInsight.findMany({
    orderBy: { weekOf: "desc" },
    take: 2,
    select: { insight: true },
  });

  // Build per-day budgets for the window
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
  }

  // Fetch candidate events (unfeatured, published, non-recurring, next 7 days)
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

  if (candidates.length === 0) {
    return { ok: true, message: "No candidate events found", featured: 0, blocked: 0 };
  }

  const clean = (s: string) => s.toWellFormed();
  const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

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
      return [
        `ID:${e.id}`,
        `Date: ${dayKey} (${DOW_LABELS[new Date(e.startDate).getDay()]})`,
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

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 8192,
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
${recentInsights.length > 0 ? `
---
${recentInsights.map((i) => i.insight).join("\n\n")}
---
` : ""}
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
    throw new Error(`Failed to parse AI response: ${text.slice(0, 200)}`);
  }

  let picks: { block: { id: string; reason: string }[]; feature: { id: string; reason: string }[] };
  try {
    picks = JSON.parse(jsonMatch[0]);
  } catch {
    throw new Error(`Invalid JSON from AI: ${jsonMatch[0].slice(0, 200)}`);
  }

  const candidateIds = new Set(candidates.map((c) => c.id));
  const candidateMap = new Map(candidates.map((c) => [c.id, c]));

  const toBlock = (picks.block ?? []).filter((b) => candidateIds.has(b.id));
  const blockIds = new Set(toBlock.map((b) => b.id));

  // Feature picks: valid IDs, not being blocked, within weekly budget
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
    } catch {
      // Already deleted — skip
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

  return {
    ok: true,
    featured: featureIds.length,
    blocked: blockedCount,
    reasons: {
      feature: toFeature.map((f) => ({ id: f.id, reason: f.reason })),
      block: toBlock.map((b) => ({ id: b.id, reason: b.reason })),
    },
  };
}

// GET — called by Vercel cron (Authorization: Bearer <CRON_SECRET>)
export async function GET(req: NextRequest) {
  if (!checkCronOrAdminAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await runAutoFeature();
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST — for manual admin triggers
export async function POST(req: NextRequest) {
  if (!checkCronOrAdminAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await runAutoFeature();
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
