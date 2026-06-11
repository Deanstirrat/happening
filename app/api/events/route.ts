import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { addDays, endOfDay } from "date-fns";
import { Prisma } from "@prisma/client";
import { NON_MUSIC_CATEGORIES } from "@/lib/types";
import { sfDayKey, sfDayStart, sfDayEnd, matchesTimeOfDay } from "@/lib/sfDate";
import { QUALITY_ORDER_BY } from "@/lib/ranking";

// Card-shaped projection shared by the list query and the by-ids lookup so both
// return the same EventSummary fields.
const EVENT_CARD_SELECT = {
  id: true,
  title: true,
  startDate: true,
  endDate: true,
  allDay: true,
  venueName: true,
  venueAddress: true,
  neighborhood: true,
  category: true,
  price: true,
  isFree: true,
  imageUrl: true,
  sourceUrl: true,
  tags: true,
  latitude: true,
  longitude: true,
  featured: true,
  featuredAt: true,
  source: { select: { slug: true, name: true } },
  externalInterest: true,
  _count: { select: { interests: true } },
} satisfies Prisma.EventSelect;

// Same flattening the list path uses: blend in-app votes with the source's
// external interest signal into a single top-level count.
function withInterestCount<T extends { _count: { interests: number }; externalInterest: number }>(
  e: T
) {
  const { _count, externalInterest, ...rest } = e;
  return { ...rest, interestCount: _count.interests + externalInterest };
}

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;

  // By-ids lookup powers the saved-events view (localStorage-backed). It returns
  // exactly the requested PUBLISHED events with no date window — a saved event
  // can be days out or already underway — and preserves no particular order, so
  // the client sorts. Unknown/unpublished ids are silently dropped.
  const idsParam = p.get("ids");
  if (idsParam !== null) {
    const ids = [...new Set(idsParam.split(",").map((s) => s.trim()).filter(Boolean))].slice(0, 200);
    if (ids.length === 0) {
      return NextResponse.json({ events: [], total: 0, page: 1, totalPages: 0 });
    }
    const rawEvents = await prisma.event.findMany({
      where: { status: "PUBLISHED", id: { in: ids } },
      select: EVENT_CARD_SELECT,
    });
    const events = rawEvents.map(withInterestCount);
    return NextResponse.json({ events, total: events.length, page: 1, totalPages: 1 });
  }

  const now = new Date();
  const sfMidnightToday = sfDayStart(sfDayKey(now));

  // Extract search early so it can influence the date window
  const search = p.get("search") ?? "";

  // Default lower bound: today in SF timezone.
  const windowStart = p.get("startDate")
    ? sfDayStart(p.get("startDate")!)
    : sfMidnightToday;
  const windowEnd = p.get("endDate")
    ? sfDayEnd(p.get("endDate")!)
    : endOfDay(addDays(now, 30));

  const categories = p.getAll("category");
  const excludedCategories = p.getAll("excludeCategory");
  const neighborhoods = p.getAll("neighborhood");
  const sources = p.getAll("source");
  const excludedSources = p.getAll("excludeSource");
  const isFree = p.get("isFree") === "true";
  const hideMusic = p.get("hideMusic") === "true";
  const hideRecurring = p.get("hideRecurring") === "true";
  const timeOfDay = p.get("timeOfDay") ?? "";
  const sort = p.get("sort") ?? "";
  const view = p.get("view") ?? "list";
  // Guard against non-numeric input: parseInt(...) yields NaN, which Prisma
  // rejects with a 500. Fall back to defaults and clamp to a sane range.
  const parsedPage = parseInt(p.get("page") ?? "1");
  const page = Number.isFinite(parsedPage) ? Math.max(1, parsedPage) : 1;
  const parsedLimit = parseInt(p.get("limit") ?? "150");
  const limit = Number.isFinite(parsedLimit)
    ? Math.min(200, Math.max(1, parsedLimit))
    : 150;

  const effectiveCategories =
    hideMusic && categories.length === 0
      ? NON_MUSIC_CATEGORIES
      : hideMusic
      ? categories.filter((c) => !c.startsWith("MUSIC_"))
      : categories;

  // Always exclude events that are completely in the past (SF timezone).
  // - Multi-day events: include if endDate >= today (SF)
  // - Single-day events: include if startDate >= today (SF)
  const notEndedCondition: Prisma.EventWhereInput = {
    OR: [
      { endDate: { gte: sfMidnightToday } },
      { endDate: null, startDate: { gte: sfMidnightToday } },
    ],
  };

  const searchCondition: Prisma.EventWhereInput | null = search
    ? {
        OR: [
          { title: { contains: search, mode: "insensitive" } },
          { description: { contains: search, mode: "insensitive" } },
          { venueName: { contains: search, mode: "insensitive" } },
        ],
      }
    : null;

  const where: Prisma.EventWhereInput = {
    status: "PUBLISHED",
    AND: [
      notEndedCondition,
      ...(searchCondition ? [searchCondition] : []),
      ...(hideRecurring ? [{ NOT: { tags: { has: "recurring" } } }] : []),
      ...(excludedCategories.length > 0 ? [{ NOT: { category: { in: excludedCategories as any } } }] : []),
      ...(excludedSources.length > 0 ? [{ NOT: { source: { slug: { in: excludedSources } } } }] : []),
    ],
    startDate: {
      ...(windowStart ? { gte: windowStart } : {}),
      lte: windowEnd,
    },
    ...(effectiveCategories.length > 0 && { category: { in: effectiveCategories as any } }),
    ...(neighborhoods.length > 0 && { neighborhood: { in: neighborhoods } }),
    ...(sources.length > 0 && { source: { slug: { in: sources } } }),
    ...(isFree && { isFree: true }),
    ...(view === "map" && {
      latitude: { not: null },
      longitude: { not: null },
    }),
  };

  const [rawEvents, total] = await Promise.all([
    prisma.event.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      // Default feed favors higher-signal events (flyer, geocoded venue,
      // non-recurring) so recurring filler pages out behind "show more".
      // ?sort=time restores pure chronological order. Featured events still
      // lead either way. See lib/ranking.ts.
      orderBy:
        sort === "time"
          ? [{ featured: "desc" }, { featuredAt: "desc" }, { startDate: "asc" }]
          : [{ featured: "desc" }, { featuredAt: "desc" }, ...QUALITY_ORDER_BY],
      select: EVENT_CARD_SELECT,
    }),
    prisma.event.count({ where }),
  ]);

  const filtered = timeOfDay
    ? rawEvents.filter((e) => matchesTimeOfDay(e.startDate, timeOfDay))
    : rawEvents;

  const events = filtered.map(withInterestCount);

  return NextResponse.json({
    events,
    total: timeOfDay ? events.length : total,
    page,
    totalPages: Math.ceil((timeOfDay ? events.length : total) / limit),
  });
}
