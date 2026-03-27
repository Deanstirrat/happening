import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const ok = () => NextResponse.json({ ok: true });

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const { type, sessionId } = body;

    if (!sessionId || (type !== "VIEW" && type !== "CLICK")) return ok();

    // Only track featured events
    const event = await prisma.event.findUnique({
      where: { id },
      select: { featured: true },
    });
    if (!event?.featured) return ok();

    // Deduplicate: one VIEW or CLICK per session per event per calendar day
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);

    const existing = await prisma.eventInteraction.findFirst({
      where: { eventId: id, type, sessionId, createdAt: { gte: dayStart } },
      select: { id: true },
    });
    if (existing) return ok();

    await prisma.eventInteraction.create({
      data: { eventId: id, type, sessionId },
    });
  } catch {
    // Fire-and-forget: never surface errors to client
  }

  return ok();
}
