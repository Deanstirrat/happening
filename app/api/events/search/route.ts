import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";

  if (!q || q.length < 2) {
    return NextResponse.json({ events: [] });
  }

  const events = await prisma.event.findMany({
    where: {
      status: "PUBLISHED",
      startDate: { gte: new Date() },
      OR: [
        { title: { contains: q, mode: "insensitive" } },
        { venueName: { contains: q, mode: "insensitive" } },
      ],
    },
    take: 10,
    orderBy: { startDate: "asc" },
    select: {
      id: true,
      title: true,
      startDate: true,
      endDate: true,
      venueName: true,
      neighborhood: true,
      category: true,
      price: true,
      isFree: true,
      imageUrl: true,
      description: true,
      tags: true,
      sourceUrl: true,
    },
  });

  return NextResponse.json({ events });
}
