import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { addDays, endOfDay } from "date-fns";
import { Prisma } from "@prisma/client";
import { NON_MUSIC_CATEGORIES } from "@/lib/types";
import { sfDayKey, sfDayStart, sfDayEnd, matchesTimeOfDay } from "@/lib/sfDate";

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;

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
  const view = p.get("view") ?? "list";
  const page = Math.max(1, parseInt(p.get("page") ?? "1"));
  const limit = Math.min(200, parseInt(p.get("limit") ?? "150"));

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
      orderBy: [{ featured: "desc" }, { featuredAt: "desc" }, { startDate: "asc" }],
      select: {
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
        _count: { select: { interests: true } },
      },
    }),
    prisma.event.count({ where }),
  ]);

  const filtered = timeOfDay
    ? rawEvents.filter((e) => matchesTimeOfDay(e.startDate, timeOfDay))
    : rawEvents;

  // Flatten the interest vote count into a top-level field for the client.
  const events = filtered.map(({ _count, ...e }) => ({
    ...e,
    interestCount: _count.interests,
  }));

  return NextResponse.json({
    events,
    total: timeOfDay ? events.length : total,
    page,
    totalPages: Math.ceil((timeOfDay ? events.length : total) / limit),
  });
}
