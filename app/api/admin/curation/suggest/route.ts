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

  // Build compact event list for the prompt
  const eventList = events
    .map((e) => {
      const cat = e.category ? CATEGORY_LABELS[e.category] : null;
      const venue = e.venueName ?? e.neighborhood ?? "";
      const price = e.isFree ? "Free" : (e.price ?? "");
      const desc = e.description ? e.description.slice(0, 200) : "";
      return [
        `ID:${e.id}`,
        `Title: ${e.title}`,
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
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    messages: [
      {
        role: "user",
        content: `You are curating a weekly events digest for San Francisco's "happening" platform — a discovery site for locals who want to find events off the beaten path.

Select 20–30 events from the list below worth featuring. Favor events that are:
- Unique, rare, or one-of-a-kind (not cookie-cutter)
- Underground, niche, or culturally specific
- Cerebral or artistic: readings, experimental music, gallery openings, film screenings, talks
- Nightlife or parties with a distinct identity — not generic club nights
- A good mix: some cerebral, some social/party-oriented
- Free or low-cost events often signal community-driven, authentic gatherings

Avoid: generic fitness classes, corporate networking events, repetitive mainstream concerts, tourist-facing events.

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
