export const dynamic = "force-dynamic";

import { Suspense } from "react";
import { prisma } from "@/lib/prisma";
import FilterSidebar from "@/components/layout/FilterSidebar";
import DateGroup from "@/components/events/DateGroup";
import FeaturedCarousel from "@/components/events/FeaturedCarousel";
import TimeFilterTabs from "@/components/events/TimeFilterTabs";
import type { EventSummary } from "@/lib/types";
import { NON_MUSIC_CATEGORIES } from "@/lib/types";
import { addDays } from "date-fns";
import { sfDayKey, sfDayStart, sfDayEnd } from "@/lib/sfDate";
import { Prisma } from "@prisma/client";

interface SearchParams {
  startDate?: string;
  endDate?: string;
  category?: string | string[];
  neighborhood?: string | string[];
  source?: string | string[];
  isFree?: string;
  search?: string;
  page?: string;
  hideMusic?: string;
}

async function getWeeklyFeaturedEvents(): Promise<EventSummary[]> {
  const todayKey = sfDayKey(new Date());
  const todayStart = sfDayStart(todayKey);
  const weekEnd = addDays(sfDayEnd(todayKey), 6);
  const events = await prisma.event.findMany({
    where: {
      status: "PUBLISHED",
      featured: true,
      startDate: { gte: todayStart, lte: weekEnd },
    },
    orderBy: [{ featuredAt: "desc" }, { startDate: "asc" }],
    take: 10,
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
  });
  return events.map((e) => ({
    ...e,
    startDate: e.startDate.toISOString(),
    endDate: e.endDate?.toISOString() ?? null,
    featuredAt: e.featuredAt?.toISOString() ?? null,
  })) as EventSummary[];
}

async function getSources() {
  return prisma.source.findMany({
    where: { enabled: true },
    select: { slug: true, name: true },
    orderBy: { name: "asc" },
  });
}

async function getEvents(params: SearchParams): Promise<{
  grouped: Record<string, EventSummary[]>;
  total: number;
}> {
  const page = parseInt(params.page ?? "1");
  const limit = 150;
  const skip = (page - 1) * limit;

  const startDate = params.startDate
    ? sfDayStart(params.startDate)
    : sfDayStart(sfDayKey(new Date()));
  const endDate = params.endDate
    ? sfDayEnd(params.endDate)
    : sfDayEnd(sfDayKey(addDays(new Date(), 30)));

  const categories = params.category
    ? Array.isArray(params.category)
      ? params.category
      : [params.category]
    : [];
  const neighborhoods = params.neighborhood
    ? Array.isArray(params.neighborhood)
      ? params.neighborhood
      : [params.neighborhood]
    : [];
  const sources = params.source
    ? Array.isArray(params.source)
      ? params.source
      : [params.source]
    : [];

  // When hiding music, use non-music categories as inclusion list
  const effectiveCategories =
    params.hideMusic === "true" && categories.length === 0
      ? NON_MUSIC_CATEGORIES
      : params.hideMusic === "true"
      ? categories.filter((c) => !c.startsWith("MUSIC_"))
      : categories;

  const where: Prisma.EventWhereInput = {
    status: "PUBLISHED",
    startDate: { gte: startDate, lte: endDate },
    ...(effectiveCategories.length > 0 && {
      category: { in: effectiveCategories as any },
    }),
    ...(neighborhoods.length > 0 && {
      neighborhood: { in: neighborhoods },
    }),
    ...(sources.length > 0 && {
      source: { slug: { in: sources } },
    }),
    ...(params.isFree === "true" && { isFree: true }),
    ...(params.search && {
      OR: [
        { title: { contains: params.search, mode: "insensitive" } },
        { description: { contains: params.search, mode: "insensitive" } },
        { venueName: { contains: params.search, mode: "insensitive" } },
      ],
    }),
  };

  const [events, total] = await Promise.all([
    prisma.event.findMany({
      where,
      skip,
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

  // Group by day
  const grouped: Record<string, EventSummary[]> = {};
  for (const event of events) {
    const dayKey = sfDayKey(event.startDate); // YYYY-MM-DD in SF timezone
    if (!grouped[dayKey]) grouped[dayKey] = [];
    grouped[dayKey].push({
      ...event,
      startDate: event.startDate.toISOString(),
      endDate: event.endDate?.toISOString() ?? null,
      featuredAt: event.featuredAt?.toISOString() ?? null,
    } as EventSummary);
  }

  return { grouped, total };
}

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const [sources, { grouped, total }, weeklyFeatured] = await Promise.all([
    getSources(),
    getEvents(params),
    getWeeklyFeaturedEvents(),
  ]);

  const days = Object.keys(grouped).sort();
  const hasEvents = days.length > 0;

  return (
    <div className="max-w-screen-xl mx-auto px-4 sm:px-6 py-6 sm:py-8 flex flex-col lg:flex-row gap-6 lg:gap-8">
      {/* Filter sidebar */}
      <div className="w-full lg:w-52 lg:shrink-0">
        <Suspense>
          <FilterSidebar sources={sources} />
        </Suspense>
      </div>

      {/* Main content */}
      <div className="flex-1 min-w-0">
        {/* Hero headline */}
        <div className="mb-8">
          <h1 className="font-headline font-black text-4xl sm:text-5xl lg:text-6xl text-on-surface lowercase leading-none">
            san francisco
          </h1>
          <p className="font-body text-on-surface-variant text-sm mt-2">
            {total > 0
              ? `${total} event${total !== 1 ? "s" : ""} found`
              : "No events found — try adjusting your filters"}
          </p>
        </div>

        {weeklyFeatured.length > 0 && (
          <div className="mb-12">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-headline font-bold text-xl text-on-surface lowercase">featured events</h2>
              <Suspense>
                <TimeFilterTabs />
              </Suspense>
            </div>
            <FeaturedCarousel events={weeklyFeatured} />
          </div>
        )}

        {hasEvents ? (
          days.map((dayKey) => (
            <DateGroup
              key={dayKey}
              date={new Date(dayKey + "T12:00:00Z")}
              events={grouped[dayKey]}
            />
          ))
        ) : (
          <div className="flex flex-col items-center justify-center py-24 gap-4">
            <div className="text-5xl">🌉</div>
            <p className="font-body text-on-surface-variant text-center">
              No events match your filters.
              <br />
              Try a wider date range or fewer filters.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
