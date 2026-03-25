import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const sources = await prisma.source.findMany({
    where: { enabled: true },
    orderBy: { name: "asc" },
    include: { _count: { select: { events: true } } },
  });
  return NextResponse.json(sources);
}
