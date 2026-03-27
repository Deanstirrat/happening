import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { addDays, endOfDay, startOfDay } from "date-fns";
import { Prisma } from "@prisma/client";
import { NON_MUSIC_CATEGORIES } from "@/lib/types";

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;

  const startDate = p.get("startDate")
    ? new Date(p.get("startDate")! + "T00:00:00.000Z")
    : startOfDay(new Date());
  const endDate = p.get("endDate")
    ? new Date(p.get("endDate")! + "T23:59:59.999Z")
    : endOfDay(addDays(new Date(), 30));

  const categories = p.getAll("category");
  const neighborhoods = p.getAll("neighborhood");
  const sources = p.getAll("source");
  const isFree = p.get("isFree") === "true";
  const hideMusic = p.get("hideMusic") === "true";
  const search = p.get("search") ?? "";
  const view = p.get("view") ?? "list";
  const page = Math.max(1, parseInt(p.get("page") ?? "1"));
  const limit = Math.min(200, parseInt(p.get("limit") ?? "150"));

  const effectiveCategories =
    hideMusic && categories.length === 0
      ? NON_MUSIC_CATEGORIES
      : hideMusic
      ? categories.filter((c) => !c.startsWith("MUSIC_"))
      : categories;

  const where: Prisma.EventWhereInput = {
    status: "PUBLISHED",
    startDate: { gte: startDate, lte: endDate },
    ...(effectiveCategories.length > 0 && { category: { in: effectiveCategories as any } }),
    ...(neighborhoods.length > 0 && { neighborhood: { in: neighborhoods } }),
    ...(sources.length > 0 && { source: { slug: { in: sources } } }),
    ...(isFree && { isFree: true }),
    ...(search && {
      OR: [
        { title: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
        { venueName: { contains: search, mode: "insensitive" } },
      ],
    }),
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
