export const dynamic = "force-dynamic";

import { Suspense } from "react";
import { prisma } from "@/lib/prisma";
import FilterSidebar from "@/components/layout/FilterSidebar";
import MapViewWrapper from "@/components/map/MapViewWrapper";
import { addDays, startOfDay, endOfDay } from "date-fns";
import type { EventSummary } from "@/lib/types";
import { Prisma } from "@prisma/client";

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
    ? new Date(params.startDate + "T00:00:00.000Z")
    : startOfDay(new Date());
  const endDate = params.endDate
    ? new Date(params.endDate + "T23:59:59.999Z")
    : endOfDay(addDays(new Date(), 30));

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
    <div className="flex h-[calc(100vh-52px)]">
      {/* Filter sidebar */}
      <div className="w-52 shrink-0 bg-surface-container-low overflow-y-auto py-6 px-4">
        <Suspense>
          <FilterSidebar sources={sources} />
        </Suspense>
      </div>

      {/* Map */}
      <div className="flex-1 relative isolate">
        <MapViewWrapper events={events} />
      </div>
    </div>
  );
}
