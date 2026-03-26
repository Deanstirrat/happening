export const dynamic = "force-dynamic";

import { Suspense } from "react";
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
  const startDate = params.startDate
    ? sfDayStart(params.startDate)
    : sfDayStart(sfDayKey(new Date()));
  const endDate = params.endDate
    ? sfDayEnd(params.endDate)
    : sfDayEnd(sfDayKey(addDays(new Date(), 30)));

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
    latitude: { not: null },
    longitude: { not: null },
    startDate: { gte: startDate, lte: endDate },
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
  const [sources, events] = await Promise.all([getSources(), getMapEvents(params)]);

  return (
    <div className="flex flex-col lg:flex-row h-auto lg:h-[calc(100vh-52px)]">
      {/* Filter sidebar */}
      <div className="w-full lg:w-52 lg:shrink-0 bg-surface-container-low overflow-y-auto py-4 lg:py-6 px-4 max-h-64 lg:max-h-none">
        <Suspense>
          <FilterSidebar sources={sources} />
        </Suspense>
      </div>

      {/* Map */}
      <div className="flex-1 relative isolate h-[60vh] lg:h-auto">
        <MapViewWrapper events={events} />
      </div>
    </div>
  );
}
