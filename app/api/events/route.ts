import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { addDays, endOfDay } from "date-fns";
import { Prisma } from "@prisma/client";
import { NON_MUSIC_CATEGORIES } from "@/lib/types";
import { sfDayKey, sfDayStart, sfDayEnd } from "@/lib/sfDate";

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;

  const now = new Date();
  const sfMidnightToday = sfDayStart(sfDayKey(now));

  // Extract search early so it can influence the date window
  const search = p.get("search") ?? "";

  // Default lower bound: today in SF timezone. When searching, drop the lower
  // bound so results aren't limited to upcoming events.
  const windowStart = p.get("startDate")
    ? sfDayStart(p.get("startDate")!)
    : search ? null : sfMidnightToday;
  const windowEnd = p.get("endDate")
    ? sfDayEnd(p.get("endDate")!)
    : endOfDay(addDays(now, 30));

  const categories = p.getAll("category");
  const neighborhoods = p.getAll("neighborhood");
  const sources = p.getAll("source");
  const isFree = p.get("isFree") === "true";
  const hideMusic = p.get("hideMusic") === "true";
  const hideRecurring = p.get("hideRecurring") === "true";
  const view = p.get("view") ?? "list";
  const page = Math.max(1, parseInt(p.get("page") ?? "1"));
  const limit = Math.min(200, parseInt(p.get("limit") ?? "150"));

  const effectiveCategories =
    hideMusic && categories.length === 0
      ? NON_MUSIC_CATEGORIES
      : hideMusic
      ? categories.filter((c) => !c.startsWith("MUSIC_"))
      : categories;

  // Exclude events that are completely in the past (SF timezone).
  // - Multi-day events: include if endDate >= today (SF)
  // - Single-day events: include if startDate >= today (SF)
  // Only applied when a date window is active (i.e. not a search-all query).
  const notEndedCondition: Prisma.EventWhereInput | null = windowStart
    ? {
        OR: [
          { endDate: { gte: sfMidnightToday } },
          { endDate: null, startDate: { gte: sfMidnightToday } },
        ],
      }
    : null;

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
    // Hide events that have already ended
    AND: [
      ...(notEndedCondition ? [notEndedCondition] : []),
      ...(searchCondition ? [searchCondition] : []),
    ],
    startDate: {
      ...(windowStart ? { gte: windowStart } : {}),
      lte: windowEnd,
    },
    ...(effectiveCategories.length > 0 && { category: { in: effectiveCategories as any } }),
    ...(neighborhoods.length > 0 && { neighborhood: { in: neighborhoods } }),
    ...(sources.length > 0 && { source: { slug: { in: sources } } }),
    ...(isFree && { isFree: true }),
    ...(hideRecurring && { NOT: { tags: { has: "recurring" } } }),
    // map view only returns events with coordinates
    ...(view === "map" && {
      latitude: { not: null },
      longitude: { not: null },
    }),
  };

  const [events, total] = await Promise.all([
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
      },
    }),
    prisma.event.count({ where }),
  ]);

  return NextResponse.json({
    events,
    total,
    page,
    totalPages: Math.ceil(total / limit),
  });
}
