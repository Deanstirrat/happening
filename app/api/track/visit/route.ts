import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const ok = () => NextResponse.json({ ok: true });

export async function POST(req: NextRequest) {
  try {
    const { sessionId, path } = await req.json();

    if (!sessionId || !path || typeof path !== "string") return ok();
    // Don't track admin traffic
    if (path.startsWith("/admin")) return ok();

    // Deduplicate: one record per sessionId + path per hour
    const hourStart = new Date();
    hourStart.setMinutes(0, 0, 0);

    const existing = await prisma.pageVisit.findFirst({
      where: { sessionId, path, createdAt: { gte: hourStart } },
      select: { id: true },
    });
    if (existing) return ok();

    await prisma.pageVisit.create({ data: { sessionId, path } });
  } catch {
    // Fire-and-forget: never surface errors to client
  }

  return ok();
}
