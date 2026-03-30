export const dynamic = "force-dynamic";

import { Suspense } from "react";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import FilterSidebar from "@/components/layout/FilterSidebar";
import MapViewWrapper from "@/components/map/MapViewWrapper";
import { addDays } from "date-fns";
import type { EventSummary } from "@/lib/types";
import { Prisma } from "@prisma/client";
import { sfDayStart, sfDayEnd, sfDayKey } from "@/lib/sfDate";

interface SearchParams {
  startDate?: string;
  endDate?: string;
  category?: string | string[];
  neighborhood?: string | string[];
  source?: string | string[];
  isFree?: string;
}

async function getSources() {
  return prisma.source.findMany({
    where: { enabled: true },
    select: { slug: true, name: true },
    orderBy: { name: "asc" },
  });
}

async function getMapEvents(params: SearchParams): Promise<EventSummary[]> {
  const now = new Date();
  const todayStart = sfDayStart(sfDayKey(now));
  const windowStart = params.startDate ? sfDayStart(params.startDate) : null;
  const windowEnd = params.endDate
    ? sfDayEnd(params.endDate)
    : sfDayEnd(sfDayKey(addDays(now, 30)));

  const categories = params.category
    ? Array.isArray(params.category) ? params.category : [params.category]
    : [];
  const neighborhoods = params.neighborhood
    ? Array.isArray(params.neighborhood) ? params.neighborhood : [params.neighborhood]
    : [];
  const sources = params.source
    ? Array.isArray(params.source) ? params.source : [params.source]
    : [];

  const where: Prisma.EventWhereInput = {
    status: "PUBLISHED",
    latitude: { not: null },
    longitude: { not: null },
    // Hide events that have already ended
    OR: [
      { endDate: { gte: now } },
      { endDate: null, startDate: { gte: todayStart } },
    ],
    startDate: {
      ...(windowStart ? { gte: windowStart } : {}),
      lte: windowEnd,
    },
    ...(categories.length > 0 && { category: { in: categories as any } }),
    ...(neighborhoods.length > 0 && { neighborhood: { in: neighborhoods } }),
    ...(sources.length > 0 && { source: { slug: { in: sources } } }),
    ...(params.isFree === "true" && { isFree: true }),
  };

  const events = await prisma.event.findMany({
    where,
    take: 500,
    orderBy: { startDate: "asc" },
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
      source: { select: { slug: true, name: true } },
    },
  });

  return events.map((e) => ({
    ...e,
    startDate: e.startDate.toISOString(),
    endDate: e.endDate?.toISOString() ?? null,
  })) as EventSummary[];
}

export default async function MapPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;

  // Default to today when no date is specified
  if (!params.startDate && !params.endDate) {
    const today = sfDayKey(new Date());
    const qs = new URLSearchParams({ startDate: today, endDate: today });
    // Preserve any other filters the user may have set
    for (const [k, v] of Object.entries(params)) {
      if (k !== "startDate" && k !== "endDate") {
        if (Array.isArray(v)) v.forEach((val) => qs.append(k, val));
        else if (v) qs.set(k, v);
      }
    }
    redirect(`/map?${qs.toString()}`);
  }

  const [sources, events] = await Promise.all([getSources(), getMapEvents(params)]);

  return (
    <div className="flex flex-col lg:flex-row h-auto lg:h-[calc(100vh-52px)]">
      {/* Filter sidebar */}
      <div className="relative w-full lg:w-52 lg:shrink-0 bg-surface-container-low overflow-y-auto py-4 lg:py-6 px-4 max-h-64 lg:max-h-none z-10">
        <Suspense>
          <FilterSidebar sources={sources} />
        </Suspense>
      </div>

      {/* Map */}
      <div className="shrink-0 h-[60vh] lg:flex-1 lg:h-auto relative isolate">
        <MapViewWrapper events={events} />
      </div>
    </div>
  );
}
