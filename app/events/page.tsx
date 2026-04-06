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
import { sfDayKey, sfDayStart, sfDayEnd, matchesTimeOfDay } from "@/lib/sfDate";
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
  hideRecurring?: string;
  timeOfDay?: string;
}

async function getWeeklyFeaturedEvents(
  params: Pick<SearchParams, "hideMusic" | "hideRecurring" | "timeOfDay" | "startDate" | "endDate">
): Promise<EventSummary[]> {
  const now = new Date();
  const todayKey = sfDayKey(now);
  const todayStart = sfDayStart(todayKey);
  const weekEnd = addDays(sfDayEnd(todayKey), 6);
  const queryStart = params.startDate ? sfDayStart(params.startDate) : todayStart;
  const queryEnd = params.endDate ? sfDayEnd(params.endDate) : weekEnd;
  const events = await prisma.event.findMany({
    where: {
      status: "PUBLISHED",
      featured: true,
      OR: [
        { endDate: { gte: todayStart } },
        { endDate: null, startDate: { gte: todayStart } },
      ],
      startDate: { gte: queryStart, lte: queryEnd },
      ...(params.hideMusic === "true" && { category: { in: NON_MUSIC_CATEGORIES as any } }),
      ...(params.hideRecurring === "true" && { NOT: { tags: { has: "recurring" } } }),
    },
    orderBy: [{ startDate: "asc" }],
    take: 15,
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
  const filtered = params.timeOfDay
    ? events.filter((e) => matchesTimeOfDay(e.startDate, params.timeOfDay!))
    : events;
  return filtered.map((e) => ({
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

const MAX_DAYS = 10;
const INITIAL_PER_OTHER_DAY = 10;

async function getEvents(params: SearchParams): Promise<{
  grouped: Record<string, EventSummary[]>;
  hasMorePerDay: Record<string, boolean>;
  total: number;
}> {
  const hasSearch = !!params.search;
  const now = new Date();
  const todayKey = sfDayKey(now);
  const todayStart = sfDayStart(todayKey);
  // Default lower bound: SF midnight today. Drop it only when searching so
  // search results aren't limited to upcoming events.
  const windowStart = params.startDate
    ? sfDayStart(params.startDate)
    : hasSearch ? null : todayStart;
  const windowEnd = params.endDate
    ? sfDayEnd(params.endDate)
    : hasSearch ? null : sfDayEnd(sfDayKey(addDays(now, 30)));

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

  // Exclude events that are completely in the past (SF timezone).
  // Only applied when a date window is active (not a search-all query).
  const notEndedCondition: Prisma.EventWhereInput | null = windowStart
    ? {
        OR: [
          { endDate: { gte: todayStart } },
          { endDate: null, startDate: { gte: todayStart } },
        ],
      }
    : null;

  const searchCondition: Prisma.EventWhereInput | null = params.search
    ? {
        OR: [
          { title: { contains: params.search, mode: "insensitive" } },
          { description: { contains: params.search, mode: "insensitive" } },
          { venueName: { contains: params.search, mode: "insensitive" } },
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
    ...(windowStart || windowEnd
      ? {
          startDate: {
            ...(windowStart ? { gte: windowStart } : {}),
            ...(windowEnd ? { lte: windowEnd } : {}),
          },
        }
      : {}),
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
    ...(params.hideRecurring === "true" && {
      NOT: { tags: { has: "recurring" } },
    }),
  };

  // Fetch enough events to fill MAX_DAYS days. We over-fetch slightly so we
  // can detect whether each day has more events beyond INITIAL_PER_OTHER_DAY.
  const rawEvents = await prisma.event.findMany({
    where,
    take: 2000,
    orderBy: [{ startDate: "asc" }],
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

  const filteredEvents = params.timeOfDay
    ? rawEvents.filter((e) => matchesTimeOfDay(e.startDate, params.timeOfDay!))
    : rawEvents;

  // Group all events by day
  const allGrouped: Record<string, EventSummary[]> = {};
  for (const event of filteredEvents) {
    const dk = sfDayKey(event.startDate);
    if (!allGrouped[dk]) allGrouped[dk] = [];
    allGrouped[dk].push({
      ...event,
      startDate: event.startDate.toISOString(),
      endDate: event.endDate?.toISOString() ?? null,
      featuredAt: event.featuredAt?.toISOString() ?? null,
    } as EventSummary);
  }

  // Keep at most MAX_DAYS days; for non-today days slice to INITIAL_PER_OTHER_DAY
  const allDays = Object.keys(allGrouped).sort();
  const visibleDays = allDays.slice(0, MAX_DAYS);

  const grouped: Record<string, EventSummary[]> = {};
  const hasMorePerDay: Record<string, boolean> = {};
  for (const dk of visibleDays) {
    const all = allGrouped[dk];
    if (dk === todayKey) {
      grouped[dk] = all;
      hasMorePerDay[dk] = false;
    } else {
      grouped[dk] = all.slice(0, INITIAL_PER_OTHER_DAY);
      hasMorePerDay[dk] = all.length > INITIAL_PER_OTHER_DAY;
    }
  }

  const total = filteredEvents.length;
  return { grouped, hasMorePerDay, total };
}

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const [sources, { grouped, hasMorePerDay, total }, weeklyFeatured] = await Promise.all([
    getSources(),
    getEvents(params),
    getWeeklyFeaturedEvents(params),
  ]);

  const days = Object.keys(grouped).sort();
  const hasEvents = days.length > 0;

  // Hide carousel only when "deep" filters are active (category, neighborhood, source, free, search)
  const hasNonTopFilters = !!(
    params.category || params.neighborhood || params.source ||
    params.isFree || params.search
  );

  const hasActiveFilters = !!(
    params.startDate || params.endDate || params.category ||
    params.neighborhood || params.source || params.isFree ||
    params.search || params.hideMusic || params.hideRecurring ||
    params.timeOfDay
  );

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

        {!hasNonTopFilters && weeklyFeatured.length > 0 && (
          <div className="mb-6">
            <h2 className="font-headline font-bold text-xl text-on-surface lowercase mb-3">featured events</h2>
            <FeaturedCarousel events={weeklyFeatured} />
          </div>
        )}

        {/* Quick filters — always visible */}
        <div className="mb-8">
          <Suspense>
            <TimeFilterTabs />
          </Suspense>
        </div>

        {hasEvents ? (
          days.map((dayKey) => (
            <DateGroup
              key={dayKey}
              dayKey={dayKey}
              date={new Date(dayKey + "T12:00:00Z")}
              events={grouped[dayKey]}
              initialHasMore={hasMorePerDay[dayKey] ?? false}
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
