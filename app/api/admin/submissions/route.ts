import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

function checkAuth(req: NextRequest): boolean {
  const secret = process.env.SCRAPE_SECRET;
  if (!secret) return false;
  return req.headers.get("x-scrape-secret") === secret;
}

export async function GET(req: NextRequest) {
  if (!checkAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const events = await prisma.event.findMany({
    where: { status: "PENDING" },
    orderBy: { scrapedAt: "desc" },
    select: {
      id: true,
      title: true,
      startDate: true,
      venueName: true,
      venueAddress: true,
      neighborhood: true,
      category: true,
      price: true,
      isFree: true,
      description: true,
      sourceUrl: true,
      tags: true,
      submitterNote: true,
      scrapedAt: true,
    },
  });

  return NextResponse.json({ events });
}

export async function POST(req: NextRequest) {
  if (!checkAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, action } = await req.json();

  if (!id || !["approve", "reject"].includes(action)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const status = action === "approve" ? "PUBLISHED" : "REJECTED";
  await prisma.event.update({ where: { id }, data: { status } });

  return NextResponse.json({ success: true, status });
}
