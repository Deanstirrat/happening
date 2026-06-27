import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAdminUser } from "@/lib/auth";
import { CATEGORY_LABELS } from "@/lib/types";
import { sfDayKey, sfDayStart, sfDayEnd } from "@/lib/sfDate";
import { addDays } from "date-fns";
import { anthropic } from "@/lib/anthropic";

export async function POST(req: NextRequest) {
  if (!(await getAdminUser(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const todayKey = sfDayKey(now);
  const windowStart = sfDayStart(todayKey);
  const windowEnd = sfDayEnd(sfDayKey(addDays(now, 14)));

  const events = await prisma.event.findMany({
    where: {
      status: "PUBLISHED",
      featured: false,
      startDate: { gte: windowStart, lte: windowEnd },
      NOT: [
        { tags: { has: "recurring" } },
        { tags: { has: "sfpl" } },
        { category: "TECH" },
      ],
    },
    orderBy: { startDate: "asc" },
    take: 600,
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
        e.tags.length ? `Tags: ${e.tags.map(clean).join(", ")}` : null,
        desc ? `Description: ${desc}` : null,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n")
    .toWellFormed();

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 4096,
    messages: [
      {
        role: "user",
        content: `You are curating a 2-week events digest for "happening", a San Francisco events platform. Your job: surface the events locals actually talk about — things worth clearing your schedule for, showing your friends, or showing up to on a whim.

Calibrate your taste against these real examples of events that belong on the list:
- Community chaos: BYOBW (Big Wheel race down Potrero Hill), St. Stupid's Day Parade, Hunky Jesus Contest, Hole Party (digging holes together on Ocean Beach)
- SF underground institutions: EFUNK SF, Boofiversary, Endzeit x Northern Electronics lineups, East Bay Mean Girls anniversary, Honey Soundsystem
- Hybrid formats: Fight Night (rave + live wrestling), Folk Punk Prom, SF Beer Mile, South Side Beer Ride (free monthly brewery shuttle)
- Community with personality: FART MARKET, Bay Bingo: Tenderloin Edition, Curiosity Guild: Fool's Errand
- Civic/cultural moments: neighborhood protests that draw 90+ locations, congressional candidate debates, Carnaval dance competition
- Big deals: Black Coffee at Treasure Island, free Big Band swing dance in Golden Gate Park, God Awful Movies LIVE, PLOVERFEST at the Sunset Dunes

Select 20–30 events. Use this hierarchy:

STRONGLY FAVOR:
- Wild, weird, or irreverent street events — parades, happenings, absurdist community gatherings
- Participatory events where you show up and DO something (not just watch): races, rides, dances, community builds
- SF underground institutions and scene nights with a real identity (not just a venue with a DJ)
- Hybrid or unexpected formats: sport + party, rave + spectacle, game night with a neighborhood twist
- Civic and cultural moments: protests, debates, competitions that reflect SF's actual community life
- Anything with a "only in San Francisco" quality

INCLUDE IF genuinely notable:
- Electronic/club nights: only if the headliner is a rare SF appearance or international touring act, OR if it's a proven SF institution (longstanding queer party, specific subculture night, etc.)
- Talks or panels: only if the subject is unusual/provocative or the speaker is a genuine name
- Shows at established venues: only if the act is rare, touring infrequently, or otherwise special
- Art or film: only if experimental, boundary-pushing, or tied to a notable name

SKIP entirely:
- Generic weekly club nights with no distinct identity or scene
- Tech meetups, startup networking, corporate events
- Standard gallery openings, generic fitness/wellness, book readings from unknown authors
- SFPL library programs and services
- Anything that could happen in any American city

Note: duplicate listings for the same event may appear — pick the most descriptive one and skip the rest.

Return ONLY a valid JSON array — no prose before or after. Each element: { "id": "...", "reason": "one sentence why" }

Events to consider (${events.length} total, next 14 days, non-recurring):

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

  // Hydrate with full event data, then sort chronologically
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

  result.sort(
    (a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime()
  );

  return NextResponse.json({ picks: result, total: events.length });
}
