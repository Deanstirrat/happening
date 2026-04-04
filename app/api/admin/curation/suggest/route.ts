import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkAuth } from "@/lib/adminAuth";
import { CATEGORY_LABELS } from "@/lib/types";
import { sfDayKey, sfDayStart, sfDayEnd } from "@/lib/sfDate";
import { addDays } from "date-fns";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();

export async function POST(req: NextRequest) {
  if (!checkAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const todayKey = sfDayKey(now);
  const windowStart = sfDayStart(todayKey);
  const windowEnd = sfDayEnd(sfDayKey(addDays(now, 7)));

  const events = await prisma.event.findMany({
    where: {
      status: "PUBLISHED",
      featured: false,
      startDate: { gte: windowStart, lte: windowEnd },
      NOT: { tags: { has: "recurring" } },
    },
    orderBy: { startDate: "asc" },
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
      imageUrl: true,
      featuredAt: true,
      featured: true,
      source: { select: { slug: true, name: true } },
    },
  });

  if (events.length === 0) {
    return NextResponse.json({ picks: [], total: 0 });
  }

  // Sanitize strings to remove lone surrogates that break JSON serialization
  const clean = (s: string) => s.toWellFormed();

  // Build compact event list for the prompt
  const eventList = events
    .map((e) => {
      const cat = e.category ? CATEGORY_LABELS[e.category] : null;
      const venue = clean(e.venueName ?? e.neighborhood ?? "");
      const price = e.isFree ? "Free" : clean(e.price ?? "");
      const desc = e.description ? clean(e.description).slice(0, 200) : "";
      return [
        `ID:${e.id}`,
        `Title: ${clean(e.title)}`,
        `Date: ${e.startDate.toISOString()}`,
        venue ? `Venue: ${venue}` : null,
        cat ? `Category: ${cat}` : null,
        price ? `Price: ${price}` : null,
        e.tags.length ? `Tags: ${e.tags.join(", ")}` : null,
        desc ? `Description: ${desc}` : null,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 4096,
    messages: [
      {
        role: "user",
        content: `You are curating a weekly events digest for San Francisco's "happening" platform. Your job is to surface the most interesting, wild, and distinctly San Francisco events of the week — the stuff locals talk about and visitors never find.

The gold standard: events like the St. Stupid's Day Parade (irreverent street chaos, pure SF counterculture) or BYOBW (strangers riding Big Wheels down a hill at full speed). Weird, participatory, only-in-SF energy. Prioritize this above everything else.

Select 20–30 events. Use this hierarchy:

STRONGLY FAVOR:
- Wild, weird, or irreverent events — street happenings, counterculture parades, absurdist gatherings, DIY spectacles
- Participatory events where you show up and *do* something (not just watch)
- Underground parties or nights with a very distinct identity, scene, or subculture
- Anything that could only happen in San Francisco

INCLUDE IF they have edge, weirdness, or are genuinely a big deal:
- Talks, panels, or readings — only if the subject matter is unusual/provocative OR the speaker is a major name
- Ticketed shows at established venues — only if the act is rare, touring infrequently, or otherwise special
- Art or film events — only if experimental, boundary-pushing, or tied to a notable name/moment

SKIP entirely:
- Standard gallery openings, regular club nights, generic fitness/wellness classes
- Corporate networking, startup events, tech meetups
- Book readings from unknown authors, run-of-the-mill live music
- Anything that could happen in any American city

Return ONLY a valid JSON array — no prose before or after. Each element: { "id": "...", "reason": "one sentence why" }

Events to consider (${events.length} total, next 7 days, non-recurring):

${eventList}`,
      },
    ],
  });

  const text =
    message.content[0].type === "text" ? message.content[0].text : "";

  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    return NextResponse.json(
      { error: "Failed to parse AI response", raw: text },
      { status: 500 }
    );
  }

  let picks: { id: string; reason: string }[];
  try {
    picks = JSON.parse(jsonMatch[0]);
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON from AI", raw: text },
      { status: 500 }
    );
  }

  // Hydrate with full event data, preserving AI ordering
  const pickedIds = picks.map((p) => p.id);
  const pickedEvents = await prisma.event.findMany({
    where: { id: { in: pickedIds } },
    select: {
      id: true,
      title: true,
      description: true,
      startDate: true,
      endDate: true,
      venueName: true,
      neighborhood: true,
      category: true,
      tags: true,
      isFree: true,
      price: true,
      imageUrl: true,
      featured: true,
      featuredAt: true,
      source: { select: { slug: true, name: true } },
    },
  });

  const eventMap = new Map(pickedEvents.map((e) => [e.id, e]));
  const result = picks
    .filter((p) => eventMap.has(p.id))
    .map((p) => {
      const e = eventMap.get(p.id)!;
      return {
        ...e,
        reason: p.reason,
        startDate: e.startDate.toISOString(),
        endDate: e.endDate?.toISOString() ?? null,
        featuredAt: e.featuredAt?.toISOString() ?? null,
      };
    });

  return NextResponse.json({ picks: result, total: events.length });
}
